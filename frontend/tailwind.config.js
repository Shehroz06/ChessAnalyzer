/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: {
          light: '#f0d9b5',
          dark: '#b58863',
        },
        classification: {
          brilliant: '#1bada6',
          best: '#00a67e',
          excellent: '#96bc4b',
          good: '#96bc4b',
          inaccuracy: '#f0c15f',
          mistake: '#e08030',
          blunder: '#ca3431',
        },
      },
    },
  },
  plugins: [],
};
