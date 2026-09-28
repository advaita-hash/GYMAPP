/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#0d0d0d',
        surface: '#1a1a19',
        raised: '#242423',
        line: 'rgba(255,255,255,0.10)',
        ink: '#ffffff',
        sub: '#c3c2b7',
        faint: '#898781',
        accent: '#a3e635',
        'accent-deep': '#65a30d',
        good: '#0ca30c',
        warn: '#fab219',
        bad: '#d03b3b',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
