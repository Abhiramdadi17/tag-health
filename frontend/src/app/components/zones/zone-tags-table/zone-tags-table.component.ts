import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { ZoneKey, ZoneRecentRow } from '../../../services/zone-tags.service';

interface DisplayRow {
  tag: string;
  machineId: string;
  rawValue: string;
  ts: string;
  // zone-specific parsed bits
  recipe?: string;
  rm?: string;
  status?: string;
  batch?: string;
  sp?: number | null;
  pv?: number | null;
  dev?: number | null;
  cascade?: string;
  noodleType?: string;
  subtype?: string;
}

@Component({
  selector: 'app-zone-tags-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './zone-tags-table.component.html',
})
export class ZoneTagsTableComponent {
  private themeSvc = inject(ThemeService);
  C = this.themeSvc.colors;

  zone = input.required<ZoneKey>();
  data = input.required<ZoneRecentRow[]>();
  filter = input<string>('');

  rows = computed<DisplayRow[]>(() => {
    const q = (this.filter() ?? '').toLowerCase();
    const built = this.data().map(r => this.buildRow(r));
    if (!q) return built;
    return built.filter(r =>
      r.tag.toLowerCase().includes(q) ||
      r.machineId.toLowerCase().includes(q) ||
      r.rawValue.toLowerCase().includes(q) ||
      (r.recipe ?? '').toLowerCase().includes(q) ||
      (r.rm ?? '').toLowerCase().includes(q) ||
      (r.noodleType ?? '').toLowerCase().includes(q) ||
      (r.subtype ?? '').toLowerCase().includes(q));
  });

  columns = computed<string[]>(() => {
    switch (this.zone()) {
      case 'sigma':
        return ['TAG', 'MACHINE ID', 'KIND', 'STATUS', 'BATCH', 'RECIPE', 'RM', 'SP', 'PV', 'DEV %', 'LATEST VALUE', 'TS'];
      case 'silo':
        return ['TAG', 'MACHINE ID', 'SUBTYPE', 'NOODLE / STATUS', 'BAG BARCODE', 'SP', 'PV', 'DEV %', 'LATEST VALUE', 'TS'];
      case 'packaging':
        return ['TAG', 'MACHINE ID', 'WRAPPER', 'CASCADE', 'CURRENT (g)', 'TARGET (g)', 'DEV (g)', 'LATEST VALUE', 'TS'];
    }
  });

  private buildRow(r: ZoneRecentRow): DisplayRow {
    const base: DisplayRow = {
      tag: this.shortTag(r.Tag),
      machineId: r.MachineId,
      rawValue: r.Value,
      ts: r.TS,
    };
    const p = r.parsed;
    switch (this.zone()) {
      case 'sigma': {
        if (p.kind === 'SIGMA') {
          base.subtype = 'BATCH';
          base.status = this.sigmaStatus(p.S);
          base.batch = isNaN(p.B) ? '—' : String(p.B);
          base.recipe = p.R || '—';
          base.rm = p.RM || '—';
          base.sp = this.num(p.SP);
          base.pv = this.num(p.PV);
          base.dev = base.sp != null && base.sp > 0 && base.pv != null
            ? ((base.pv - base.sp) / base.sp) * 100
            : null;
        } else if (p.kind === 'SIGMA_BARCODE') {
          base.subtype = 'BARCODE';
          base.status = p.isIdle ? 'IDLE' : 'SCANNED';
        } else if (p.kind === 'SIGMA_REWORK') {
          base.subtype = 'REWORK';
          base.status = p.reworkValue > 0 ? 'ACTIVE' : 'NORMAL';
          base.pv = p.reworkValue;
        } else {
          base.subtype = 'UNKNOWN';
        }
        break;
      }
      case 'silo': {
        if (p.kind === 'SILO') {
          base.subtype = p.tagType;
          if (p.tagType === 'noodle_type') {
            base.noodleType = p.noodleType;
            base.status = p.noodleType || '—';
          } else if (p.tagType === 'bagout_detail') {
            base.status = p.isIdle ? 'IDLE' : 'ACTIVE';
            if (!p.isIdle) {
              base.batch = p.batchId;
              base.sp = this.num(p.SP);
              base.pv = this.num(p.PV);
              base.dev = base.sp != null && base.sp > 0 && base.pv != null
                ? ((base.pv - base.sp) / base.sp) * 100
                : null;
              base.noodleType = p.noodleType;
            }
          } else if (p.tagType === 'barcode') {
            base.status = p.isIdle ? 'IDLE' : 'SCANNED';
            base.batch = p.barcodeValue;
          } else if (p.tagType === 'warehouse_barcode') {
            base.status = 'DOSING';
            base.batch = p.batchId;
            base.noodleType = p.noodleType;
            base.pv = this.num(p.weight);
          } else if (p.tagType === 'shreeji_barcode') {
            base.status = p.mode || 'WEIGHED';
            base.batch = p.barcodeId;
            base.pv = this.num(p.weight);
          }
        }
        break;
      }
      case 'packaging': {
        if (p.kind === 'PACKAGING') {
          base.subtype = p.wrapperName;
          base.cascade = p.cascade;
          base.pv = this.num(p.currentGrams);
          base.sp = this.num(p.targetGrams);
          base.dev = base.pv != null && base.sp != null
            ? base.pv - base.sp
            : null;
        }
        break;
      }
    }
    return base;
  }

  private sigmaStatus(s: number | undefined): string {
    return s === 2 ? 'DOSING' : s === 3 ? 'COMPLETE' : 'IDLE';
  }

  private shortTag(tag: string): string {
    const dotIdx = tag.lastIndexOf('.');
    return dotIdx >= 0 ? tag.substring(dotIdx + 1) : tag;
  }

  private num(v: number | null | undefined): number | null {
    return v == null || (typeof v === 'number' && isNaN(v)) ? null : v;
  }

  statusStyle(status: string | undefined) {
    const c = this.C();
    let col = c.MUTED;
    if (!status) return { color: col };
    const s = status.toUpperCase();
    if (s === 'DOSING' || s === 'SCANNED' || s === 'WEIGHED' || s === 'PV') col = c.CYAN;
    else if (s === 'COMPLETE' || s === 'NORMAL') col = c.GREEN;
    else if (s === 'ACTIVE') col = c.GREEN;
    else if (s === 'IDLE') col = c.MUTED;
    else if (s.includes('NOODLES')) {
      if (s.includes('JASMINE')) col = c.CYAN;
      else if (s.includes('PLUMERIA')) col = '#a855f7';
      else if (s.includes('SERGIO')) col = c.YELLOW;
      else if (s.includes('TEXAS')) col = '#0ea5e9';
      else if (s.includes('GALAXY')) col = '#6366f1';
      else if (s.includes('TULIP')) col = '#ec4899';
      else if (s.includes('LILAC')) col = '#c084fc';
    }
    return {
      color: col,
      borderColor: `color-mix(in srgb, ${col} 27%, transparent)`,
      background: `color-mix(in srgb, ${col} 7%, transparent)`,
      boxShadow: c.isDark ? `0 0 8px color-mix(in srgb, ${col} 20%, transparent)` : 'none',
    };
  }

  devColor(dev: number | null | undefined): string {
    const c = this.C();
    if (dev == null || isNaN(dev)) return c.MUTED;
    const a = Math.abs(dev);
    return a <= 5 ? c.GREEN : a <= 10 ? c.YELLOW : c.PINK;
  }

  devGramColor(dev: number | null | undefined): string {
    const c = this.C();
    if (dev == null || isNaN(dev)) return c.MUTED;
    const a = Math.abs(dev);
    return a <= 2 ? c.GREEN : a <= 3 ? c.YELLOW : c.PINK;
  }

  cascadeStyle(cascade: string | undefined) {
    const c = this.C();
    if (!cascade) return { color: c.MUTED };
    const col = cascade === 'CAS3' ? c.CYAN : c.ORANGE;
    return { color: col, borderColor: `color-mix(in srgb, ${col} 27%, transparent)`, background: `color-mix(in srgb, ${col} 7%, transparent)` };
  }

  // ---- shared table styling ----
  headerStyle() {
    const c = this.C();
    return { background: c.BG_PANEL, borderColor: c.BORDER };
  }
  titleStyle() {
    const c = this.C();
    return { color: c.CYAN, textShadow: c.isDark ? `0 0 8px color-mix(in srgb, ${c.CYAN} 40%, transparent)` : 'none' };
  }
  headRowStyle() {
    const c = this.C();
    return { borderColor: c.BORDER, background: c.BG_BASE };
  }
  rowMouseEnter(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.background = this.C().BG_CARD;
  }
  rowMouseLeave(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.background = 'transparent';
  }
}
