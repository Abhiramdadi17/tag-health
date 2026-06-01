import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';
import { PredictionResult, TagRecord } from '../../types';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-prediction-drawer',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './prediction-drawer.component.html',
})
export class PredictionDrawerComponent {
  private themeSvc = inject(ThemeService);

  tag = input.required<TagRecord>();
  prediction = input<PredictionResult | undefined>(undefined);
  closed = output<void>();

  readonly XIcon = X;
  readonly Math = Math;
  C = this.themeSvc.colors;

  readings = computed(() => this.tag().last_10_readings ?? []);
  minVal = computed(() => this.readings().length ? Math.min(...this.readings()) : 0);
  maxVal = computed(() => this.readings().length ? Math.max(...this.readings()) : 1);
  mean = computed(() => {
    const r = this.readings();
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
  });
  range = computed(() => (this.maxVal() - this.minVal()) || 1);
  slope = computed(() => {
    const r = this.readings();
    return r.length >= 2 ? (r[r.length - 1] - r[0]) / (r.length - 1) : 0;
  });
  variance = computed(() => {
    const r = this.readings();
    const m = this.mean();
    return r.length ? r.reduce((s, x) => s + Math.pow(x - m, 2), 0) / r.length : 0;
  });
  volatility = computed(() => Math.sqrt(this.variance()));

  spikeWindows = ['5m', '10m', '15m'] as const;

  precursors = computed(() => this.prediction()?.top_precursors ?? []);
  temporalAttentionEntries = computed(() => {
    const ta = this.prediction()?.temporal_attention;
    return ta ? Object.entries(ta) : [];
  });
  modelVersionEntries = computed(() => {
    const mv = this.prediction()?.model_versions;
    return mv ? Object.entries(mv) : [];
  });

  getRiskColor(rc: string): string {
    const c = this.C();
    if (rc === 'low') return c.GREEN;
    if (rc === 'medium') return c.YELLOW;
    if (rc === 'high') return c.ORANGE;
    if (rc === 'critical') return c.PINK;
    return c.MUTED;
  }

  getRiskDesc(rc: string): string {
    if (rc === 'low') return 'Should stay stable. No major changes expected.';
    if (rc === 'medium') return 'Expect slight drift within normal parameters.';
    if (rc === 'high') return 'Attention needed — significant drift predicted.';
    if (rc === 'critical') return 'Critical risk — immediate intervention may be needed.';
    return 'Risk assessment pending.';
  }

  statusColor(s: string): string {
    const c = this.C();
    if (s === 'OK') return c.GREEN;
    if (s === 'ALERT') return c.YELLOW;
    if (s === 'WARNING') return c.ORANGE;
    if (s === 'SEVERE' || s === 'CRITICAL') return c.PINK;
    return c.MUTED;
  }

  devColor(d: number): string {
    const c = this.C();
    const a = Math.abs(d);
    if (a < 5) return c.GREEN;
    if (a < 10) return c.YELLOW;
    if (a < 15) return c.ORANGE;
    return c.PINK;
  }

  predictedDevColor(d: number): string {
    const c = this.C();
    if (d > 3) return c.ORANGE;
    if (d < -3) return c.CYAN;
    return c.GREEN;
  }

  probabilityColor(pct: number): string {
    const c = this.C();
    if (pct > 70) return c.PINK;
    if (pct > 40) return c.ORANGE;
    return c.GREEN;
  }

  headerStyle() {
    const c = this.C();
    return { background: c.BG_PANEL, borderColor: c.BORDER };
  }
  cardStyle() {
    const c = this.C();
    return { background: c.BG_CARD, border: `1px solid ${c.BORDER}`, borderRadius: '8px', padding: '10px' };
  }
  hrStyle() {
    return { borderTop: `1px solid ${this.C().BORDER}`, margin: '18px 0' };
  }
  sectionTitleStyle() {
    const c = this.C();
    return {
      fontSize: '10px',
      fontWeight: '700',
      letterSpacing: '0.1em',
      color: c.CYAN,
      textShadow: c.isDark ? `0 0 6px ${c.CYAN}66` : 'none',
      marginBottom: '10px',
    };
  }

  rightNowDotStyle() {
    const c = this.C();
    const col = this.statusColor(this.tag().health_status);
    return {
      background: col,
      boxShadow: c.isDark ? `0 0 6px ${col}` : 'none',
    };
  }

  forecastBoxStyle() {
    const pred = this.prediction();
    if (!pred) return {};
    const col = this.getRiskColor(pred.risk_class);
    return {
      background: `${col}0a`,
      borderColor: `${col}44`,
    };
  }

  riskPillStyle() {
    const pred = this.prediction();
    if (!pred) return {};
    const col = this.getRiskColor(pred.risk_class);
    return {
      color: col,
      borderColor: `${col}44`,
      background: `${col}11`,
    };
  }

  spikeBoxStyle(prob: number) {
    const c = this.C();
    const pct = prob * 100;
    const col = this.probabilityColor(pct);
    return {
      background: `${col}0a`,
      borderColor: `${col}44`,
      _col: col,
      _pct: pct,
    };
  }

  spikeFillStyle(pct: number, col: string) {
    return { width: `${Math.max(pct, 1)}%`, background: col };
  }

  spikeBatchBarStyle(pct: number, col: string) {
    const c = this.C();
    return {
      width: `${Math.max(pct, 1)}%`,
      background: col,
      boxShadow: c.isDark ? `0 0 6px ${col}88` : 'none',
    };
  }

  precursorTrendColor(trend: string): string {
    const c = this.C();
    return trend === '↑' ? c.ORANGE : c.CYAN;
  }

  readingBarHeight(r: number): string {
    const h = ((r - this.minVal()) / this.range()) * 100;
    return `${Math.max(h, 5)}%`;
  }

  readingBarBg(r: number): string {
    const c = this.C();
    return r > 0 ? c.ORANGE : c.CYAN;
  }

  attentionFillStyle(weight: number) {
    const c = this.C();
    return {
      width: `${Math.round(weight * 100)}%`,
      background: c.CYAN,
      opacity: 0.8,
    };
  }

  pct(v: number): number {
    return v * 100;
  }

  onClose(): void {
    this.closed.emit();
  }

  setHoverCyan(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.color = this.C().CYAN;
  }
  setHoverMuted(ev: MouseEvent): void {
    (ev.currentTarget as HTMLElement).style.color = this.C().MUTED;
  }

  syntheticIdStyle() {
    return { color: `${this.C().CYAN}88` };
  }

  leadTimeFootnote(): string {
    const pred = this.prediction();
    if (!pred?.spike_probability) return '';
    const inBatch = pred.spike_probability.in_batch ?? 0;
    if (pred.lead_time_minutes >= 30 && inBatch > 0.5) {
      return ' — spike expected later in batch, not imminent';
    }
    return '';
  }

  predictionTimestamp(): string {
    const ts = this.prediction()?.timestamp;
    return ts ? new Date(ts).toLocaleString() : '';
  }
}
