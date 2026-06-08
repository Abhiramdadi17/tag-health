import { Injectable } from '@angular/core';
import {
  RawTagRow,
  TagType,
  ParsedTagValue,
  PsmParsed,
  PsmTelemetryParsed,
  SigmaParsed,
  SigmaBarcode,
  SigmaRework,
  SigmaTelemetryParsed,
  SigmaMixer,
  SiloParsed,
  PackagingParsed,
  StatusCode,
  WRAPPER_TARGETS,
} from '../types/tags';

/**
 * TagParserService
 * Type-aware parsing of raw OPC-UA telemetry rows into strongly-typed
 * structures for the PSM / Sigma / Silo / Packaging dashboard zones.
 */
@Injectable({ providedIn: 'root' })
export class TagParserService {

  // --------------------------------------------------------------------------
  // Tag type detection
  // --------------------------------------------------------------------------
  detectTagType(tagName: string): TagType {
    const t = tagName || '';
    const lower = t.toLowerCase();
    // SILO first — silo tags can carry a 'Cascade<n>.' OPC-UA path prefix.
    if (
      lower.includes('silo') || t.includes('Bagout') ||
      t.includes('Scnr_barcode') || t.includes('Dosing_Barcode') || t.includes('Shreeji')
    ) return 'SILO';
    // SIGMA — covers the new Cascade<n>_ rooted tags + classic MIXER patterns.
    // Must precede PSM because a few Sigma rows ('Cascade 2_PSM_batch_…') carry
    // 'PSM' as a substring even though they belong to Sigma.
    if (
      t.includes('Sigmamixer') || t.includes('SigmaMixer') ||
      t.includes('MIXER') || t.includes('SM_MX') || t.includes('MX0') ||
      /Cascade\s*\d/.test(t)
    ) return 'SIGMA';
    if (t.includes('SOAP_GRAM') || t.includes('ACMA1')) return 'PACKAGING';
    if (t.includes('PSM') || t.includes('Psm')) return 'PSM';
    return 'UNKNOWN';
  }

  // --------------------------------------------------------------------------
  // Top-level dispatch
  // --------------------------------------------------------------------------
  parseTagValue(row: RawTagRow): ParsedTagValue {
    const type = this.detectTagType(row.Tag);
    const raw = row.Value;

    switch (type) {
      case 'PSM':
        return this.parsePsmTag(row.Tag, String(raw));

      case 'SIGMA':
        return this.parseSigmaTag(row.Tag, raw);

      case 'SILO':
        return this.parseSiloTag(row.Tag, String(raw));

      case 'PACKAGING':
        return this.parsePackagingTag(row.Tag, this.toNumber(raw));

      default:
        return { kind: 'UNKNOWN', raw };
    }
  }

  // --------------------------------------------------------------------------
  // PSM / Sigma shared string format:
  // 'D:202641,S:3,B:38,R:PLUMERIA NOODLES,RM:EDTA,SP:2.0499,PV:2.0850'
  // --------------------------------------------------------------------------
  parseBatchString(raw: string, kind: 'PSM' | 'SIGMA'): PsmParsed | SigmaParsed | null {
    if (raw == null) return null;
    const map = this.splitKeyValue(raw);
    if (!('D' in map) && !('S' in map)) return null;

    const base = {
      D: map['D'] ?? '',
      S: this.toStatus(map['S']),
      B: this.toNumber(map['B']),
      R: map['R'] ?? '',
      RM: map['RM'] ?? '',
      SP: this.toNumber(map['SP']),
      PV: this.toNumber(map['PV']),
    };

    return kind === 'PSM'
      ? ({ kind: 'PSM', ...base } as PsmParsed)
      : ({ kind: 'SIGMA', ...base } as SigmaParsed);
  }

  // --------------------------------------------------------------------------
  // PSM telemetry dispatch — two tag families:
  //   Psm_01_AOS_Batch  →  embedded batch string (same format as SIGMA)
  //   PSM_01_Batch_PV_Weight / Batch_SP_Weight / Batch_Counter / Noodle_Name
  //                     →  scalar or string telemetry value
  // --------------------------------------------------------------------------
  private parsePsmTag(tagName: string, raw: string): ParsedTagValue {
    const short = tagName.split('.').pop() ?? tagName;

    // RM_Batch tags: 'Psm_01_AOS_Batch', 'Psm_01_Caustic_Batch' …
    // Value is a full batch string: 'D:202641,S:3,B:38,R:...,RM:AOS,SP:35.749,PV:35.740'
    if (/^Psm_\d+_\w+_Batch$/i.test(short)) {
      return this.parseBatchString(raw, 'PSM') ?? { kind: 'UNKNOWN', raw };
    }

    // Structural tags: 'PSM_01_Batch_PV_Weight', 'PSM_01_Noodle_Name', …
    const m = short.match(/^PSM_\d+_(.+)$/);
    const tagType = m ? m[1] : short;

    if (tagType === 'Batch_PV_Weight' || tagType === 'Batch_SP_Weight') {
      return { kind: 'PSM_TELEMETRY', tagType, value: parseFloat(raw) } as PsmTelemetryParsed;
    }
    if (tagType === 'Batch_Counter') {
      return { kind: 'PSM_TELEMETRY', tagType, value: parseInt(raw, 10) } as PsmTelemetryParsed;
    }
    if (tagType === 'Noodle_Name') {
      return { kind: 'PSM_TELEMETRY', tagType, value: raw.replace(/^'|'$/g, '').trim() } as PsmTelemetryParsed;
    }

    // Unknown PSM structural tag — surface raw value
    return { kind: 'PSM_TELEMETRY', tagType, value: raw } as PsmTelemetryParsed;
  }

  // --------------------------------------------------------------------------
  // Sigma sub-types:
  //   batch string  D:S:B:R:RM:SP:PV   (the dominant case in the new workbook)
  //   REWORK        scalar int
  //   BATCHCOUNTER  scalar int — structural mixer-state tag
  //   RECIPE_NAME   string     — structural mixer-state tag
  //   SM_MX#_BC     numeric barcode (legacy)
  // --------------------------------------------------------------------------
  private parseSigmaTag(tagName: string, raw: string | number): ParsedTagValue {
    const short = tagName.split('.').pop() ?? tagName;
    const mixer = this.sigmaMixerOf(tagName);

    if (/REWORK/i.test(short) || /Rework/.test(short)) {
      return {
        kind: 'SIGMA_REWORK',
        mixer,
        reworkValue: this.toNumber(raw),
      } as SigmaRework;
    }

    if (/BATCHCOUNTER/i.test(short)) {
      return {
        kind: 'SIGMA_TELEMETRY',
        mixer,
        tagType: 'BATCHCOUNTER',
        value: this.toNumber(raw),
      } as SigmaTelemetryParsed;
    }

    if (/RECIPE[_ ]?NAME/i.test(short)) {
      return {
        kind: 'SIGMA_TELEMETRY',
        mixer,
        tagType: 'RECIPE_NAME',
        value: String(raw ?? '').trim(),
      } as SigmaTelemetryParsed;
    }

    if (tagName.includes('SM_MX') || tagName.includes('_BC')) {
      const val = String(raw ?? '').trim();
      const lower = val.toLowerCase();
      const isIdle = val === '' || lower === 'scan barcode' || lower === 'nan';
      return {
        kind: 'SIGMA_BARCODE',
        mixer,
        barcodeValue: val,
        isIdle,
      } as SigmaBarcode;
    }

    // Batch string D:S:B:R:RM:SP:PV — the dominant case.
    const parsed = this.parseBatchString(String(raw), 'SIGMA');
    return parsed ?? { kind: 'UNKNOWN', raw };
  }

  /** Derive the mixer identity (MX1..MX6) from any known tag shape:
   *   - explicit 'MX<n>' / 'MX0<n>'
   *   - 'MIX<n>' / 'MIXER<n>' / 'MIXER_<n>'
   *   - 'Cascade<n>' (cascades map 1:1 to mixers in the current plant) */
  sigmaMixerOf(tagName: string): SigmaMixer {
    const direct = tagName.match(/(?:^|[^A-Za-z])MX0?([1-6])(?![0-9])/);
    if (direct) return (`MX${direct[1]}`) as SigmaMixer;
    const mix = tagName.match(/MIX(?:ER)?_?([1-6])(?![0-9])/);
    if (mix) return (`MX${mix[1]}`) as SigmaMixer;
    const cascade = tagName.match(/Cascade\s*([1-6])(?![0-9])/);
    if (cascade) return (`MX${cascade[1]}`) as SigmaMixer;
    return 'MX1';
  }

  // --------------------------------------------------------------------------
  // Silo parsing — dispatch by tag-name sub-type
  // --------------------------------------------------------------------------
  parseSiloTag(tagName: string, raw: string): SiloParsed {
    // Noodle type tags: '..._type_of_noodle'
    if (tagName.includes('type_of_noodle')) {
      return {
        kind: 'SILO',
        tagType: 'noodle_type',
        siloId: this.siloIdOf(tagName),
        noodleType: (raw ?? '').trim(),
      };
    }

    // Bag-out detail: 'batchId,upperLimit,lowerLimit,noodleType' or ',' (idle)
    if (tagName.includes('All_Details')) {
      const stationId = tagName.includes('Stn_02') ? 'Stn_02' : 'Stn_01';
      const isIdle = (raw ?? '').trim() === ',';
      const parts = (raw ?? '').split(',');
      return {
        kind: 'SILO',
        tagType: 'bagout_detail',
        stationId,
        batchId: isIdle ? '' : (parts[0] ?? '').trim(),
        upperLimit: isIdle ? NaN : this.toNumber(parts[1]),
        lowerLimit: isIdle ? NaN : this.toNumber(parts[2]),
        noodleType: isIdle ? '' : (parts[3] ?? '').trim(),
        isIdle,
      };
    }

    // Scanner barcode tags
    if (tagName.includes('Scnr_barcode')) {
      const stationId = tagName.includes('Stn_02') ? 'Stn_02' : 'Stn_01';
      const val = (raw ?? '').trim();
      const numeric = /^\d{6,}$/.test(val);
      return {
        kind: 'SILO',
        tagType: 'barcode',
        stationId,
        barcodeValue: val,
        isIdle: !numeric,
      };
    }

    // Warehouse dosing barcode: 'batchId,weight,noodleType,count'
    if (tagName.includes('Dosing_Barcode')) {
      const parts = (raw ?? '').split(',');
      return {
        kind: 'SILO',
        tagType: 'warehouse_barcode',
        batchId: (parts[0] ?? '').trim(),
        weight: this.toNumber(parts[1]),
        noodleType: (parts[2] ?? '').trim(),
        count: this.toNumber(parts[3]),
      };
    }

    // Shreeji barcode: 'barcodeId,MODE,weight'  (e.g. '1300326026,PV,937.00')
    // Middle field is a literal mode indicator (typically 'PV'), NOT a number.
    if (tagName.includes('Shreeji')) {
      const parts = (raw ?? '').split(',');
      return {
        kind: 'SILO',
        tagType: 'shreeji_barcode',
        barcodeId: (parts[0] ?? '').trim(),
        mode: (parts[1] ?? '').trim(),
        weight: this.toNumber(parts[2]),
      };
    }

    // Fallback: treat as noodle type
    return {
      kind: 'SILO',
      tagType: 'noodle_type',
      siloId: this.siloIdOf(tagName),
      noodleType: (raw ?? '').trim(),
    };
  }

  private siloIdOf(tagName: string): string {
    // 'TSPCAS3.Cascade3.Day_silo_1_type_of_noodle' -> 'Day_silo_1'
    const m = tagName.match(/((?:Bagout_)?(?:Day|Buffer)_silo_\d+)/i);
    return m ? m[1] : tagName;
  }

  // --------------------------------------------------------------------------
  // Packaging parsing — integer grams + wrapper target lookup
  // --------------------------------------------------------------------------
  parsePackagingTag(tagName: string, value: number): PackagingParsed {
    const wrapperName = this.extractWrapperName(tagName);
    const target = WRAPPER_TARGETS[wrapperName];
    const cascade = target
      ? target.cascade
      : (tagName.includes('CAS5_6') ? 'CAS5_6' : 'CAS3');
    return {
      kind: 'PACKAGING',
      wrapperName,
      cascade,
      currentGrams: value,
      targetGrams: target ? target.target : NaN,
    };
  }

  extractWrapperName(tagName: string): string {
    const match = (tagName || '').match(/(WRA\d+|ACMA1)/);
    return match ? match[1] : 'UNKNOWN';
  }

  // --------------------------------------------------------------------------
  // Julian date helper — D field format YYYYDDD e.g. '202641' = day 41 of 2026
  // --------------------------------------------------------------------------
  julianDateToDate(d: string): Date | null {
    if (!d || d.length < 5) return null;
    const year = parseInt(d.substring(0, 4), 10);
    const dayOfYear = parseInt(d.substring(4), 10);
    if (isNaN(year) || isNaN(dayOfYear) || dayOfYear < 1 || dayOfYear > 366) return null;
    const date = new Date(year, 0);
    date.setDate(dayOfYear);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Parse the OPC-UA timestamp format: '4/26/2026, 6:00:15.199 AM'
   * Falls back to Date constructor for ISO strings.
   */
  parseTimestamp(ts: string): Date | null {
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------
  private splitKeyValue(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pair of raw.split(',')) {
      const idx = pair.indexOf(':');
      if (idx === -1) continue;
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      if (key) out[key] = val;
    }
    return out;
  }

  private toNumber(v: unknown): number {
    if (v == null || v === '') return NaN;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return n;
  }

  private toStatus(v: unknown): StatusCode {
    const n = this.toNumber(v);
    return (n === 1 || n === 2 || n === 3 ? n : NaN) as StatusCode;
  }
}
