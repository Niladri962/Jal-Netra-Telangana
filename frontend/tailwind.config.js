/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#050d1f', 900: '#0a1630', 850: '#0d1c3b', 800: '#112449', 700: '#1a3263', 600: '#264580' },
        water: { 500: '#1e88e5', 400: '#42a5f5', 300: '#7cc4fa' },
        teal: { 500: '#14b8a6', 400: '#2dd4bf' },
        ok: '#22c55e', warn: '#f59e0b', crit: '#ef4444', idle: '#64748b',
      },
      fontFamily: { sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
