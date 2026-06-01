# Tag Dashboard

Self-contained bundle of the live tag-monitoring stack.

```
tag dashboard/
├── frontend/    Angular 18 dashboard (port 5173)
├── backend/     ASP.NET Core 8 API + ONNX-backed forecaster (port 5050)
├── data/        Excel telemetry sources read by the backend
└── README.md
```

The rest of the workspace at `D:\tag3\` (Python ML pipeline, training
scripts, the original React frontend, the original Flask service, model
joblib/ckpt sources, notebooks, etc.) stays in place — none of it is
required to run this bundle.

## What's inside

| Folder      | Origin                       | Purpose                                              |
|-------------|------------------------------|------------------------------------------------------|
| `frontend/` | copied from `D:\tag3\frontend-angular` | Angular dashboard, talks to the .NET API at `http://localhost:5050` |
| `backend/`  | copied from `D:\tag3\backend-dotnet`   | ASP.NET Core API. Embeds the 7 ONNX models under `backend/models/onnx/` (6 LightGBM + TFT). |
| `data/`     | copied from `D:\tag3\data`             | LLPL + PSM Excel workbooks. The backend reads them on first `/tags` request. |

The backend's data-file resolver looks in several candidate locations
(see [`backend/Services/TagLoaderService.cs`](backend/Services/TagLoaderService.cs)),
including the parent of the current working directory — which is how it
picks up `tag dashboard/data/` when launched from `tag dashboard/backend/`.

## Run

### 1) Backend (terminal 1)

```
cd "D:\tag3\tag dashboard\backend"
dotnet run -c Release
```

Listens on `http://localhost:5050`. On startup you should see:

```
[OK] 1341 tags ready
[OK] ONNX predictor active (models: precursor_risk, future_error_pct,
     spike_within_window, spike_5m, spike_10m, spike_15m, tft)
[OK] Listening on http://0.0.0.0:5050
```

### 2) Frontend (terminal 2)

```
cd "D:\tag3\tag dashboard\frontend"
npm install        # only the first time
npm start          # serves http://127.0.0.1:5173
```

Open http://127.0.0.1:5173/ — you should see the Tag Health Monitor with
1341 rows, clickable to load per-tag predictions from the .NET backend.

## What was not copied

- `node_modules/` — recreated by `npm install` in the new location
- `bin/`, `obj/`, `dist/`, `.angular/cache/` — produced by the build tools
- The Python tooling at `D:\tag3\scripts\*.py` (ONNX export, parity checks).
  It is not needed to run the bundle, only to refresh the models. To
  re-export models, run those scripts from the workspace root and copy
  the resulting `*.onnx` / `*.meta.json` files into
  `tag dashboard/backend/models/onnx/`.

## Wire contract

Frontend → backend: same JSON shapes documented in
[`backend/ARCHITECTURE.md`](backend/ARCHITECTURE.md). Port 5050 is
hard-coded in [`frontend/src/app/services/tag.service.ts`](frontend/src/app/services/tag.service.ts);
change it there if you bind Kestrel to a different port in
[`backend/Program.cs`](backend/Program.cs).

## Where the rest of the tree lives

Outside this folder, the workspace still contains:

- `D:\tag3\frontend\` — original React dashboard (superseded by `frontend/` here)
- `D:\tag3\forecasting_api.py` — original Flask service (superseded by `backend/` here)
- `D:\tag3\src\` — Python ML library used by the export scripts
- `D:\tag3\models\` — joblib + Lightning checkpoint sources (input to the ONNX export)
- `D:\tag3\scripts\export_lgbm_to_onnx.py`, `export_tft_to_onnx.py`,
  `parity_check.py`, `parity_check_tft.py`
- `D:\tag3\notebooks\`, `configs/`, `colab/`, `deployment/`, `logs/`, `outputs/`

None of these are needed at runtime by the bundle in this folder.
