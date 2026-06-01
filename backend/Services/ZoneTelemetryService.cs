using System.Globalization;
using ClosedXML.Excel;

namespace backend_dotnet.Services;

/// <summary>
/// Streams raw OPC-UA rows from the three zone workbooks (Sigma Mixer, Silo,
/// Packaging) as plain dictionaries the Angular zones dashboard consumes.
///
/// Each workbook has the same columns:
///   IotDeviceId | SensorId | SiteId | MachineId | Tag | Value | TS
///
/// The service reads every workbook once on first request, parses the TS
/// column into UTC DateTime, and caches the result. Callers ask for a
/// time-windowed slice (default: most recent N rows) via /zones/telemetry.
/// </summary>
public sealed class ZoneTelemetryService
{
    private readonly ILogger<ZoneTelemetryService> _logger;
    private readonly object _lock = new();
    private readonly Dictionary<string, List<TelemetryRow>> _cache = new(StringComparer.OrdinalIgnoreCase);

    private static readonly (string Zone, string FilePath)[] Workbooks =
    {
        ("sigma",         "data/LLPL SigmaMixer Zone.xlsx"),
        ("silo",          "data/LLPL Silo Zone.xlsx"),
        ("packaging",     "data/LLPL Packaging.xlsx"),
        ("psm_telemetry", "data/LLPL PSM 1st April to 20th May.xlsx"),
    };

    public ZoneTelemetryService(ILogger<ZoneTelemetryService> logger)
    {
        _logger = logger;
    }

    public List<TelemetryRow> GetWindow(string zone, int limit = 500, DateTime? sinceUtc = null)
    {
        var rows = LoadZone(zone);
        IEnumerable<TelemetryRow> q = rows;
        if (sinceUtc.HasValue)
        {
            q = q.Where(r => r.TimestampUtc > sinceUtc.Value);
        }
        return q.Take(limit).ToList();
    }

    public IReadOnlyList<TelemetryRow> All(string zone) => LoadZone(zone);

    /// <summary>
    /// One entry per unique Tag in the workbook with its most-recent value,
    /// timestamp, machine id, and sample count. The frontend renders this as a
    /// PSM-style per-tag table.
    /// </summary>
    public List<ZoneTagSummary> TagsSummary(string zone)
    {
        var rows = LoadZone(zone);
        var grouped = new Dictionary<string, ZoneTagSummary>(StringComparer.Ordinal);
        // Rows are newest-first; the first time we see a Tag, that's its latest.
        foreach (var r in rows)
        {
            if (!grouped.TryGetValue(r.Tag, out var entry))
            {
                entry = new ZoneTagSummary
                {
                    Tag = r.Tag,
                    MachineId = r.MachineId,
                    LatestValue = r.Value,
                    LatestTs = r.TS,
                    LatestTsUtc = r.TimestampUtc,
                    SampleCount = 0,
                };
                grouped[r.Tag] = entry;
            }
            entry.SampleCount++;
        }
        return grouped.Values.OrderBy(t => t.Tag, StringComparer.Ordinal).ToList();
    }

    public Dictionary<string, int> Counts()
    {
        var result = new Dictionary<string, int>();
        foreach (var (zone, _) in Workbooks)
        {
            result[zone] = LoadZone(zone).Count;
        }
        return result;
    }

    private List<TelemetryRow> LoadZone(string zone)
    {
        if (_cache.TryGetValue(zone, out var cached)) return cached;

        lock (_lock)
        {
            if (_cache.TryGetValue(zone, out cached)) return cached;

            var match = Workbooks.FirstOrDefault(w => string.Equals(w.Zone, zone, StringComparison.OrdinalIgnoreCase));
            if (match.FilePath is null)
            {
                _logger.LogWarning("Unknown zone requested: {Zone}", zone);
                _cache[zone] = new List<TelemetryRow>();
                return _cache[zone];
            }

            var path = ResolvePath(match.FilePath);
            if (path is null)
            {
                _logger.LogWarning("Workbook not found for zone {Zone}: {File}", zone, match.FilePath);
                _cache[zone] = new List<TelemetryRow>();
                return _cache[zone];
            }

            _logger.LogInformation("Loading {Zone} workbook {Path}...", zone, path);
            var rows = ReadWorkbook(path);
            _cache[zone] = rows;
            _logger.LogInformation("Loaded {Count} rows for {Zone}", rows.Count, zone);
            return rows;
        }
    }

    private static List<TelemetryRow> ReadWorkbook(string path)
    {
        var result = new List<TelemetryRow>();
        using var workbook = new XLWorkbook(path);
        var sheet = workbook.Worksheets.First();
        var headerRow = sheet.FirstRowUsed();
        if (headerRow is null) return result;

        var headers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var cell in headerRow.CellsUsed())
            headers[cell.GetString().Trim()] = cell.Address.ColumnNumber;

        int Col(string name) => headers.TryGetValue(name, out var c) ? c : -1;

        var iotCol  = Col("IotDeviceId");
        var sensCol = Col("SensorId");
        var siteCol = Col("SiteId");
        var machCol = Col("MachineId");
        var tagCol  = Col("Tag");
        var valCol  = Col("Value");
        var tsCol   = Col("TS");

        if (tagCol < 0 || valCol < 0 || tsCol < 0) return result;

        foreach (var row in sheet.RowsUsed().Skip(1))
        {
            var tag = row.Cell(tagCol).GetString().Trim();
            if (string.IsNullOrWhiteSpace(tag)) continue;

            string value;
            var valCell = row.Cell(valCol);
            if (valCell.DataType == XLDataType.Number)
                value = valCell.GetDouble().ToString("R", CultureInfo.InvariantCulture);
            else
                value = valCell.GetString();

            var tsText = row.Cell(tsCol).GetString().Trim();
            var ts = ParseTimestamp(tsText, row.Cell(tsCol));

            result.Add(new TelemetryRow
            {
                IotDeviceId = iotCol  > 0 ? row.Cell(iotCol).GetString().Trim()  : string.Empty,
                SensorId    = sensCol > 0 ? row.Cell(sensCol).GetString().Trim() : string.Empty,
                SiteId      = siteCol > 0 ? row.Cell(siteCol).GetString().Trim() : string.Empty,
                MachineId   = machCol > 0 ? row.Cell(machCol).GetString().Trim() : string.Empty,
                Tag         = tag,
                Value       = value,
                TS          = tsText,
                TimestampUtc = ts,
            });
        }

        // Newest first so the limit slice is the most recent activity.
        result.Sort((a, b) => b.TimestampUtc.CompareTo(a.TimestampUtc));
        return result;
    }

    private static DateTime ParseTimestamp(string text, IXLCell cell)
    {
        if (cell.DataType == XLDataType.DateTime)
            return DateTime.SpecifyKind(cell.GetDateTime(), DateTimeKind.Local).ToUniversalTime();

        // Format like "4/26/2026, 6:00:15.199 AM"
        var styles = DateTimeStyles.AssumeLocal | DateTimeStyles.AdjustToUniversal;
        if (DateTime.TryParse(text, CultureInfo.InvariantCulture, styles, out var dt))
            return dt;
        if (DateTime.TryParseExact(text, "M/d/yyyy, h:mm:ss.fff tt",
                CultureInfo.InvariantCulture, styles, out dt))
            return dt;
        if (DateTime.TryParseExact(text, "M/d/yyyy, h:mm:ss tt",
                CultureInfo.InvariantCulture, styles, out dt))
            return dt;
        return DateTime.MinValue;
    }

    private static string? ResolvePath(string relPath)
    {
        var basePath = AppContext.BaseDirectory;
        var candidates = new[]
        {
            relPath,
            Path.Combine(basePath, relPath),
            Path.Combine(basePath, "..", "..", "..", relPath),
            Path.Combine(Directory.GetCurrentDirectory(), relPath),
            Path.Combine(Directory.GetCurrentDirectory(), "..", relPath),
        };
        foreach (var c in candidates)
        {
            var full = Path.GetFullPath(c);
            if (File.Exists(full)) return full;
        }
        return null;
    }
}

public sealed class ZoneTagSummary
{
    [System.Text.Json.Serialization.JsonPropertyName("Tag")]          public string Tag { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("MachineId")]    public string MachineId { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("LatestValue")]  public string LatestValue { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("LatestTs")]     public string LatestTs { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("LatestTsUtc")]  public DateTime LatestTsUtc { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("SampleCount")]  public int SampleCount { get; set; }
}

public sealed class TelemetryRow
{
    [System.Text.Json.Serialization.JsonPropertyName("IotDeviceId")] public string IotDeviceId { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("SensorId")]    public string SensorId    { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("SiteId")]      public string SiteId      { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("MachineId")]   public string MachineId   { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("Tag")]         public string Tag         { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("Value")]       public string Value       { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("TS")]          public string TS          { get; set; } = string.Empty;
    [System.Text.Json.Serialization.JsonPropertyName("TimestampUtc")] public DateTime TimestampUtc { get; set; }
}
