/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvasbg: '#F5F7FB',
        ink: { DEFAULT: '#17233C', 700: '#2B3A57', 500: '#5B6784', 300: '#9AA4BA', 200: '#CBD2E0', 100: '#E4E8F1', 50: '#EEF1F8' },
        brand: { DEFAULT: '#4263EB', dark: '#3451C7', soft: '#EDF0FF' },
        teal: { DEFAULT: '#14B8A6', soft: '#E3F8F5' },
      },
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(23,35,60,.05), 0 4px 16px rgba(23,35,60,.06)', pop: '0 8px 30px rgba(23,35,60,.16)' },
    },
  },
  plugins: [],
};
