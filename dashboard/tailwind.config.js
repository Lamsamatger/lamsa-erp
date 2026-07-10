/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#eef2f8',
          100: '#d5dfee',
          500: '#2d5096',
          600: '#1e3a6e',
          800: '#152b56',
          900: '#0f1e3c',
          DEFAULT: '#1a2d4a',
        },
        gold: {
          50:  '#fdf8ec',
          100: '#f9eccc',
          400: '#d4a832',
          500: '#c9a24b',
          600: '#b8902f',
          DEFAULT: '#c9a24b',
        },
      },
      fontFamily: {
        tajawal: ['Tajawal', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.04)',
      },
    },
  },
  plugins: [],
}
