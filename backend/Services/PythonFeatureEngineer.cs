using System.Globalization;

namespace backend_dotnet.Services;

/// <summary>
/// Byte-for-byte port of <c>engineer_features</c> in forecasting_api.py. Produces
/// the full ~149 named feature dictionary that the ONNX-exported LightGBM
/// regressors and classifiers expect. Each ONNX session selects the subset it
/// needs by feature name and order, so this dictionary is the single source of
/// truth for inference inputs.
/// </summary>
public static class PythonFeatureEngineer
{
    private static readonly int[] Windows = { 60, 120, 180, 360 };

    public static Dictionary<string, double> Build(Models.PredictRequest request)
    {
        var features = request.Features ?? new Dictionary<string, double>();

        var rawReadings = request.Last10Readings ?? new List<double>();
        var readings = NormaliseReadings(rawReadings);

        double sp = features.TryGetValue("current_sp", out var spVal) && spVal != 0 ? spVal : 100.0;
        double pv = features.TryGetValue("current_pv", out var pvVal) ? pvVal : sp;
        double batchPct = features.TryGetValue("batch_position_pct", out var bp) ? bp : 50.0;
        int shift = features.TryGetValue("shift", out var sh) ? (int)sh : 1;

        var e = readings.ToArray();
        var r = e.Select(v => sp * (1.0 + v / 100.0)).ToArray();

        DateTime ts;
        int hour;
        double elapsed;
        if (!string.IsNullOrWhiteSpace(request.Timestamp) &&
            DateTime.TryParse(request.Timestamp, CultureInfo.InvariantCulture,
                              DateTimeStyles.AssumeLocal, out ts))
        {
            hour = ts.Hour;
            elapsed = Math.Max((DateTime.UtcNow - ts.ToUniversalTime()).TotalSeconds, 1.0);
        }
        else
        {
            hour = 0;
            elapsed = 1.0;
        }

        var feat = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["SP"] = sp,
            ["PV"] = pv,
            ["SP_smooth"] = sp,
            ["PV_smooth"] = pv,
            ["stage"] = batchPct / 100.0,
            ["batch"] = 0.0,
            ["hour"] = hour,
            ["shift"] = shift,
            ["elapsed_batch_seconds"] = elapsed,
            ["production_cycle"] = 0.0,
            ["latency_seconds"] = 5.0,
            ["sparse_update"] = 0.0,

            ["error_pct"] = Last(e),
            ["abs_deviation"] = Math.Abs(Last(e)),
            ["normalized_deviation"] = sp != 0 ? Last(e) / sp : 0.0,
            ["cumulative_drift"] = e.Sum(Math.Abs),
            ["sp_pv_lag_error"] = pv - sp,
            ["rolling_slope"] = LinearSlope(e),
            ["overshoot_magnitude"] = Math.Max(Math.Abs(Last(e) - First(e)), 0),
            ["deviation_persistence"] = Mean(e.Select(Math.Abs)),

            ["pv_lag_1"] = r.Length > 1 ? r[^2] : pv,
            ["pv_lag_2"] = r.Length > 2 ? r[^3] : pv,
            ["pv_lag_5"] = r.Length > 5 ? r[^6] : pv,
            ["pv_lag_10"] = First(r),
            ["error_lag_1"] = e.Length > 1 ? e[^2] : 0.0,
            ["error_lag_5"] = e.Length > 5 ? e[^6] : 0.0,
        };

        AddRollingWindows(feat, "pv", r);
        AddRollingWindows(feat, "error", e, includeVarFlag: false);

        feat["pv_ema_10"] = Ema(r, 10);
        feat["pv_ema_60"] = Ema(r, 10); // Python alias, same call signature
        feat["error_ema_10"] = Ema(e, 10);
        feat["error_ema_60"] = Ema(e, 10);

        feat["pv_velocity"] = r.Length > 1 ? Diff(r)[^1] : 0.0;
        feat["pv_acceleration"] = r.Length > 2 ? Diff(Diff(r))[^1] : 0.0;
        feat["error_velocity"] = e.Length > 1 ? Diff(e)[^1] : 0.0;
        feat["error_acceleration"] = e.Length > 2 ? Diff(Diff(e))[^1] : 0.0;
        feat["pv_jerk"] = r.Length > 3 ? Diff(Diff(Diff(r)))[^1] : 0.0;
        feat["error_jerk"] = e.Length > 3 ? Diff(Diff(Diff(e)))[^1] : 0.0;

        var diffE = e.Length > 1 ? Diff(e) : Array.Empty<double>();
        feat["volatility_index"] = StdDev(diffE);
        feat["oscillation_score"] = ZeroCrossingRate(e);
        feat["drift_score"] = e.Length > 1 ? Math.Abs(Last(e) - First(e)) : 0.0;
        feat["sudden_jump_score"] = e.Length > 1 ? diffE.Select(Math.Abs).Max() : 0.0;
        feat["instability_score"] = StdDev(e);

        feat["machine_rm_pv_mean"] = Mean(r);
        feat["machine_rm_pv_std"] = StdDev(r);
        feat["machine_rm_error_mean"] = Mean(e.Select(Math.Abs));
        feat["tag_vs_machine_rm_pv"] = 0.0;
        feat["tag_vs_machine_rm_error"] = 0.0;
        feat["sp_pv_response_gap"] = 0.0;
        feat["error_accumulation_rate"] = e.Sum() / elapsed;

        feat["control_degradation_score"] = Mean(e.Select(Math.Abs));
        feat["precursor_oscillation_score"] = ZeroCrossingRate(e);
        feat["precursor_variance_score"] = Variance(e);
        feat["precursor_drift_score"] = e.Length > 1 ? Math.Abs(Last(e) - First(e)) : 0.0;
        feat["precursor_instability_score"] = Instability(e, 1);

        foreach (var w in Windows)
        {
            var sfx = w.ToString(CultureInfo.InvariantCulture);
            var diffSign = e.Length > 2 ? Diff(e.Select(Math.Sign).Select(v => (double)v).ToArray()) : Array.Empty<double>();

            feat[$"zero_crossing_rate_{sfx}"] = ZeroCrossingRate(e);
            feat[$"error_zero_crossing_rate_{sfx}"] = ZeroCrossingRate(e);
            feat[$"sign_change_frequency_{sfx}"] = ZeroCrossingRate(e);
            feat[$"local_extrema_density_{sfx}"] = e.Length > 2
                ? Diff(Diff(e).Select(Math.Sign).Select(v => (double)v).ToArray()).Select(Math.Abs).Sum() / Math.Max(e.Length, 1)
                : 0.0;
            feat[$"oscillation_frequency_{sfx}"] = ZeroCrossingRate(e) / Math.Max(elapsed, 1);
            feat[$"pv_variance_acceleration_{sfx}"] = r.Length > 1 ? Variance(Diff(r)) : 0.0;
            feat[$"volatility_growth_rate_{sfx}"] = e.Length > 3
                ? StdDev(e[^3..]) - StdDev(e[..3])
                : 0.0;
            feat[$"variance_expansion_ratio_{sfx}"] = e.Length > 3
                ? Variance(e[^3..]) / Math.Max(Variance(e[..3]), 1e-9)
                : 1.0;
            feat[$"rolling_entropy_{sfx}"] = 0.0;
            feat[$"signal_energy_{sfx}"] = e.Sum(v => v * v);
            feat[$"signal_energy_growth_{sfx}"] = e.Length > 3
                ? e[^3..].Sum(v => v * v) - e[..3].Sum(v => v * v)
                : 0.0;
            feat[$"rolling_acceleration_{sfx}"] = e.Length > 2
                ? Diff(Diff(e)).Select(Math.Abs).Average()
                : 0.0;
            feat[$"acceleration_instability_{sfx}"] = Instability(e, 2);
            feat[$"jerk_instability_{sfx}"] = Instability(e, 3);
            feat[$"trend_instability_{sfx}"] = Instability(e, 1);
            feat[$"settling_instability_{sfx}"] = StdDev(e[^Math.Min(3, e.Length)..]);
            feat[$"control_delay_estimate_{sfx}"] = 0.0;
            feat[$"error_accumulation_{sfx}"] = e.Sum();
            feat[$"waveform_instability_score_{sfx}"] = e.Length > 1 ? Variance(Diff(e)) : 0.0;
        }

        return feat;
    }

    private static double[] NormaliseReadings(IReadOnlyList<double> source)
    {
        if (source.Count == 0) return new double[] { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
        if (source.Count >= 2) return source.ToArray();
        // pad: ([0]*10 + list(readings))[-10:]
        var padded = new double[10];
        var offset = 10 - source.Count;
        for (var i = 0; i < source.Count; i++) padded[offset + i] = source[i];
        return padded;
    }

    private static void AddRollingWindows(Dictionary<string, double> feat, string prefix, double[] arr, bool includeVarFlag = true)
    {
        var w5 = arr.Length >= 5 ? arr[^5..] : arr;
        var mean5 = Mean(w5);
        var std5 = StdDev(w5);
        var var5 = Variance(w5);

        feat[$"{prefix}_roll_mean_5"] = mean5;
        feat[$"{prefix}_roll_std_5"] = std5;
        if (includeVarFlag) feat[$"{prefix}_roll_var_5"] = var5;

        var meanAll = Mean(arr);
        var stdAll = StdDev(arr);
        var varAll = Variance(arr);
        foreach (var w in new[] { 15, 60, 300 })
        {
            feat[$"{prefix}_roll_mean_{w}"] = meanAll;
            feat[$"{prefix}_roll_std_{w}"] = stdAll;
            if (includeVarFlag) feat[$"{prefix}_roll_var_{w}"] = varAll;
        }
    }

    private static double Last(double[] arr) => arr.Length == 0 ? 0.0 : arr[^1];
    private static double First(double[] arr) => arr.Length == 0 ? 0.0 : arr[0];

    private static double Mean(IEnumerable<double> values)
    {
        double sum = 0; int n = 0;
        foreach (var v in values) { sum += v; n++; }
        return n == 0 ? 0 : sum / n;
    }

    private static double Variance(IEnumerable<double> values)
    {
        var arr = values as double[] ?? values.ToArray();
        if (arr.Length == 0) return 0;
        var m = Mean(arr);
        double s = 0;
        for (var i = 0; i < arr.Length; i++) { var d = arr[i] - m; s += d * d; }
        return s / arr.Length;
    }

    private static double StdDev(IEnumerable<double> values) => Math.Sqrt(Variance(values));

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

    private static double ZeroCrossingRate(double[] values)
    {
        if (values.Length < 2) return 0;
        double crossings = 0;
        for (var i = 1; i < values.Length; i++)
        {
            var a = Math.Sign(values[i - 1]);
            var b = Math.Sign(values[i]);
            crossings += Math.Abs(a - b);
        }
        return crossings / 2.0;
    }

    private static double Ema(double[] arr, int span)
    {
        if (arr.Length == 0) return 0;
        var alpha = 2.0 / (span + 1);
        var v = arr[0];
        for (var i = 1; i < arr.Length; i++) v = alpha * arr[i] + (1 - alpha) * v;
        return v;
    }

    private static double Instability(double[] arr, int order)
    {
        var current = arr;
        for (var i = 0; i < order; i++)
        {
            if (current.Length < 2) return 0;
            current = Diff(current);
        }
        return StdDev(current);
    }
}
