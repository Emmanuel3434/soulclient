/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0c0c0c",
          panel: "#111111",
          card: "#161616",
          hover: "#1f1f1f",
        },
        accent: {
          DEFAULT: "#d4d4d4",
          soft: "#f0f0f0",
        },
        border: "#242424",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
