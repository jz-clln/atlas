import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#000000",
        charcoal: "#66666e",
        slate: "#9999a1",
        mist: "#e6e6e9",
        cloud: "#f4f4f6",
      },
      fontFamily: {
        display: ["Inter", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      keyframes: {
        "atlas-breathe": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.035)" },
        },
        "atlas-fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "atlas-search-bounce": {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "50%": { transform: "translateY(-12px) rotate(-2.5deg)" },
        },
        "atlas-dot-pulse": {
          "0%, 80%, 100%": { opacity: "0.2" },
          "40%": { opacity: "1" },
        },
      },
      animation: {
        "atlas-breathe": "atlas-breathe 4.5s ease-in-out infinite",
        "atlas-fade-up": "atlas-fade-up 0.7s ease-out both",
        "atlas-search-bounce": "atlas-search-bounce 2.6s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate",
        "atlas-dot-pulse": "atlas-dot-pulse 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;