import { Injectable, inject, signal } from '@angular/core';
import { TagService } from './tag.service';
import { ZoneTagsService, ZoneRecentRow } from './zone-tags.service';
import { TagParserService } from './tag-parser.service';
import {
  BatchHealth, HealthStatus, STATUS_TO_BUCKET, UnifiedTagRow, ZoneType,
} from '../types/tags';
import { TagRecord } from '../types';

const ZONE_ROW_LIMIT = 2000;

/**
 * Pulls PSM tags + Sigma/Silo/Packaging telemetry from the .NET backend, runs
 * each row through the parser, and produces one flat list of UnifiedTagRow.
 * Also computes a batch-level health score: (#passing rows / #total rows in
 * the batch) * 100. Batch keying is zone-specific:
 *   PSM:       plant + batch_id + recipe
 *   SIGMA:     mixer + batch counter
 *   SILO:      bag barcode if known, else silo/station id
 *   PACKAGING: cascade
 */
@Injectable({ providedIn: 'root' })
export class ZoneAggregatorService {
  private psmSvc = inject(TagService);
  private zonesSvc = inject(ZoneTagsService);
  private parser = inject(TagParserService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Loaded rows by zone (lazy, cached). */
  private rowsByZone = new Map<ZoneType, UnifiedTagRow[]>();
  /** Separate cache for PSM OPC-UA telemetry (structural tags). */
  private psmTelemetryCache: UnifiedTagRow[] | null = null;

  async loadAll(force = false): Promise<UnifiedTagRow[]> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [psm, psmTel, sigma, silo, pkg] = await Promise.all([
        this.loadPsm(force),
        this.loadPsmTelemetry(force),
        this.loadZone('SIGMA', 'sigma', force),
        this.loadZone('SILO', 'silo', force),
        this.loadZone('PACKAGING', 'packaging', force),
      ]);
      return [...psm, ...psmTel, ...sigma, ...silo, ...pkg];
    } catch (e: any) {
      this.error.set(e?.message ?? 'failed to aggregate');
      return [];
    } finally {
      this.loading.set(false);
    }
  }

  async loadZoneSubset(zones: ZoneType[]): Promise<UnifiedTagRow[]> {
    const tasks = zones.map(z =>
      z === 'PSM'
        ? Promise.all([this.loadPsm(), this.loadPsmTelemetry()]).then(r => r.flat())
        : this.loadZone(z, this.zoneApiKey(z)));
    const results = await Promise.all(tasks);
    return results.flat();
  }

  /** Aggregate health per batchKey, counting only rows where dataAvailable=true.
   *  Rule-quality rows alone drive the score — noodle labels, idle barcodes,
   *  idle bagouts, etc. don't count for or against the batch. */
  static computeBatchHealth(rows: UnifiedTagRow[]): Map<string, BatchHealth> {
    const acc = new Map<string, { total: number; passing: number }>();
    for (const r of rows) {
      if (!r.dataAvailable) continue;
      const e = acc.get(r.batchKey) ?? { total: 0, passing: 0 };
      e.total += 1;
      if (r.passing) e.passing += 1;
      acc.set(r.batchKey, e);
    }
    const out = new Map<string, BatchHealth>();
    for (const [batchKey, v] of acc) {
      const score = v.total === 0 ? 0 : (v.passing / v.total) * 100;
      out.set(batchKey, { batchKey, total: v.total, passing: v.passing, score });
    }
    return out;
  }

  // -------------------- PSM ----------------------------------------------
  private async loadPsm(force = false): Promise<UnifiedTagRow[]> {
    if (!force && this.rowsByZone.has('PSM')) return this.rowsByZone.get('PSM')!;
    const tags = await this.psmSvc.fetchTags();
    const rows = tags.map(t => this.psmRowToUnified(t));
    this.rowsByZone.set('PSM', rows);
    return rows;
  }

  private async loadPsmTelemetry(force = false): Promise<UnifiedTagRow[]> {
    if (!force && this.psmTelemetryCache) return this.psmTelemetryCache;
    try {
      const recent = await this.zonesSvc.fetchRecent('psm_telemetry', ZONE_ROW_LIMIT, force);
      const rows = recent
        .map(r => this.zoneRowToUnified('PSM', r))
        .filter(r => r.subtype !== undefined);  // skip unparseable PSM rows
      this.psmTelemetryCache = rows;
      return rows;
    } catch {
      return [];
    }
  }

  private psmRowToUnified(t: TagRecord): UnifiedTagRow {
    const status = t.health_status as HealthStatus;
    const bucket = STATUS_TO_BUCKET[status] ?? 'WARNING';
    const dev = t.current_deviation_pct;
    return {
      zone: 'PSM',
      id: `PSM:${t.synthetic_id}`,
      tag: t.synthetic_id,
      shortTag: t.synthetic_id,
      subtype: this.psmTagType(t.synthetic_id, t.raw_material),
      machineId: t.plant,
      batchKey: `PSM:${t.plant}:${t.batch_id}:${t.recipe}`,
      recipe: t.recipe,
      rm: t.raw_material,
      batchId: t.batch_id,
      status,
      bucket,
      passing: bucket === 'GOOD',
      dataAvailable: true,
      sp: t.current_sp,
      pv: t.current_pv,
      dev,
      latestValue: `SP=${t.current_sp} PV=${t.current_pv}`,
      ts: t.batch_start_ts,
      tsUtc: this.parseTs(t.batch_start_ts),
      last10: t.last_10_readings?.length ? [...t.last_10_readings] : undefined,
    };
  }

  /** Derive a PSM tag-type subtype from the synthetic_id.
   *  RM-batch tags (Salt, AOS…) keep their raw_material as the subtype.
   *  Structural tags (Weight, Counter, Noodle Name…) are classified by
   *  parsing the suffix after "PSM_NN_" in the synthetic_id. */
  private psmTagType(syntheticId: string, rawMaterial: string): string {
    if (rawMaterial) return rawMaterial;
    const m = syntheticId.match(/^PSM_\d+_(.+)$/);
    return m ? m[1] : syntheticId;
  }

  /** Parse ISO or OPC-UA-style timestamp strings to Unix ms. Returns 0 on failure. */
  private parseTs(s: string | null | undefined): number {
    if (!s) return 0;
    const t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  // -------------------- Zone (Sigma / Silo / Packaging) -------------------
  private async loadZone(
    zone: ZoneType, apiKey: 'sigma' | 'silo' | 'packaging', force = false,
  ): Promise<UnifiedTagRow[]> {
    if (!force && this.rowsByZone.has(zone)) return this.rowsByZone.get(zone)!;
    const recent = await this.zonesSvc.fetchRecent(apiKey, ZONE_ROW_LIMIT);
    const rows = recent.map(r => this.zoneRowToUnified(zone, r));
    this.rowsByZone.set(zone, rows);
    return rows;
  }

  private zoneRowToUnified(zone: ZoneType, r: ZoneRecentRow): UnifiedTagRow {
    const shortTag = this.shortTag(r.Tag);
    const p = r.parsed;
    const base: UnifiedTagRow = {
      zone,
      id: `${zone}:${r.Tag}:${r.TS}`,
      tag: r.Tag,
      shortTag,
      machineId: r.MachineId,
      batchKey: `${zone}:${shortTag}`,
      status: 'OK',
      bucket: 'GOOD',
      passing: false,
      dataAvailable: false,
      latestValue: r.Value,
      ts: r.TS,
      tsUtc: this.parseTs(r.TimestampUtc) || this.parseTs(r.TS),
    };

    if (zone === 'SIGMA' && p.kind === 'SIGMA') {
      // RM becomes the subtype so the Sigma "Tag Type" filter mirrors PSM.
      base.subtype = p.RM || 'BATCH';
      base.recipe = p.R; base.rm = p.RM; base.batchId = String(p.B);
      base.sp = isFinite(p.SP) ? p.SP : undefined;
      base.pv = isFinite(p.PV) ? p.PV : undefined;
      base.dev = base.sp != null && base.sp > 0 && base.pv != null
        ? ((base.pv - base.sp) / base.sp) * 100
        : undefined;
      const mixer = this.parser.sigmaMixerOf(r.Tag);
      // Mirror PSM batchKey shape: SIGMA:<mixer>:<batchCounter>:<recipe>
      base.batchKey = `SIGMA:${mixer}:${p.B}:${p.R}`;
      base.status = this.sigmaStatusFromDev(p.S, base.dev);
      base.dataAvailable = base.sp != null && base.sp > 0;
    } else if (zone === 'SIGMA' && p.kind === 'SIGMA_BARCODE') {
      // Legacy Sigma barcodes route into the BARCODE virtual zone.
      base.zone = 'BARCODE';
      base.subtype = 'SIGMA';
      base.machineId = p.mixer;
      base.status = p.isIdle ? 'IDLE' : 'SCANNED';
      base.batchId = p.barcodeValue;
      base.batchKey = `BARCODE:SIGMA:${p.mixer}`;
      base.dataAvailable = !p.isIdle;
    } else if (zone === 'SIGMA' && p.kind === 'SIGMA_REWORK') {
      base.subtype = 'REWORK';
      base.status = p.reworkValue > 0 ? 'WARNING' : 'NORMAL';
      base.pv = p.reworkValue;
      base.batchKey = `SIGMA:${p.mixer}:REWORK`;
      base.dataAvailable = p.reworkValue > 0;
    } else if (zone === 'SIGMA' && p.kind === 'SIGMA_TELEMETRY') {
      base.subtype = p.tagType;
      base.latestValue = String(p.value);
      base.batchKey = `SIGMA:${p.mixer}:TELEMETRY`;
      base.status = 'OK';
      if (p.tagType === 'BATCHCOUNTER') {
        base.batchId = String(p.value);
      } else if (p.tagType === 'RECIPE_NAME') {
        base.recipe = String(p.value);
      }
      // Structural labels are not rule-checked — kept out of the health score.
      base.dataAvailable = false;
    } else if (zone === 'SILO' && p.kind === 'SILO') {
      base.subtype = p.tagType;
      if (p.tagType === 'noodle_type') {
        base.rm = p.noodleType;
        base.status = p.noodleType ? 'OK' : 'IDLE';
        base.batchKey = `SILO:${p.siloId}`;
        // A noodle label alone isn't telemetry we can rule-check.
        base.dataAvailable = false;
      } else if (p.tagType === 'bagout_detail') {
        base.batchKey = `SILO:${p.stationId}`;
        if (p.isIdle) {
          base.status = 'IDLE';
          base.dataAvailable = false;
        } else {
          base.batchId = p.batchId;
          // Silo bag-out carries acceptance limits, NOT SP/PV. Surface them
          // explicitly; leave sp/pv/dev untouched so the table doesn't show
          // a deviation column that has no measured value behind it.
          base.upperLimit = isFinite(p.upperLimit) ? p.upperLimit : undefined;
          base.lowerLimit = isFinite(p.lowerLimit) ? p.lowerLimit : undefined;
          base.rm = p.noodleType;
          base.latestValue = `UL=${this.fmtKg(p.upperLimit)} / LL=${this.fmtKg(p.lowerLimit)}`;
          base.status = this.bagoutStatusFromLimits(p.upperLimit, p.lowerLimit);
          base.dataAvailable = isFinite(p.upperLimit) && isFinite(p.lowerLimit);
        }
      } else if (p.tagType === 'barcode') {
        // Station barcodes now live in the BARCODE zone.
        base.zone = 'BARCODE';
        base.subtype = 'STATION';
        base.status = p.isIdle ? 'IDLE' : 'SCANNED';
        base.batchId = p.barcodeValue;
        base.machineId = p.stationId;
        base.batchKey = `BARCODE:STATION:${p.stationId}`;
        base.dataAvailable = !p.isIdle;
      } else if (p.tagType === 'warehouse_barcode') {
        base.zone = 'BARCODE';
        base.subtype = 'WAREHOUSE';
        base.status = 'ACTIVE';
        base.batchId = p.batchId; base.rm = p.noodleType; base.pv = p.weight;
        base.batchKey = `BARCODE:WAREHOUSE`;
        base.dataAvailable = isFinite(p.weight) && p.weight > 0;
      } else if (p.tagType === 'shreeji_barcode') {
        base.zone = 'BARCODE';
        base.subtype = 'SHREEJI';
        base.status = 'ACTIVE';
        base.batchId = p.barcodeId; base.pv = p.weight;
        base.batchKey = `BARCODE:SHREEJI`;
        base.dataAvailable = isFinite(p.weight) && p.weight > 0;
      }
    } else if (zone === 'PSM' && p.kind === 'PSM_TELEMETRY') {
      base.subtype = p.tagType;
      base.latestValue = String(p.value);
      base.batchKey = `PSM:TELEMETRY:${base.machineId}`;
      base.status = 'OK';
      if (p.tagType === 'Batch_PV_Weight') {
        base.pv = typeof p.value === 'number' && isFinite(p.value) ? p.value : undefined;
        base.dataAvailable = base.pv != null;
      } else if (p.tagType === 'Batch_SP_Weight') {
        base.sp = typeof p.value === 'number' && isFinite(p.value) ? p.value : undefined;
        base.dataAvailable = base.sp != null;
      } else if (p.tagType === 'Batch_Counter') {
        base.batchId = String(p.value);
        base.dataAvailable = false;
      } else if (p.tagType === 'Noodle_Name') {
        base.rm = String(p.value);
        base.dataAvailable = false;
      }
    } else if (zone === 'PACKAGING' && p.kind === 'PACKAGING') {
      base.subtype = p.wrapperName;
      base.pv = p.currentGrams; base.sp = p.targetGrams;
      base.dev = p.currentGrams - p.targetGrams;
      base.rm = p.wrapperName;
      base.batchKey = `PACKAGING:${p.cascade}`;
      base.status = this.pkgStatusFromDev(p.currentGrams, p.targetGrams);
      base.dataAvailable = isFinite(p.currentGrams) && p.currentGrams > 0;
    }

    base.bucket = STATUS_TO_BUCKET[base.status] ?? 'WARNING';
    // Health is only meaningful for rich rows: a 'noodle name' isn't graded.
    base.passing = base.dataAvailable && base.bucket === 'GOOD';
    return base;
  }

  private sigmaStatusFromDev(s: number | undefined, dev: number | undefined): HealthStatus {
    if (s === 2) return 'DOSING';
    if (s === 3) return this.classifyDev(dev);
    return 'IDLE';
  }

  private fmtKg(v: number): string {
    return isFinite(v) ? v.toFixed(2) : '—';
  }

  private bagoutStatusFromLimits(upper: number, lower: number): HealthStatus {
    if (!isFinite(upper) || !isFinite(lower)) return 'ACTIVE';
    if (upper <= 0 || lower <= 0) return 'CRITICAL';
    if (upper <= lower) return 'CRITICAL';
    const window = (upper - lower) / lower;
    if (window > 0.20) return 'WARNING';   // very loose acceptance window
    return 'IN-SPEC';
  }

  // Kept for backwards-compat with any caller that still expects the legacy signature.
  private bagoutStatusFromDev(dev: number | undefined): HealthStatus {
    if (dev == null) return 'ACTIVE';
    const a = Math.abs(dev);
    if (a <= 5) return 'OK';
    if (a <= 10) return 'WARNING';
    return 'CRITICAL';
  }

  private pkgStatusFromDev(grams: number, target: number): HealthStatus {
    if (grams <= 0) return 'OFFLINE';
    const a = Math.abs(grams - target);
    if (a <= 2) return 'IN-SPEC';
    if (a <= 3) return 'WARNING';
    return 'OUT-OF-SPEC';
  }

  private classifyDev(dev: number | undefined): HealthStatus {
    if (dev == null || isNaN(dev)) return 'OK';
    const a = Math.abs(dev);
    if (a < 5)  return 'OK';
    if (a < 10) return 'ALERT';
    if (a < 15) return 'WARNING';
    if (a < 25) return 'SEVERE';
    return 'CRITICAL';
  }

  private zoneApiKey(z: ZoneType): 'sigma' | 'silo' | 'packaging' {
    return z === 'SIGMA' ? 'sigma' : z === 'SILO' ? 'silo' : 'packaging';
  }

  private shortTag(t: string): string {
    const i = t.lastIndexOf('.');
    return i >= 0 ? t.substring(i + 1) : t;
  }
}
