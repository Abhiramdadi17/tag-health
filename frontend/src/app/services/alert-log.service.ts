import { Injectable, computed, signal } from '@angular/core';
import { Severity, UnifiedTagRow, ValidationResult, ZoneType } from '../types/tags';

/** One entry in the chronological alert log. */
export interface AlertEntry {
  ruleId: string;
  /** Human-readable rule name shown next to the ID in the drawer. */
  ruleTitle: string;
  severity: Severity;
  message: string;
  /** Tag identifier (e.g. 'PSM_01_Salt_Batch' or shortTag form). */
  tagName: string;
  zone: ZoneType;
  machineId: string;
  /** Best-available batch id, when the row carries one. */
  batchId?: string;
  /** Best-available recipe code. */
  recipe?: string;
  /** Unix ms; falls back to ingest time when the row's timestamp is unparseable. */
  ts: number;
}

const MAX_ENTRIES = 5_000;

/** Short, human-readable titles for every rule ID the engine emits. */
const RULE_TITLES: Record<string, string> = {
  'GEN-01': 'Streaming silence > 5 min',
  'GEN-02': 'Null or empty value',
  'GEN-03': 'Timestamps non-monotonic',
  'GEN-04': 'Source metadata mismatch',
  // PSM
  'PSM-01': 'Schema completeness',
  'PSM-02': 'PV non-zero when dosing',
  'PSM-03': 'PV non-negative',
  'PSM-04': 'No PV drop within batch',
  'PSM-05': 'Completion deviation ≤ 5%',
  'PSM-06': 'Valid status code',
  'PSM-07': 'Batch counter sequential',
  'PSM-08': 'Recipe consistency across RMs',
  'PSM-09': 'Streaming gap',
  'PSM-10': 'SP-change event',
  'PSM-11': 'Date plausibility',
  'PSM-12': 'Mass conservation',
  // Sigma — mirrors PSM 01..12 + sigma-specific
  'SMX-01': 'Schema completeness',
  'SMX-02': 'PV non-zero when dosing',
  'SMX-03': 'PV non-negative',
  'SMX-04': 'No PV drop within batch',
  'SMX-05': 'Completion deviation ≤ 5%',
  'SMX-06': 'Valid status code',
  'SMX-07': 'Batch counter sequential',
  'SMX-08': 'Recipe consistency across RMs',
  'SMX-09': 'Streaming gap',
  'SMX-10': 'SP-change event',
  'SMX-11': 'Date plausibility',
  'SMX-12': 'Mass conservation',
  'SMX-13': 'Rework stuck > 3 polls',
  'SMX-14': 'Rework value plausibility',
  'SMX-15': 'Rework rate > 5/hr',
  'SMX-16': 'Mixers parallel-dosing',
  'SMX-17': 'Recipe mid-batch change',
  'SMX-18': 'Sigma barcode (legacy)',
  // Silo
  'SLO-01': 'Noodle type valid',
  'SLO-02': 'Bag-out CSV format',
  'SLO-03': 'Lower limit > 0',
  'SLO-04': 'Limit window sane',
  'SLO-05': 'Day/Buffer silo agree',
  'SLO-08': 'Silo streaming gap',
  'SLO-09': 'No lone unique noodle',
  // Barcode
  'BCD-01': 'Station barcode format',
  'BCD-02': 'Warehouse barcode valid',
  'BCD-03': 'Shreeji barcode valid',
  'BCD-04': 'Sigma barcode (legacy)',
  'BCD-05': 'Barcode streaming gap',
  // Packaging
  'PKG-01': 'Grams > 0',
  'PKG-02': '|grams − target| ≤ 3g',
  'PKG-03': 'No sudden jump > 5g',
  'PKG-04': 'Peer cascade consistency',
  'PKG-05': 'MachineId mapping',
  'PKG-06': 'Value not frozen',
  'PKG-07': 'Wrapper streaming gap',
  // Synthetic row-status alerts (see recordRowStatus below)
  'STATUS-CRITICAL': 'Row in CRITICAL status',
  'STATUS-WARNING':  'Row in WARNING status',
};

export function ruleTitleFor(ruleId: string): string {
  return RULE_TITLES[ruleId] ?? ruleId;
}

/**
 * AlertLogService — central sink for every rule failure produced by
 * TagValidationService during aggregator ingest, plus synthetic entries
 * for any row that arrived in the CRITICAL or WARNING bucket regardless
 * of whether a rule explicitly fired against it. The latter is what
 * surfaces "this tag is bad and here is exactly why" for rows whose
 * status was derived (sigmaStatusFromDev, pkgStatusFromDev, etc.) rather
 * than rule-checked.
 *
 * The log is capped at MAX_ENTRIES (newest wins) to keep the dashboard
 * responsive on long runs.
 */
@Injectable({ providedIn: 'root' })
export class AlertLogService {
  private readonly _entries = signal<AlertEntry[]>([]);

  readonly entries = this._entries.asReadonly();

  readonly counts = computed(() => {
    const acc = { critical: 0, warning: 0, info: 0, total: 0 };
    for (const e of this._entries()) {
      acc.total += 1;
      if (e.severity === 'CRITICAL') acc.critical += 1;
      else if (e.severity === 'WARNING') acc.warning += 1;
      else if (e.severity === 'INFO') acc.info += 1;
    }
    return acc;
  });

  /** Index alerts by tagName for the per-tag grouped view. */
  readonly byTag = computed(() => {
    const grouped = new Map<string, AlertEntry[]>();
    for (const e of this._entries()) {
      const arr = grouped.get(e.tagName);
      if (arr) arr.push(e);
      else grouped.set(e.tagName, [e]);
    }
    return grouped;
  });

  /** Append failed rule results from a TagValidationService run. */
  record(ctx: {
    tagName: string;
    zone: ZoneType;
    machineId: string;
    batchId?: string;
    recipe?: string;
    tsUtc: number;
    results: ValidationResult[];
  }): void {
    const tsFallback = ctx.tsUtc || Date.now();
    const additions: AlertEntry[] = [];
    for (const r of ctx.results) {
      if (r.passed) continue;
      additions.push({
        ruleId:    r.ruleId,
        ruleTitle: ruleTitleFor(r.ruleId),
        severity:  r.severity,
        message:   r.message,
        tagName:   ctx.tagName,
        zone:      ctx.zone,
        machineId: ctx.machineId,
        batchId:   ctx.batchId,
        recipe:    ctx.recipe,
        ts:        tsFallback,
      });
    }
    this.append(additions);
  }

  /** Emit a synthetic alert for any row that resolved to bucket=CRITICAL
   *  or bucket=WARNING. The reason string explains exactly what about the
   *  row drove the status. */
  recordRowStatus(row: UnifiedTagRow): void {
    let sev: Severity;
    if (row.bucket === 'CRITICAL') sev = 'CRITICAL';
    else if (row.bucket === 'WARNING') sev = 'WARNING';
    else return;

    const message = this.explainRowStatus(row);
    this.append([{
      ruleId:    `STATUS-${row.bucket}`,
      ruleTitle: ruleTitleFor(`STATUS-${row.bucket}`),
      severity:  sev,
      message,
      tagName:   row.shortTag || row.tag,
      zone:      row.zone,
      machineId: row.machineId,
      batchId:   row.batchId,
      recipe:    row.recipe,
      ts:        row.tsUtc || Date.now(),
    }]);
  }

  /** Build a one-line reason describing why the row is in its current bucket. */
  private explainRowStatus(r: UnifiedTagRow): string {
    const sp = r.sp != null && !isNaN(r.sp) ? r.sp.toFixed(2) : null;
    const pv = r.pv != null && !isNaN(r.pv) ? r.pv.toFixed(2) : null;
    const dev = r.dev != null && !isNaN(r.dev)
      ? `${r.dev > 0 ? '+' : ''}${r.dev.toFixed(2)}%`
      : null;

    const subtype = r.subtype ? ` · ${r.subtype}` : '';

    if (r.zone === 'PSM' || r.zone === 'SIGMA') {
      if (sp && pv && dev) {
        return `${r.status}${subtype}: PV ${pv} vs SP ${sp} — deviation ${dev}`;
      }
      if (pv) return `${r.status}${subtype}: PV ${pv}`;
      return `${r.status}${subtype}`;
    }
    if (r.zone === 'SILO') {
      if (r.upperLimit != null && r.lowerLimit != null) {
        return `${r.status}${subtype}: bag-out UL ${r.upperLimit.toFixed(2)} / LL ${r.lowerLimit.toFixed(2)} kg`;
      }
      if (r.rm) return `${r.status}${subtype}: noodle ${r.rm}`;
      return `${r.status}${subtype}`;
    }
    if (r.zone === 'PACKAGING') {
      if (pv && sp) {
        const diff = (r.pv! - r.sp!).toFixed(0);
        const sign = (r.pv! - r.sp!) >= 0 ? '+' : '';
        return `${r.status}${subtype}: ${pv} g vs target ${sp} g (${sign}${diff} g)`;
      }
      return `${r.status}${subtype}`;
    }
    if (r.zone === 'BARCODE') {
      return `${r.status}${subtype}${r.batchId ? ' · value ' + r.batchId : ''}`;
    }
    return `${r.status}${subtype}`;
  }

  clear(): void {
    this._entries.set([]);
  }

  private append(entries: AlertEntry[]): void {
    if (entries.length === 0) return;
    const next = entries.concat(this._entries());
    if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
    this._entries.set(next);
  }
}
