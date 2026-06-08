import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../../services/theme.service';
import { ZoneAggregatorService } from '../../services/zone-aggregator.service';
import { AlertLogService } from '../../services/alert-log.service';
import { UnifiedTagsTableComponent, ZoneOption, StatusOption } from '../../components/zones/unified-tags-table/unified-tags-table.component';
import { TagDetailDrawerComponent } from '../../components/zones/tag-detail-drawer/tag-detail-drawer.component';
import { AlertLogDrawerComponent } from '../../components/zones/alert-log-drawer/alert-log-drawer.component';
import {
  StatusBucket, UnifiedTagRow, ZoneType,
  ZoneFilters, EMPTY_ZONE_FILTERS, ZoneFilterEvent,
} from '../../types/tags';

const ZONE_OPTIONS: { key: ZoneType; label: string }[] = [
  { key: 'PSM', label: 'PSM' },
  { key: 'SIGMA', label: 'Sigma Mixers' },
  { key: 'SILO', label: 'Silos' },
  { key: 'BARCODE', label: 'Barcodes' },
  { key: 'PACKAGING', label: 'Packaging' },
];

const STATUS_OPTIONS: { key: StatusBucket; label: string }[] = [
  { key: 'GOOD', label: 'Good' },
  { key: 'WARNING', label: 'Warning' },
  { key: 'CRITICAL', label: 'Critical' },
  { key: 'IDLE', label: 'Idle' },
];

@Component({
  selector: 'app-zones-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, UnifiedTagsTableComponent, TagDetailDrawerComponent, AlertLogDrawerComponent],
  templateUrl: './zones-dashboard.component.html',
})
export class ZonesDashboardComponent implements OnInit {
  private themeSvc = inject(ThemeService);
  private aggregator = inject(ZoneAggregatorService);
  private alertLog = inject(AlertLogService);

  C = this.themeSvc.colors;

  alertCounts = this.alertLog.counts;
  alertLogOpen = signal<boolean>(false);

  readonly zoneOptions = ZONE_OPTIONS;
  readonly statusOptions = STATUS_OPTIONS;

  selectedZone   = signal<ZoneType | 'ALL'>('ALL');
  selectedStatus = signal<StatusBucket | 'ALL'>('ALL');
  filter = signal<string>('');
  /** When true, only rows with dataAvailable=true are visible. */
  onlyDataAvailable = signal<boolean>(true);
  zoneFilters = signal<ZoneFilters>(structuredClone(EMPTY_ZONE_FILTERS));
  /** Date range in yyyy-MM-dd; empty string = unbounded. */
  dateFrom = signal<string>('');
  dateTo = signal<string>('');

  selectedRow = signal<UnifiedTagRow | null>(null);
  zoneFiltersOpen = signal<boolean>(false);

  loading = this.aggregator.loading;
  error = this.aggregator.error;

  allRows = signal<UnifiedTagRow[]>([]);

  // ---- per-zone option lists (derived from loaded data) -------------------
  psmOptions = computed(() => this.buildOptions('PSM', r => ({
    recipe: r.recipe, rm: r.rm, plant: r.machineId, subtype: r.subtype,
  })));
  sigmaOptions = computed(() => this.buildOptions('SIGMA', r => ({
    mixer: r.batchKey.split(':')[1], recipe: r.recipe, subtype: r.subtype,
  })));
  siloOptions = computed(() => this.buildOptions('SILO', r => ({
    subtype: r.subtype,
    station: r.batchKey.includes(':Stn_') ? r.batchKey.split(':')[1] : undefined,
    noodle: r.rm,
  })));
  packagingOptions = computed(() => this.buildOptions('PACKAGING', r => ({
    cascade: r.batchKey.split(':')[1],
    wrapper: r.subtype,
  })));

  private buildOptions<K extends string>(
    zone: ZoneType,
    extract: (r: UnifiedTagRow) => Record<K, string | undefined>,
  ): Record<K, string[]> {
    const sets = new Map<string, Set<string>>();
    for (const r of this.allRows()) {
      if (r.zone !== zone) continue;
      const fields = extract(r);
      for (const [k, v] of Object.entries(fields)) {
        if (!v) continue;
        const s = String(v);
        if (!s) continue;
        if (!sets.has(k)) sets.set(k, new Set());
        sets.get(k)!.add(s);
      }
    }
    const out: any = {};
    for (const [k, set] of sets) {
      out[k] = ['ALL', ...Array.from(set).sort()];
    }
    return out;
  }

  filteredRows = computed<UnifiedTagRow[]>(() => {
    const zone   = this.selectedZone();
    const status = this.selectedStatus();
    const q = this.filter().toLowerCase().trim();
    const onlyData = this.onlyDataAvailable();
    const zf = this.zoneFilters();
    const fromMs = this.parseDateStart(this.dateFrom());
    const toMs   = this.parseDateEnd(this.dateTo());

    return this.allRows().filter(r => {
      if (zone   !== 'ALL' && r.zone   !== zone)   return false;
      if (status !== 'ALL' && r.bucket !== status) return false;
      if (onlyData && !r.dataAvailable) return false;
      // Date range (only enforced when a tsUtc was parseable; PSM rows with empty
      // batch_start_ts get tsUtc=0 and are excluded only when both bounds are set).
      if (fromMs > 0 && (r.tsUtc === 0 || r.tsUtc < fromMs)) return false;
      if (toMs   > 0 && (r.tsUtc === 0 || r.tsUtc > toMs)) return false;
      if (q) {
        const hay = `${r.tag} ${r.machineId} ${r.recipe ?? ''} ${r.rm ?? ''} ${r.batchId ?? ''} ${r.latestValue}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // Per-zone column filters
      if (r.zone === 'PSM') {
        if (zf.psm.plant !== 'ALL' && r.machineId !== zf.psm.plant) return false;
        if (zf.psm.recipe !== 'ALL' && r.recipe !== zf.psm.recipe) return false;
        if (zf.psm.rm !== 'ALL' && r.rm !== zf.psm.rm) return false;
        if (zf.psm.subtype !== 'ALL' && r.subtype !== zf.psm.subtype) return false;
      } else if (r.zone === 'SIGMA') {
        const mixer = r.batchKey.split(':')[1];
        if (zf.sigma.mixer !== 'ALL' && mixer !== zf.sigma.mixer) return false;
        if (zf.sigma.recipe !== 'ALL' && r.recipe !== zf.sigma.recipe) return false;
        if (zf.sigma.subtype !== 'ALL' && r.subtype !== zf.sigma.subtype) return false;
      } else if (r.zone === 'SILO') {
        const station = r.batchKey.includes(':Stn_') ? r.batchKey.split(':')[1] : '';
        if (zf.silo.subtype !== 'ALL' && r.subtype !== zf.silo.subtype) return false;
        if (zf.silo.station !== 'ALL' && station !== zf.silo.station) return false;
        if (zf.silo.noodle !== 'ALL' && r.rm !== zf.silo.noodle) return false;
      } else if (r.zone === 'PACKAGING') {
        const cascade = r.batchKey.split(':')[1];
        if (zf.packaging.cascade !== 'ALL' && cascade !== zf.packaging.cascade) return false;
        if (zf.packaging.wrapper !== 'ALL' && r.subtype !== zf.packaging.wrapper) return false;
      }
      return true;
    });
  });

  batchHealth = computed(() => ZoneAggregatorService.computeBatchHealth(this.filteredRows()));

  countsByZone = computed(() => {
    const acc: Record<ZoneType, number> = { PSM: 0, SIGMA: 0, SILO: 0, BARCODE: 0, PACKAGING: 0 };
    for (const r of this.allRows()) acc[r.zone] += 1;
    return acc;
  });

  countsByStatus = computed(() => {
    const acc: Record<StatusBucket, number> = { GOOD: 0, WARNING: 0, CRITICAL: 0, IDLE: 0 };
    for (const r of this.allRows()) acc[r.bucket] += 1;
    return acc;
  });

  zoneOptionsList = computed<ZoneOption[]>(() => {
    const counts = this.countsByZone();
    return ZONE_OPTIONS.map(z => ({ key: z.key, label: z.label, count: counts[z.key] }));
  });

  statusOptionsList = computed<StatusOption[]>(() => {
    const counts = this.countsByStatus();
    return STATUS_OPTIONS.map(s => ({ key: s.key, label: s.label, count: counts[s.key] }));
  });

  dataAvailableCount = computed(() => this.allRows().filter(r => r.dataAvailable).length);

  activePreset = computed<string>(() => {
    const from = this.dateFrom();
    const to   = this.dateTo();
    const span = this.dataDateSpan();
    if (!from && !to) return 'all';
    if (!span.max) return '';
    const toStr = this.fmtDate(new Date(span.max));
    if (from === toStr && to === toStr) return 'today';
    for (const [preset, days] of [['24h', 1], ['7d', 7], ['30d', 30]] as [string, number][]) {
      if (from === this.fmtDate(new Date(span.max - days * 86_400_000)) && to === toStr) return preset;
    }
    return '';
  });

  /** Min/max timestamps across loaded rows (epoch ms, 0 if none). */
  dataDateSpan = computed(() => {
    let min = Number.POSITIVE_INFINITY, max = 0;
    for (const r of this.allRows()) {
      if (!r.tsUtc) continue;
      if (r.tsUtc < min) min = r.tsUtc;
      if (r.tsUtc > max) max = r.tsUtc;
    }
    return { min: isFinite(min) ? min : 0, max };
  });

  globalHealthScore = computed(() => {
    const rows = this.filteredRows().filter(r => r.dataAvailable);
    if (rows.length === 0) return 0;
    const passing = rows.filter(r => r.passing).length;
    return (passing / rows.length) * 100;
  });

  isZoneOn(zone: ZoneType): boolean {
    const z = this.selectedZone();
    return z === 'ALL' || z === zone;
  }
  isStatusOn(status: StatusBucket): boolean {
    const s = this.selectedStatus();
    return s === 'ALL' || s === status;
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const rows = await this.aggregator.loadAll(true);
    this.allRows.set(rows);
  }

  setZone(value: string): void {
    this.selectedZone.set(value as ZoneType | 'ALL');
  }

  setStatus(value: string): void {
    this.selectedStatus.set(value as StatusBucket | 'ALL');
  }

  handleFilterChange(ev: ZoneFilterEvent): void {
    const next = structuredClone(this.zoneFilters());
    (next[ev.zone] as any)[ev.key] = ev.value;
    this.zoneFilters.set(next);
  }

  setZoneFilter<Z extends keyof ZoneFilters, K extends keyof ZoneFilters[Z]>(
    zone: Z, key: K, value: string,
  ): void {
    const next = structuredClone(this.zoneFilters());
    (next[zone] as any)[key] = value;
    this.zoneFilters.set(next);
  }

  resetZoneFilters(): void {
    this.zoneFilters.set(structuredClone(EMPTY_ZONE_FILTERS));
  }

  // ---- Date range helpers ------------------------------------------------
  parseDateStart(s: string): number {
    if (!s) return 0;
    const t = Date.parse(`${s}T00:00:00`);
    return isNaN(t) ? 0 : t;
  }
  parseDateEnd(s: string): number {
    if (!s) return 0;
    const t = Date.parse(`${s}T23:59:59.999`);
    return isNaN(t) ? 0 : t;
  }
  clearDateRange(): void {
    this.dateFrom.set('');
    this.dateTo.set('');
  }
  /** Quick preset: 'today' | '24h' | '7d' | '30d' | 'all'. Anchored on the
   *  newest timestamp present in the loaded data, so a preset works even on
   *  historical workbooks that don't include 'now'. */
  applyDatePreset(preset: string): void {
    if (preset !== 'today' && preset !== '24h' && preset !== '7d' && preset !== '30d' && preset !== 'all') return;
    if (preset === 'all') { this.clearDateRange(); return; }
    const span = this.dataDateSpan();
    if (!span.max) return;
    const anchor = new Date(span.max);
    const toStr = this.fmtDate(anchor);
    if (preset === 'today') {
      this.dateFrom.set(toStr);
      this.dateTo.set(toStr);
      return;
    }
    const days = preset === '24h' ? 1 : preset === '7d' ? 7 : 30;
    const from = new Date(span.max - days * 86_400_000);
    this.dateFrom.set(this.fmtDate(from));
    this.dateTo.set(toStr);
  }
  fmtDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  formatRangeHint(): string {
    const span = this.dataDateSpan();
    if (!span.max) return '';
    return `${this.fmtDate(new Date(span.min))} → ${this.fmtDate(new Date(span.max))}`;
  }

  // ---- style helpers ----
  zonePillStyle(zone: ZoneType) {
    const c = this.C();
    const col = zone === 'PSM' ? c.CYAN : zone === 'SIGMA' ? '#a855f7' : zone === 'SILO' ? c.YELLOW : c.ORANGE;
    const active = this.isZoneOn(zone);
    return {
      color: active ? col : c.MUTED,
      borderColor: active ? `color-mix(in srgb, ${col} 53%, transparent)` : c.BORDER,
      background: active ? `color-mix(in srgb, ${col} 8%, transparent)` : 'transparent',
      boxShadow: active && c.isDark ? `0 0 8px color-mix(in srgb, ${col} 20%, transparent)` : 'none',
    };
  }

  statusPillStyle(status: StatusBucket) {
    const c = this.C();
    const col = status === 'GOOD' ? c.GREEN : status === 'WARNING' ? c.YELLOW : status === 'CRITICAL' ? c.PINK : c.MUTED;
    const active = this.isStatusOn(status);
    return {
      color: active ? col : c.MUTED,
      borderColor: active ? `color-mix(in srgb, ${col} 53%, transparent)` : c.BORDER,
      background: active ? `color-mix(in srgb, ${col} 8%, transparent)` : 'transparent',
      boxShadow: active && c.isDark ? `0 0 8px color-mix(in srgb, ${col} 20%, transparent)` : 'none',
    };
  }

  filterBarStyle() {
    const c = this.C();
    return { background: c.BG_PANEL, borderColor: c.BORDER };
  }

  inputStyle() {
    const c = this.C();
    return {
      background: c.BG_CARD,
      color: c.TEXT,
      border: `1px solid ${c.BORDER}`,
      borderRadius: '6px',
      padding: '6px 10px',
      fontSize: '13px',
    };
  }

  searchStyle() { return { ...this.inputStyle(), flex: '1' }; }

  selectStyle() {
    return { ...this.inputStyle(), padding: '4px 8px', fontSize: '12px' };
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
    };
  }

  resetBtnStyle() {
    const c = this.C();
    return {
      color: c.MUTED,
      border: `1px solid ${c.BORDER}`,
      background: 'transparent',
      padding: '4px 10px',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: 'bold',
    };
  }

  presetBtnStyle(preset: string) {
    const c = this.C();
    const from = this.dateFrom();
    const to = this.dateTo();
    const span = this.dataDateSpan();
    let active = false;
    if (preset === 'all' && !from && !to) active = true;
    else if (preset === 'today' && span.max) {
      const d = this.fmtDate(new Date(span.max));
      active = from === d && to === d;
    } else if (preset !== 'all' && span.max && from) {
      const days = preset === '24h' ? 1 : preset === '7d' ? 7 : 30;
      active = from === this.fmtDate(new Date(span.max - days * 86_400_000)) && to === this.fmtDate(new Date(span.max));
    }
    return {
      color: active ? c.CYAN : c.MUTED,
      border: `1px solid ${active ? 'color-mix(in srgb, ' + c.CYAN + ' 53%, transparent)' : c.BORDER}`,
      background: active ? 'color-mix(in srgb, ' + c.CYAN + ' 9%, transparent)' : 'transparent',
      padding: '3px 8px',
      borderRadius: '5px',
      fontSize: '11px',
      fontWeight: 'bold',
    };
  }

  healthHeroStyle() {
    const c = this.C();
    const score = this.globalHealthScore();
    const col = score >= 95 ? c.GREEN : score >= 80 ? c.YELLOW : c.PINK;
    return {
      color: col,
      borderColor: `color-mix(in srgb, ${col} 27%, transparent)`,
      background: `color-mix(in srgb, ${col} 7%, transparent)`,
      boxShadow: c.isDark ? `0 0 12px color-mix(in srgb, ${col} 27%, transparent)` : 'none',
    };
  }

  zoneSectionStyle(zone: ZoneType) {
    const c = this.C();
    const col = zone === 'PSM' ? c.CYAN : zone === 'SIGMA' ? '#a855f7' : zone === 'SILO' ? c.YELLOW : c.ORANGE;
    return { color: col };
  }

  zoneCardStyle(zone: ZoneType) {
    const c = this.C();
    const col = zone === 'PSM' ? c.CYAN : zone === 'SIGMA' ? '#a855f7' : zone === 'SILO' ? c.YELLOW : c.ORANGE;
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
    return { color: c.MUTED, fontSize: '9px', letterSpacing: '0.07em' };
  }

  zoneFilterHeaderStyle() {
    const c = this.C();
    return { borderColor: c.BORDER, background: c.BG_BASE };
  }

  activeFilterCount = computed(() => {
    const zf = this.zoneFilters();
    let n = 0;
    for (const zone of [zf.psm, zf.sigma, zf.silo, zf.packaging] as any[]) {
      for (const v of Object.values(zone)) if (v !== 'ALL') n++;
    }
    return n;
  });

  /** Human-readable label for subtype values used across all zones. */
  subtypeLabel(v: string): string {
    if (v === 'ALL') return 'All types';
    const map: Record<string, string> = {
      // SIGMA
      'BATCH':             'Lauric Batch (Dosing)',
      'BARCODE':           'Barcode Scan',
      'REWORK':            'Rework Weight',
      // SILO
      'noodle_type':       'Noodle Type',
      'bagout_detail':     'Bag-out Detail',
      'barcode':           'Station Barcode',
      'warehouse_barcode': 'Warehouse Barcode',
      'shreeji_barcode':   'Shreeji Barcode',
      // PSM (RM-based subtypes — all case variants present in live data)
      'Salt':             'Salt (RM Batch)',
      'AOS':              'AOS (RM Batch)',
      'Caustic':          'Caustic (RM Batch)',
      'CAUSTIC':          'Caustic (RM Batch)',
      'DFA':              'DFA (RM Batch)',
      'EDTA':             'EDTA (RM Batch)',
      'EHDP':             'EHDP (RM Batch)',
      'EMILY':            'EMILY (RM Batch)',
      'GLYCERINE':        'Glycerine (RM Batch)',
      'Water':            'Water (RM Batch)',
      'SODIUM SULPHATE':  'Sodium Sulphate (RM Batch)',
      // PSM (structural tag types parsed from synthetic_id)
      'Batch_PV_Weight': 'Batch Weight (PV)',
      'Batch_SP_Weight': 'Batch Weight (SP)',
      'Batch_Counter':   'Batch Counter',
      'Noodle_Name':     'Noodle Name',
    };
    return map[v] ?? v;
  }

  // ─── CSV export of the currently filtered view ────────────────────────
  exportCsv(): void {
    const rows = this.filteredRows();
    const bh = this.batchHealth();
    const headers = [
      'Zone', 'Tag', 'Machine', 'Batch', 'Recipe', 'RM / Noodle',
      'Status', 'SP', 'PV', 'Dev %', 'Batch Health %', 'Latest Value', 'Timestamp',
    ];

    const esc = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmt = (n: number | undefined, digits = 3): string =>
      n == null || isNaN(n) ? '' : n.toFixed(digits);

    const lines: string[] = [headers.join(',')];
    for (const r of rows) {
      const h = bh.get(r.batchKey);
      lines.push([
        esc(r.zone),
        esc(r.shortTag),
        esc(r.machineId),
        esc(r.batchId ?? ''),
        esc(r.recipe ?? ''),
        esc(r.rm ?? ''),
        esc(r.status),
        fmt(r.sp, 3),
        fmt(r.pv, 3),
        r.dev == null ? '' : r.dev.toFixed(2),
        h ? h.score.toFixed(0) : '',
        esc(r.latestValue),
        esc(r.ts),
      ].join(','));
    }

    const csv = lines.join('\n');
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
    const filename = `tag-monitor-${stamp}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
