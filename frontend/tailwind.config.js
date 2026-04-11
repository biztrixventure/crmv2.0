/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Primary Colors - Warm Amber/Brown (Light) to Black Matte (Dark)
        primary: {
          50: "#F5EDE4",
          100: "#E8D9C8",
          200: "#D4C0A5",
          300: "#C0A682",
          400: "#A88A62",
          500: "#8B7049",
          600: "#6E5838",
          700: "#524228",
          800: "#3A2E1C",
          900: "#241C11",
          950: "#000000",
        },
        // Accent Colors - Warm Amber (Light Mode only)
        accent: {
          50: "#F7ECD8",
          100: "#EED9B3",
          200: "#E0C18A",
          300: "#D2A861",
          400: "#C49038",
          500: "#A67720",
          600: "#865F19",
          700: "#674812",
          800: "#4A330C",
          900: "#2E2007",
        },
        // Cream/Neutral Colors
        cream: {
          50: "#F8F3EB",
          100: "#F0E6D8",
          200: "#E4D4BE",
          300: "#D4BE9E",
          400: "#C4A77E",
          500: "#A8885C",
        },
        // Dark Mode Grays
        dark: {
          50: "#fafafa",
          100: "#f5f5f5",
          200: "#e5e5e5",
          300: "#d4d4d4",
          400: "#a3a3a3",
          500: "#737373",
          600: "#525252",
          700: "#262626",
          800: "#171717",
          900: "#0a0a0a",
        },
      },
      backgroundImage: {
        // Light Mode Gradients
        "gradient-warm": "linear-gradient(135deg, #E4D4BE 0%, #D4BE9E 50%, #C4A77E 100%)",
        "gradient-sidebar": "linear-gradient(180deg, #A8885C 0%, #C4A77E 100%)",
        // Dark Mode Gradients
        "gradient-warm-dark": "linear-gradient(135deg, #171717 0%, #0a0a0a 50%, #000000 100%)",
        "gradient-sidebar-dark": "linear-gradient(180deg, #262626 0%, #171717 100%)",
      },
      backgroundColor: {
        light: "#F5EDE4",
        dark: "#0a0a0a",
      },
      textColor: {
        light: "#241C11",
        dark: "#fafafa",
      },
    },
  },
  plugins: [],
};

