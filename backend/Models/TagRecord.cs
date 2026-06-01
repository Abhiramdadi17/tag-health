using System.Text.Json.Serialization;

namespace backend_dotnet.Models;

public class TagRecord
{
    [JsonPropertyName("synthetic_id")]
    public string SyntheticId { get; set; } = string.Empty;

    [JsonPropertyName("tag_name")]
    public string TagName { get; set; } = string.Empty;

    [JsonPropertyName("plant")]
    public string Plant { get; set; } = string.Empty;

    [JsonPropertyName("recipe")]
    public string Recipe { get; set; } = "UNKNOWN";

    [JsonPropertyName("raw_material")]
    public string RawMaterial { get; set; } = "UNKNOWN";

    [JsonPropertyName("batch_id")]
    public string BatchId { get; set; } = "0";

    [JsonPropertyName("shift")]
    public int Shift { get; set; } = 1;

    [JsonPropertyName("current_sp")]
    public double CurrentSp { get; set; }

    [JsonPropertyName("current_pv")]
    public double CurrentPv { get; set; }

    [JsonPropertyName("reading_count")]
    public int ReadingCount { get; set; }

    [JsonPropertyName("last_10_readings")]
    public List<double> Last10Readings { get; set; } = new();

    [JsonPropertyName("batch_start_ts")]
    public string BatchStartTs { get; set; } = string.Empty;

    [JsonPropertyName("current_deviation_pct")]
    public double CurrentDeviationPct { get; set; }

    [JsonPropertyName("health_status")]
    public string HealthStatus { get; set; } = "OK";
}
