import type { Config } from "tailwindcss";
import { colors } from "./lib/design/colors";
import { fontFamily, fontSize } from "./lib/design/typography";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors,
      fontFamily,
      fontSize,
      borderRadius: {
        "4xl": "2rem",
      },
      animation: {
        "fade-in": "fadeIn 0.25s ease-in-out",
        "slide-up": "slideUp 0.35s ease-out both",
        "pulse-ring": "pulseRing 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "sweep": "sweep 2.2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.85)", opacity: "0.7" },
          "70%": { transform: "scale(2.1)", opacity: "0" },
          "100%": { transform: "scale(2.1)", opacity: "0" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
