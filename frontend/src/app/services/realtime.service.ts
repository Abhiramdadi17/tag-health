import { Injectable, signal } from '@angular/core';

interface RealtimeState {
  isStreaming: boolean;
  latencyMs: number;
  gpuLoad: number;
  cpuLoad: number;
  alertCount: number;
  averageConfidence: number;
  updateCount: number;
}

const initial: RealtimeState = {
  isStreaming: true,
  latencyMs: 0,
  gpuLoad: 0,
  cpuLoad: 0,
  alertCount: 0,
  averageConfidence: 0.92,
  updateCount: 0,
};

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  readonly state = signal<RealtimeState>({ ...initial });

  readonly isStreaming = () => this.state().isStreaming;
  readonly latencyMs = () => this.state().latencyMs;
  readonly alertCount = () => this.state().alertCount;
  readonly gpuLoad = () => this.state().gpuLoad;

  setStreaming(streaming: boolean): void {
    this.state.update(s => ({ ...s, isStreaming: streaming }));
  }

  updateMetrics(metrics: Partial<RealtimeState>): void {
    this.state.update(s => ({ ...s, ...metrics, updateCount: s.updateCount + 1 }));
  }

  reset(): void {
    this.state.set({ ...initial });
  }
}
