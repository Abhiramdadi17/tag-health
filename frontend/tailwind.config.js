/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{html,ts}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Page surfaces
        base:  '#F4F3EE',
        panel: '#FFFFFF',
        card:  '#FFFFFF',
        'row-alt': '#FAFAF8',
        hover:  '#F7F6F2',

        // Borders
        border:      '#E3E2DC',
        'border-soft': '#F0EFE9',

        // Text
        'text-primary':   '#1C1917',
        'text-secondary': '#6B7280',
        'text-muted':     '#9CA3AF',
        'text-header':    '#6B6A64',

        // Accent
        indigo:    '#6366F1',

        // Status chips
        'ok-bg':       '#DCFCE7',
        'ok-text':     '#166534',
        'ok-border':   '#BBF7D0',
        'crit-bg':     '#FEF2F2',
        'crit-text':   '#991B1B',
        'crit-border': '#FECACA',
        'alert-bg':    '#FEF3C7',
        'alert-text':  '#92400E',
        'alert-border':'#FDE68A',

        // Zone badges
        'sigma-bg':   '#EDE9FE',
        'sigma-text': '#5B21B6',
        'psm-bg':     '#FEF3C7',
        'psm-text':   '#92400E',
        'silo-bg':    '#D1FAE5',
        'silo-text':  '#065F46',
        'pkg-bg':     '#FEE2E2',
        'pkg-text':   '#991B1B',

        // DEV%
        'dev-pos':    '#059669',
        'dev-pos-bg': '#F0FDF4',
        'dev-neg':    '#DC2626',
        'dev-neg-bg': '#FEF2F2',

        // Legacy dark (keep for backwards compat)
        surface: {
          DEFAULT: 'rgba(26, 31, 56, 0.8)',
          light: 'rgba(26, 31, 56, 0.6)',
          dark: 'rgba(10, 14, 39, 0.95)',
        },
        risk: {
          low: '#22c55e',
          medium: '#f59e0b',
          high: '#ef4444',
          critical: '#dc2626',
        },
        accent: {
          cyan: '#06b6d4',
          teal: '#14b8a6',
          amber: '#f59e0b',
        },
      },
      fontFamily: {
        sans:    ['Figtree', 'system-ui', 'sans-serif'],
        heading: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
        mono:    ['DM Mono', 'JetBrains Mono', 'monospace'],
        'mono-alt': ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'ui':  ['11px', { lineHeight: '1.4', letterSpacing: '0.04em', fontWeight: '500' }],
        'tag': ['13px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      animation: {
        'live-pulse': 'live-pulse 1.4s ease-in-out infinite',
        'dropdown':   'dropdown-fade 150ms ease both',
        'slide-in':   'slide-in-right 0.28s cubic-bezier(0.32, 0.72, 0, 1) both',
        'pulse-glow': 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink':      'blink 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'live-pulse': {
          '0%':   { boxShadow: '0 0 0 0 rgba(34,197,94,0.6)' },
          '70%':  { boxShadow: '0 0 0 6px rgba(34,197,94,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0)' },
        },
        'dropdown-fade': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.75' },
        },
        'blink': {
          '0%, 49%, 100%': { opacity: '1' },
          '50%, 99%':      { opacity: '0.3' },
        },
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'focus-indigo': '0 0 0 2px rgba(99,102,241,0.15)',
      },
    },
  },
  plugins: [],
}
