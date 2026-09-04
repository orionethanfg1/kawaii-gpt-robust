/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        kawaii: {
          pink: '#FF9ECD',
          'pink-soft': '#FFE4F1',
          'pink-deep': '#FF6B9D',
          purple: '#C9B1FF',
          'purple-soft': '#F0E6FF',
          blue: '#A6E3FF',
          'blue-soft': '#E8F7FF',
          mint: '#B8F2E6',
          cream: '#FFF8F0',
          peach: '#FFD6C9',
          text: '#5A4A6A',
          'text-muted': '#9B8AA8',
          border: '#F0D4E4',
          surface: '#FFFFFF',
          'surface-alt': '#FFF5FA'
        }
      },
      fontFamily: {
        nunito: ['Nunito', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        kawaii: '0 4px 20px -4px rgba(255, 158, 205, 0.25)',
        'kawaii-lg': '0 8px 30px -6px rgba(255, 158, 205, 0.3)'
      },
      borderRadius: {
        kawaii: '1.25rem',
        'kawaii-lg': '1.75rem'
      }
    }
  },
  plugins: []
}
