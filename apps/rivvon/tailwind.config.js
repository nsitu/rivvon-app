/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index-vue.html",
    "./src-vue/**/*.{vue,js,mjs,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'roboto': ['Roboto', 'sans-serif'],
        'cascadia': ['Cascadia Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
