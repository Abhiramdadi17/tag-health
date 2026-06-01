using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Json;
using backend_dotnet.Models;
using backend_dotnet.Services;

namespace backend_dotnet;

public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        builder.WebHost.ConfigureKestrel(o =>
        {
            o.ListenAnyIP(5050);
        });

        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
                policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
        });

        builder.Services.Configure<JsonOptions>(opt =>
        {
            opt.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        });

        builder.Services.AddSingleton<TagLoaderService>();
        builder.Services.AddSingleton<RiskPredictorService>();
        builder.Services.AddSingleton<TftAttentionService>();
        builder.Services.AddSingleton<OnnxRiskPredictor>();
        builder.Services.AddSingleton<ZoneTelemetryService>();

        var app = builder.Build();

        app.UseCors();

        var logger = app.Logger;
        var tagLoader = app.Services.GetRequiredService<TagLoaderService>();
        var heuristic = app.Services.GetRequiredService<RiskPredictorService>();
        var onnx = app.Services.GetRequiredService<OnnxRiskPredictor>();

        // Pre-warm the tag cache at startup so the first /tags call is fast.
        try
        {
            var count = tagLoader.GetTags().Count;
            logger.LogInformation("Pre-loaded {Count} tags from Excel", count);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Pre-load failed; /tags will retry on first request");
        }

        app.MapGet("/", () => Results.Json(new
        {
            service = "Unified Forecasting API (.NET port)",
            version = "1.0",
            endpoints = new
            {
                health = "GET /health",
                tags = "GET /tags",
                predict = "POST /predict",
                predict_batch = "POST /predict/batch",
                explain = "GET /explain/{entity_id}",
                models = "GET /models",
            },
            models = new
            {
                primary = "Heuristic LightGBM port (deviation-driven risk)",
                secondary = "Heuristic temporal attention",
            },
            output_fields = new
            {
                risk_score = "float [0, 1]",
                risk_class = "low | medium | high | critical",
                lead_time_minutes = "float",
                top_precursors = "list[Precursor]",
                temporal_attention = "dict[window, weight]",
                uncertainty_band = "{p10,p50,p90}",
                trajectory_summary = "string",
                confidence = "float",
            }
        }));

        app.MapGet("/health", () =>
        {
            var loaded = onnx.IsReady
                ? onnx.ModelVersions.Keys.ToArray()
                : (heuristic.ModelsLoaded ? heuristic.ModelVersions.Keys.ToArray() : Array.Empty<string>());
            return Results.Json(new
            {
                status = onnx.IsReady ? "healthy" : (heuristic.ModelsLoaded ? "healthy" : "degraded"),
                backend = onnx.IsReady ? "onnx" : "heuristic",
                loaded_models = loaded,
                tag_count = tagLoader.GetTags().Count,
                timestamp = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            });
        });

        app.MapGet("/tags", (TagLoaderService loader) =>
        {
            return Results.Json(loader.GetTags());
        });

        app.MapPost("/predict", async (HttpRequest req) =>
        {
            try
            {
                var body = await JsonSerializer.DeserializeAsync<PredictRequest>(
                    req.Body, new JsonSerializerOptions(JsonSerializerDefaults.Web));
                if (body is null) return Results.BadRequest(new { error = "Empty request body" });
                var result = onnx.Predict(body) ?? heuristic.Predict(body);
                return Results.Json(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Prediction failed");
                return Results.Json(new { error = ex.Message }, statusCode: 400);
            }
        });

        app.MapPost("/predict/batch", async (HttpRequest req) =>
        {
            try
            {
                var body = await JsonSerializer.DeserializeAsync<BatchPredictRequest>(
                    req.Body, new JsonSerializerOptions(JsonSerializerDefaults.Web));
                if (body is null || body.Data.Count == 0)
                    return Results.BadRequest(new { error = "No data provided" });
                var result = onnx.PredictBatch(body.Data) ?? heuristic.PredictBatch(body.Data);
                return Results.Json(result);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Batch prediction failed");
                return Results.Json(new { error = ex.Message }, statusCode: 400);
            }
        });

        app.MapGet("/zones/telemetry", (string zone, int? limit, string? since, ZoneTelemetryService svc) =>
        {
            DateTime? sinceUtc = null;
            if (!string.IsNullOrWhiteSpace(since) &&
                DateTime.TryParse(since, System.Globalization.CultureInfo.InvariantCulture,
                                  System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                                  out var parsed))
            {
                sinceUtc = parsed;
            }
            var rows = svc.GetWindow(zone, limit ?? 500, sinceUtc);
            return Results.Json(new { zone, count = rows.Count, rows });
        });

        app.MapGet("/zones/counts", (ZoneTelemetryService svc) => Results.Json(svc.Counts()));

        app.MapGet("/zones/tags", (string zone, ZoneTelemetryService svc) =>
        {
            var tags = svc.TagsSummary(zone);
            return Results.Json(new { zone, count = tags.Count, tags });
        });

        app.MapGet("/explain/{entityId}", (string entityId) =>
        {
            return Results.Json(new
            {
                error = "Not implemented - requires prediction cache",
                hint = "Call /predict first, then use /explain with cached prediction",
            }, statusCode: 501);
        });

        app.MapGet("/models", () =>
        {
            var versions = onnx.IsReady ? onnx.ModelVersions : heuristic.ModelVersions;
            return Results.Json(new
            {
                backend = onnx.IsReady ? "onnx" : "heuristic",
                models = versions,
                lgbm_loaded = onnx.IsReady || heuristic.ModelsLoaded,
                tft_loaded = false,
                features = Array.Empty<string>(),
            });
        });

        Console.WriteLine(new string('=', 60));
        Console.WriteLine("Unified Forecasting API Server (.NET 8)");
        Console.WriteLine(new string('=', 60));
        Console.WriteLine($"[OK] {tagLoader.GetTags().Count} tags ready");
        if (onnx.IsReady)
            Console.WriteLine($"[OK] ONNX predictor active (models: {string.Join(", ", onnx.ModelVersions.Keys)})");
        else
            Console.WriteLine($"[WARN] ONNX not loaded, falling back to heuristic ({string.Join(", ", heuristic.ModelVersions.Select(kv => $"{kv.Key}={kv.Value}"))})");
        Console.WriteLine("[OK] Listening on http://0.0.0.0:5050");
        Console.WriteLine("     Endpoints: /, /health, /tags, /predict, /predict/batch, /explain/{id}, /models");
        Console.WriteLine(new string('=', 60));

        app.Run();
    }
}
