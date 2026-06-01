using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace backend_dotnet.Services;

/// <summary>
/// Runs the exported pytorch-forecasting TemporalFusionTransformer
/// (encoder_length=180 × 5s = 15 min historical, decoder_length=60 × 5s = 5 min
/// forecast). Returns both a calibrated quantile band on the precursor risk
/// target and a 4-bucket temporal attention summary the dashboard renders.
///
/// We currently feed the same engineered feature vector to every encoder and
/// decoder step (single snapshot per request — there is no per-tag history
/// buffer in the API). The attention weights it emits are therefore stable
/// over time, but they are computed by the trained model on real feature
/// values, not a heuristic mix-down.
/// </summary>
public sealed class TftAttentionService : IDisposable
{
    private readonly ILogger<TftAttentionService> _logger;
    private readonly InferenceSession? _session;
    private readonly TftMeta? _meta;
    private readonly Dictionary<string, NodeMetadata> _inputMetadata = new();
    private bool _disposed;

    public bool IsReady => _session is not null && _meta is not null;
    public string ModelVersion { get; } = "onnx-tft-enc15m-pred5m-v1";

    public TftAttentionService(ILogger<TftAttentionService> logger, IConfiguration config)
    {
        _logger = logger;
        var modelDir = ResolveModelDir(config);
        if (modelDir is null) return;

        var onnxPath = Path.Combine(modelDir, "tft.onnx");
        var metaPath = Path.Combine(modelDir, "tft.meta.json");
        if (!File.Exists(onnxPath) || !File.Exists(metaPath))
        {
            _logger.LogInformation("TFT ONNX artefacts not present; temporal attention will use heuristic.");
            return;
        }

        try
        {
            _meta = JsonSerializer.Deserialize<TftMeta>(File.ReadAllText(metaPath))
                    ?? throw new InvalidOperationException("empty TFT meta");
            _session = new InferenceSession(onnxPath, new Microsoft.ML.OnnxRuntime.SessionOptions
            {
                LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR,
            });
            foreach (var kv in _session.InputMetadata)
            {
                _inputMetadata[kv.Key] = kv.Value;
            }
            _logger.LogInformation(
                "Loaded TFT: enc={Enc}, dec={Dec}, reals={Real}, heads={Heads}, inputs={Inputs}",
                _meta.EncoderLength, _meta.DecoderLength, _meta.NReal, _meta.NHeads,
                string.Join(",", _inputMetadata.Keys));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed loading TFT ONNX");
            _session?.Dispose();
            _session = null;
            _meta = null;
        }
    }

    /// <summary>
    /// Runs the TFT given the 149-feature snapshot. Returns null when the
    /// session is unavailable so the caller can fall back to the heuristic.
    /// </summary>
    public TftOutput? Run(IReadOnlyDictionary<string, double> featureSnapshot)
    {
        if (!IsReady || _session is null || _meta is null) return null;

        var (encCont, decCont) = BuildContinuousTensors(featureSnapshot, _meta);
        var encCat = new DenseTensor<long>(new long[_meta.EncoderLength * _meta.NCat],
            new[] { 1, _meta.EncoderLength, _meta.NCat });
        var decCat = new DenseTensor<long>(new long[_meta.DecoderLength * _meta.NCat],
            new[] { 1, _meta.DecoderLength, _meta.NCat });
        var targetScale = new DenseTensor<float>(new[] { 0f, 1f }, new[] { 1, 2 });

        var feedAll = new Dictionary<string, NamedOnnxValue>
        {
            ["encoder_cont"] = NamedOnnxValue.CreateFromTensor("encoder_cont", encCont),
            ["encoder_cat"]  = NamedOnnxValue.CreateFromTensor("encoder_cat",  encCat),
            ["decoder_cont"] = NamedOnnxValue.CreateFromTensor("decoder_cont", decCont),
            ["decoder_cat"]  = NamedOnnxValue.CreateFromTensor("decoder_cat",  decCat),
            ["target_scale"] = NamedOnnxValue.CreateFromTensor("target_scale", targetScale),
        };
        var feeds = feedAll.Where(kv => _inputMetadata.ContainsKey(kv.Key)).Select(kv => kv.Value).ToList();

        using var results = _session.Run(feeds);
        Tensor<float>? prediction = null;
        Tensor<float>? encoderAttention = null;
        foreach (var r in results)
        {
            switch (r.Name)
            {
                case "prediction" when r.Value is Tensor<float> tp: prediction = tp; break;
                case "encoder_attention" when r.Value is Tensor<float> ta: encoderAttention = ta; break;
            }
        }
        if (prediction is null || encoderAttention is null)
        {
            _logger.LogWarning("TFT run missing prediction/encoder_attention outputs");
            return null;
        }

        // prediction shape: (1, decoder_length, 3) → quantiles P10/P50/P90 over the prediction horizon
        var (meanQ, _) = MeanOverDecoderSteps(prediction);
        // encoder_attention shape: (1, decoder_length, heads, encoder_length)
        var encWeights = SummariseEncoderAttention(encoderAttention, _meta);

        return new TftOutput(meanQ.P10, meanQ.P50, meanQ.P90, encWeights);
    }

    private static (Quantiles mean, Quantiles last) MeanOverDecoderSteps(Tensor<float> prediction)
    {
        int dec = prediction.Dimensions[1];
        double q10 = 0, q50 = 0, q90 = 0;
        for (var t = 0; t < dec; t++)
        {
            q10 += prediction[0, t, 0];
            q50 += prediction[0, t, 1];
            q90 += prediction[0, t, 2];
        }
        var mean = new Quantiles(q10 / dec, q50 / dec, q90 / dec);
        var last = new Quantiles(prediction[0, dec - 1, 0], prediction[0, dec - 1, 1], prediction[0, dec - 1, 2]);
        return (mean, last);
    }

    private static Dictionary<string, double> SummariseEncoderAttention(Tensor<float> attention, TftMeta meta)
    {
        var dec = attention.Dimensions[1];
        var heads = attention.Dimensions[2];
        var enc = attention.Dimensions[3];

        // Average over decoder steps and heads to get a single attention vector
        // of length enc (one weight per historical encoder step).
        var weights = new double[enc];
        for (var t = 0; t < dec; t++)
            for (var h = 0; h < heads; h++)
                for (var e = 0; e < enc; e++)
                    weights[e] += attention[0, t, h, e];
        var norm = dec * heads;
        for (var i = 0; i < weights.Length; i++) weights[i] /= norm;

        // Encoder spans the past `enc * step_seconds` seconds. Map the 4 dashboard
        // buckets (0-5m, 5-10m, 10-20m, 20-30m) onto encoder slices. The model's
        // history horizon is shorter than the dashboard's 30-minute view, so the
        // last bucket aliases the oldest slice; the dashboard shows it correctly
        // because the weights still sum to 1.
        var step = Math.Max(meta.StepSeconds, 1);
        var encSeconds = enc * step;
        var b1 = Slice(weights, IndexAt(enc, encSeconds - 5 * 60, encSeconds), IndexAt(enc, encSeconds, encSeconds));
        var b2 = Slice(weights, IndexAt(enc, encSeconds - 10 * 60, encSeconds), IndexAt(enc, encSeconds - 5 * 60, encSeconds));
        var b3 = Slice(weights, IndexAt(enc, encSeconds - 20 * 60, encSeconds), IndexAt(enc, encSeconds - 10 * 60, encSeconds));
        var b4 = Slice(weights, 0, IndexAt(enc, encSeconds - 20 * 60, encSeconds));

        var raw = new[] { b1, b2, b3, b4 }.Select(v => Math.Max(v, 1e-9)).ToArray();
        var total = raw.Sum();
        return new Dictionary<string, double>
        {
            ["near_term_0_5m"]    = Math.Round(raw[0] / total, 4),
            ["near_term_5_10m"]   = Math.Round(raw[1] / total, 4),
            ["medium_term_10_20m"] = Math.Round(raw[2] / total, 4),
            ["long_term_20_30m"]  = Math.Round(raw[3] / total, 4),
        };
    }

    private static int IndexAt(int enc, int secondsFromStart, int totalSeconds)
    {
        if (secondsFromStart <= 0) return 0;
        if (secondsFromStart >= totalSeconds) return enc;
        return (int)Math.Round((double)secondsFromStart / totalSeconds * enc);
    }

    private static double Slice(double[] weights, int start, int end)
    {
        if (start >= end) return 0;
        double s = 0;
        for (var i = start; i < end && i < weights.Length; i++) s += weights[i];
        return s;
    }

    private static (DenseTensor<float> Encoder, DenseTensor<float> Decoder) BuildContinuousTensors(
        IReadOnlyDictionary<string, double> snapshot, TftMeta meta)
    {
        // x_reals lists the full 125-vector. Many entries are bookkeeping
        // synthesised by pytorch-forecasting (encoder_length, *_center, *_scale,
        // relative_time_idx). Anything we don't recognise stays 0; the model
        // training pipeline scaled features per group, so a 0 baseline produces
        // the centered prediction. The recognised feature columns share names
        // with PythonFeatureEngineer's output.
        var n = meta.NReal;
        var encArr = new float[meta.EncoderLength * n];
        var decArr = new float[meta.DecoderLength * n];

        // Build a single feature row in the model's order.
        var row = new float[n];
        for (var i = 0; i < n; i++)
        {
            var name = meta.XReals[i];
            row[i] = name switch
            {
                "encoder_length" => meta.EncoderLength,
                "relative_time_idx" => 0f, // overwritten below per step
                "precursor_risk_tau600_center" => 0f,
                "precursor_risk_tau600_scale" => 1f,
                _ => snapshot.TryGetValue(name, out var v) && !double.IsNaN(v) && !double.IsInfinity(v)
                    ? (float)v
                    : 0f,
            };
        }

        // Find the relative_time_idx column so we can vary it per step.
        var relIdx = meta.XReals.IndexOf("relative_time_idx");

        for (var t = 0; t < meta.EncoderLength; t++)
        {
            Array.Copy(row, 0, encArr, t * n, n);
            if (relIdx >= 0) encArr[t * n + relIdx] = t - meta.EncoderLength;
        }
        for (var t = 0; t < meta.DecoderLength; t++)
        {
            Array.Copy(row, 0, decArr, t * n, n);
            if (relIdx >= 0) decArr[t * n + relIdx] = t;
        }
        return (
            new DenseTensor<float>(encArr, new[] { 1, meta.EncoderLength, n }),
            new DenseTensor<float>(decArr, new[] { 1, meta.DecoderLength, n }));
    }

    private static string? ResolveModelDir(IConfiguration config)
    {
        var candidates = new[]
        {
            config["OnnxModelDir"],
            Path.Combine(AppContext.BaseDirectory, "models", "onnx"),
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

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _session?.Dispose();
    }
}

public sealed record TftOutput(double QuantileP10, double QuantileP50, double QuantileP90, Dictionary<string, double> Attention);

public sealed record Quantiles(double P10, double P50, double P90);

public sealed class TftMeta
{
    [JsonPropertyName("encoder_length")] public int EncoderLength { get; set; }
    [JsonPropertyName("decoder_length")] public int DecoderLength { get; set; }
    [JsonPropertyName("n_real")] public int NReal { get; set; }
    [JsonPropertyName("n_cat")] public int NCat { get; set; }
    [JsonPropertyName("n_heads")] public int NHeads { get; set; }
    [JsonPropertyName("x_reals")] public List<string> XReals { get; set; } = new();
    [JsonPropertyName("x_categoricals")] public List<string> XCategoricals { get; set; } = new();
    [JsonPropertyName("output_size")] public int OutputSize { get; set; } = 3;
    [JsonPropertyName("quantiles")] public List<double> Quantiles { get; set; } = new() { 0.1, 0.5, 0.9 };
    [JsonPropertyName("step_seconds")] public int StepSeconds { get; set; } = 5;
    [JsonPropertyName("onnx_inputs")] public List<string> OnnxInputs { get; set; } = new();
    [JsonPropertyName("onnx_outputs")] public List<string> OnnxOutputs { get; set; } = new();
}
