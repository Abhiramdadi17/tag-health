import { Injectable, computed, signal } from '@angular/core';
import { Severity, ValidationResult, ZoneType } from '../types/tags';

/** One entry in the chronological alert log. */
export interface AlertEntry {
  ruleId: string;
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

/**
 * AlertLogService — central sink for every rule failure produced by
 * TagValidationService during aggregator ingest. Components read the
 * chronological log through `entries` and the per-severity totals through
 * `counts`.
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

  /** Append failed rule results. Successful results are ignored. */
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
        ruleId: r.ruleId,
        severity: r.severity,
        message: r.message,
        tagName: ctx.tagName,
        zone: ctx.zone,
        machineId: ctx.machineId,
        batchId: ctx.batchId,
        recipe: ctx.recipe,
        ts: tsFallback,
      });
    }
    if (additions.length === 0) return;

    // Newest-first; trim to cap.
    const next = additions.concat(this._entries());
    if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
    this._entries.set(next);
  }

  clear(): void {
    this._entries.set([]);
  }
}
