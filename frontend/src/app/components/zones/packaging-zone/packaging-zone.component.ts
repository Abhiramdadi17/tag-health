import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { TagStateService } from '../../../services/tag-state.service';
import { PackagingParsed, PackagingSnapshot, ValidationAlert } from '../../../types/tags';

interface WrapperRow extends PackagingParsed {
  dev: number;
  status: 'IN-SPEC' | 'OUT-OF-SPEC' | 'OFFLINE' | 'FROZEN';
  machineId: string;
}

@Component({
  selector: 'app-packaging-zone',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './packaging-zone.component.html',
})
export class PackagingZoneComponent {
  private themeSvc = inject(ThemeService);
  private stateSvc = inject(TagStateService);

  C = this.themeSvc.colors;
  pkg$ = this.stateSvc.packagingSnapshot$;

  readonly columns = [
    'WRAPPER', 'CASCADE', 'CURRENT (g)', 'TARGET (g)', 'DEV (g)', 'MACHINE ID', 'STATUS',
  ];

  readonly wrapperMachineMap: Record<string, string> = {
    WRA3: '800500104343-1',
    ACMA1: '800500104343-1',
    WRA16: '800500005279-0',
  };
  readonly defaultMachine = '8005000043300';

  rows(snap: PackagingSnapshot): WrapperRow[] {
    return Array.from(snap.wrappers.values())
      .sort((a, b) =>
        a.cascade.localeCompare(b.cascade) ||
        a.wrapperName.localeCompare(b.wrapperName, undefined, { numeric: true }))
      .map((w) => ({
        ...w,
        dev: w.currentGrams - w.targetGrams,
        status: this.classify(snap, w),
        machineId: this.wrapperMachineMap[w.wrapperName] ?? this.defaultMachine,
      }));
  }

  private classify(snap: PackagingSnapshot, w: PackagingParsed): WrapperRow['status'] {
    if (snap.alerts.some(a => a.ruleId === 'PKG-06' && a.tagName.includes(w.wrapperName + '_'))) return 'FROZEN';
    if (snap.alerts.some(a => a.ruleId === 'PKG-07' && a.tagName.includes(w.wrapperName + '_'))) return 'OFFLINE';
    if (w.currentGrams <= 0) return 'OFFLINE';
    return Math.abs(w.currentGrams - w.targetGrams) > 3 ? 'OUT-OF-SPEC' : 'IN-SPEC';
  }

  statusStyle(s: WrapperRow['status']) {
    const c = this.C();
    let col = c.GREEN;
    if (s === 'OUT-OF-SPEC') col = c.PINK;
    else if (s === 'FROZEN') col = c.CYAN;
    else if (s === 'OFFLINE') col = c.MUTED;
    return {
      color: col,
      borderColor: `${col}44`,
      background: `${col}11`,
      boxShadow: c.isDark ? `0 0 8px ${col}44` : 'none',
    };
  }

  devColor(d: number): string {
    const c = this.C();
    const a = Math.abs(d);
    return a <= 2 ? c.GREEN : a <= 3 ? c.YELLOW : c.PINK;
  }

  cascadeStyle(cascade: 'CAS3' | 'CAS5_6') {
    const c = this.C();
    const col = cascade === 'CAS3' ? c.CYAN : c.ORANGE;
    return {
      color: col,
      borderColor: `${col}44`,
      background: `${col}11`,
    };
  }

  statusCounts(snap: PackagingSnapshot): Array<[WrapperRow['status'], number]> {
    const acc = { 'IN-SPEC': 0, 'OUT-OF-SPEC': 0, 'OFFLINE': 0, 'FROZEN': 0 } as Record<WrapperRow['status'], number>;
    for (const r of this.rows(snap)) acc[r.status] += 1;
    return Object.entries(acc) as Array<[WrapperRow['status'], number]>;
  }

  alerts(snap: PackagingSnapshot): ValidationAlert[] { return snap.alerts; }

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
  thAlign(i: number): string {
    if ([0, 1, 5].includes(i)) return 'text-left';
    if (i === 6) return 'text-center';
    return 'text-right';
  }
}
