/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Primary — mapped to the runtime CSS vars so every `bg-primary-*` /
        // `text-primary-*` / `border-primary-*` utility follows the active theme
        // (light, dark, and any Appearance preset) instead of a baked-in amber.
        // Defaults live in global.css :root / html.dark; the Appearance manager
        // overrides them via <style id="bsx-theme-vars">. NOTE: opacity
        // modifiers (e.g. bg-primary-600/50) don't work on var() colors — use an
        // inline color-mix() there instead.
        primary: {
          50:  "var(--color-primary-50)",
          100: "var(--color-primary-100)",
          200: "var(--color-primary-200)",
          300: "var(--color-primary-300)",
          400: "var(--color-primary-400)",
          500: "var(--color-primary-500)",
          600: "var(--color-primary-600)",
          700: "var(--color-primary-700)",
          800: "var(--color-primary-800)",
          900: "var(--color-primary-900)",
          950: "var(--color-primary-900)",
          DEFAULT: "var(--color-primary)",
        },
        // Accent — the theme defines a single --color-accent; map every stop to
        // it so `*-accent-*` utilities stay theme-driven.
        accent: {
          50:  "var(--color-accent)",
          100: "var(--color-accent)",
          200: "var(--color-accent)",
          300: "var(--color-accent)",
          400: "var(--color-accent)",
          500: "var(--color-accent)",
          600: "var(--color-accent)",
          700: "var(--color-accent)",
          800: "var(--color-accent)",
          900: "var(--color-accent)",
          DEFAULT: "var(--color-accent)",
        },
        // Cream/Neutral — theme-driven (only 200/400/500 are defined as vars).
        cream: {
          50:  "var(--color-cream-200)",
          100: "var(--color-cream-200)",
          200: "var(--color-cream-200)",
          300: "var(--color-cream-400)",
          400: "var(--color-cream-400)",
          500: "var(--color-cream-500)",
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
        // Error Colors
        error: {
          50: "#FEF2F2",
          100: "#FEE2E2",
          200: "#FECACA",
          300: "#FCA5A5",
          400: "#F87171",
          500: "#EF4444",
          600: "#DC2626",
          700: "#B91C1C",
          800: "#991B1B",
          900: "#7F1D1D",
        },
        // Success Colors
        success: {
          50: "#F0FDF4",
          100: "#DCFCE7",
          200: "#BBF7D0",
          300: "#86EFAC",
          400: "#4ADE80",
          500: "#22C55E",
          600: "#16A34A",
          700: "#15803D",
          800: "#166534",
          900: "#145231",
        },
        // Warning Colors
        warning: {
          50: "#FFFBEB",
          100: "#FEF3C7",
          200: "#FDE68A",
          300: "#FCD34D",
          400: "#FBBF24",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
          800: "#92400E",
          900: "#78350F",
        },
        // Info Colors
        info: {
          50: "#F0F9FF",
          100: "#E0F2FE",
          200: "#BAE6FD",
          300: "#7DD3FC",
          400: "#38BDF8",
          500: "#0EA5E9",
          600: "#0284C7",
          700: "#0369A1",
          800: "#075985",
          900: "#0C4A6E",
        },
      },
      backgroundImage: {
        // Theme-driven gradients — follow --gradient-* from the active theme.
        "gradient-warm": "var(--gradient-warm)",
        "gradient-sidebar": "var(--gradient-sidebar)",
        "gradient-warm-dark": "var(--gradient-warm)",
        "gradient-sidebar-dark": "var(--gradient-sidebar)",
      },
      backgroundColor: {
        light: "#F5EDE4",
        dark: "#0a0a0a",
      },
      textColor: {
        light: "#241C11",
        dark: "#fafafa",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        sm: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
        md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
        xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
        elevated: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
      },
      spacing: {
        xs: "0.25rem",
        sm: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
        "2xl": "2rem",
        "3xl": "3rem",
        "4xl": "4rem",
      },
      borderRadius: {
        xs: "0.125rem",
        sm: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        full: "9999px",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "Oxygen",
          "Ubuntu",
          "Cantarell",
          '"Fira Sans"',
          '"Droid Sans"',
          '"Helvetica Neue"',
          "sans-serif",
        ],
        serif: ["Merriweather", "Georgia", "serif"],
        mono: ["Fira Code", "Courier New", "monospace"],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.25" }],
        sm: ["0.875rem", { lineHeight: "1.5" }],
        base: ["1rem", { lineHeight: "1.5" }],
        lg: ["1.125rem", { lineHeight: "1.5" }],
        xl: ["1.25rem", { lineHeight: "1.5" }],
        "2xl": ["1.5rem", { lineHeight: "1.25" }],
        "3xl": ["1.875rem", { lineHeight: "1.15" }],
        "4xl": ["2.25rem", { lineHeight: "1.1" }],
        "5xl": ["3rem", { lineHeight: "1" }],
      },
      fontWeight: {
        light: "300",
        normal: "400",
        medium: "500",
        semibold: "600",
        bold: "700",
      },
      lineHeight: {
        tight: "1.25",
        normal: "1.5",
        relaxed: "1.75",
        loose: "2",
      },
      letterSpacing: {
        tight: "-0.02em",
        normal: "0",
        wide: "0.02em",
      },
      transitionDuration: {
        fast: "150ms",
        normal: "300ms",
        slow: "500ms",
      },
      transitionTimingFunction: {
        linear: "linear",
        "ease-in": "cubic-bezier(0.4, 0, 1, 1)",
        "ease-out": "cubic-bezier(0, 0, 0.2, 1)",
        "ease-in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      animation: {
        "fadeIn": "fadeIn 300ms ease-out",
        "fadeOut": "fadeOut 300ms ease-in",
        "slideUp": "slideInUp 300ms ease-out",
        "slideDown": "slideOutDown 300ms ease-in",
        "scaleIn": "scaleIn 300ms ease-out",
        "pulse-slow": "pulse 2s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeOut: {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        slideInUp: {
          "0%": { transform: "translateY(1rem)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideOutDown: {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(1rem)", opacity: "0" },
        },
        slideInLeft: {
          "0%": { transform: "translateX(-1rem)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        slideOutRight: {
          "0%": { transform: "translateX(0)", opacity: "1" },
          "100%": { transform: "translateX(1rem)", opacity: "0" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        scaleOut: {
          "0%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(0.95)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

