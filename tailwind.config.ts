import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)', ink: 'var(--ink)', mute: 'var(--mute)', line: 'var(--line)',
        panel: 'var(--panel)', sunk: 'var(--sunk)', silver: 'var(--silver)', lime: 'var(--lime)', 'lime-ink': 'var(--lime-ink)', accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Cascadia Mono', 'Consolas', 'monospace'],
      },
    },
  },
} satisfies Config;
