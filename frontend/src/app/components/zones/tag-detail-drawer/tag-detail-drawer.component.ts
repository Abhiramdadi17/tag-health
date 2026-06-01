import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../../services/theme.service';
import { BatchHealth, StatusBucket, UnifiedTagRow } from '../../../types/tags';

const BUCKET_ORDER: Record<StatusBucket, number> = { CRITICAL: 0, WARNING: 1, GOOD: 2, IDLE: 3 };

export interface HistoryPoint { tsUtc: number; pv: number; sp?: number; ts: string; dev?: number; }

const CHART_W = 340;
const CHART_H = 90;
const PAD = { t: 8, r: 8, b: 20, l: 38 };

@Component({
  selector: 'app-tag-detail-drawer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tag-detail-drawer.component.html',
})
export class TagDetailDrawerComponent {
  private themeSvc = inject(ThemeService);
  C = this.themeSvc.colors;

  row         = input<UnifiedTagRow | null>(null);
  allRows     = input<UnifiedTagRow[]>([]);
  batchHealth = input<Map<string, BatchHealth>>(new Map());
  closed      = output<void>();

  readonly CHART_W = CHART_W;
  readonly CHART_H = CHART_H;
  readonly PAD = PAD;
  readonly innerW = CHART_W - PAD.l - PAD.r;
  readonly innerH = CHART_H - PAD.t - PAD.b;

  // ---- batch siblings ---------------------------------------------------------
  batchRows = computed<UnifiedTagRow[]>(() => {
    const r = this.row();
    if (!r) return [];
    return this.allRows()
      .filter(x => x.batchKey === r.batchKey && x.dataAvailable)
      .sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || (Math.abs(b.dev ?? 0) - Math.abs(a.dev ?? 0)));
  });

  health = computed<BatchHealth | null>(() => {
    const r = this.row();
    if (!r) return null;
    return this.batchHealth().get(r.batchKey) ?? null;
  });

  // ---- history points ---------------------------------------------------------
  historyPoints = computed<HistoryPoint[]>(() => {
    const r = this.row();
    if (!r) return [];

    if (r.zone === 'PSM') {
      // PSM: use last_10_readings (no timestamps — evenly spaced)
      const readings = r.last10;
      if (!readings?.length) return r.pv != null ? [{ tsUtc: r.tsUtc, pv: r.pv, sp: r.sp, ts: r.ts, dev: r.dev }] : [];
      const sp = r.sp;
      return readings.map((pv, i) => {
        const dev = sp && sp > 0 ? ((pv - sp) / sp) * 100 : undefined;
        return { tsUtc: i, pv, sp, ts: `T-${readings.length - 1 - i}`, dev };
      });
    }

    // SIGMA / SILO / PACKAGING: filter allRows by same tag, sort oldest→newest
    const pts = this.allRows()
      .filter(x => x.tag === r.tag && x.pv != null && x.dataAvailable)
      .sort((a, b) => a.tsUtc - b.tsUtc)
      .map(x => ({ tsUtc: x.tsUtc, pv: x.pv!, sp: x.sp, ts: x.ts, dev: x.dev }));

    // deduplicate by tsUtc, keep last 60 points
    const seen = new Set<number>();
    const deduped: HistoryPoint[] = [];
    for (const p of pts) {
      if (!seen.has(p.tsUtc)) { seen.add(p.tsUtc); deduped.push(p); }
    }
    return deduped.slice(-60);
  });

  // ---- SVG chart computed helpers ---------------------------------------------
  chartMeta = computed(() => {
    const pts = this.historyPoints();
    if (pts.length < 2) return null;

    const pvs = pts.map(p => p.pv);
    const sps = pts.filter(p => p.sp != null).map(p => p.sp!);
    const allVals = [...pvs, ...sps];

    let yMin = Math.min(...allVals);
    let yMax = Math.max(...allVals);
    const pad = (yMax - yMin) * 0.15 || 1;
    yMin -= pad; yMax += pad;

    const xMin = pts[0].tsUtc;
    const xMax = pts[pts.length - 1].tsUtc;
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin;

    const toX = (t: number) => PAD.l + ((t - xMin) / xRange) * (CHART_W - PAD.l - PAD.r);
    const toY = (v: number) => PAD.t + (1 - (v - yMin) / yRange) * (CHART_H - PAD.t - PAD.b);

    const pvPoints = pts.map(p => `${toX(p.tsUtc).toFixed(1)},${toY(p.pv).toFixed(1)}`).join(' ');
    const spPoints = pts.filter(p => p.sp != null)
      .map(p => `${toX(p.tsUtc).toFixed(1)},${toY(p.sp!).toFixed(1)}`).join(' ');

    // Y axis ticks (3 values)
    const yTicks = [
      { val: yMin + yRange * 0.0, y: toY(yMin + yRange * 0.0) },
      { val: yMin + yRange * 0.5, y: toY(yMin + yRange * 0.5) },
      { val: yMin + yRange * 1.0, y: toY(yMin + yRange * 1.0) },
    ];

    // coloured dots for each point
    const dots = pts.map(p => ({
      x: toX(p.tsUtc), y: toY(p.pv), pv: p.pv, sp: p.sp, ts: p.ts, dev: p.dev,
    }));

    return { pvPoints, spPoints, yTicks, dots, yMin, yMax, xMin, xMax };
  });

  dotColor(dev: number | undefined): string {
    const c = this.C();
    if (dev == null || isNaN(dev)) return c.CYAN;
    const a = Math.abs(dev);
    return a <= 5 ? c.GREEN : a <= 10 ? c.YELLOW : c.PINK;
  }

  // ---- SVG donut helpers ------------------------------------------------------
  readonly RADIUS = 52;
  readonly CX = 64;
  readonly CY = 64;
  readonly STROKE = 10;

  circumference = 2 * Math.PI * this.RADIUS;

  donutOffset = computed(() => {
    const h = this.health();
    const score = h ? h.score : 0;
    return this.circumference * (1 - score / 100);
  });

  donutColor = computed(() => {
    const h = this.health();
    const score = h ? h.score : 0;
    const c = this.C();
    return score >= 95 ? c.GREEN : score >= 75 ? c.YELLOW : c.PINK;
  });

  // ---- deviation gauge helpers ------------------------------------------------
  readonly DEV_RANGE = 25;

  devMarkerPct = computed(() => {
    const dev = this.row()?.dev;
    if (dev == null || isNaN(dev)) return 50;
    const clamped = Math.max(-this.DEV_RANGE, Math.min(this.DEV_RANGE, dev));
    return ((clamped + this.DEV_RANGE) / (2 * this.DEV_RANGE)) * 100;
  });

  devLabel = computed(() => {
    const dev = this.row()?.dev;
    if (dev == null || isNaN(dev)) return '—';
    return (dev > 0 ? '+' : '') + dev.toFixed(2) + '%';
  });

  devColor = computed(() => {
    const dev = this.row()?.dev;
    const c = this.C();
    if (dev == null || isNaN(dev)) return c.MUTED;
    const a = Math.abs(dev);
    return a <= 5 ? c.GREEN : a <= 10 ? c.YELLOW : c.PINK;
  });

  // ---- mini-bar per sibling row -----------------------------------------------
  siblingBarLeft(dev: number | undefined): string {
    if (dev == null || isNaN(dev) || dev >= 0) return '50%';
    const pct = Math.min(Math.abs(dev) / this.DEV_RANGE * 50, 50);
    return (50 - pct) + '%';
  }

  siblingBarWidth(dev: number | undefined): string {
    if (dev == null || isNaN(dev)) return '0';
    const pct = Math.min(Math.abs(dev) / this.DEV_RANGE * 50, 50);
    return pct + '%';
  }

  siblingDevColor(dev: number | undefined): string {
    const c = this.C();
    if (dev == null || isNaN(dev)) return c.MUTED;
    const a = Math.abs(dev);
    return a <= 5 ? c.GREEN : a <= 10 ? c.YELLOW : c.PINK;
  }

  bucketColor(bucket: StatusBucket): string {
    const c = this.C();
    return bucket === 'GOOD' ? c.GREEN : bucket === 'WARNING' ? c.YELLOW : bucket === 'CRITICAL' ? c.PINK : c.MUTED;
  }

  zoneColor = computed(() => {
    const c = this.C();
    const z = this.row()?.zone;
    return z === 'PSM' ? c.CYAN : z === 'SIGMA' ? '#a855f7' : z === 'SILO' ? c.YELLOW : c.ORANGE;
  });

  statusColor = computed(() => {
    const c = this.C();
    const b = this.row()?.bucket;
    return b === 'GOOD' ? c.GREEN : b === 'WARNING' ? c.YELLOW : b === 'CRITICAL' ? c.PINK : c.MUTED;
  });

  formatNum(v: number | undefined, d = 2): string {
    if (v == null || isNaN(v)) return '—';
    return v.toFixed(d);
  }

  formatTick(v: number): string { return v.toFixed(1); }

  midIndex(len: number): number { return Math.floor(len / 2); }
}
