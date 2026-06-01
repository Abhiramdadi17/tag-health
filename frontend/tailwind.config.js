/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{html,ts}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
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
      backgroundColor: {
        glass: 'rgba(26, 31, 56, 0.6)',
        'glass-dark': 'rgba(10, 14, 39, 0.95)',
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.5)',
        'glow-amber': '0 0 20px rgba(245, 158, 11, 0.5)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.5)',
        'glow-green': '0 0 20px rgba(34, 197, 94, 0.5)',
        'inset-cyan': 'inset 0 0 20px rgba(6, 182, 212, 0.2)',
        glass: '0 8px 32px rgba(0, 0, 0, 0.3)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 3s ease-in-out infinite',
        'bounce-subtle': 'bounce-subtle 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'live-pulse': 'live-pulse 1.4s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 15px rgba(34, 197, 94, 0.3)' },
          '50%': { opacity: '0.8', boxShadow: '0 0 30px rgba(34, 197, 94, 0.6)' },
        },
        'blink': {
          '0%, 49%, 100%': { opacity: '1' },
          '50%, 99%': { opacity: '0.3' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'live-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(0, 255, 136, 0.73)' },
          '100%': { boxShadow: '0 0 0 7px rgba(0, 255, 136, 0)' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
