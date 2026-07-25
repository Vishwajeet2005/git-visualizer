import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "Cascadia Code",
          "ui-monospace",
          "monospace",
        ],
      },
      colors: {
        // Surface palette
        surface: {
          base:    "#0a0a0f",
          raised:  "#0d0d15",
          overlay: "#12121e",
          float:   "#16162a",
        },
        // Accent palette
        accent: {
          purple: {
            DEFAULT: "#7c3aed",
            light:   "#a78bfa",
            dark:    "#5b21b6",
          },
          blue: {
            DEFAULT: "#2563eb",
            light:   "#60a5fa",
          },
          amber: {
            DEFAULT: "#d97706",
            light:   "#fbbf24",
          },
          green: {
            DEFAULT: "#16a34a",
            light:   "#34d399",
          },
          red: {
            DEFAULT: "#dc2626",
            light:   "#f87171",
          },
        },
        // Neutral overrides for dark-first design
        neutral: {
          50:  "#fafafa",
          100: "#f5f5f5",
          200: "#e5e5e5",
          300: "#d4d4d4",
          400: "#a3a3a3",
          500: "#737373",
          600: "#525252",
          700: "#404040",
          800: "#262626",
          900: "#171717",
          950: "#0a0a0a",
        },
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        sm:  "0.375rem",
        md:  "0.75rem",
        lg:  "1rem",
        xl:  "1.25rem",
        "2xl": "1.5rem",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "gradient-shine":
          "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.07) 50%, transparent 60%)",
      },
      keyframes: {
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0"  },
        },
        "fade-in": {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)"   },
        },
        "scale-in": {
          "0%":   { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)"    },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0" },
        },
        "spin-slow": {
          "0%":   { transform: "rotate(0deg)"   },
          "100%": { transform: "rotate(360deg)" },
        },
        glow: {
          "0%, 100%": { opacity: "0.4" },
          "50%":      { opacity: "0.8" },
        },
      },
      animation: {
        shimmer:   "shimmer 2s linear infinite",
        "fade-in": "fade-in 0.4s ease-out both",
        "scale-in":"scale-in 0.3s ease-out both",
        blink:     "blink 1s step-end infinite",
        "spin-slow": "spin-slow 8s linear infinite",
        glow:      "glow 3s ease-in-out infinite",
      },
      boxShadow: {
        glow:      "0 0 20px rgba(124, 58, 237, 0.3)",
        "glow-blue": "0 0 20px rgba(37, 99, 235, 0.3)",
        "inner-glow": "inset 0 1px 0 rgba(255,255,255,0.06)",
      },
      // Fine-grained opacity steps for borders and overlays
      opacity: {
        "2":  "0.02",
        "4":  "0.04",
        "6":  "0.06",
        "8":  "0.08",
        "15": "0.15",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "in-expo":  "cubic-bezier(0.7, 0, 0.84, 0)",
      },
    },
  },
  plugins: [],
};

export default config;
