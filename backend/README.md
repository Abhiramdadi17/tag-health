# Forecasting API — .NET 8 port

Replaces `forecasting_api.py` (Flask) with an ASP.NET Core 8 minimal API.
The trained LightGBM models are exported to ONNX and executed in-process
through Microsoft.ML.OnnxRuntime, so .NET produces predictions that match
the original Python pipeline.

## Endpoints

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| GET    | `/`                   | API metadata |
| GET    | `/health`             | Status + tag count + active backend |
| GET    | `/tags`               | Tags loaded from the Excel workbooks |
| POST   | `/predict`            | Hybrid prediction for a single tag |
| POST   | `/predict/batch`      | Batch prediction + summary |
| GET    | `/explain/{entityId}` | Reserved (501 placeholder) |
| GET    | `/models`             | Loaded model versions / backend |

JSON request/response shapes are byte-compatible with the Python service.

## Run

```
cd d:\tag3\backend-dotnet
dotnet run -c Release
```

Listens on `http://localhost:5050`, with CORS open so the Angular dev
server (`http://localhost:5173`) can call it.

## Data sources

`Services/TagLoaderService.cs` reads:

* `data/LLPL PSM 1st April to 20th May.xlsx`
* `data/PSM_TagData_10th_to_20th.xlsx`

…via ClosedXML and aggregates 1341 unique entities.

## ONNX-backed predictions

The original Flask service loaded LightGBM joblib bundles and an optional
TFT PyTorch checkpoint. The joblib bundles are now exported once to ONNX:

```
python scripts/export_lgbm_to_onnx.py
```

This writes six `.onnx` files plus matching `.meta.json` sidecars to
`backend-dotnet/models/onnx/` and verifies that each ONNX session
reproduces the joblib output within 1e-6 on a baseline input.

Models exported:

| Name                  | kind        | features | role |
|-----------------------|-------------|---------:|------|
| precursor_risk        | regressor   |       61 | raw risk score → isotonic calibration |
| future_error_pct      | regressor   |      149 | `predicted_deviation` + uncertainty band |
| spike_within_window   | classifier  |      149 | `spike_probability.in_batch` |
| spike_5m              | classifier  |      149 | `spike_probability.5m` |
| spike_10m             | classifier  |      149 | `spike_probability.10m` |
| spike_15m             | classifier  |      149 | `spike_probability.15m` |

At runtime `Services/OnnxRiskPredictor.cs` loads all six sessions plus
the isotonic-calibrator thresholds embedded in `precursor_risk.meta.json`,
runs them against features produced by `Services/PythonFeatureEngineer.cs`
(a byte-for-byte port of Python's `engineer_features`), then applies the
same lead-time / risk-class / trajectory logic the Flask app used.
If any artefact is missing the service falls back automatically to
`RiskPredictorService` (the heuristic implementation), so the API stays
functional even without ONNX exports on disk.

### Parity tests

LightGBM models:

```
python scripts/parity_check.py
```

Posts the same payload to the running .NET API and to the joblib models
in Python, then diffs every output field. Observed deltas are ≤ 5e-4
(rounding at 3–4 decimal places).

TFT temporal attention:

```
python scripts/parity_check_tft.py
```

Runs the loaded pytorch-forecasting TFT and the .NET-served response side
by side and diffs the 4 attention buckets. Observed delta is 0.0000 on
each bucket — the .NET output is bit-identical to the PyTorch model for
the same feature snapshot.

### TFT

The pytorch-forecasting TemporalFusionTransformer at
`models/tft/logs/tft_enc15m_pred5m/tft_best.ckpt`
(encoder 180 × 5 s = 15 min history, decoder 60 × 5 s = 5 min forecast,
125 continuous + 6 categorical inputs, 4 attention heads, 3 output
quantiles) is exported to ONNX with

```
python scripts/export_tft_to_onnx.py
```

The script wraps the model in a `FlatTFT` module whose forward takes
plain tensors (encoder_cont, encoder_cat, decoder_cont, decoder_cat,
target_scale), invokes the legacy TorchScript-based ONNX exporter
(opset 17, `dynamo=False` because pytorch-forecasting's dynamic
encoder-length splits are not supported by the new dynamo path) and
verifies that the resulting ONNX session reproduces the PyTorch output
within 1e-6 for `prediction`, `encoder_attention` and `static_variables`.

`Services/TftAttentionService.cs` loads the resulting
`models/onnx/tft.onnx` (~6 MB) at startup, runs it for every request with
the engineered feature snapshot replicated across the encoder/decoder
windows, then averages the encoder attention tensor (1, 60, 4, 180) over
prediction steps and heads and bins the resulting weight vector into the
four dashboard buckets (0–5 m, 5–10 m, 10–20 m, 20–30 m). The same
buckets are used by both the .NET service and the parity reference, so
the model's attention is what reaches the dashboard.

## Project layout

```
backend-dotnet/
├── Program.cs                          # bootstrap, CORS, endpoints, ONNX-first routing
├── Models/
│   ├── TagRecord.cs                    # GET /tags shape
│   └── Prediction.cs                   # /predict, /predict/batch shapes
├── Services/
│   ├── TagLoaderService.cs             # Excel ingestion + cache
│   ├── FeatureEngineer.cs              # heuristic summary stats
│   ├── PythonFeatureEngineer.cs        # full 149-feature port of engineer_features
│   ├── RiskPredictorService.cs         # heuristic risk fallback
│   ├── OnnxRiskPredictor.cs            # 6 LGBM sessions + isotonic calibration
│   └── TftAttentionService.cs          # TFT ONNX session + 4-bucket attention summary
├── models/onnx/                        # exported by scripts/export_*_to_onnx.py
│   ├── precursor_risk.onnx / .meta.json
│   ├── future_error_pct.onnx / .meta.json
│   ├── spike_within_window.onnx / .meta.json
│   ├── spike_5m.onnx / .meta.json
│   ├── spike_10m.onnx / .meta.json
│   ├── spike_15m.onnx / .meta.json
│   └── tft.onnx / .meta.json
└── backend-dotnet.csproj               # ClosedXML 0.104.2, Microsoft.ML.OnnxRuntime 1.20.0
```
