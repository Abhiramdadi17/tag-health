import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../../../services/theme.service';
import { AlertLogService, AlertEntry } from '../../../services/alert-log.service';
import { Severity, ZoneType } from '../../../types/tags';

type SevFilter = 'ALL' | Severity;

@Component({
  selector: 'app-alert-log-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './alert-log-drawer.component.html',
  styles: [`
    :host { display: contents; }
  `],
})
export class AlertLogDrawerComponent {
  private themeSvc = inject(ThemeService);
  private alertSvc = inject(AlertLogService);
  C = this.themeSvc.colors;

  open    = input<boolean>(false);
  closed  = output<void>();

  // local filter signals
  severity = signal<SevFilter>('ALL');
  zoneFilter = signal<ZoneType | 'ALL'>('ALL');
  query    = signal<string>('');
  /** Per-tag expanded set. */
  expanded = signal<Set<string>>(new Set());

  counts = this.alertSvc.counts;

  filtered = computed<AlertEntry[]>(() => {
    const sev = this.severity();
    const zn  = this.zoneFilter();
    const q   = this.query().toLowerCase().trim();
    return this.alertSvc.entries().filter(e => {
      if (sev !== 'ALL' && e.severity !== sev) return false;
      if (zn !== 'ALL' && e.zone !== zn) return false;
      if (q) {
        const hay = `${e.tagName} ${e.ruleId} ${e.message} ${e.recipe ?? ''} ${e.batchId ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  /** Tags ordered by most-recent failure descending. */
  groupedByTag = computed<{ tag: string; rows: AlertEntry[]; latest: number }[]>(() => {
    const map = new Map<string, AlertEntry[]>();
    for (const e of this.filtered()) {
      const arr = map.get(e.tagName);
      if (arr) arr.push(e);
      else map.set(e.tagName, [e]);
    }
    return Array.from(map.entries())
      .map(([tag, rows]) => ({ tag, rows, latest: Math.max(...rows.map(r => r.ts)) }))
      .sort((a, b) => b.latest - a.latest);
  });

  toggleTag(tag: string): void {
    const next = new Set(this.expanded());
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    this.expanded.set(next);
  }

  fmtTime(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  severityColor(s: Severity): string {
    const c = this.C();
    return s === 'CRITICAL' ? c.PINK : s === 'WARNING' ? c.YELLOW : c.MUTED;
  }
  zoneColor(z: ZoneType): string {
    const c = this.C();
    return z === 'PSM' ? c.CYAN :
           z === 'SIGMA' ? '#a855f7' :
           z === 'SILO' ? c.YELLOW :
           z === 'BARCODE' ? '#ec4899' :
           c.ORANGE;
  }

  // ---- styles ----
  panelStyle() {
    const c = this.C();
    return {
      background: c.BG_PANEL,
      borderLeft: `1px solid ${c.BORDER}`,
      color: c.TEXT,
    };
  }
  headerStyle() {
    const c = this.C();
    return { background: c.BG_BASE, borderColor: c.BORDER };
  }
  filterBtn(active: boolean, color: string) {
    const c = this.C();
    return {
      color: active ? color : c.MUTED,
      border: `1px solid ${active ? color : c.BORDER}`,
      background: active ? `color-mix(in srgb, ${color} 13%, transparent)` : 'transparent',
      padding: '3px 10px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: 'bold',
      cursor: 'pointer',
      letterSpacing: '0.05em',
    };
  }
  selectStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      color: c.TEXT,
      border: `1px solid ${c.BORDER}`,
      borderRadius: '5px',
      padding: '4px 8px',
      fontSize: '12px',
    };
  }
  searchStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      color: c.TEXT,
      border: `1px solid ${c.BORDER}`,
      borderRadius: '5px',
      padding: '4px 10px',
      fontSize: '12px',
      flex: '1',
    };
  }
  tagHeaderStyle(severities: string[]) {
    const c = this.C();
    return {
      background: c.BG_CARD,
      borderTop: `1px solid ${c.BORDER}`,
      borderBottom: `1px solid ${c.BORDER_SOFT}`,
    };
  }
  rowStyle() {
    const c = this.C();
    return { borderTop: `1px solid ${c.BORDER_SOFT}` };
  }
  severityChip(s: Severity) {
    const col = this.severityColor(s);
    return {
      color: col,
      background: `color-mix(in srgb, ${col} 13%, transparent)`,
      border: `1px solid color-mix(in srgb, ${col} 33%, transparent)`,
      padding: '1px 6px',
      borderRadius: '4px',
      fontSize: '10px',
      fontWeight: 'bold',
    };
  }
  zoneChip(z: ZoneType) {
    const col = this.zoneColor(z);
    return {
      color: col,
      background: `color-mix(in srgb, ${col} 11%, transparent)`,
      border: `1px solid color-mix(in srgb, ${col} 27%, transparent)`,
      padding: '1px 6px',
      borderRadius: '4px',
      fontSize: '10px',
      fontWeight: 'bold',
    };
  }

  /** Per-tag severity counts shown in the group header. */
  tagCounts(rows: AlertEntry[]): { c: number; w: number; i: number } {
    let cN = 0, w = 0, i = 0;
    for (const r of rows) {
      if (r.severity === 'CRITICAL') cN++;
      else if (r.severity === 'WARNING') w++;
      else if (r.severity === 'INFO') i++;
    }
    return { c: cN, w, i };
  }
}
