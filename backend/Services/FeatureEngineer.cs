using System.Globalization;

namespace backend_dotnet.Services;

/// <summary>
/// Ports the numpy feature pipeline used by the Python forecaster. The 149-feature
/// vector is summarised into intermediate statistics that drive the heuristic risk
/// scorer. The complete vector schema is preserved for downstream callers that may
/// re-introduce a native model.
/// </summary>
public class FeatureSummary
{
    public double Sp { get; init; }
    public double Pv { get; init; }
    public double[] Errors { get; init; } = Array.Empty<double>();
    public double[] PvSeries { get; init; } = Array.Empty<double>();
    public double Mean { get; init; }
    public double Volatility { get; init; }
    public double Trend { get; init; }
    public double Slope { get; init; }
    public double LastError { get; init; }
    public double AbsoluteDeviation { get; init; }
    public double CumulativeDrift { get; init; }
    public double VarianceExpansion { get; init; }
    public double JumpScore { get; init; }
    public double InstabilityScore { get; init; }
    public double OscillationScore { get; init; }
    public double ElapsedBatchSeconds { get; init; }
    public int Hour { get; init; }
    public int Shift { get; init; }
    public double BatchPositionPct { get; init; }
}

public static class FeatureEngineer
{
    public static FeatureSummary Build(
        double sp,
        double pv,
        IReadOnlyList<double> last10Readings,
        DateTime timestamp,
        int shift = 1,
        double batchPositionPct = 50.0)
    {
        var padded = NormaliseReadings(last10Readings);
        var pvSeries = padded.Select(e => sp * (1.0 + e / 100.0)).ToArray();

        var mean = Mean(padded);
        var volatility = StdDev(padded);
        var trend = padded.Length > 1 ? padded[^1] - padded[0] : 0.0;
        var slope = LinearSlope(padded);
        var jump = MaxAbsDiff(padded);
        var oscillation = ZeroCrossingRate(padded);

        double varExpansion = 1.0;
        if (padded.Length >= 6)
        {
            var firstHalf = padded[..3];
            var lastHalf = padded[^3..];
            var vFirst = Variance(firstHalf);
            var vLast = Variance(lastHalf);
            varExpansion = vLast / Math.Max(vFirst, 1e-9);
        }

        var elapsed = Math.Max((DateTime.UtcNow - timestamp.ToUniversalTime()).TotalSeconds, 1.0);

        return new FeatureSummary
        {
            Sp = sp,
            Pv = pv,
            Errors = padded,
            PvSeries = pvSeries,
            Mean = mean,
            Volatility = volatility,
            Trend = trend,
            Slope = slope,
            LastError = padded[^1],
            AbsoluteDeviation = Math.Abs(padded[^1]),
            CumulativeDrift = padded.Select(Math.Abs).Sum(),
            VarianceExpansion = varExpansion,
            JumpScore = jump,
            InstabilityScore = StdDev(Diff(padded)),
            OscillationScore = oscillation,
            ElapsedBatchSeconds = elapsed,
            Hour = timestamp.Hour,
            Shift = shift,
            BatchPositionPct = batchPositionPct,
        };
    }

    public static FeatureSummary BuildFromRequest(
        string entityId,
        string? timestampIso,
        IReadOnlyList<double>? readings,
        IDictionary<string, double>? features)
    {
        var sp = ReadFeature(features, "current_sp", 100.0);
        var pv = ReadFeature(features, "current_pv", sp);
        var shift = (int)ReadFeature(features, "shift", 1.0);
        var batchPct = ReadFeature(features, "batch_position_pct", 50.0);

        DateTime ts = DateTime.UtcNow;
        if (!string.IsNullOrWhiteSpace(timestampIso) &&
            DateTime.TryParse(timestampIso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed))
        {
            ts = parsed.ToUniversalTime();
        }

        var readingList = readings ?? new List<double>();
        return Build(sp, pv, readingList, ts, shift, batchPct);
    }

    private static double ReadFeature(IDictionary<string, double>? features, string key, double fallback)
    {
        if (features is not null && features.TryGetValue(key, out var v) && !double.IsNaN(v) && v != 0)
            return v;
        if (features is not null && features.TryGetValue(key, out var raw))
            return raw == 0 && key == "current_sp" ? fallback : raw;
        return fallback;
    }

    private static double[] NormaliseReadings(IReadOnlyList<double> source)
    {
        if (source is null || source.Count == 0)
            return new double[] { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };

        if (source.Count >= 10)
            return source.TakeLast(10).ToArray();

        var padding = new double[10 - source.Count];
        return padding.Concat(source).ToArray();
    }

    private static double Mean(IReadOnlyList<double> values)
    {
        if (values.Count == 0) return 0;
        double s = 0;
        for (var i = 0; i < values.Count; i++) s += values[i];
        return s / values.Count;
    }

    private static double Variance(IReadOnlyList<double> values)
    {
        if (values.Count <= 1) return 0;
        var m = Mean(values);
        double s = 0;
        for (var i = 0; i < values.Count; i++)
        {
            var d = values[i] - m;
            s += d * d;
        }
        return s / values.Count;
    }

    private static double StdDev(IReadOnlyList<double> values) => Math.Sqrt(Variance(values));

    private static double[] Diff(double[] values)
    {
        if (values.Length < 2) return Array.Empty<double>();
        var result = new double[values.Length - 1];
        for (var i = 1; i < values.Length; i++) result[i - 1] = values[i] - values[i - 1];
        return result;
    }

    private static double LinearSlope(double[] y)
    {
        if (y.Length < 2) return 0;
        double sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (var i = 0; i < y.Length; i++)
        {
            sumX += i;
            sumY += y[i];
            sumXY += i * y[i];
            sumXX += i * i;
        }
        var n = y.Length;
        var denom = n * sumXX - sumX * sumX;
        if (Math.Abs(denom) < 1e-12) return 0;
        return (n * sumXY - sumX * sumY) / denom;
    }

    private static double MaxAbsDiff(double[] values)
    {
        if (values.Length < 2) return 0;
        var max = 0.0;
        for (var i = 1; i < values.Length; i++)
        {
            var d = Math.Abs(values[i] - values[i - 1]);
            if (d > max) max = d;
        }
        return max;
    }

    private static double ZeroCrossingRate(double[] values)
    {
        if (values.Length < 2) return 0;
        double crossings = 0;
        for (var i = 1; i < values.Length; i++)
        {
            var a = Math.Sign(values[i - 1]);
            var b = Math.Sign(values[i]);
            if (a != b) crossings++;
        }
        return crossings / 2.0;
    }
}
