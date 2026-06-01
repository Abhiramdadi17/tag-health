import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TagParserService } from './tag-parser.service';
import { TagValidationService } from './tag-validation.service';
import {
  RawTagRow, PsmParsed, SigmaParsed, SigmaBarcode, SigmaRework, PackagingParsed,
  SigmaSnapshot, SigmaMixerSnapshot, SiloSnapshot, PackagingSnapshot, ValidationAlert,
  SiloBagOut, SiloBarcodeTag, SiloNoodleType, SiloWarehouseBarcode, SiloShreejiBarcode,
} from '../types/tags';

function emptyMixer(): SigmaMixerSnapshot {
  return { batch: null, barcode: null, rework: null, barcodeIdleSince: null, alerts: [] };
}

@Injectable({ providedIn: 'root' })
export class TagStateService {
  private parser = inject(TagParserService);
  private validator = inject(TagValidationService);

  readonly psmSnapshot$ = new BehaviorSubject<Map<string, PsmParsed>>(new Map());
  readonly sigmaSnapshot$ = new BehaviorSubject<SigmaSnapshot>({ mx1: emptyMixer(), mx2: emptyMixer() });
  readonly siloSnapshot$ = new BehaviorSubject<SiloSnapshot>({ daySilos: new Map(), bufferSilos: new Map(), stations: new Map(), stationBarcodes: new Map(), warehouse: null, shreeji: null, alerts: [] });
  readonly packagingSnapshot$ = new BehaviorSubject<PackagingSnapshot>({ wrappers: new Map(), alerts: [] });

  private latestRaw = new Map<string, RawTagRow>();

  updateFromRow(row: RawTagRow): void {
    this.latestRaw.set(row.Tag, row);
    const parsed = this.parser.parseTagValue(row);
    switch (parsed.kind) {
      case 'PSM': this.applyPsm(row, parsed); break;
      case 'SIGMA': case 'SIGMA_BARCODE': case 'SIGMA_REWORK': this.applySigma(row, parsed); break;
      case 'SILO': this.applySilo(row, parsed); break;
      case 'PACKAGING': this.applyPackaging(row, parsed); break;
      default: this.validator.validateTag(row, parsed);
    }
  }
  ingestAll(rows: RawTagRow[]): void { for (const r of rows) this.updateFromRow(r); }

  private applyPsm(row: RawTagRow, parsed: PsmParsed): void {
    const map = new Map(this.psmSnapshot$.value);
    map.set(row.Tag, parsed);
    this.validator.validateTag(row, parsed, { allCurrentRMs: Array.from(map.values()) });
    this.psmSnapshot$.next(map);
  }

  private applySigma(row: RawTagRow, parsed: SigmaParsed | SigmaBarcode | SigmaRework): void {
    const snap: SigmaSnapshot = { mx1: { ...this.sigmaSnapshot$.value.mx1 }, mx2: { ...this.sigmaSnapshot$.value.mx2 } };
    let mixer: SigmaMixerSnapshot;
    if (parsed.kind === 'SIGMA') {
      mixer = row.Tag.includes('MIXER_2') ? snap.mx2 : snap.mx1;
      mixer.batch = parsed;
      this.validator.validateTag(row, parsed, { mx1: snap.mx1.batch, mx2: snap.mx2.batch });
    } else if (parsed.kind === 'SIGMA_BARCODE') {
      mixer = parsed.mixer === 'MX2' ? snap.mx2 : snap.mx1;
      mixer.barcode = parsed;
      mixer.barcodeIdleSince = parsed.isIdle ? (mixer.barcodeIdleSince ?? this.parser.parseTimestamp(row.TS)) : null;
      this.validator.validateTag(row, parsed);
    } else {
      mixer = parsed.mixer === 'MX2' ? snap.mx2 : snap.mx1;
      mixer.rework = parsed;
      this.validator.validateTag(row, parsed);
    }
    snap.mx1.alerts = this.alertsForMixer('MX1');
    snap.mx2.alerts = this.alertsForMixer('MX2');
    this.sigmaSnapshot$.next(snap);
  }
  private alertsForMixer(mixer: 'MX1' | 'MX2'): ValidationAlert[] {
    const all = this.validator.getActiveAlerts();
    const m = mixer === 'MX2' ? ['MIXER_2', 'MX2', 'MX02'] : ['MIXER_1', 'MX1', 'MX01'];
    return this.dedupe(all.filter(a => m.some(token => a.tagName.includes(token)) && (a.tagName.includes('MIXER') || a.tagName.includes('MX') || a.tagName.includes('REWORK'))));
  }

  private applySilo(row: RawTagRow, parsed: any): void {
    const cur = this.siloSnapshot$.value;
    const snap: SiloSnapshot = { daySilos: new Map(cur.daySilos), bufferSilos: new Map(cur.bufferSilos), stations: new Map(cur.stations), stationBarcodes: new Map(cur.stationBarcodes), warehouse: cur.warehouse, shreeji: cur.shreeji, alerts: cur.alerts };
    const ctx: any = {};
    switch (parsed.tagType) {
      case 'noodle_type': {
        const p = parsed as SiloNoodleType;
        const idx = this.siloIndex(p.siloId);
        if (/Day/i.test(p.siloId) && idx != null) { snap.daySilos.set(idx, p.noodleType); ctx.bufferSiloType = snap.bufferSilos.get(idx); ctx.siloIndex = idx; }
        else if (/Buffer/i.test(p.siloId) && idx != null) { snap.bufferSilos.set(idx, p.noodleType); ctx.bufferSiloType = p.noodleType; ctx.siloIndex = idx; }
        ctx.allSiloTypes = this.allSiloTypes(snap);
        break;
      }
      case 'bagout_detail': { const p = parsed as SiloBagOut; snap.stations.set(p.stationId, p); break; }
      case 'barcode': { const p = parsed as SiloBarcodeTag; snap.stationBarcodes.set(p.stationId, p); break; }
      case 'warehouse_barcode': snap.warehouse = parsed as SiloWarehouseBarcode; break;
      case 'shreeji_barcode': snap.shreeji = parsed as SiloShreejiBarcode; break;
    }
    this.validator.validateTag(row, parsed, ctx);
    snap.alerts = this.alertsByPrefix(['SLO']);
    this.siloSnapshot$.next(snap);
  }
  private siloIndex(siloId: string): number | null { const m = siloId.match(/_(\d+)\b/); return m ? parseInt(m[1], 10) : null; }
  private allSiloTypes(snap: SiloSnapshot): Map<string, string> {
    const out = new Map<string, string>();
    for (const [i, t] of snap.daySilos) out.set(`Day_${i}`, t);
    for (const [i, t] of snap.bufferSilos) out.set(`Buffer_${i}`, t);
    return out;
  }

  private applyPackaging(row: RawTagRow, parsed: PackagingParsed): void {
    const cur = this.packagingSnapshot$.value;
    const wrappers = new Map(cur.wrappers);
    wrappers.set(parsed.wrapperName, parsed);
    const cascadeSnapshot = new Map<string, number>();
    for (const [name, w] of wrappers) if (w.cascade === parsed.cascade) cascadeSnapshot.set(name, w.currentGrams);
    this.validator.validateTag(row, parsed, { cascadeSnapshot });
    this.packagingSnapshot$.next({ wrappers, alerts: this.alertsByPrefix(['PKG']) });
  }

  private alertsByPrefix(prefixes: string[]): ValidationAlert[] {
    return this.dedupe(this.validator.getActiveAlerts().filter(a => prefixes.some(p => a.ruleId.startsWith(p))));
  }
  private dedupe(alerts: ValidationAlert[]): ValidationAlert[] {
    const seen = new Set<string>(); const out: ValidationAlert[] = [];
    for (const a of alerts) { const key = `${a.ruleId}|${a.message}`; if (seen.has(key)) continue; seen.add(key); out.push(a); }
    return out;
  }
}
