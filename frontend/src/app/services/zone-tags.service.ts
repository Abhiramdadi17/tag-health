import { Injectable, inject, signal } from '@angular/core';
import { TagParserService } from './tag-parser.service';
import { ParsedTagValue, RawTagRow } from '../types/tags';

const API = 'http://localhost:5050';

/** Server response shape from GET /zones/tags?zone=X (one entry per unique tag) */
export interface ZoneTagDto {
  Tag: string;
  MachineId: string;
  LatestValue: string;
  LatestTs: string;
  LatestTsUtc: string;
  SampleCount: number;
}

/** Server response shape from GET /zones/telemetry?zone=X (recent telemetry rows) */
export interface ZoneTelemetryDto extends RawTagRow {
  TimestampUtc: string;
}

/** Frontend-enriched recent-row record: server row + parsed value. */
export interface ZoneRecentRow {
  Tag: string;
  MachineId: string;
  Value: string;
  TS: string;
  TimestampUtc: string;
  parsed: ParsedTagValue;
}

/** Frontend-enriched per-tag summary row: server data + parsed latest value. */
export interface ZoneTagRow extends ZoneTagDto {
  parsed: ParsedTagValue;
}

export type ZoneKey = 'sigma' | 'silo' | 'packaging' | 'psm_telemetry';

/**
 * Fetches zone telemetry from the .NET backend. Two modes:
 *
 *   fetchRecent(zone, limit)  → most recent N rows from the Excel workbook
 *                               (≈hundreds, every row is a real telemetry sample
 *                               and most parsed columns are populated).
 *
 *   fetchTags(zone)           → one-row-per-unique-tag summary (≈16–18 rows).
 *                               Useful for an overview.
 */
@Injectable({ providedIn: 'root' })
export class ZoneTagsService {
  private parser = inject(TagParserService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private recentCache = new Map<ZoneKey, ZoneRecentRow[]>();
  private summaryCache = new Map<ZoneKey, ZoneTagRow[]>();

  async fetchRecent(zone: ZoneKey, limit = 2000, force = false): Promise<ZoneRecentRow[]> {
    if (!force && this.recentCache.has(zone)) return this.recentCache.get(zone)!;
    this.loading.set(true);
    this.error.set(null);
    try {
      const resp = await fetch(`${API}/zones/telemetry?zone=${zone}&limit=${limit}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { zone: string; count: number; rows: ZoneTelemetryDto[] };
      const rows = data.rows.map(dto => this.enrichRecent(dto));
      this.recentCache.set(zone, rows);
      return rows;
    } catch (e: any) {
      this.error.set(e?.message ?? 'failed to load zone telemetry');
      return [];
    } finally {
      this.loading.set(false);
    }
  }

  async fetchTags(zone: ZoneKey, force = false): Promise<ZoneTagRow[]> {
    if (!force && this.summaryCache.has(zone)) return this.summaryCache.get(zone)!;
    this.loading.set(true);
    this.error.set(null);
    try {
      const resp = await fetch(`${API}/zones/tags?zone=${zone}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { zone: string; count: number; tags: ZoneTagDto[] };
      const rows = data.tags.map(dto => this.enrichSummary(dto));
      this.summaryCache.set(zone, rows);
      return rows;
    } catch (e: any) {
      this.error.set(e?.message ?? 'failed to load zone tags');
      return [];
    } finally {
      this.loading.set(false);
    }
  }

  private enrichRecent(dto: ZoneTelemetryDto): ZoneRecentRow {
    return {
      Tag: dto.Tag,
      MachineId: dto.MachineId,
      Value: String(dto.Value ?? ''),
      TS: dto.TS,
      TimestampUtc: dto.TimestampUtc,
      parsed: this.parser.parseTagValue(dto),
    };
  }

  private enrichSummary(dto: ZoneTagDto): ZoneTagRow {
    const fakeRow: RawTagRow = {
      IotDeviceId: 'uaq-lakme-hul-iotedge-01',
      SensorId: 'opcua',
      SiteId: 'LLPL',
      MachineId: dto.MachineId,
      Tag: dto.Tag,
      Value: dto.LatestValue,
      TS: dto.LatestTs,
    };
    return { ...dto, parsed: this.parser.parseTagValue(fakeRow) };
  }
}
