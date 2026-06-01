import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { TagStateService } from '../../../services/tag-state.service';
import { SiloBagOut, SiloSnapshot, ValidationAlert } from '../../../types/tags';

interface SiloRow {
  id: string;
  group: 'Day' | 'Buffer' | 'Bagout-Buffer';
  noodleType: string;
  paired?: string;
  mismatch: boolean;
}

interface StationRow {
  id: 'Stn_01' | 'Stn_02';
  state: 'IDLE' | 'ACTIVE';
  batchId: string;
  sp: number | null;
  pv: number | null;
  dev: number | null;
  noodleType: string;
  barcode: string;
  barcodeIdle: boolean;
}

@Component({
  selector: 'app-silo-zone',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './silo-zone.component.html',
})
export class SiloZoneComponent {
  private themeSvc = inject(ThemeService);
  private stateSvc = inject(TagStateService);

  C = this.themeSvc.colors;
  silo$ = this.stateSvc.siloSnapshot$;

  readonly siloColumns = ['SILO', 'GROUP', 'NOODLE TYPE', 'PAIRED WITH', 'CROSS-CHECK'];
  readonly stationColumns = [
    'STATION', 'STATE', 'BATCH ID', 'SP (kg)', 'PV (kg)', 'DEV %', 'NOODLE', 'BARCODE',
  ];

  readonly daySiloIds = [1, 2, 3, 4, 5, 6];
  readonly bufferSiloIds = [1, 2, 3, 4, 5];

  siloRows(snap: SiloSnapshot): SiloRow[] {
    const rows: SiloRow[] = [];
    for (const i of this.daySiloIds) {
      const day = snap.daySilos.get(i) ?? '';
      const buf = snap.bufferSilos.get(i) ?? '';
      rows.push({
        id: `Day_silo_${i}`,
        group: 'Day',
        noodleType: day,
        paired: buf || undefined,
        mismatch: !!day && !!buf && day.trim() !== buf.trim(),
      });
    }
    for (const i of this.bufferSiloIds) {
      const buf = snap.bufferSilos.get(i) ?? '';
      const day = snap.daySilos.get(i) ?? '';
      rows.push({
        id: `Buffer_silo_${i}`,
        group: 'Buffer',
        noodleType: buf,
        paired: day || undefined,
        mismatch: !!day && !!buf && day.trim() !== buf.trim(),
      });
    }
    return rows;
  }

  stationRows(snap: SiloSnapshot): StationRow[] {
    return (['Stn_01', 'Stn_02'] as const).map((id) => {
      const s = snap.stations.get(id);
      const bc = snap.stationBarcodes.get(id);
      const dev = s && !s.isIdle && s.SP ? ((s.PV - s.SP) / s.SP) * 100 : null;
      return {
        id,
        state: !s || s.isIdle ? 'IDLE' : 'ACTIVE',
        batchId: s && !s.isIdle ? s.batchId : '—',
        sp: s && !s.isIdle ? s.SP : null,
        pv: s && !s.isIdle ? s.PV : null,
        dev,
        noodleType: s && !s.isIdle ? s.noodleType : '—',
        barcode: bc?.barcodeValue ?? '',
        barcodeIdle: !bc || bc.isIdle,
      };
    });
  }

  noodleStyle(type: string) {
    const c = this.C();
    let col = c.MUTED;
    const t = (type ?? '').toUpperCase();
    if (t.includes('JASMINE')) col = c.CYAN;
    else if (t.includes('PLUMERIA')) col = '#a855f7';
    else if (t.includes('SERGIO')) col = c.YELLOW;
    else if (t.includes('TEXAS')) col = '#0ea5e9';
    else if (t.includes('GALAXY')) col = '#6366f1';
    else if (t.includes('TULIP')) col = '#ec4899';
    else if (t.includes('LILAC')) col = '#c084fc';
    return {
      color: col,
      borderColor: `${col}44`,
      background: `${col}11`,
      boxShadow: c.isDark && type ? `0 0 8px ${col}33` : 'none',
    };
  }

  stationStateStyle(state: 'IDLE' | 'ACTIVE') {
    const c = this.C();
    const col = state === 'ACTIVE' ? c.GREEN : c.MUTED;
    return {
      color: col,
      borderColor: `${col}44`,
      background: `${col}11`,
      boxShadow: c.isDark && state === 'ACTIVE' ? `0 0 8px ${col}44` : 'none',
    };
  }

  devColor(dev: number | null): string {
    const c = this.C();
    if (dev == null || isNaN(dev)) return c.MUTED;
    const a = Math.abs(dev);
    return a <= 5 ? c.GREEN : a <= 10 ? c.YELLOW : c.PINK;
  }

  noodleCounts(snap: SiloSnapshot): Array<[string, number]> {
    const acc: Record<string, number> = {};
    for (const t of [...snap.daySilos.values(), ...snap.bufferSilos.values()]) {
      if (!t) continue;
      acc[t] = (acc[t] ?? 0) + 1;
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }

  warehouse(snap: SiloSnapshot) { return snap.warehouse; }
  shreeji(snap: SiloSnapshot) { return snap.shreeji; }
  alerts(snap: SiloSnapshot): ValidationAlert[] { return snap.alerts; }

  severityColor(a: ValidationAlert): string {
    const c = this.C();
    return a.severity === 'CRITICAL' ? c.PINK : a.severity === 'WARNING' ? c.YELLOW : c.MUTED;
  }

  // ---- shared table styling ----
  headerStyle() {
    const c = this.C();
    return { background: c.BG_PANEL, borderColor: c.BORDER };
  }
  titleStyle() {
    const c = this.C();
    return { color: c.CYAN, textShadow: c.isDark ? `0 0 8px ${c.CYAN}66` : 'none' };
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
  siloThAlign(i: number): string {
    return i === 4 ? 'text-center' : 'text-left';
  }
  stationThAlign(i: number): string {
    if ([0, 6, 7].includes(i)) return 'text-left';
    if (i === 1) return 'text-center';
    return 'text-right';
  }
}
