# Theme-Toggle Performance Refactor

**Date:** 2026-06-08
**Status:** Design approved; awaiting spec review

## 1. Problem

Switching the dashboard between light and dark mode is visibly laggy. Tracing the cause:

- `ThemeService.colors` is a single Angular `computed<ThemeColors>` signal that returns a 17-field hex-colour object.
- Every dashboard component injects `ThemeService`, holds a `C = themeSvc.colors` reference, and builds inline `[ngStyle]` style objects from `C()` inside style-helper methods (`dropdownStyle()`, `dataOnlyStyle()`, `zoneStyle()`, `statusStyle()`, `dateInputStyle()`, `presetStyle()`, etc.). There are 60+ such methods across the dashboard.
- When the user flips the theme, the `colors` signal re-emits. Every component re-runs change detection. Every style-helper rebuilds a fresh `{ background, color, borderColor, boxShadow, … }` object. Angular re-applies inline styles to several hundred DOM nodes in one pass.

The expensive work is happening in Angular's change-detection cycle and in the browser's "Recalculate Style" phase across a large element count, instead of in the browser's native paint pipeline against a single attribute flip.

## 2. Goals

- Eliminate the perceptible lag on theme toggle. Target: ≤ 16 ms from click to first painted frame in the new theme on a mid-range laptop.
- Keep the public shape of `ThemeService.colors` intact (signal still resolves to a `ThemeColors`-shaped object). Style-helper method **signatures** and template **structure** do not change.
- Add a 250 ms cross-fade transition on theme-affecting properties (`background-color`, `color`, `border-color`, `box-shadow`), gated to fire only during the theme swap so hover/focus interactions stay snappy.

## 3. Non-goals

- No template-structure refactor. The `[ngStyle]` / `[style.*]` callsites are not moved or replaced with CSS classes.
- No replacement of style helpers with CSS classes. That is the path for a later "Full CSS-variable rewrite".
- No change to accent-colour palette (`CYAN`, `GREEN`, `YELLOW`, `ORANGE`, `PINK`, `INDIGO`). They simply become CSS vars like every other token.
- No new theme variants beyond light and dark.

### What does change beyond the "minimal 3 files"

The codebase has ~45 alpha-suffix interpolations of the form `${c.CYAN}44`, `${col}11`, `C().BORDER + 'cc'`, etc., spread across 8 component files. The pattern relies on `c.CYAN` being a 6-digit hex (so concatenating two more hex digits produces an 8-digit hex with alpha). Once `c.CYAN` becomes `'var(--c-cyan)'`, the concatenation produces `'var(--c-cyan)44'` — invalid CSS. Each of those sites converts mechanically to `color-mix(in srgb, var(--c-cyan) <percent>%, transparent)`. The conversion is one regex per alpha level (`44 → 27%`, `11 → 7%`, etc.) — no logic changes, no template restructure.

## 4. Design

### 4.1 CSS variable layer (`frontend/src/styles.css`)

Two new blocks are added at the top of `styles.css` — one on `:root` (the default = light), one on `[data-theme="dark"]`. Every existing field on `ThemeColors` becomes a CSS custom property named `--c-<token>` in `kebab-case`. The hex values are copied verbatim from the current `ThemeService` implementation so nothing visually changes.

```css
:root {
  --c-bg-base:     #F4F3EE;
  --c-bg-panel:    #FFFFFF;
  --c-bg-card:     #FFFFFF;
  --c-bg-row-alt:  #FAFAF8;
  --c-bg-hover:    #F7F6F2;
  --c-border:      #E3E2DC;
  --c-border-soft: #F0EFE9;
  --c-text:        #1C1917;
  --c-muted:       #6B7280;
  --c-header-text: #6B6A64;
  --c-cyan:        #6366F1;
  --c-green:       #059669;
  --c-yellow:      #D97706;
  --c-orange:      #EA580C;
  --c-pink:        #DC2626;
  --c-indigo:      #6366F1;
}

[data-theme="dark"] {
  --c-bg-base:     #080d18;
  --c-bg-panel:    #0d1526;
  --c-bg-card:     #111c33;
  --c-bg-row-alt:  #0f1a2e;
  --c-bg-hover:    #172038;
  --c-border:      #1e2d4a;
  --c-border-soft: #162035;
  --c-text:        #e2e8f0;
  --c-muted:       #64748b;
  --c-header-text: #94a3b8;
  --c-cyan:        #00e5ff;
  --c-green:       #00ff88;
  --c-yellow:      #ffe600;
  --c-orange:      #ff6a00;
  --c-pink:        #ff2d78;
  --c-indigo:      #818cf8;
}
```

Same file also gets the class-gated transition rule (see §4.3).

### 4.2 `ThemeService` rewrite (`frontend/src/app/services/theme.service.ts`)

The public shape of the service does not change. The `colors` signal still returns a `ThemeColors` object. Internally, every colour field becomes a CSS var reference (a literal string) instead of a hex value:

```ts
readonly colors = computed<ThemeColors>(() => {
  const dark = this.settings.theme() === 'dark';
  return {
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
    isDark:      dark,
  };
});
```

Observable behaviour from a component's point of view:

- The signal still re-emits when `settings.theme()` changes (because `isDark` flips).
- Every colour field becomes the **same string** in both themes. Style-helper methods like `zoneStyle()` produce inline-style objects whose string values are identical across themes (because `c.CYAN` is `'var(--c-cyan)'` regardless of theme).
- Angular still runs change detection on every component, but the strings it writes into inline styles are unchanged byte-for-byte. The browser's CSSOM doesn't see a property mutation per element — it just resolves the `var()` against the new attribute value once.
- `isDark` continues to be a real boolean so existing conditional logic that branches on it (e.g. neon glow `boxShadow` only in dark mode) keeps working.

### 4.2.1 Alpha-suffix concat sites

A grep of the codebase finds 45 sites doing `${col}NN` / `C().X + 'NN'` to construct an 8-digit hex with alpha. Distinct suffixes seen across the code: `0a`, `11`, `15`, `18`, `22`, `33`, `44`, `55`, `66`, `88`, `aa`, `cc` — 12 alpha levels.

These sites are mechanically rewritten:

```
`${col}44`        →   `color-mix(in srgb, ${col} 27%, transparent)`
`${c.CYAN}66`     →   `color-mix(in srgb, ${c.CYAN} 40%, transparent)`
C().BORDER + 'cc' →   `color-mix(in srgb, ${C().BORDER} 80%, transparent)`
```

Suffix → percentage mapping (hex byte ÷ 255, rounded):

| Suffix | % | Suffix | % | Suffix | % |
|--------|---|--------|---|--------|---|
| `0a`   | 4 | `22`   | 13 | `66`   | 40 |
| `11`   | 7 | `33`   | 20 | `88`   | 53 |
| `15`   | 8 | `44`   | 27 | `aa`   | 67 |
| `18`   | 9 | `55`   | 33 | `cc`   | 80 |

`color-mix(in srgb, …, transparent)` is supported in every browser the project targets (Chrome 111+, Firefox 113+, Safari 16.2+). The blend happens in the same colour space as 8-digit hex alpha, so the visual output is identical to today's appearance.

Files containing alpha-concat sites (audit results):

- `components/zones/sigma-mixer-zone/sigma-mixer-zone.component.ts`
- `components/zones/zone-tags-table/zone-tags-table.component.ts`
- `components/zones/unified-tags-table/unified-tags-table.component.ts`
- `components/zones/silo-zone/silo-zone.component.ts`
- `components/zones/packaging-zone/packaging-zone.component.ts`
- `components/zones/tag-detail-drawer/tag-detail-drawer.component.html`
- `components/top-navbar/top-navbar.component.ts`
- `components/prediction-drawer/prediction-drawer.component.ts`
- `pages/zones/zones-dashboard.component.ts`

### 4.3 Toggle mechanic + transition

`SettingsService` already owns the `theme()` signal. A new method `applyTheme(value)` is added that performs the DOM-level work, deliberately outside Angular's zone so it never schedules a change-detection cycle:

```ts
applyTheme(value: 'light' | 'dark'): void {
  this.ngZone.runOutsideAngular(() => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', value);
    setTimeout(() => root.classList.remove('theme-switching'), 300);
  });
}
```

An `effect()` (created in the service constructor) calls `applyTheme(this.theme())` whenever the `theme` signal changes. The same effect fires once during construction so the initial paint already matches the saved preference. No separate `APP_INITIALIZER` is needed because the service is `providedIn: 'root'` and is therefore instantiated before the first component renders.

CSS rule (added to `styles.css`):

```css
html.theme-switching,
html.theme-switching * {
  transition: background-color 250ms ease,
              color            250ms ease,
              border-color     250ms ease,
              box-shadow       250ms ease;
}
```

Only paint-only / compositor-friendly properties are listed — explicitly **no** `width`, `height`, `padding`, `margin`, `font-size` — so the transition never triggers layout recalc. Outside the 300 ms switching window the rule does not match anything, so hover/focus/select interactions stay instant.

## 5. Files touched

**Core (3 files):**

| File                                                              | Change                                                                                                | Approx LOC |
|-------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|------------|
| `frontend/src/styles.css`                                         | Add `:root` + `[data-theme="dark"]` var blocks + `theme-switching` transition rule                    | +90        |
| `frontend/src/app/services/theme.service.ts`                      | Colours object becomes `var(--…)` strings; `isDark` remains real boolean                              | ±30        |
| `frontend/src/app/services/settings.service.ts`                   | Inject `NgZone`; add `applyTheme()`; add `effect()` that calls it on `theme()` change and on bootstrap | +20        |

**Alpha-suffix mechanical conversion (8 component files, 45 sites):**

| File                                                                                       | Sites |
|--------------------------------------------------------------------------------------------|-------|
| `pages/zones/zones-dashboard.component.ts`                                                  | 11    |
| `components/zones/unified-tags-table/unified-tags-table.component.ts`                       | 7     |
| `components/prediction-drawer/prediction-drawer.component.ts`                               | 8     |
| `components/zones/sigma-mixer-zone/sigma-mixer-zone.component.ts`                           | 6     |
| `components/zones/zone-tags-table/zone-tags-table.component.ts`                             | 4     |
| `components/zones/packaging-zone/packaging-zone.component.ts`                               | ~3    |
| `components/zones/silo-zone/silo-zone.component.ts`                                         | ~3    |
| `components/zones/tag-detail-drawer/tag-detail-drawer.component.html`                       | 5     |
| `components/top-navbar/top-navbar.component.ts`                                             | 3     |

Each site is a one-line conversion from `${col}NN` to `color-mix(in srgb, ${col} <pct>%, transparent)`. No control-flow changes, no template structure changes.

## 6. Verification

1. **Build clean.** `npx ng build --configuration development` finishes with no type errors.
2. **Visual diff.** Boot the app on `localhost:4200`, compare both themes side by side against the current production. No colour drift on any tile, chip, dropdown, or border. Specifically inspect the alpha-suffixed surfaces: zone chips (`${col}44`/`${col}11`), status chips, deviation gradient, batch-health pill.
3. **Toggle perf.** Open Chrome DevTools → Performance, record a theme toggle. Acceptance criterion: total time from click to fully-painted new theme < 300 ms (250 ms transition + small jitter). No "Recalculate Style" bar > 16 ms.
4. **Interaction snappiness.** With theme stable, hover a few dozen rows in the unified table. Confirm there is no 250 ms colour-fade on hover — the transition fires only during the switching window.
5. **First-paint correctness.** Load the app in light theme, switch to dark, hard-reload. The page must render in dark immediately, with no flash of light theme.

## 7. Risks and mitigations

| Risk                                                                          | Mitigation                                                                                                                                                                                |
|-------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Alpha-suffix interpolations (`${col}44`) produce invalid CSS strings          | All 45 sites identified in §4.2.1 are mechanically rewritten to `color-mix(in srgb, ${col} <pct>%, transparent)`. Suffix → percent mapping is fixed and small (12 entries). |
| `color-mix()` browser support gap                                             | All supported browsers (Chrome 111+, Firefox 113+, Safari 16.2+) ship it. The plant intranet's standardised Chromium meets this. No polyfill needed. |
| `color-mix(in srgb, …, transparent)` produces a different visual result than 8-digit hex alpha | Both compute the final RGBA in the sRGB colour space using the same alpha value (after the suffix → percent conversion). Visual diff in §6 acceptance step catches any drift. |
| Inline boxShadow strings reference colours that are now `var(…)`              | Box-shadow accepts `var()` values; same vars work without change.                                                                                                                          |
| `document` reference inside a service breaks SSR                              | Project does not use SSR (`ng build` is browser-only). Guarded only if SSR is added later.                                                                                                |
| `effect()` calling `applyTheme()` during service construction may fire before document is ready | The service is constructed during bootstrap inside the browser, after `document` exists. No guard needed.                                                                |
| Saved theme preference lost across the swap                                   | `SettingsService.theme` signal continues to be the source of truth; the localStorage write path is unchanged.                                                                              |

## 8. Out of scope (for follow-up specs)

- Replacing all `[ngStyle]` callsites with class-based theming (the "Full CSS-variable rewrite" track).
- Adding `OnPush` change-detection on heavy components.
- A third theme variant (e.g. high-contrast).
- `prefers-color-scheme` auto-follow.
