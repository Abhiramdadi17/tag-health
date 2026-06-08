import { Injectable, inject } from '@angular/core';
import { TagParserService } from './tag-parser.service';
import {
  RawTagRow,
  ParsedTagValue,
  PsmParsed,
  SigmaParsed,
  PackagingParsed,
  ValidationResult,
  ValidationAlert,
  TagState,
  Severity,
  VALID_NOODLE_TYPES,
  WRAPPER_TARGETS,
  WRAPPER_MACHINE_MAP,
  DEFAULT_WRAPPER_MACHINE_ID,
  PRODUCTION_HOURS,
  GAP_COMMS_DROP_S,
  GAP_OVERNIGHT_S,
} from '../types/tags';

const ok = (ruleId: string, severity: Severity, message = 'OK'): ValidationResult =>
  ({ ruleId, severity, passed: true, message });
const fail = (ruleId: string, severity: Severity, message: string): ValidationResult =>
  ({ ruleId, severity, passed: false, message });

@Injectable({ providedIn: 'root' })
export class TagValidationService {
  private parser = inject(TagParserService);
  private tagState = new Map<string, TagState>();
  private activeAlerts = new Map<string, ValidationAlert[]>();

  validateTag(row: RawTagRow, parsed: ParsedTagValue, context: any = {}): ValidationResult[] {
    const ts = this.parser.parseTimestamp(row.TS);
    const state = this.getState(row.Tag);
    const results: ValidationResult[] = [];
    results.push(this.gen04_sourceMetadata(row));
    results.push(this.gen02_nullEmptyValue(row.Value, parsed));
    results.push(this.gen03_timestampMonotonic(ts, state.lastTS));
    results.push(this.gen01_tagSilence(ts, state.lastTS));
    switch (parsed.kind) {
      case 'PSM':
        results.push(...this.runPsmRules(row, parsed, state, ts, context));
        break;
      case 'SIGMA': {
        // The 12 PSM rules also apply to Sigma rows — relabel PSM-XX → SMX-XX
        // so they surface under the Sigma filter and ruleId space.
        const mirrored = this.runPsmRules(row, parsed as unknown as PsmParsed, state, ts, context);
        for (const r of mirrored) {
          r.ruleId = r.ruleId.replace(/^PSM-/, 'SMX-');
        }
        results.push(...mirrored);
        results.push(...this.runSigmaExtra(parsed, state, context));
        break;
      }
      case 'SIGMA_BARCODE':
        // Legacy Sigma barcode rows now flow through the BARCODE zone.
        results.push(...this.runBarcodeRules(row, parsed, ts, state));
        break;
      case 'SIGMA_REWORK': {
        const consec = parsed.reworkValue > 0 ? state.consecutiveNonZeroReworkCount + 1 : 0;
        state.consecutiveNonZeroReworkCount = consec;
        // Maintain rolling 60-min window of non-zero rework events for SMX-15.
        const now = ts ?? new Date();
        const events = (state.reworkEvents ?? []).filter(
          d => now.getTime() - d.getTime() < 3_600_000,
        );
        if (parsed.reworkValue > 0) events.push(now);
        state.reworkEvents = events;

        results.push(this.smx13_reworkStuck(parsed.reworkValue, consec));
        results.push(this.smx14_reworkValuePlausibility(parsed.reworkValue));
        results.push(this.smx15_reworkRateLimit(events.length));
        break;
      }
      case 'SIGMA_TELEMETRY':
        // Structural mixer-state labels — only general rules apply.
        break;
      case 'SILO':
        results.push(...this.runSiloRules(row, parsed, ts, state, context));
        break;
      case 'PACKAGING':
        results.push(...this.runPackagingRules(row, parsed, state, ts, context));
        break;
    }
    this.commitState(row, parsed, ts, state);
    this.recordAlerts(row, ts, results);
    return results;
  }

  getActiveAlerts(tagName?: string): ValidationAlert[] {
    if (tagName) return this.activeAlerts.get(tagName) ?? [];
    return Array.from(this.activeAlerts.values()).flat();
  }
  clearAlerts(tagName: string): void { this.activeAlerts.delete(tagName); }

  private runPsmRules(row: RawTagRow, p: PsmParsed, state: TagState, ts: Date | null, ctx: any): ValidationResult[] {
    return [
      this.psm01_schemaValid(String(row.Value)),
      this.psm02_pvNotZeroWhenDosing(p),
      this.psm03_pvNotNegative(p),
      this.psm04_noSuddenPvDrop(p, state.previousPV, state.previousB),
      this.psm05_pvSpDeviation(p),
      this.psm06_validStatusCode(p),
      this.psm07_batchCounterSequential(p, state.previousB),
      this.psm08_recipeConsistency(p, ctx.allCurrentRMs ?? []),
      this.psm09_streamingGap(ts, state.lastTS),
      this.psm10_spChangeDetection(p, state.previousSP),
      this.psm11_dateFieldPlausibility(p, new Date()),
      ...(ctx.batchPvWeight != null && ctx.rmPvSum != null ? [this.psm12_batchWeightVsRmSum(ctx.batchPvWeight, ctx.rmPvSum)] : []),
    ];
  }

  psm01_schemaValid(raw: string): ValidationResult {
    const keys = ['D', 'S', 'B', 'R', 'RM', 'SP', 'PV'];
    const map = this.kv(raw);
    const missing = keys.filter(k => !(k in map) || map[k] === '');
    return missing.length === 0 ? ok('PSM-01', 'CRITICAL') : fail('PSM-01', 'CRITICAL', `Schema incomplete: ${missing.join(', ')}`);
  }
  psm02_pvNotZeroWhenDosing(p: PsmParsed): ValidationResult {
    if (p.S === 2 && (isNaN(p.PV) || p.PV < 0.001)) return fail('PSM-02', 'CRITICAL', `PV0 while dosing. PV=${p.PV}`);
    return ok('PSM-02', 'CRITICAL');
  }
  psm03_pvNotNegative(p: PsmParsed): ValidationResult {
    return p.PV < 0 ? fail('PSM-03', 'CRITICAL', `PV is negative (${p.PV})`) : ok('PSM-03', 'CRITICAL');
  }
  psm04_noSuddenPvDrop(p: PsmParsed, previousPV: number | null, previousB: number | null): ValidationResult {
    if (previousPV != null && previousB != null && previousB === p.B && previousPV - p.PV > 0.5)
      return fail('PSM-04', 'WARNING', `PV dropped within batch ${p.B} (${previousPV}->${p.PV})`);
    return ok('PSM-04', 'WARNING');
  }
  psm05_pvSpDeviation(p: PsmParsed): ValidationResult {
    if (p.S === 3 && p.SP > 0) {
      const dev = Math.abs(p.PV - p.SP) / p.SP;
      if (dev > 0.05) return fail('PSM-05', 'WARNING', `Completion deviation ${(dev * 100).toFixed(1)}% > 5% (SP=${p.SP}, PV=${p.PV})`);
    }
    return ok('PSM-05', 'WARNING');
  }
  psm06_validStatusCode(p: PsmParsed): ValidationResult {
    return [1, 2, 3].includes(p.S) ? ok('PSM-06', 'WARNING') : fail('PSM-06', 'WARNING', `Invalid status code S=${p.S}`);
  }
  psm07_batchCounterSequential(p: PsmParsed, previousB: number | null): ValidationResult {
    if (previousB == null) return ok('PSM-07', 'WARNING');
    if ((previousB === 39 && p.B === 0) || p.B === previousB || p.B === previousB + 1) return ok('PSM-07', 'WARNING');
    return fail('PSM-07', 'WARNING', `Non-sequential batch jump ${previousB}->${p.B}`);
  }
  psm08_recipeConsistency(current: PsmParsed, allCurrentRMs: PsmParsed[]): ValidationResult {
    const mismatch = allCurrentRMs.filter(x => x !== current).find(o => o.D !== current.D || o.R !== current.R);
    return mismatch ? fail('PSM-08', 'WARNING', `Recipe/date mismatch across RMs`) : ok('PSM-08', 'WARNING');
  }
  psm09_streamingGap(currentTS: Date | null, previousTS: Date | null): ValidationResult {
    const gap = this.gapSeconds(currentTS, previousTS);
    if (gap == null) return ok('PSM-09', 'INFO');
    if (gap > GAP_OVERNIGHT_S) return ok('PSM-09', 'INFO', `Overnight gap`);
    if (gap > GAP_COMMS_DROP_S && this.inProductionHours(currentTS)) return fail('PSM-09', 'INFO', `Comms gap ${this.hms(gap)}`);
    return ok('PSM-09', 'INFO');
  }
  psm10_spChangeDetection(p: PsmParsed, previousSP: number | null): ValidationResult {
    if (previousSP != null && !isNaN(p.SP) && Math.abs(p.SP - previousSP) > 1e-6) return ok('PSM-10', 'INFO', `SP adjusted ${previousSP}->${p.SP}`);
    return ok('PSM-10', 'INFO');
  }
  psm11_dateFieldPlausibility(p: PsmParsed, now: Date): ValidationResult {
    const d = this.parser.julianDateToDate(p.D);
    if (!d) return fail('PSM-11', 'INFO', `Unparseable D field '${p.D}'`);
    const days = Math.abs((now.getTime() - d.getTime()) / 86400000);
    if (days > 2) return fail('PSM-11', 'INFO', `D field stale by ${days.toFixed(1)}d`);
    return ok('PSM-11', 'INFO');
  }
  psm12_batchWeightVsRmSum(batchPvWeight: number, rmPvSum: number): ValidationResult {
    if (rmPvSum <= 0) return ok('PSM-12', 'INFO');
    const dev = Math.abs(batchPvWeight - rmPvSum) / rmPvSum;
    return dev > 0.02 ? fail('PSM-12', 'INFO', `Batch weight vs RM-sum deviation ${(dev * 100).toFixed(1)}%`) : ok('PSM-12', 'INFO');
  }

  // --- Sigma-specific rules (after the SMX-01..SMX-12 mirror block) ---------
  // Numbering convention:
  //   SMX-01..SMX-12  mirror PSM-01..PSM-12 (applied via prefix relabel)
  //   SMX-13..SMX-15  rework rules
  //   SMX-16..SMX-17  orchestration rules (parallel dosing, recipe mid-batch)
  //   SMX-18          legacy barcode rule (fires only when a SIGMA_BARCODE row exists)

  private runSigmaExtra(p: SigmaParsed, state: TagState, ctx: any): ValidationResult[] {
    const res: ValidationResult[] = [this.smx17_recipeConsistency(p, state.previousR, state.previousB)];
    if (ctx.mx1 && ctx.mx2) res.push(this.smx16_simultaneousSameBatch(ctx.mx1, ctx.mx2));
    return res;
  }

  smx13_reworkStuck(reworkValue: number, consecutiveNonZeroCount: number): ValidationResult {
    if (reworkValue > 0 && consecutiveNonZeroCount > 3) {
      return fail('SMX-13', 'WARNING',
        `Rework stuck active for ${consecutiveNonZeroCount} polls (value=${reworkValue})`);
    }
    return ok('SMX-13', 'WARNING');
  }
  smx14_reworkValuePlausibility(reworkValue: number): ValidationResult {
    if (isNaN(reworkValue) || reworkValue === 0 || reworkValue === 30) {
      return ok('SMX-14', 'WARNING');
    }
    return fail('SMX-14', 'WARNING',
      `Unrecognised rework code ${reworkValue} (expected 0 or 30)`);
  }
  smx15_reworkRateLimit(eventsLastHour: number): ValidationResult {
    if (eventsLastHour > 5) {
      return fail('SMX-15', 'WARNING',
        `${eventsLastHour} rework events in last 60 min — chronic rework`);
    }
    return ok('SMX-15', 'WARNING');
  }
  smx16_simultaneousSameBatch(mx1: SigmaParsed, mx2: SigmaParsed): ValidationResult {
    if (mx1.S === 2 && mx2.S === 2 && mx1.B === mx2.B) {
      return fail('SMX-16', 'WARNING', `MX1 & MX2 both dosing same batch ${mx1.B}`);
    }
    return ok('SMX-16', 'WARNING');
  }
  smx17_recipeConsistency(p: SigmaParsed, previousR: string | null, previousB: number | null): ValidationResult {
    if (previousR != null && previousB != null && previousB === p.B && previousR !== p.R) return fail('SMX-17', 'INFO', `Recipe changed mid-batch ${p.B}`);
    return ok('SMX-17', 'INFO');
  }

  smx18_barcodeState(barcodeValue: string): ValidationResult {
    const v = (barcodeValue ?? '').trim();
    if (v === '') return fail('SMX-18', 'CRITICAL', 'Empty/null barcode');
    if (v.toLowerCase() === 'scan barcode') return ok('SMX-18', 'CRITICAL', 'Idle (Scan Barcode)');
    if (/^\d+$/.test(v)) return ok('SMX-18', 'CRITICAL', `Valid scan #${v}`);
    return fail('SMX-18', 'CRITICAL', `Malformed barcode scan '${v}'`);
  }

  private runSiloRules(row: RawTagRow, p: any, ts: Date | null, state: TagState, ctx: any): ValidationResult[] {
    const res: ValidationResult[] = [];
    switch (p.tagType) {
      case 'noodle_type':
        res.push(this.slo01_noodleTypeValid(p.noodleType));
        if (ctx.bufferSiloType != null && ctx.siloIndex != null) res.push(this.slo05_siloCrossConsistency(p.noodleType, ctx.bufferSiloType, ctx.siloIndex));
        break;
      case 'bagout_detail':
        res.push(this.slo02_bagOutDetailsFormat(String(row.Value)));
        if (!p.isIdle) {
          res.push(this.slo03_lowerLimitPositive(p.lowerLimit));
          res.push(this.slo04_limitWindowSane(p.upperLimit, p.lowerLimit));
        }
        break;
      // Barcode sub-types are now routed through the BARCODE virtual zone.
      // Their BCD-* rules are dispatched in runBarcodeRules() below.
      case 'barcode':
      case 'warehouse_barcode':
      case 'shreeji_barcode':
        res.push(...this.runBarcodeRules(row, p, ts, state));
        break;
    }
    res.push(this.slo08_streamingGap(ts, state.lastTS, row.Tag));
    if (ctx.allSiloTypes) res.push(...this.slo09_recipeAlignment(ctx.allSiloTypes));
    return res;
  }
  slo01_noodleTypeValid(noodleType: string): ValidationResult {
    const v = (noodleType ?? '').trim();
    if (v === '') return fail('SLO-01', 'CRITICAL', 'Empty noodle type');
    return VALID_NOODLE_TYPES.includes(v) ? ok('SLO-01', 'CRITICAL') : fail('SLO-01', 'CRITICAL', `Unknown noodle type '${v}'`);
  }
  slo02_bagOutDetailsFormat(raw: string): ValidationResult {
    const v = (raw ?? '').trim();
    if (v === ',') return ok('SLO-02', 'CRITICAL', 'Idle (no bag)');
    if (v === '' || v == null) return fail('SLO-02', 'CRITICAL', 'Null/missing bag-out detail');
    const parts = v.split(',');
    if (parts.length !== 4) return fail('SLO-02', 'CRITICAL', `Expected 4 CSV fields, got ${parts.length}`);
    return ok('SLO-02', 'CRITICAL');
  }
  slo03_lowerLimitPositive(lowerLimit: number): ValidationResult {
    if (isNaN(lowerLimit)) return ok('SLO-03', 'CRITICAL');
    return lowerLimit > 0
      ? ok('SLO-03', 'CRITICAL')
      : fail('SLO-03', 'CRITICAL', `Bag-out lower limit not positive (${lowerLimit})`);
  }
  slo04_limitWindowSane(upperLimit: number, lowerLimit: number): ValidationResult {
    if (isNaN(upperLimit) || isNaN(lowerLimit)) return ok('SLO-04', 'WARNING');
    if (upperLimit <= lowerLimit) {
      return fail('SLO-04', 'WARNING',
        `Bag-out limits inverted: upper=${upperLimit}, lower=${lowerLimit}`);
    }
    if (lowerLimit <= 0) return ok('SLO-04', 'WARNING');
    const window = (upperLimit - lowerLimit) / lowerLimit;
    if (window > 0.20) {
      return fail('SLO-04', 'WARNING',
        `Acceptance window too loose: UL=${upperLimit}, LL=${lowerLimit} (${(window * 100).toFixed(1)}% wide)`);
    }
    return ok('SLO-04', 'WARNING');
  }
  slo05_siloCrossConsistency(daySiloType: string, bufferSiloType: string, siloIndex: number): ValidationResult {
    if (!daySiloType || !bufferSiloType) return ok('SLO-05', 'WARNING');
    return daySiloType.trim() === bufferSiloType.trim() ? ok('SLO-05', 'WARNING') : fail('SLO-05', 'WARNING', `Day/Buffer silo ${siloIndex} mismatch (Day='${daySiloType}', Buffer='${bufferSiloType}')`);
  }
  slo08_streamingGap(currentTS: Date | null, previousTS: Date | null, _tagName: string): ValidationResult {
    const gap = this.gapSeconds(currentTS, previousTS);
    if (gap == null) return ok('SLO-08', 'INFO');
    if (gap > GAP_COMMS_DROP_S && this.inProductionHours(currentTS)) {
      return fail('SLO-08', 'INFO', `Silo comms gap ${this.hms(gap)}`);
    }
    return ok('SLO-08', 'INFO');
  }

  // ------------------------------------------------------------------------
  // BARCODE zone rules — station / warehouse / Shreeji / legacy Sigma.
  // ------------------------------------------------------------------------
  private runBarcodeRules(row: RawTagRow, p: any, ts: Date | null, state: TagState): ValidationResult[] {
    const res: ValidationResult[] = [];
    if (p.kind === 'SILO' && p.tagType === 'barcode') {
      res.push(this.bcd01_stationBarcodeFormat(p.barcodeValue));
    } else if (p.kind === 'SILO' && p.tagType === 'warehouse_barcode') {
      res.push(this.bcd02_warehouseBarcodeValid(String(row.Value)));
    } else if (p.kind === 'SILO' && p.tagType === 'shreeji_barcode') {
      res.push(this.bcd03_shreejiBarcodeValid(p.barcodeId, p.mode, p.weight));
    } else if (p.kind === 'SIGMA_BARCODE') {
      res.push(this.bcd04_sigmaBarcodeFormat(p.barcodeValue));
    }
    res.push(this.bcd05_barcodeStreamingGap(ts, state.lastTS));
    return res;
  }
  bcd01_stationBarcodeFormat(barcodeValue: string): ValidationResult {
    const v = (barcodeValue ?? '').trim();
    if (v === '') return fail('BCD-01', 'WARNING', 'Empty station barcode');
    if (/^\d{6,}$/.test(v)) return ok('BCD-01', 'WARNING');
    return ok('BCD-01', 'INFO', `Scanner idle / short value '${v}'`);
  }
  bcd02_warehouseBarcodeValid(raw: string): ValidationResult {
    const parts = (raw ?? '').split(',');
    if (parts.length !== 4) {
      return fail('BCD-02', 'WARNING', `Warehouse barcode needs 4 fields, got ${parts.length}`);
    }
    const weight = parseFloat(parts[1]);
    const count = parseInt(parts[3], 10);
    const noodle = (parts[2] ?? '').trim();
    const problems: string[] = [];
    if (!(weight > 0)) problems.push(`weight=${parts[1]}`);
    if (!(count >= 1 && count <= 6)) problems.push(`count=${parts[3]}`);
    if (!VALID_NOODLE_TYPES.includes(noodle)) problems.push(`noodle='${noodle}'`);
    return problems.length
      ? fail('BCD-02', 'WARNING', `Invalid warehouse barcode: ${problems.join(', ')}`)
      : ok('BCD-02', 'WARNING');
  }
  bcd03_shreejiBarcodeValid(barcodeId: string, mode: string, weight: number): ValidationResult {
    const problems: string[] = [];
    if (!barcodeId || barcodeId.trim() === '') problems.push('id missing');
    if ((mode ?? '').trim().toUpperCase() !== 'PV') problems.push(`mode='${mode}' (expected 'PV')`);
    if (!isFinite(weight) || weight <= 0) problems.push(`weight=${weight}`);
    return problems.length
      ? fail('BCD-03', 'WARNING', `Invalid Shreeji barcode: ${problems.join(', ')}`)
      : ok('BCD-03', 'WARNING');
  }
  bcd04_sigmaBarcodeFormat(barcodeValue: string): ValidationResult {
    const v = (barcodeValue ?? '').trim();
    if (v === '') return fail('BCD-04', 'CRITICAL', 'Empty/null Sigma barcode');
    if (v.toLowerCase() === 'scan barcode') return ok('BCD-04', 'CRITICAL', 'Idle (Scan Barcode)');
    if (/^\d+$/.test(v)) return ok('BCD-04', 'CRITICAL', `Valid scan #${v}`);
    return fail('BCD-04', 'CRITICAL', `Malformed Sigma barcode '${v}'`);
  }
  bcd05_barcodeStreamingGap(currentTS: Date | null, previousTS: Date | null): ValidationResult {
    const gap = this.gapSeconds(currentTS, previousTS);
    if (gap == null) return ok('BCD-05', 'INFO');
    // Shreeji is sparse by design — flag only at the very long end (15 min).
    if (gap > 900 && this.inProductionHours(currentTS)) {
      return fail('BCD-05', 'INFO', `Barcode comms gap ${this.hms(gap)}`);
    }
    return ok('BCD-05', 'INFO');
  }
  slo09_recipeAlignment(allSiloTypes: Map<string, string>): ValidationResult[] {
    const present = Array.from(allSiloTypes.values()).filter(t => !!t);
    if (present.length < 6) return [ok('SLO-09', 'INFO')];
    const counts = new Map<string, number>();
    for (const t of present) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (counts.size <= 1) return [ok('SLO-09', 'INFO')];
    const out: ValidationResult[] = [];
    for (const [silo, type] of allSiloTypes) if (type && counts.get(type) === 1) out.push(fail('SLO-09', 'INFO', `${silo} shows unique noodle type '${type}' — review`));
    return out.length ? out : [ok('SLO-09', 'INFO')];
  }

  private runPackagingRules(row: RawTagRow, p: PackagingParsed, state: TagState, ts: Date | null, ctx: any): ValidationResult[] {
    const identical = state.lastValue === p.currentGrams ? state.consecutiveIdenticalCount + 1 : 1;
    state.consecutiveIdenticalCount = identical;
    return [
      this.pkg01_valuePositive(p.currentGrams),
      this.pkg02_withinWrapperLimit(p.wrapperName, p.currentGrams),
      this.pkg03_noSuddenJump(p.currentGrams, state.previousPV),
      ...(ctx.cascadeSnapshot ? [this.pkg04_groupConsistency(p.wrapperName, p.currentGrams, ctx.cascadeSnapshot)] : []),
      this.pkg05_machineIdMapping(p.wrapperName, row.MachineId),
      this.pkg06_frozenValue(p.currentGrams, identical),
      this.pkg07_streamingGap(ts, state.lastTS),
    ];
  }
  pkg01_valuePositive(grams: number): ValidationResult {
    return grams > 0 ? ok('PKG-01', 'CRITICAL') : fail('PKG-01', 'CRITICAL', `Grams not positive (${grams})`);
  }
  pkg02_withinWrapperLimit(wrapperName: string, grams: number): ValidationResult {
    const target = WRAPPER_TARGETS[wrapperName]?.target;
    if (target == null) return fail('PKG-02', 'CRITICAL', `Unknown wrapper '${wrapperName}'`);
    const diff = Math.abs(grams - target);
    return diff > 3 ? fail('PKG-02', 'CRITICAL', `${wrapperName} ${grams}g off target ${target}g by ${diff.toFixed(0)}g`) : ok('PKG-02', 'CRITICAL');
  }
  pkg03_noSuddenJump(grams: number, previousGrams: number | null): ValidationResult {
    if (previousGrams != null && Math.abs(grams - previousGrams) > 5) return fail('PKG-03', 'WARNING', `Sudden ${Math.abs(grams - previousGrams).toFixed(0)}g jump (${previousGrams}->${grams})`);
    return ok('PKG-03', 'WARNING');
  }
  pkg04_groupConsistency(wrapperName: string, grams: number, cascadeSnapshot: Map<string, number>): ValidationResult {
    const myTarget = WRAPPER_TARGETS[wrapperName]?.target;
    if (myTarget == null) return ok('PKG-04', 'WARNING');
    let outlier = false;
    for (const [w, g] of cascadeSnapshot) {
      if (w === wrapperName) continue;
      if (WRAPPER_TARGETS[w]?.target !== myTarget) continue;
      if (Math.abs(grams - g) > 3) { outlier = true; break; }
    }
    return outlier ? fail('PKG-04', 'WARNING', `${wrapperName} (${grams}g) deviates >3g from same-target peers`) : ok('PKG-04', 'WARNING');
  }
  pkg05_machineIdMapping(wrapperName: string, actualMachineId: string): ValidationResult {
    const expected = WRAPPER_MACHINE_MAP[wrapperName] ?? DEFAULT_WRAPPER_MACHINE_ID;
    return actualMachineId === expected ? ok('PKG-05', 'WARNING') : fail('PKG-05', 'WARNING', `${wrapperName} from MachineId ${actualMachineId}, expected ${expected}`);
  }
  pkg06_frozenValue(grams: number, consecutiveIdenticalCount: number): ValidationResult {
    return consecutiveIdenticalCount > 5 ? fail('PKG-06', 'WARNING', `Value frozen at ${grams}g for ${consecutiveIdenticalCount} polls`) : ok('PKG-06', 'WARNING');
  }
  pkg07_streamingGap(currentTS: Date | null, previousTS: Date | null): ValidationResult {
    const gap = this.gapSeconds(currentTS, previousTS);
    if (gap == null) return ok('PKG-07', 'INFO');
    return gap > 360 ? fail('PKG-07', 'INFO', `Wrapper gap ${this.hms(gap)} > 6min`) : ok('PKG-07', 'INFO');
  }

  gen01_tagSilence(currentTS: Date | null, previousTS: Date | null): ValidationResult {
    const gap = this.gapSeconds(currentTS, previousTS);
    if (gap == null) return ok('GEN-01', 'WARNING');
    if (gap >= GAP_OVERNIGHT_S) return ok('GEN-01', 'INFO', `Overnight gap`);
    if (gap > GAP_COMMS_DROP_S && this.inProductionHours(currentTS)) return fail('GEN-01', 'WARNING', `Streaming stopped ${this.hms(gap)}`);
    return ok('GEN-01', 'WARNING');
  }
  gen02_nullEmptyValue(value: string | number | null | undefined, parsed: ParsedTagValue): ValidationResult {
    if (parsed.kind === 'SILO' && parsed.tagType === 'bagout_detail' && parsed.isIdle) return ok('GEN-02', 'WARNING', 'Idle bag-out (valid)');
    if (value == null || String(value).trim() === '') return fail('GEN-02', 'WARNING', 'Null or empty value');
    return ok('GEN-02', 'WARNING');
  }
  gen03_timestampMonotonic(currentTS: Date | null, previousTS: Date | null): ValidationResult {
    if (currentTS && previousTS && currentTS.getTime() < previousTS.getTime()) return fail('GEN-03', 'INFO', `Out-of-order TS`);
    return ok('GEN-03', 'INFO');
  }
  gen04_sourceMetadata(row: RawTagRow): ValidationResult {
    const problems: string[] = [];
    if (row.SiteId !== 'LLPL') problems.push(`SiteId=${row.SiteId}`);
    if (row.IotDeviceId !== 'uaq-lakme-hul-iotedge-01') problems.push(`IotDeviceId=${row.IotDeviceId}`);
    if (row.SensorId !== 'opcua') problems.push(`SensorId=${row.SensorId}`);
    return problems.length ? fail('GEN-04', 'INFO', `Unexpected source metadata: ${problems.join(', ')}`) : ok('GEN-04', 'INFO');
  }

  private getState(tagName: string): TagState {
    let s = this.tagState.get(tagName);
    if (!s) { s = { lastTS: null, lastValue: null, previousPV: null, previousSP: null, previousB: null, previousR: null, consecutiveIdenticalCount: 0, consecutiveNonZeroReworkCount: 0 }; this.tagState.set(tagName, s); }
    return s;
  }
  private commitState(row: RawTagRow, parsed: ParsedTagValue, ts: Date | null, state: TagState): void {
    state.lastTS = ts ?? state.lastTS;
    state.lastValue = row.Value;
    if (parsed.kind === 'PSM' || parsed.kind === 'SIGMA') { state.previousPV = parsed.PV; state.previousSP = parsed.SP; state.previousB = parsed.B; state.previousR = parsed.R; }
    else if (parsed.kind === 'PACKAGING') { state.previousPV = parsed.currentGrams; }
  }
  private recordAlerts(row: RawTagRow, ts: Date | null, results: ValidationResult[]): void {
    const failed = results.filter(r => !r.passed);
    if (failed.length === 0) { this.activeAlerts.delete(row.Tag); return; }
    this.activeAlerts.set(row.Tag, failed.map(r => ({ ...r, tagName: row.Tag, machineId: row.MachineId, ts: ts ?? new Date() })));
  }
  private kv(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of (raw ?? '').split(',')) { const idx = pair.indexOf(':'); if (idx === -1) continue; out[pair.substring(0, idx).trim()] = pair.substring(idx + 1).trim(); }
    return out;
  }
  private gapSeconds(currentTS: Date | null, previousTS: Date | null): number | null {
    if (!currentTS || !previousTS) return null;
    return (currentTS.getTime() - previousTS.getTime()) / 1000;
  }
  private inProductionHours(ts: Date | null): boolean {
    if (!ts) return true;
    const h = ts.getHours();
    return h >= PRODUCTION_HOURS.start && h < PRODUCTION_HOURS.end;
  }
  private hms(seconds: number): string {
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
    return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
  }
}
