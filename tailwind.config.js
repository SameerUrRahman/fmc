/** @type {import('tailwindcss').Config} */
const { heroui } = require("@heroui/react");
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  darkMode: "class",

  plugins: [heroui(
    {
      themes: {
        dark: {
          colors: {
            // navy scale with real steps between surfaces so cards,
            // inputs and page background don't melt together
            background: "#080b16",
            content1: "#111527",
            content2: "#1a2038",
            content3: "#242c4a",
            content4: "#2f3a5e",
            default: {
              50: "#111527",
              100: "#1a2038",
              200: "#242c4a",
              300: "#2f3a5e",
              400: "#4a5680",
              500: "#7a86ab",
              600: "#a5aec9",
              700: "#c8cede",
              800: "#e2e5ee",
              900: "#f4f5f9",
            },
            focus: "#4f7cff",
            primary: { DEFAULT: "#4f7cff", foreground: "#ffffff" },
          },
        },
      },
    }
  )],
};
