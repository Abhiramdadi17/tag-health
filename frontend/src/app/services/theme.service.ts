import { Injectable, computed, inject } from '@angular/core';
import { SettingsService } from './settings.service';

export interface ThemeColors {
  BG_BASE: string;
  BG_PANEL: string;
  BG_CARD: string;
  BG_ROW_ALT: string;
  BG_HOVER: string;
  BORDER: string;
  BORDER_SOFT: string;
  TEXT: string;
  MUTED: string;
  HEADER_TEXT: string;
  CYAN: string;
  GREEN: string;
  YELLOW: string;
  ORANGE: string;
  PINK: string;
  INDIGO: string;
  isDark: boolean;
}

/**
 * Colour fields are CSS-var references rather than literal hex values, so
 * the actual paint swap happens once at the document root when the `dark`
 * class flips on <html> — instead of recomputing every [ngStyle] binding
 * in every component on every theme change.
 *
 * The signal still re-emits when the theme flips (because `isDark` changes),
 * which preserves the dark-only conditional logic that some components rely on
 * (neon glows, boxShadow tweaks, etc.). But the colour-field strings are
 * identical across themes, so Angular's inline-style write is a no-op for the
 * browser — the real swap is the single attribute mutation on <html>.
 */
const VAR_TOKENS: Omit<ThemeColors, 'isDark'> = {
  BG_BASE:     'var(--c-bg-base)',
  BG_PANEL:    'var(--c-bg-panel)',
  BG_CARD:     'var(--c-bg-card)',
  BG_ROW_ALT:  'var(--c-bg-row-alt)',
  BG_HOVER:    'var(--c-bg-hover)',
  BORDER:      'var(--c-border)',
  BORDER_SOFT: 'var(--c-border-soft)',
  TEXT:        'var(--c-text)',
  MUTED:       'var(--c-muted)',
  HEADER_TEXT: 'var(--c-header-text)',
  CYAN:        'var(--c-cyan)',
  GREEN:       'var(--c-green)',
  YELLOW:      'var(--c-yellow)',
  ORANGE:      'var(--c-orange)',
  PINK:        'var(--c-pink)',
  INDIGO:      'var(--c-indigo)',
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private settings = inject(SettingsService);

  readonly colors = computed<ThemeColors>(() => ({
    ...VAR_TOKENS,
    isDark: this.settings.theme() === 'dark',
  }));
}
