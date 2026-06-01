import { Injectable, signal, effect } from '@angular/core';
import { DashboardSettings } from '../types';

const STORAGE_KEY = 'dashboard-settings';

const defaultSettings: DashboardSettings = {
  theme: 'dark',
  updateFrequency: 5,
  chartType: 'recharts',
  replayMode: false,
  showAdvancedMetrics: true,
  autoRefresh: true,
};

function loadSettings(): DashboardSettings {
  if (typeof localStorage === 'undefined') return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...(parsed?.state ?? parsed) };
  } catch {
    return defaultSettings;
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<DashboardSettings>(loadSettings());

  readonly theme = () => this.settings().theme;
  readonly updateFrequency = () => this.settings().updateFrequency;
  readonly chartType = () => this.settings().chartType;
  readonly autoRefresh = () => this.settings().autoRefresh;
  readonly showAdvancedMetrics = () => this.settings().showAdvancedMetrics;
  readonly replayMode = () => this.settings().replayMode;

  constructor() {
    effect(() => {
      const value = this.settings();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: value, version: 0 }));
      } catch {
        /* ignore */
      }
    });
  }

  toggleTheme(): void {
    this.settings.update(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }));
  }

  setUpdateFrequency(freq: number): void {
    this.settings.update(s => ({ ...s, updateFrequency: Math.max(1, Math.min(60, freq)) }));
  }

  setChartType(type: 'recharts' | 'plotly'): void {
    this.settings.update(s => ({ ...s, chartType: type }));
  }

  setReplayMode(mode: boolean): void {
    this.settings.update(s => ({ ...s, replayMode: mode }));
  }

  setShowAdvancedMetrics(show: boolean): void {
    this.settings.update(s => ({ ...s, showAdvancedMetrics: show }));
  }

  setAutoRefresh(enabled: boolean): void {
    this.settings.update(s => ({ ...s, autoRefresh: enabled }));
  }

  resetDefaults(): void {
    this.settings.set({ ...defaultSettings });
  }
}
