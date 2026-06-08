import { Injectable, NgZone, inject, signal, effect } from '@angular/core';
import { DashboardSettings } from '../types';

const STORAGE_KEY = 'dashboard-settings';

const defaultSettings: DashboardSettings = {
  theme: 'light',
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

/** Apply/remove the `dark` class on <html> immediately. */
function applyThemeClass(theme: 'dark' | 'light'): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private ngZone = inject(NgZone);

  readonly settings = signal<DashboardSettings>(loadSettings());

  readonly theme = () => this.settings().theme;
  readonly updateFrequency = () => this.settings().updateFrequency;
  readonly chartType = () => this.settings().chartType;
  readonly autoRefresh = () => this.settings().autoRefresh;
  readonly showAdvancedMetrics = () => this.settings().showAdvancedMetrics;
  readonly replayMode = () => this.settings().replayMode;

  constructor() {
    // Apply the correct theme class on startup (before transitions are enabled).
    // Flip outside Angular's zone — it's a pure DOM mutation that has nothing
    // to do with Angular's change-detection cycle, so we don't want it to
    // trigger one.
    this.ngZone.runOutsideAngular(() => {
      applyThemeClass(this.settings().theme);

      // After a short delay, add `.theme-ready` so CSS transitions kick in only
      // for *user-initiated* toggling — not the initial page render.
      if (typeof document !== 'undefined') {
        setTimeout(() => {
          document.documentElement.classList.add('theme-ready');
        }, 300);
      }
    });

    // Keep <html>.dark in sync whenever the signal changes. The effect itself
    // runs inside Angular (we need to *read* the signal), but the DOM write
    // is pushed outside the zone so the class flip doesn't schedule another
    // change-detection pass.
    effect(() => {
      const theme = this.settings().theme;
      this.ngZone.runOutsideAngular(() => applyThemeClass(theme));
    });

    // Persist to localStorage
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
