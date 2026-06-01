import { Injectable } from '@angular/core';
import { TagRecord, PredictionResult, HealthCheckResponse } from '../types';

const API = 'http://localhost:5050';

@Injectable({ providedIn: 'root' })
export class TagService {
  async fetchTags(): Promise<TagRecord[]> {
    try {
      const resp = await fetch(`${API}/tags`, { signal: AbortSignal.timeout(60000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.error('Failed to fetch tags:', e);
      throw new Error('Cannot reach server. Start forecasting_api.py first.');
    }
  }

  async fetchHealth(): Promise<HealthCheckResponse> {
    try {
      const resp = await fetch(`${API}/health`, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.error('Failed to fetch health:', e);
      throw new Error('Server health check failed');
    }
  }

  async predict(tag: TagRecord, batchPosPct: number = 50.0): Promise<PredictionResult> {
    const payload = {
      entity_id: tag.synthetic_id,
      timestamp: tag.batch_start_ts || new Date().toISOString(),
      last_10_readings: tag.last_10_readings,
      features: {
        current_sp: tag.current_sp,
        current_pv: tag.current_pv,
        shift: tag.shift,
        batch_position_pct: batchPosPct,
      },
    };

    console.log('[PREDICT] Sending request for', tag.synthetic_id);

    try {
      const resp = await fetch(`${API}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        const errorText = await resp.text();
        console.error('[PREDICT] Error response:', errorText);
        throw new Error(`HTTP ${resp.status}: ${errorText}`);
      }
      const result = await resp.json();
      console.log('[PREDICT] Success:', result);
      return result;
    } catch (e) {
      console.error('[PREDICT] Request failed:', e);
      throw e;
    }
  }
}
