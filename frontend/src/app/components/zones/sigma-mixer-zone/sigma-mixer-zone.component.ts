import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { TagStateService } from '../../../services/tag-state.service';
import { SigmaMixerSnapshot, SigmaSnapshot, ValidationAlert } from '../../../types/tags';

@Component({
  selector: 'app-sigma-mixer-zone',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sigma-mixer-zone.component.html',
})
export class SigmaMixerZoneComponent {
  private themeSvc = inject(ThemeService);
  private stateSvc = inject(TagStateService);

  C = this.themeSvc.colors;
  sigma$ = this.stateSvc.sigmaSnapshot$;

  readonly columns = [
    'MIXER', 'STATUS', 'BATCH #', 'RECIPE', 'SP (kg)', 'PV (kg)',
    'DEV %', 'BARCODE', 'REWORK', 'DATE (D)',
  ];

  rows(snap: SigmaSnapshot): { id: 'MX1' | 'MX2'; mixer: SigmaMixerSnapshot }[] {
    return [
      { id: 'MX1', mixer: snap.mx1 },
      { id: 'MX2', mixer: snap.mx2 },
    ];
  }

  statusLabel(s: number | undefined): string {
    return s === 2 ? 'DOSING' : s === 3 ? 'COMPLETE' : 'IDLE';
  }

  statusStyle(s: number | undefined) {
    const c = this.C();
    const col = s === 2 ? c.CYAN : s === 3 ? c.GREEN : c.MUTED;
    return {
      color: col,
      borderColor: `${col}44`,
      background: `${col}11`,
      boxShadow: c.isDark ? `0 0 8px ${col}44` : 'none',
    };
  }

  statusCounts(snap: SigmaSnapshot): Array<[string, number]> {
    const acc: Record<string, number> = { IDLE: 0, DOSING: 0, COMPLETE: 0 };
    for (const m of [snap.mx1, snap.mx2]) {
      acc[this.statusLabel(m.batch?.S)] += 1;
    }
    return Object.entries(acc);
  }

  deviation(m: SigmaMixerSnapshot): number | null {
    const b = m.batch;
    if (!b || !b.SP) return null;
    return ((b.PV - b.SP) / b.SP) * 100;
  }

  devColor(dev: number | null): string {
    const c = this.C();
    if (dev == null || isNaN(dev)) return c.MUTED;
    const a = Math.abs(dev);
    return a <= 5 ? c.GREEN : a <= 10 ? c.YELLOW : c.PINK;
  }

  barcodeLabel(m: SigmaMixerSnapshot): string {
    const bc = m.barcode;
    if (!bc) return '—';
    if (bc.isIdle) return 'Scanning…';
    return `#${bc.barcodeValue}`;
  }

  reworkLabel(m: SigmaMixerSnapshot): string {
    const r = m.rework;
    if (!r) return '—';
    return r.reworkValue > 0 ? `ACTIVE (${r.reworkValue})` : 'NORMAL';
  }

  reworkStyle(m: SigmaMixerSnapshot) {
    const c = this.C();
    const active = (m.rework?.reworkValue ?? 0) > 0;
    const col = active ? c.ORANGE : c.MUTED;
    return {
      color: col,
      borderColor: `${col}44`,
      background: `${col}11`,
      boxShadow: c.isDark && active ? `0 0 8px ${col}44` : 'none',
    };
  }

  allAlerts(snap: SigmaSnapshot): ValidationAlert[] {
    return [...snap.mx1.alerts, ...snap.mx2.alerts];
  }

  severityColor(a: ValidationAlert): string {
    const c = this.C();
    return a.severity === 'CRITICAL' ? c.PINK : a.severity === 'WARNING' ? c.YELLOW : c.MUTED;
  }

  // ---- table styling (matches TagsMonitorTable) ----
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
  thAlign(i: number): string {
    if ([0, 1, 7, 8].includes(i)) return 'text-left';
    if ([2].includes(i)) return 'text-center';
    return 'text-right';
  }
  tdAlign(i: number): string {
    return this.thAlign(i);
  }
}
