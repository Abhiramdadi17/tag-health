import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../../../services/theme.service';
import {
  BatchHealth, HealthStatus, StatusBucket, UnifiedTagRow, ZoneType,
  ZoneFilters, EMPTY_ZONE_FILTERS, ZoneFilterEvent,
} from '../../../types/tags';

export interface ZoneOption   { key: ZoneType;    label: string; count: number; }
export interface StatusOption { key: StatusBucket; label: string; count: number; }

type SortKey =
  | 'zone' | 'tag' | 'machineId' | 'batchId' | 'recipe' | 'rm'
  | 'status' | 'sp' | 'pv' | 'dev' | 'health' | 'ts';
type SortDir = 'asc' | 'desc';

interface ColumnSpec {
  label: string;
  key: SortKey | null;
}

const COLUMNS: ColumnSpec[] = [
  { label: 'ZONE',          key: 'zone' },
  { label: 'TAG / ENTITY',  key: 'tag' },
  { label: 'MACHINE',       key: 'machineId' },
  { label: 'BATCH',         key: 'batchId' },
  { label: 'RECIPE',        key: 'recipe' },
  { label: 'RM / NOODLE',   key: 'rm' },
  { label: 'STATUS',        key: 'status' },
  { label: 'SP',            key: 'sp' },
  { label: 'PV',            key: 'pv' },
  { label: 'DEV %',         key: 'dev' },
  { label: 'BATCH HEALTH',  key: 'health' },
  { label: 'LATEST VALUE',  key: null },
  { label: 'TS',            key: 'ts' },
];

@Component({
  selector: 'app-unified-tags-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './unified-tags-table.component.html',
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
  `],
})
export class UnifiedTagsTableComponent {
  private themeSvc = inject(ThemeService);
  C = this.themeSvc.colors;

  rows         = input.required<UnifiedTagRow[]>();
  batchHealth  = input.required<Map<string, BatchHealth>>();
  rowClick     = output<UnifiedTagRow>();

  // Zone / status dropdowns shown in the title bar
  zoneOptions   = input<ZoneOption[]>([]);
  statusOptions = input<StatusOption[]>([]);
  selectedZone  = input<string>('ALL');
  selectedStatus = input<string>('ALL');
  zoneChange   = output<string>();
  statusChange = output<string>();

  // Data-available toggle
  onlyDataAvailable    = input<boolean>(false);
  dataAvailableCount   = input<number>(0);
  dataAvailableChange  = output<boolean>();

  // Date range controls
  dateFrom      = input<string>('');
  dateTo        = input<string>('');
  activePreset  = input<string>('');
  dateHint      = input<string>('');
  dateFromChange = output<string>();
  dateToChange   = output<string>();
  applyPreset    = output<string>();
  clearDate      = output<void>();

  // Zone column filters (rendered inside the sticky header)
  zoneFilters        = input<ZoneFilters>(structuredClone(EMPTY_ZONE_FILTERS));
  psmOpts            = input<Record<string, string[]>>({});
  sigmaOpts          = input<Record<string, string[]>>({});
  siloOpts           = input<Record<string, string[]>>({});
  packagingOpts      = input<Record<string, string[]>>({});
  zoneFiltersOpen    = input<boolean>(false);
  activeFilterCount  = input<number>(0);
  zoneFiltersOpenChange = output<boolean>();
  filterChange          = output<ZoneFilterEvent>();
  resetFilters          = output<void>();

  // Search + status bar (moved into the sticky header)
  filter         = input<string>('');
  loading        = input<boolean>(false);
  error          = input<string | null>(null);
  globalHealth   = input<number>(0);
  filterTextChange = output<string>();
  refresh          = output<void>();

  // Alert log + CSV export hooks
  alertCount       = input<number>(0);
  criticalCount    = input<number>(0);
  openAlertLog     = output<void>();
  exportCsv        = output<void>();

  psmVisible     = computed(() => this.selectedZone() === 'ALL' || this.selectedZone() === 'PSM');
  sigmaVisible   = computed(() => this.selectedZone() === 'ALL' || this.selectedZone() === 'SIGMA');
  siloVisible    = computed(() => this.selectedZone() === 'ALL' || this.selectedZone() === 'SILO');
  pkgVisible     = computed(() => this.selectedZone() === 'ALL' || this.selectedZone() === 'PACKAGING');
  anyZoneVisible = computed(() => this.psmVisible() || this.sigmaVisible() || this.siloVisible() || this.pkgVisible());

  readonly columns = COLUMNS;

  // Default sort: newest first.
  sortKey = signal<SortKey>('ts');
  sortDir = signal<SortDir>('desc');

  sortedRows = computed<UnifiedTagRow[]>(() => {
    const key = this.sortKey();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const bh = this.batchHealth();
    const copy = this.rows().slice();
    copy.sort((a, b) => {
      const diff = this.cmp(key, a, b, bh);
      if (diff !== 0) return diff * dir;
      // Stable secondary: tsUtc desc, then tag asc
      const ts = (b.tsUtc - a.tsUtc);
      if (ts !== 0) return ts;
      return a.tag.localeCompare(b.tag);
    });
    return copy;
  });

  private cmp(key: SortKey, a: UnifiedTagRow, b: UnifiedTagRow, bh: Map<string, BatchHealth>): number {
    switch (key) {
      case 'ts':        return (a.tsUtc - b.tsUtc);
      case 'zone':      return a.zone.localeCompare(b.zone);
      case 'tag':       return a.shortTag.localeCompare(b.shortTag);
      case 'machineId': return a.machineId.localeCompare(b.machineId);
      case 'batchId':   return (a.batchId ?? '').localeCompare(b.batchId ?? '', undefined, { numeric: true });
      case 'recipe':    return (a.recipe ?? '').localeCompare(b.recipe ?? '');
      case 'rm':        return (a.rm ?? '').localeCompare(b.rm ?? '');
      case 'status':    return a.status.localeCompare(b.status);
      case 'sp':        return this.numCmp(a.sp, b.sp);
      case 'pv':        return this.numCmp(a.pv, b.pv);
      case 'dev':       return this.numCmp(a.dev, b.dev);
      case 'health': {
        const ha = bh.get(a.batchKey)?.score ?? -1;
        const hb = bh.get(b.batchKey)?.score ?? -1;
        return ha - hb;
      }
    }
  }

  private numCmp(a: number | undefined, b: number | undefined): number {
    const x = a == null || isNaN(a) ? -Infinity : a;
    const y = b == null || isNaN(b) ? -Infinity : b;
    return x - y;
  }

  toggleSort(key: SortKey | null): void {
    if (!key) return;
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      // Numeric / date columns default to desc, text columns to asc
      const dir: SortDir = ['ts', 'sp', 'pv', 'dev', 'health'].includes(key) ? 'desc' : 'asc';
      this.sortDir.set(dir);
    }
  }

  arrowFor(key: SortKey | null): string {
    if (!key || this.sortKey() !== key) return '';
    return this.sortDir() === 'asc' ? ' ↑' : ' ↓';
  }

  totalCount = computed(() => this.rows().length);
  batchCount = computed(() => this.batchHealth().size);

  healthFor(row: UnifiedTagRow): BatchHealth | undefined {
    return this.batchHealth().get(row.batchKey);
  }

  zoneStyle(zone: ZoneType) {
    const c = this.C();
    const col =
      zone === 'PSM' ? c.CYAN :
      zone === 'SIGMA' ? '#a855f7' :
      zone === 'SILO' ? c.YELLOW :
      zone === 'BARCODE' ? '#ec4899' :
      c.ORANGE;
    return {
      color: col,
      borderColor: `color-mix(in srgb, ${col} 27%, transparent)`,
      background: `color-mix(in srgb, ${col} 7%, transparent)`,
      boxShadow: c.isDark ? `0 0 6px color-mix(in srgb, ${col} 20%, transparent)` : 'none',
    };
  }

  statusStyle(_status: HealthStatus, bucket: StatusBucket) {
    const c = this.C();
    let col = c.GREEN;
    if (bucket === 'CRITICAL') col = c.PINK;
    else if (bucket === 'WARNING') col = c.YELLOW;
    else if (bucket === 'IDLE') col = c.MUTED;
    return {
      color: col,
      borderColor: `color-mix(in srgb, ${col} 27%, transparent)`,
      background: `color-mix(in srgb, ${col} 7%, transparent)`,
      boxShadow: c.isDark ? `0 0 8px color-mix(in srgb, ${col} 20%, transparent)` : 'none',
    };
  }

  devColor(dev: number | undefined): string {
    const c = this.C();
    if (dev == null || isNaN(dev)) return c.MUTED;
    const a = Math.abs(dev);
    return a <= 5 ? c.GREEN : a <= 10 ? c.YELLOW : c.PINK;
  }

  healthColor(score: number | undefined): string {
    const c = this.C();
    if (score == null || isNaN(score)) return c.MUTED;
    if (score >= 95) return c.GREEN;
    if (score >= 80) return c.YELLOW;
    return c.PINK;
  }

  healthStyle(score: number | undefined) {
    const col = this.healthColor(score);
    return {
      color: col,
      borderColor: `color-mix(in srgb, ${col} 27%, transparent)`,
      background: `color-mix(in srgb, ${col} 7%, transparent)`,
    };
  }

  formatNum(v: number | undefined, digits = 3): string {
    if (v == null || isNaN(v)) return '—';
    return v.toFixed(digits);
  }

  // ---- zone filter helpers ----
  zoneSectionStyle(zone: ZoneType) {
    const c = this.C();
    const col = zone === 'PSM' ? c.CYAN : zone === 'SIGMA' ? '#a855f7' : zone === 'SILO' ? c.YELLOW : zone === 'BARCODE' ? '#ec4899' : c.ORANGE;
    return { color: col };
  }

  zoneCardStyle(zone: ZoneType) {
    const c = this.C();
    const col = zone === 'PSM' ? c.CYAN : zone === 'SIGMA' ? '#a855f7' : zone === 'SILO' ? c.YELLOW : zone === 'BARCODE' ? '#ec4899' : c.ORANGE;
    return {
      background: c.BG_BASE,
      border: `1px solid ${c.BORDER}`,
      borderLeft: `3px solid ${col}`,
      borderRadius: '8px',
      flex: '1 1 180px',
      minWidth: '0',
    };
  }

  filterLabelStyle() {
    const c = this.C();
    return { color: c.MUTED, fontSize: '11px', letterSpacing: '0.07em' };
  }

  zoneFilterHeaderStyle() {
    const c = this.C();
    return { borderColor: c.BORDER, background: c.BG_BASE };
  }

  subtypeLabel(v: string): string {
    if (v === 'ALL') return 'All types';
    const map: Record<string, string> = {
      'BATCH': 'Lauric Batch (Dosing)', 'BARCODE': 'Barcode Scan', 'REWORK': 'Rework Weight',
      'noodle_type': 'Noodle Type', 'bagout_detail': 'Bag-out Detail', 'barcode': 'Station Barcode',
      'warehouse_barcode': 'Warehouse Barcode', 'shreeji_barcode': 'Shreeji Barcode',
      'Salt': 'Salt (RM Batch)', 'AOS': 'AOS (RM Batch)', 'Caustic': 'Caustic (RM Batch)',
      'CAUSTIC': 'Caustic (RM Batch)', 'DFA': 'DFA (RM Batch)', 'EDTA': 'EDTA (RM Batch)',
      'EHDP': 'EHDP (RM Batch)', 'EMILY': 'EMILY (RM Batch)', 'GLYCERINE': 'Glycerine (RM Batch)',
      'Water': 'Water (RM Batch)', 'SODIUM SULPHATE': 'Sodium Sulphate (RM Batch)',
      'Batch_PV_Weight': 'Batch Weight (PV)', 'Batch_SP_Weight': 'Batch Weight (SP)',
      'Batch_Counter': 'Batch Counter', 'Noodle_Name': 'Noodle Name',
    };
    return map[v] ?? v;
  }

  opts(bag: Record<string, string[]>, key: string): string[] {
    return bag[key] ?? ['ALL'];
  }

  healthHeroStyle() {
    const c = this.C();
    const score = this.globalHealth();
    const col = score >= 95 ? c.GREEN : score >= 80 ? c.YELLOW : c.PINK;
    return {
      color: col,
      borderColor: `color-mix(in srgb, ${col} 27%, transparent)`,
      background: `color-mix(in srgb, ${col} 7%, transparent)`,
      boxShadow: c.isDark ? `0 0 12px color-mix(in srgb, ${col} 27%, transparent)` : 'none',
    };
  }

  searchStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      color: c.TEXT,
      border: `1px solid ${c.BORDER}`,
      borderRadius: '6px',
      padding: '6px 10px',
      fontSize: '13px',
      flex: '1',
    };
  }

  refreshBtnStyle() {
    const c = this.C();
    return {
      color: c.CYAN,
      border: `1px solid color-mix(in srgb, ${c.CYAN} 40%, transparent)`,
      background: `color-mix(in srgb, ${c.CYAN} 7%, transparent)`,
      padding: '6px 14px',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: 'bold',
      cursor: 'pointer',
    };
  }
  alertBtnStyle() {
    const c = this.C();
    const hot = this.criticalCount() > 0;
    const col = hot ? c.PINK : (this.alertCount() > 0 ? c.YELLOW : c.MUTED);
    return {
      color: col,
      border: `1px solid color-mix(in srgb, ${col} 40%, transparent)`,
      background: `color-mix(in srgb, ${col} 7%, transparent)`,
      padding: '6px 14px',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: 'bold',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
    };
  }
  exportBtnStyle() {
    const c = this.C();
    return {
      color: c.GREEN,
      border: `1px solid color-mix(in srgb, ${c.GREEN} 40%, transparent)`,
      background: `color-mix(in srgb, ${c.GREEN} 7%, transparent)`,
      padding: '6px 14px',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: 'bold',
      cursor: 'pointer',
    };
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

  dateInputStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      color: c.TEXT,
      border: `1px solid ${c.BORDER}`,
      borderRadius: '5px',
      padding: '4px 8px',
      fontSize: '13px',
    };
  }

  presetStyle(preset: string) {
    const c = this.C();
    const active = this.activePreset() === preset;
    return {
      color: active ? c.CYAN : c.MUTED,
      border: `1px solid ${active ? 'color-mix(in srgb, ' + c.CYAN + ' 53%, transparent)' : c.BORDER}`,
      background: active ? 'color-mix(in srgb, ' + c.CYAN + ' 9%, transparent)' : 'transparent',
      padding: '3px 8px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: 'bold',
      cursor: 'pointer',
    };
  }

  dataOnlyStyle() {
    const c = this.C();
    const on = this.onlyDataAvailable();
    return {
      color: on ? c.GREEN : c.MUTED,
      borderColor: on ? 'color-mix(in srgb, ' + c.GREEN + ' 53%, transparent)' : c.BORDER,
      background: on ? 'color-mix(in srgb, ' + c.GREEN + ' 8%, transparent)' : 'transparent',
      border: `1px solid ${on ? 'color-mix(in srgb, ' + c.GREEN + ' 53%, transparent)' : c.BORDER}`,
      borderRadius: '5px',
      padding: '4px 10px',
      fontSize: '13px',
      fontWeight: 'bold',
      cursor: 'pointer',
      userSelect: 'none' as const,
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
    };
  }

  /** Header block — sits OUTSIDE the scroll container (flex-shrink-0),
   *  so it never scrolls horizontally. No position:sticky needed. */
  stickyTitleStyle() {
    const c = this.C();
    return {
      background: c.BG_PANEL,
      borderBottom: `1px solid ${c.BORDER}`,
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    };
  }

  dropdownStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      color: c.TEXT,
      border: `1px solid ${c.BORDER}`,
      borderRadius: '5px',
      padding: '4px 10px',
      fontSize: '13px',
      minWidth: '140px',
    };
  }

  /** Column headers sticky inside the scroll container — stick to top
   *  as the user scrolls the table rows vertically. */
  stickyTheadStyle() {
    const c = this.C();
    return {
      position: 'sticky' as const,
      top: '0px',
      zIndex: 20,
      background: c.BG_BASE,
      boxShadow: `0 1px 0 0 ${c.BORDER}`,
    };
  }
  thStyle(key: SortKey | null) {
    const c = this.C();
    const active = key && this.sortKey() === key;
    return {
      color: active ? c.TEXT : c.CYAN,
      cursor: key ? 'pointer' : 'default',
      userSelect: 'none' as const,
    };
  }
  rowMouseEnter(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.background = this.C().BG_CARD;
  }
  rowMouseLeave(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.background = 'transparent';
  }
}
