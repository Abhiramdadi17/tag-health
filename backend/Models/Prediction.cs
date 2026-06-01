using System.Text.Json.Serialization;

namespace backend_dotnet.Models;

public class Precursor
{
    [JsonPropertyName("feature")]
    public string Feature { get; set; } = string.Empty;

    [JsonPropertyName("importance")]
    public double Importance { get; set; }

    [JsonPropertyName("shap_value")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? ShapValue { get; set; }

    [JsonPropertyName("trend")]
    public string Trend { get; set; } = "↑";
}

public class UncertaintyBand
{
    [JsonPropertyName("p10")]
    public double P10 { get; set; }

    [JsonPropertyName("p50")]
    public double P50 { get; set; }

    [JsonPropertyName("p90")]
    public double P90 { get; set; }
}

public class SpikeProbability
{
    [JsonPropertyName("in_batch")]
    public double? InBatch { get; set; }

    [JsonPropertyName("5m")]
    public double? FiveMin { get; set; }

    [JsonPropertyName("10m")]
    public double? TenMin { get; set; }

    [JsonPropertyName("15m")]
    public double? FifteenMin { get; set; }
}

public class HybridPrediction
{
    [JsonPropertyName("timestamp")]
    public string Timestamp { get; set; } = string.Empty;

    [JsonPropertyName("entity_id")]
    public string EntityId { get; set; } = string.Empty;

    [JsonPropertyName("risk_score")]
    public double RiskScore { get; set; }

    [JsonPropertyName("risk_class")]
    public string RiskClass { get; set; } = "low";

    [JsonPropertyName("lead_time_minutes")]
    public double LeadTimeMinutes { get; set; }

    [JsonPropertyName("predicted_deviation")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? PredictedDeviation { get; set; }

    [JsonPropertyName("spike_probability")]
    public SpikeProbability? SpikeProbability { get; set; }

    [JsonPropertyName("top_precursors")]
    public List<Precursor> TopPrecursors { get; set; } = new();

    [JsonPropertyName("temporal_attention")]
    public Dictionary<string, double> TemporalAttention { get; set; } = new();

    [JsonPropertyName("uncertainty_band")]
    public UncertaintyBand UncertaintyBand { get; set; } = new();

    [JsonPropertyName("trajectory_summary")]
    public string TrajectorySummary { get; set; } = string.Empty;

    [JsonPropertyName("confidence")]
    public double Confidence { get; set; }

    [JsonPropertyName("model_versions")]
    public Dictionary<string, string> ModelVersions { get; set; } = new();
}

public class PredictRequest
{
    [JsonPropertyName("entity_id")]
    public string EntityId { get; set; } = "unknown";

    [JsonPropertyName("timestamp")]
    public string? Timestamp { get; set; }

    [JsonPropertyName("last_10_readings")]
    public List<double>? Last10Readings { get; set; }

    [JsonPropertyName("features")]
    public Dictionary<string, double>? Features { get; set; }
}

public class BatchPredictRequest
{
    [JsonPropertyName("data")]
    public List<PredictRequest> Data { get; set; } = new();
}

public class BatchSummary
{
    [JsonPropertyName("n_predictions")]
    public int NPredictions { get; set; }

    [JsonPropertyName("high_risk_count")]
    public int HighRiskCount { get; set; }

    [JsonPropertyName("risk_distribution")]
    public Dictionary<string, int> RiskDistribution { get; set; } = new();

    [JsonPropertyName("avg_lead_time_minutes")]
    public double AvgLeadTimeMinutes { get; set; }

    [JsonPropertyName("mean_confidence")]
    public double MeanConfidence { get; set; }
}

public class BatchPredictResponse
{
    [JsonPropertyName("predictions")]
    public List<HybridPrediction> Predictions { get; set; } = new();

    [JsonPropertyName("summary")]
    public BatchSummary Summary { get; set; } = new();

    [JsonPropertyName("timestamp")]
    public string Timestamp { get; set; } = string.Empty;
}
