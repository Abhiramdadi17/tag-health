using System.Globalization;
using System.Text.Json;
using backend_dotnet.Models;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace backend_dotnet.Services;

/// <summary>
/// ONNX-backed predictor. Loads the six LightGBM models exported by
/// <c>scripts/export_lgbm_to_onnx.py</c> and produces the same response shape
/// as the original Python forecaster. The precursor-risk model is calibrated
/// with the isotonic mapping embedded in its meta sidecar; the four spike
/// classifiers and the future_error_pct regressor populate the rest of the
/// HybridPrediction body.
///
/// If any model is missing on disk the constructor falls back to disabled
/// state and Predict returns null, so the wrapper can drop back to the
/// heuristic scorer without crashing.
/// </summary>
public sealed class OnnxRiskPredictor : IDisposable
{
    private readonly ILogger<OnnxRiskPredictor> _logger;
    private readonly TftAttentionService _tft;
    private readonly Dictionary<string, OnnxModel> _models = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _modelVersions = new();
    private bool _disposed;

    public bool IsReady { get; }
    public IReadOnlyDictionary<string, string> ModelVersions => _modelVersions;

    private static readonly string[] RequiredModels =
    {
        "precursor_risk",
        "future_error_pct",
        "spike_within_window",
        "spike_5m",
        "spike_10m",
        "spike_15m",
    };

    public OnnxRiskPredictor(ILogger<OnnxRiskPredictor> logger, IConfiguration config, TftAttentionService tft)
    {
        _logger = logger;
        _tft = tft;
        var modelDir = ResolveModelDir(config);
        if (modelDir is null)
        {
            _logger.LogWarning("ONNX model directory not found; falling back to heuristic predictor");
            IsReady = false;
            return;
        }

        foreach (var name in RequiredModels)
        {
            var onnxPath = Path.Combine(modelDir, $"{name}.onnx");
            var metaPath = Path.Combine(modelDir, $"{name}.meta.json");
            if (!File.Exists(onnxPath) || !File.Exists(metaPath))
            {
                _logger.LogWarning("Missing artefact for {Name}", name);
                IsReady = false;
                Dispose();
                return;
            }

            try
            {
                var meta = JsonSerializer.Deserialize<OnnxMeta>(File.ReadAllText(metaPath))
                          ?? throw new InvalidOperationException("empty meta");
                var session = new InferenceSession(onnxPath, new Microsoft.ML.OnnxRuntime.SessionOptions { LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR });
                _models[name] = new OnnxModel(session, meta);
                _modelVersions[name] = "onnx-lgbm-v1";
                _logger.LogInformation("Loaded {Name}: {Count} features, kind={Kind}", name, meta.Features.Count, meta.Kind);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed loading {Name}", name);
                IsReady = false;
                Dispose();
                return;
            }
        }

        if (_tft.IsReady)
        {
            _modelVersions["tft"] = _tft.ModelVersion;
        }
        IsReady = true;
    }

    private static string? ResolveModelDir(IConfiguration config)
    {
        var candidates = new[]
        {
            config["OnnxModelDir"],
            Path.Combine(AppContext.BaseDirectory, "models", "onnx"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "models", "onnx"),
            Path.Combine(Directory.GetCurrentDirectory(), "models", "onnx"),
        };
        foreach (var c in candidates)
        {
            if (string.IsNullOrEmpty(c)) continue;
            var full = Path.GetFullPath(c);
            if (Directory.Exists(full)) return full;
        }
        return null;
    }

    public HybridPrediction? Predict(PredictRequest request)
    {
        if (!IsReady) return null;

        var featureDict = PythonFeatureEngineer.Build(request);

        var rawRisk = RunRegressor("precursor_risk", featureDict);
        var calibratedRisk = ApplyIsotonic(_models["precursor_risk"].Meta, rawRisk);
        var smoothing = _models["precursor_risk"].Meta.SmoothingAlpha ?? 0.25;
        var riskScore = Math.Clamp(calibratedRisk * (1 + smoothing * 0.0), 0.0, 1.0);
        var riskClass = ClassifyRisk(riskScore);

        var predictedDeviation = RunRegressor("future_error_pct", featureDict);

        var spike = new SpikeProbability
        {
            InBatch = Math.Round(RunClassifierPositive("spike_within_window", featureDict), 3),
            FiveMin = Math.Round(RunClassifierPositive("spike_5m", featureDict), 3),
            TenMin = Math.Round(RunClassifierPositive("spike_10m", featureDict), 3),
            FifteenMin = Math.Round(RunClassifierPositive("spike_15m", featureDict), 3),
        };

        var leadTime = ComputeLeadTime(riskScore, spike);

        var tftOut = _tft.IsReady ? _tft.Run(featureDict) : null;
        var temporalAttention = tftOut?.Attention ?? ComputeTemporalAttention(featureDict);

        return new HybridPrediction
        {
            Timestamp = request.Timestamp ?? DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            EntityId = request.EntityId,
            RiskScore = Math.Round(riskScore, 4),
            RiskClass = riskClass,
            LeadTimeMinutes = Math.Round(leadTime, 1),
            PredictedDeviation = Math.Round(predictedDeviation, 3),
            SpikeProbability = spike,
            TopPrecursors = BuildPrecursors(featureDict, _models["precursor_risk"].Meta),
            TemporalAttention = temporalAttention,
            UncertaintyBand = new UncertaintyBand
            {
                P10 = Math.Round(predictedDeviation * 0.7, 3),
                P50 = Math.Round(predictedDeviation, 3),
                P90 = Math.Round(predictedDeviation * 1.3, 3),
            },
            TrajectorySummary = BuildTrajectory(riskClass, featureDict),
            Confidence = Math.Round(Math.Clamp(0.85 + 0.15 * (1.0 - GetFeature(featureDict, "volatility_index") / 5.0), 0.45, 0.99), 3),
            ModelVersions = new Dictionary<string, string>(_modelVersions),
        };
    }

    public BatchPredictResponse? PredictBatch(IEnumerable<PredictRequest> requests)
    {
        if (!IsReady) return null;
        var preds = new List<HybridPrediction>();
        foreach (var req in requests)
        {
            var p = Predict(req);
            if (p is not null) preds.Add(p);
        }
        var risk = new Dictionary<string, int>
        {
            ["low"] = 0, ["medium"] = 0, ["high"] = 0, ["critical"] = 0,
        };
        foreach (var p in preds) risk[p.RiskClass]++;
        return new BatchPredictResponse
        {
            Predictions = preds,
            Summary = new BatchSummary
            {
                NPredictions = preds.Count,
                HighRiskCount = risk["high"] + risk["critical"],
                RiskDistribution = risk,
                AvgLeadTimeMinutes = preds.Count > 0 ? Math.Round(preds.Average(p => p.LeadTimeMinutes), 2) : 0,
                MeanConfidence = preds.Count > 0 ? Math.Round(preds.Average(p => p.Confidence), 4) : 0,
            },
            Timestamp = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
        };
    }

    private double RunRegressor(string name, Dictionary<string, double> featureDict)
    {
        var model = _models[name];
        var input = BuildInputTensor(model.Meta.Features, featureDict);
        var inputName = model.Session.InputMetadata.Keys.First();
        using var results = model.Session.Run(new[] { NamedOnnxValue.CreateFromTensor(inputName, input) });
        foreach (var r in results)
        {
            if (r.Value is Tensor<float> t && t.Length >= 1) return t.GetValue(0);
            if (r.Value is DenseTensor<float> dt && dt.Length >= 1) return dt.GetValue(0);
        }
        throw new InvalidOperationException($"{name}: regressor produced no scalar output");
    }

    private double RunClassifierPositive(string name, Dictionary<string, double> featureDict)
    {
        var model = _models[name];
        var input = BuildInputTensor(model.Meta.Features, featureDict);
        var inputName = model.Session.InputMetadata.Keys.First();
        using var results = model.Session.Run(new[] { NamedOnnxValue.CreateFromTensor(inputName, input) });
        foreach (var r in results)
        {
            // skip the predicted-label output (usually int64), take the probability tensor
            if (r.Value is Tensor<float> tf && tf.Dimensions.Length == 2 && tf.Dimensions[1] >= 2)
                return tf[0, 1];
            if (r.Value is DenseTensor<float> dtf && dtf.Dimensions.Length == 2 && dtf.Dimensions[1] >= 2)
                return dtf[0, 1];
        }
        throw new InvalidOperationException($"{name}: classifier produced no 2D float probability output");
    }

    private static DenseTensor<float> BuildInputTensor(IReadOnlyList<string> featureOrder, Dictionary<string, double> featureDict)
    {
        var n = featureOrder.Count;
        var data = new float[n];
        for (var i = 0; i < n; i++)
        {
            data[i] = featureDict.TryGetValue(featureOrder[i], out var v) && !double.IsNaN(v) && !double.IsInfinity(v)
                ? (float)v
                : 0f;
        }
        return new DenseTensor<float>(data, new[] { 1, n });
    }

    private static double ApplyIsotonic(OnnxMeta meta, double raw)
    {
        var iso = meta.Isotonic;
        if (iso is null) return Math.Clamp(raw, 0.0, 1.0);
        var x = Math.Clamp(raw, iso.XMin, iso.XMax);
        var xs = iso.XThresholds;
        var ys = iso.YThresholds;
        if (xs.Count == 0) return Math.Clamp(raw, 0.0, 1.0);

        // binary search insertion point
        int lo = 0, hi = xs.Count - 1;
        if (x <= xs[lo]) return ys[lo];
        if (x >= xs[hi]) return ys[hi];
        while (hi - lo > 1)
        {
            var mid = (lo + hi) / 2;
            if (xs[mid] <= x) lo = mid; else hi = mid;
        }
        var spanX = xs[hi] - xs[lo];
        if (spanX < 1e-12) return ys[lo];
        var t = (x - xs[lo]) / spanX;
        return ys[lo] + t * (ys[hi] - ys[lo]);
    }

    private static string ClassifyRisk(double score)
    {
        if (score < 0.25) return "low";
        if (score < 0.5)  return "medium";
        if (score < 0.75) return "high";
        return "critical";
    }

    private static double ComputeLeadTime(double riskScore, SpikeProbability spike)
    {
        if (spike.FiveMin is > 0.5) return 5.0;
        if (spike.TenMin is > 0.5) return 10.0;
        if (spike.FifteenMin is > 0.5) return 15.0;
        if (spike.InBatch is > 0.5) return 30.0;
        return Math.Max(0.0, Math.Pow(riskScore, 0.8) * 28.0);
    }

    private static Dictionary<string, double> ComputeTemporalAttention(Dictionary<string, double> feat)
    {
        var volatility = GetFeature(feat, "volatility_index");
        var trend = GetFeature(feat, "rolling_slope");
        var nearShort = 0.45 + volatility * 0.04;
        var nearLong  = 0.30 + Math.Max(0.0, trend) * 0.03;
        var medium    = 0.15 - volatility * 0.01;
        var longTerm  = 0.10;
        var raw = new[] { nearShort, nearLong, medium, longTerm }.Select(v => Math.Max(v, 0.01)).ToArray();
        var total = raw.Sum();
        return new Dictionary<string, double>
        {
            ["near_term_0_5m"]   = Math.Round(raw[0] / total, 4),
            ["near_term_5_10m"]  = Math.Round(raw[1] / total, 4),
            ["medium_term_10_20m"] = Math.Round(raw[2] / total, 4),
            ["long_term_20_30m"] = Math.Round(raw[3] / total, 4),
        };
    }

    private static List<Precursor> BuildPrecursors(Dictionary<string, double> featureDict, OnnxMeta meta)
    {
        if (meta.FeatureImportances is null || meta.FeatureImportances.Count != meta.Features.Count)
            return new List<Precursor>();

        var totalImportance = meta.FeatureImportances.Sum();
        if (totalImportance <= 0) totalImportance = 1.0;

        var contributions = new List<(string Feature, double Contribution, double Value, double NormalisedImportance)>();
        for (var i = 0; i < meta.Features.Count; i++)
        {
            var name = meta.Features[i];
            var importance = meta.FeatureImportances[i];
            var value = featureDict.TryGetValue(name, out var v) ? v : 0.0;
            var contribution = Math.Abs(value) * importance;
            contributions.Add((name, contribution, value, importance / totalImportance));
        }

        return contributions
            .OrderByDescending(c => c.Contribution)
            .Take(5)
            .Select(c => new Precursor
            {
                Feature = HumanizeFeatureName(c.Feature),
                Importance = Math.Round(c.NormalisedImportance, 4),
                ShapValue = Math.Round(c.Contribution, 3),
                Trend = c.Value >= 0 ? "↑" : "↓",
            })
            .ToList();
    }

    private static string HumanizeFeatureName(string name)
    {
        return name switch
        {
            "abs_deviation" => "SP-PV Deviation",
            "rolling_slope" => "Rolling Slope",
            "cumulative_drift" => "Cumulative Drift",
            "instability_score" => "Instability Score",
            "volatility_index" => "Process Volatility",
            "sudden_jump_score" => "Sudden Jump Score",
            "drift_score" => "Drift Score",
            "oscillation_score" => "Oscillation Score",
            "precursor_drift_score" => "Precursor Drift",
            "precursor_instability_score" => "Precursor Instability",
            "control_degradation_score" => "Control Degradation",
            "error_accumulation_rate" => "Error Accumulation Rate",
            _ => name,
        };
    }

    private static string BuildTrajectory(string riskClass, Dictionary<string, double> feat)
    {
        var rising = GetFeature(feat, "rolling_slope") > 0;
        return riskClass switch
        {
            "low" => rising
                ? "Stable process with slight degradation. Continue monitoring SP-PV deviation."
                : "Process stable. Key indicators within normal range.",
            "medium" => rising
                ? "Early precursor activity detected. Deviation increasing. Recommend increased monitoring."
                : "Early precursors detected. Stabilising. Continue monitoring.",
            "high" => rising
                ? "Significant precursor cascade active. Risk escalating. Prepare intervention protocols."
                : "Significant precursor activity. Risk plateauing. Prepare for potential intervention.",
            "critical" => rising
                ? "CRITICAL: Imminent event signature with escalation. Execute emergency response."
                : "CRITICAL: Sustained anomaly. Execute emergency response immediately.",
            _ => "Risk assessment pending.",
        };
    }

    private static double GetFeature(Dictionary<string, double> feat, string key)
        => feat.TryGetValue(key, out var v) ? v : 0.0;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var m in _models.Values) m.Session.Dispose();
        _models.Clear();
    }

    private sealed record OnnxModel(InferenceSession Session, OnnxMeta Meta);
}

public sealed class OnnxMeta
{
    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("kind")]
    public string Kind { get; set; } = "regressor";

    [System.Text.Json.Serialization.JsonPropertyName("features")]
    public List<string> Features { get; set; } = new();

    [System.Text.Json.Serialization.JsonPropertyName("feature_importances")]
    public List<double>? FeatureImportances { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("isotonic")]
    public IsotonicMeta? Isotonic { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("smoothing_alpha")]
    public double? SmoothingAlpha { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("risk_threshold")]
    public double? RiskThreshold { get; set; }
}

public sealed class IsotonicMeta
{
    [System.Text.Json.Serialization.JsonPropertyName("x_thresholds")]
    public List<double> XThresholds { get; set; } = new();

    [System.Text.Json.Serialization.JsonPropertyName("y_thresholds")]
    public List<double> YThresholds { get; set; } = new();

    [System.Text.Json.Serialization.JsonPropertyName("x_min")]
    public double XMin { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("x_max")]
    public double XMax { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("increasing")]
    public bool Increasing { get; set; } = true;
}
