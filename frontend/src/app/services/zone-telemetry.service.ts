import { Injectable, inject, signal } from '@angular/core';
import { RawTagRow } from '../types/tags';
import { TagStateService } from './tag-state.service';

const API = 'http://localhost:5050';

interface ZoneResponse {
  zone: string;
  count: number;
  rows: Array<RawTagRow & { TimestampUtc: string }>;
}

/**
 * Polls the .NET backend for the latest telemetry from each zone workbook and
 * pushes every row through TagStateService. The first poll fetches a small
 * recent window so the UI has something to display; subsequent polls request
 * only rows newer than the most recent timestamp we have for that zone.
 */
@Injectable({ providedIn: 'root' })
export class ZoneTelemetryPollerService {
  private state = inject(TagStateService);

  private cursors: Record<string, string | null> = {
    sigma: null,
    silo: null,
    packaging: null,
  };

  readonly status = signal<'idle' | 'loading' | 'streaming' | 'error'>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly lastUpdate = signal<Date | null>(null);
  readonly counts = signal<Record<string, number>>({ sigma: 0, silo: 0, packaging: 0 });

  private timerHandle: any = null;

  start(intervalMs = 5000): void {
    if (this.timerHandle != null) return;
    this.status.set('loading');
    // Kick off an initial fetch immediately, then poll on interval.
    void this.tick(800);
    this.timerHandle = setInterval(() => this.tick(200), intervalMs);
  }

  stop(): void {
    if (this.timerHandle != null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private async tick(limitPerZone: number): Promise<void> {
    try {
      const results = await Promise.all([
        this.fetchZone('sigma', limitPerZone),
        this.fetchZone('silo', limitPerZone),
        this.fetchZone('packaging', limitPerZone),
      ]);
      for (const res of results) {
        if (!res) continue;
        // Rows arrive newest-first; replay oldest-first so monotonic-TS rules
        // see them in chronological order.
        const ordered = [...res.rows].reverse();
        for (const r of ordered) {
          this.state.updateFromRow(r);
          if (r.TimestampUtc) this.cursors[res.zone] = r.TimestampUtc;
        }
        this.counts.update(c => ({ ...c, [res.zone]: (c[res.zone] ?? 0) + res.rows.length }));
      }
      this.status.set('streaming');
      this.errorMessage.set(null);
      this.lastUpdate.set(new Date());
    } catch (e: any) {
      this.status.set('error');
      this.errorMessage.set(e?.message ?? 'telemetry fetch failed');
    }
  }

  private async fetchZone(zone: string, limit: number): Promise<ZoneResponse | null> {
    const params = new URLSearchParams({ zone, limit: String(limit) });
    const since = this.cursors[zone];
    if (since) params.set('since', since);
    const url = `${API}/zones/telemetry?${params.toString()}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${zone}`);
    return (await resp.json()) as ZoneResponse;
  }
}
