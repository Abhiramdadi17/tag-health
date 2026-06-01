using System.Globalization;
using System.Text.RegularExpressions;
using backend_dotnet.Models;
using ClosedXML.Excel;

namespace backend_dotnet.Services;

public class TagLoaderService
{
    private readonly ILogger<TagLoaderService> _logger;

    private static readonly (string Plant, string FilePath)[] DataFiles =
    {
        ("LLPL", "data/LLPL PSM 1st April to 20th May.xlsx"),
        ("PSM",  "data/PSM_TagData_10th_to_20th.xlsx"),
    };

    private static readonly Regex ProcessPattern = new(
        @"(?:^|,)D:(?<process_id>[^,]*)|(?:^|,)S:(?<stage>[^,]*)|(?:^|,)B:(?<batch>[^,]*)|" +
        @"(?:^|,)R:(?<recipe>[^,]*)|(?:^|,)RM:(?<rm>[^,]*)|(?:^|,)SP:(?<sp>[^,]*)|(?:^|,)PV:(?<pv>[^,]*)",
        RegexOptions.Compiled);

    private List<TagRecord>? _cache;
    private readonly object _cacheLock = new();

    public TagLoaderService(ILogger<TagLoaderService> logger)
    {
        _logger = logger;
    }

    public IReadOnlyList<TagRecord> GetTags()
    {
        if (_cache is not null) return _cache;
        lock (_cacheLock)
        {
            _cache ??= LoadTagsFromExcel();
        }
        return _cache;
    }

    public void ReloadTags()
    {
        lock (_cacheLock)
        {
            _cache = LoadTagsFromExcel();
        }
    }

    public static string ClassifyHealth(double devPct)
    {
        var a = Math.Abs(devPct);
        if (a < 5)  return "OK";
        if (a < 10) return "ALERT";
        if (a < 15) return "WARNING";
        if (a < 25) return "SEVERE";
        return "CRITICAL";
    }

    private List<TagRecord> LoadTagsFromExcel()
    {
        var aggregated = new Dictionary<string, TagRecord>(StringComparer.Ordinal);
        var basePath = AppContext.BaseDirectory;

        foreach (var (plant, relPath) in DataFiles)
        {
            var path = ResolvePath(relPath, basePath);
            if (path is null)
            {
                _logger.LogWarning("Data file not found: {Path}", relPath);
                continue;
            }

            _logger.LogInformation("Loading {Path}...", path);
            try
            {
                using var workbook = new XLWorkbook(path);
                var sheet = workbook.Worksheets.First();
                ProcessSheet(plant, sheet, aggregated);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to read {Path}", path);
            }
        }

        _logger.LogInformation("Total unique tags loaded: {Count}", aggregated.Count);
        return aggregated.Values.ToList();
    }

    private static string? ResolvePath(string relPath, string basePath)
    {
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

    private static void ProcessSheet(string plant, IXLWorksheet sheet, Dictionary<string, TagRecord> agg)
    {
        var headerRow = sheet.FirstRowUsed();
        if (headerRow is null) return;

        var headers = new Dictionary<int, string>();
        foreach (var cell in headerRow.CellsUsed())
        {
            headers[cell.Address.ColumnNumber] = cell.GetString().Trim();
        }

        int? valueCol = FindColumn(headers, h => h.Contains("value", StringComparison.OrdinalIgnoreCase));
        int? tsCol = FindColumn(headers, h => h.Contains("timestamp", StringComparison.OrdinalIgnoreCase)
                                              || string.Equals(h, "TS", StringComparison.OrdinalIgnoreCase));
        int? tagCol = FindColumn(headers, h => string.Equals(h, "tag", StringComparison.OrdinalIgnoreCase)
                                               || string.Equals(h, "tagname", StringComparison.OrdinalIgnoreCase)
                                               || string.Equals(h, "tag_name", StringComparison.OrdinalIgnoreCase));

        if (valueCol is null) return;

        // entity_id -> rolling state
        var groups = new Dictionary<string, EntityState>(StringComparer.Ordinal);

        foreach (var row in sheet.RowsUsed().Skip(1))
        {
            var rawValue = row.Cell(valueCol.Value).GetString();
            if (string.IsNullOrWhiteSpace(rawValue)) continue;

            var parsed = ParseValueString(rawValue);
            if (!parsed.Sp.HasValue || !parsed.Pv.HasValue) continue;
            if (parsed.Sp.Value == 0) continue;

            var errorPct = (parsed.Pv.Value - parsed.Sp.Value) / parsed.Sp.Value * 100.0;
            var recipe = string.IsNullOrWhiteSpace(parsed.Recipe) ? "UNKNOWN" : parsed.Recipe;
            var rm = string.IsNullOrWhiteSpace(parsed.Rm) ? "UNKNOWN" : parsed.Rm;
            var batch = parsed.Batch ?? 0;
            var stage = parsed.Stage ?? 1;

            var entityId = $"{plant}_B{batch}_{recipe.Replace(" ", "_")}_{rm}";

            DateTime? ts = null;
            if (tsCol is not null)
            {
                var tsCell = row.Cell(tsCol.Value);
                ts = TryGetDateTime(tsCell);
            }

            if (!groups.TryGetValue(entityId, out var state))
            {
                state = new EntityState
                {
                    EntityId = entityId,
                    Plant = plant,
                    Recipe = recipe,
                    Rm = rm,
                    BatchId = batch.ToString(CultureInfo.InvariantCulture),
                    Shift = stage,
                };
                groups[entityId] = state;
            }

            state.Count++;
            state.LastSp = parsed.Sp.Value;
            state.LastPv = parsed.Pv.Value;
            state.LastDeviationPct = errorPct;
            state.Recipe = recipe;
            state.Rm = rm;
            state.Shift = stage;
            state.BatchId = batch.ToString(CultureInfo.InvariantCulture);

            state.Last10.Enqueue(errorPct);
            if (state.Last10.Count > 10) state.Last10.Dequeue();

            if (ts is not null)
            {
                if (state.FirstTimestamp is null || ts < state.FirstTimestamp)
                    state.FirstTimestamp = ts;
            }
        }

        foreach (var state in groups.Values)
        {
            if (state.Count < 2) continue;
            var record = new TagRecord
            {
                SyntheticId = state.EntityId,
                TagName = state.EntityId,
                Plant = state.Plant,
                Recipe = state.Recipe,
                RawMaterial = state.Rm,
                BatchId = state.BatchId,
                Shift = state.Shift,
                CurrentSp = Math.Round(state.LastSp, 4),
                CurrentPv = Math.Round(state.LastPv, 4),
                ReadingCount = state.Count,
                Last10Readings = state.Last10.Select(v => Math.Round(v, 4)).ToList(),
                BatchStartTs = state.FirstTimestamp?.ToString("o", CultureInfo.InvariantCulture) ?? string.Empty,
                CurrentDeviationPct = Math.Round(state.LastDeviationPct, 4),
                HealthStatus = ClassifyHealth(state.LastDeviationPct),
            };
            agg[record.SyntheticId] = record;
        }
    }

    private static int? FindColumn(Dictionary<int, string> headers, Func<string, bool> predicate)
    {
        foreach (var kv in headers)
        {
            if (predicate(kv.Value)) return kv.Key;
        }
        return null;
    }

    private static DateTime? TryGetDateTime(IXLCell cell)
    {
        try
        {
            if (cell.DataType == XLDataType.DateTime)
                return cell.GetDateTime();
            var s = cell.GetString();
            if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
                return dt;
        }
        catch { /* ignored */ }
        return null;
    }

    private struct ParsedValue
    {
        public double? Sp;
        public double? Pv;
        public double? Batch;
        public int? Stage;
        public string Recipe;
        public string Rm;
    }

    private static ParsedValue ParseValueString(string value)
    {
        var result = new ParsedValue { Recipe = "UNKNOWN", Rm = "UNKNOWN" };
        var matches = ProcessPattern.Matches(value);
        foreach (Match m in matches)
        {
            if (TryGet(m, "sp", out var sp)) result.Sp = ParseDouble(sp);
            if (TryGet(m, "pv", out var pv)) result.Pv = ParseDouble(pv);
            if (TryGet(m, "batch", out var b)) result.Batch = ParseDouble(b);
            if (TryGet(m, "stage", out var st)) { if (int.TryParse(st, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) result.Stage = n; }
            if (TryGet(m, "recipe", out var r) && !string.IsNullOrEmpty(r)) result.Recipe = r;
            if (TryGet(m, "rm", out var rm) && !string.IsNullOrEmpty(rm)) result.Rm = rm;
        }
        return result;
    }

    private static bool TryGet(Match m, string group, out string value)
    {
        var g = m.Groups[group];
        if (g.Success && !string.IsNullOrWhiteSpace(g.Value))
        {
            value = g.Value.Trim();
            return true;
        }
        value = string.Empty;
        return false;
    }

    private static double? ParseDouble(string s)
    {
        return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    private sealed class EntityState
    {
        public string EntityId = string.Empty;
        public string Plant = string.Empty;
        public string Recipe = "UNKNOWN";
        public string Rm = "UNKNOWN";
        public string BatchId = "0";
        public int Shift = 1;
        public int Count;
        public double LastSp;
        public double LastPv;
        public double LastDeviationPct;
        public Queue<double> Last10 = new();
        public DateTime? FirstTimestamp;
    }
}
