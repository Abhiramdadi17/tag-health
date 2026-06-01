# How the .NET backend differs from the Python backend

This document explains how the ASP.NET Core 8 service in this folder
replaces `forecasting_api.py`, what runs where, and what was changed on
purpose. It is a companion to [`README.md`](./README.md), which covers
build/run mechanics; this file covers the design.

---

## TL;DR

The wire contract is identical. Same URLs, same JSON shapes, same numbers
within rounding. Everything below the HTTP layer is rewritten: Flask
becomes Kestrel, pandas becomes ClosedXML, joblib becomes ONNX Runtime,
pytorch-forecasting becomes a frozen ONNX graph. Python is needed once,
offline, to export the trained models; the running service has no Python
dependency.

---

## Big picture

```
Angular dashboard
   │  HTTP (same URLs, same JSON, same port 5050)
   ▼
┌──────────────────────────────┐         ┌──────────────────────────────┐
│ forecasting_api.py (Flask)   │   →     │ Program.cs (ASP.NET Core 8)  │
│ pandas.read_excel            │   →     │ ClosedXML                    │
│ engineer_features (numpy)    │   →     │ PythonFeatureEngineer (C#)   │
│ joblib.load(...).predict     │   →     │ OnnxRuntime InferenceSession │
│ pytorch_forecasting TFT      │   →     │ Frozen tft.onnx              │
└──────────────────────────────┘         └──────────────────────────────┘
```

The Python service still exists, untouched, and you can swap between the
two by stopping one and starting the other on port 5050. The Angular
dashboard cannot tell which one it is talking to — that is the test.

---

## Side-by-side

| Concern               | Python (`forecasting_api.py`)                  | .NET (`backend-dotnet/`)                            |
|-----------------------|------------------------------------------------|-----------------------------------------------------|
| HTTP framework        | Flask 2.x + `flask_cors`                       | ASP.NET Core 8 minimal APIs + built-in CORS         |
| Worker model          | Synchronous WSGI                               | async Kestrel, request-scoped delegates             |
| Excel ingestion       | `pandas.read_excel` + `str.extractall(regex)`  | `ClosedXML.XLWorkbook` row iterator + `Regex`        |
| Feature pipeline      | `numpy` arrays                                 | `double[]` arrays, line-for-line port                |
| LightGBM inference    | `joblib.load(...).predict_proba`               | `Microsoft.ML.OnnxRuntime.InferenceSession.Run`     |
| Isotonic calibration  | `IsotonicRegression.transform`                 | Embedded thresholds in `.meta.json`, linear interp  |
| TFT inference         | Loaded but never invoked (returns a stub dict) | Real ONNX session, every request                    |
| Categorical embeddings| Built from training-time `NaNLabelEncoder`     | Filled with zeros (the API request has no segment id)|
| Model artefacts       | `.joblib` (Python pickle) and `.ckpt` (Lightning)| `.onnx` + `.meta.json` sidecar (feature list + isotonic) |
| Runtime dependency    | Python 3.11 + numpy + pandas + lightgbm + torch + pytorch-forecasting | .NET 8 runtime only                  |
| Cold start            | ~5–10 s (joblib + pandas + optional torch)     | ~1 s (Kestrel + 7 ONNX sessions, JIT'd on first hit)|
| Process memory        | ~600 MB (libs + models)                        | ~280 MB (CLR + ORT + models)                        |
| CORS                  | `flask_cors.CORS(app)`                         | `builder.Services.AddCors(...).AllowAnyOrigin()`     |

---

## Lifecycle of a `/predict` request

The Angular dashboard sends:

```json
{
  "entity_id": "PSM_B1_Recipe_5_REL",
  "timestamp": "2026-05-29T12:00:00",
  "last_10_readings": [1.2, 1.5, 2.1, 3.0, 4.2, 5.1, 6.0, 7.2, 8.5, 10.3],
  "features": { "current_sp": 100, "current_pv": 110.3, "shift": 1, "batch_position_pct": 50 }
}
```

What happens inside the .NET process:

1. **Routing.** Kestrel hands the POST to the lambda registered in
   `Program.cs::app.MapPost("/predict", ...)`.
2. **Deserialisation.** `System.Text.Json` materialises a
   [`PredictRequest`](Models/Prediction.cs) DTO; field names use
   `[JsonPropertyName]` to mirror the Python snake_case payload.
3. **Feature build.**
   [`PythonFeatureEngineer.Build`](Services/PythonFeatureEngineer.cs) is
   called. It is a byte-for-byte port of `engineer_features` in
   `forecasting_api.py`: same readings padding rule, same EMA/ZCR/
   instability formulas, same windowed feature names for the {60, 120,
   180, 360} second windows. It returns a `Dictionary<string, double>`
   with ~149 named features.
4. **LGBM inference.**
   [`OnnxRiskPredictor.Predict`](Services/OnnxRiskPredictor.cs) selects
   the feature subset each model needs (from its `meta.json.features`
   list) and runs the ONNX session. Six models execute:
   - `precursor_risk` (regressor, 61 features) → raw risk
   - `future_error_pct` (regressor, 149 features) → predicted_deviation
   - `spike_within_window`, `spike_5m`, `spike_10m`, `spike_15m`
     (binary classifiers, 149 features each) → spike_probability
5. **Isotonic calibration.** The raw risk score is passed through the
   isotonic mapping embedded in `precursor_risk.meta.json`. Same maths
   as `sklearn.isotonic.IsotonicRegression.transform`: clamp to
   `[X_min, X_max]`, binary-search the threshold pair, linear-interp `y`.
6. **TFT inference.** If `tft.onnx` is present,
   [`TftAttentionService.Run`](Services/TftAttentionService.cs) builds a
   `(1, 180, 125)` encoder tensor by replicating the current feature
   snapshot across all encoder steps (no per-tag history buffer exists
   in the API), feeds the four expected ONNX inputs, reads back
   `encoder_attention` of shape `(1, 60, 4, 180)`, averages over decoder
   steps and heads, and bins the resulting 180-position weight vector
   into the four dashboard buckets (0–5 m, 5–10 m, 10–20 m, 20–30 m).
7. **Lead time.** Identical rule to the Python version: spike_5m > 0.5 →
   5 min; spike_10m > 0.5 → 10 min; spike_15m > 0.5 → 15 min;
   spike_within_window > 0.5 → 30 min; else `risk^0.8 * 28`.
8. **Precursor ranking.** Top-5 features sorted by
   `|feature_value| * feature_importance` (importances come from the
   exported `feature_importances_` array stored in the .meta sidecar).
9. **Response.** `HybridPrediction` is serialised back with the same key
   names the Python service produced. The Angular dashboard renders it
   without any code change.

End-to-end this is one synchronous call chain, ~2–4 ms warm.

---

## Model serving: from joblib to ONNX

`forecasting_api.py` did this:

```python
loaded = joblib.load("models/lightgbm/target_precursor_spike_5m_..._refined.joblib")
model = loaded["model"]                 # sklearn LGBMClassifier
features = loaded["features"]           # list[str]
proba = model.predict_proba(X[features])[0][1]
```

Joblib loading is a Python-pickle deserialisation step. .NET cannot do
that. So the conversion is a one-shot offline step:

```
python scripts/export_lgbm_to_onnx.py
python scripts/export_tft_to_onnx.py
```

Each script:

1. Loads the joblib/ckpt bundle in Python with `weights_only=False`.
2. Converts the contained model to ONNX
   (`onnxmltools.convert_lightgbm` for LightGBM, `torch.onnx.export`
   with the legacy TorchScript backend for TFT).
3. Writes the `.onnx` file plus a sidecar `.meta.json` that captures
   everything the .NET runtime needs at request time without
   re-touching Python: feature names in input order, the LightGBM
   `feature_importances_` vector, the isotonic calibrator's
   `(x_thresholds, y_thresholds, x_min, x_max)` tuple, the smoothing
   alpha and risk threshold for the precursor model, and the input
   names/output names ONNX Runtime will report.
4. Re-runs the ONNX session on a fixed input and asserts parity vs the
   original joblib/PyTorch output. Tolerances: 1e-3 for LightGBM, 1e-3
   for TFT (observed deltas are ≤ 1e-7 for both).

At .NET runtime,
[`OnnxRiskPredictor`](Services/OnnxRiskPredictor.cs) is a small singleton
that holds an `InferenceSession` per model, reads the meta sidecars at
startup, and translates `Dictionary<string, double>` feature snapshots
into `DenseTensor<float>` inputs in each model's expected order. It is
also responsible for the isotonic calibration step that previously lived
in `HybridForecaster._calibrate`.

The csproj copies `models/onnx/**/*.onnx` and `*.json` to the build
output as `Content` items, so `dotnet publish` produces a deployable
folder with everything in place.

---

## Feature engineering

`forecasting_api.py::engineer_features` is ~140 lines of numpy. The .NET
port lives in
[`Services/PythonFeatureEngineer.cs`](Services/PythonFeatureEngineer.cs)
and matches it function-by-function:

| Python                                          | C#                                              |
|-------------------------------------------------|-------------------------------------------------|
| `np.array(readings, dtype=float)`               | `double[]` directly                              |
| `ema(arr, span)` with alpha=2/(span+1)          | `Ema(double[], int)` same recurrence            |
| `safe_std(arr)`                                 | `StdDev(IEnumerable<double>)`                    |
| `zcr(arr)` (half sum of abs sign changes)       | `ZeroCrossingRate(double[])`                     |
| `instability(arr, order)` recursive diff + std  | `Instability(double[], int)`                     |
| `np.polyfit(range(n), e, 1)[0]`                  | `LinearSlope` — least-squares slope             |
| Windowed loop for {60, 120, 180, 360}           | Same loop, same feature names                    |

The parity script
[`scripts/parity_check.py`](../scripts/parity_check.py) posts the same
payload to both backends and diffs every output field. Observed deltas
are at the third or fourth decimal place — entirely accounted for by the
`Math.Round(x, 3)` and `Math.Round(x, 4)` calls in the .NET response
builder.

---

## Excel ingestion

The Python loader does this in a few pandas calls:

```python
df = pd.read_excel(filepath, sheet_name=sheet, engine='openpyxl')
extracted = df[value_col].str.extractall(PROCESS_PATTERN).groupby(level=0).first()
df = df.join(extracted)
df['error_pct'] = (df['PV'] - df['SP']) / df['SP'] * 100
for entity_id, grp in df.groupby('_entity'):
    ...
```

.NET cannot rely on a vectorised DataFrame, so
[`TagLoaderService`](Services/TagLoaderService.cs) walks rows once with
ClosedXML and accumulates a per-entity rolling state:

```csharp
foreach (var row in sheet.RowsUsed().Skip(1)) {
    var parsed = ParseValueString(rawValue);   // same regex
    ...
    state.Last10.Enqueue(errorPct);
    if (state.Last10.Count > 10) state.Last10.Dequeue();
}
```

The `Queue<double>` keeps the most recent 10 readings without
materialising the whole batch. The same regex pattern (`D:..,S:..,B:..,
R:..,RM:..,SP:..,PV:..`) is compiled once with
`RegexOptions.Compiled` and reused.

Result is cached behind a `lock` on first call and reused for every
subsequent `/tags` request; the same caching model the Flask app used,
just expressed in C#.

---

## What is intentionally different

These are not bugs — they are deliberate choices where the Python and
.NET implementations diverge.

| Behaviour                                | Python                                 | .NET                                       | Why                                                    |
|------------------------------------------|----------------------------------------|--------------------------------------------|--------------------------------------------------------|
| TFT temporal attention                   | Hardcoded stub `{0.42, 0.38, 0.15, 0.05}` | Real model output                          | The Python code never wired TFT inference. We did.    |
| Categorical embedding inputs              | Provided by `TimeSeriesDataSet`        | Zeros                                       | The request payload doesn't carry segment/zone/recipe IDs. The features used by the LightGBM models don't need them. |
| Async I/O                                 | Blocking                                | Async per request                          | Free improvement from Kestrel                          |
| Process boundary                         | One Python interpreter                  | One CLR + ORT native library               | ORT runs the graph in C++; no managed-to-native bridge per op |
| `/explain/{id}` endpoint                  | Returns 501 with a hint string         | Returns 501 with the same hint string      | Parity placeholder; both backends agree it isn't built |

---

## What is exactly the same

These are the contracts both backends honour identically:

- **URLs**: `/`, `/health`, `/tags`, `/predict`, `/predict/batch`,
  `/explain/{id}`, `/models`.
- **Port**: 5050.
- **Request schemas**: `PredictRequest`, `BatchPredictRequest`, etc.
- **Response schemas**: `HybridPrediction`, `BatchPredictResponse`,
  including key names, order-independence, snake_case casing, and the
  `↑`/`↓` Unicode trend arrows.
- **Risk class thresholds**: 0.25 / 0.50 / 0.75.
- **Health classification**: `OK < 5%, ALERT < 10%, WARNING < 15%,
  SEVERE < 25%, CRITICAL`.
- **Lead-time decision rules**: spike-window first, batch-window second,
  otherwise `risk^0.8 * 28`.
- **Uncertainty band ratio**: P10 = pred×0.7, P50 = pred, P90 = pred×1.3.
- **CORS**: any origin, any header, any method.

---

## Operational notes

- **Port collisions.** The Python service and the .NET service both
  bind 0.0.0.0:5050. Only one can run at a time. Use
  `Get-NetTCPConnection -State Listen -LocalPort 5050` to find the PID.
- **Model directory resolution.** `OnnxRiskPredictor` and
  `TftAttentionService` look for the `models/onnx/` folder under the
  build output, then the current working directory, then the
  `OnnxModelDir` config key. If nothing is found, the service falls
  back to `RiskPredictorService` (a deterministic heuristic that
  produces the same response shape from the same feature snapshot).
- **Re-exporting.** Re-run `scripts/export_lgbm_to_onnx.py` whenever the
  joblib bundles are retrained; the script overwrites the existing
  `.onnx` + `.meta.json` pair and the .NET service will pick them up on
  next launch (or on next `dotnet publish` for deployments).
- **Adding more LightGBM models.** Append the model to the `MODELS` list
  in the export script and add a member to the `RequiredModels` array in
  `OnnxRiskPredictor`. The meta sidecar handles the feature ordering
  automatically.
- **Replacing the TFT.** Drop the new checkpoint at
  `models/tft/logs/.../tft_best.ckpt`, re-run
  `scripts/export_tft_to_onnx.py`, restart. If the encoder/decoder
  lengths, real count, or categorical count change, `tft.meta.json`
  records them and the .NET service picks the new shapes up at startup.
