import { Injectable, computed, inject } from '@angular/core';
import { SettingsService } from './settings.service';

export interface ThemeColors {
  BG_BASE: string;
  BG_PANEL: string;
  BG_CARD: string;
  BORDER: string;
  TEXT: string;
  MUTED: string;
  CYAN: string;
  GREEN: string;
  YELLOW: string;
  ORANGE: string;
  PINK: string;
  isDark: boolean;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private settings = inject(SettingsService);

  readonly colors = computed<ThemeColors>(() => {
    const dark = this.settings.theme() === 'dark';
    return {
      BG_BASE:  dark ? '#080d18' : '#f8fafc',
      BG_PANEL: dark ? '#0d1526' : '#ffffff',
      BG_CARD:  dark ? '#111c33' : '#f1f5f9',
      BORDER:   dark ? '#1e2d4a' : '#e2e8f0',
      TEXT:     dark ? '#e2e8f0' : '#0f172a',
      MUTED:    dark ? '#64748b' : '#64748b',
      CYAN:     dark ? '#00e5ff' : '#0284c7',
      GREEN:    dark ? '#00ff88' : '#16a34a',
      YELLOW:   dark ? '#ffe600' : '#d97706',
      ORANGE:   dark ? '#ff6a00' : '#ea580c',
      PINK:     dark ? '#ff2d78' : '#dc2626',
      isDark:   dark,
    };
  });
}
