import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#F8F9FB",
          card: "#FFFFFF",
          hover: "#F0F2F5",
          border: "#E2E6EB",
          elevated: "#FFFFFF",
        },
        approved: "#22c55e",
        blocked: "#ef4444",
        pending: "#eab308",
        brand: {
          50: "#e6f0ff",
          100: "#b3d1ff",
          400: "#3d8bfd",
          500: "#0066FF",
          600: "#0047FF",
          700: "#0033cc",
          900: "#001a66",
        },
        accent: {
          DEFAULT: "#00D4AA",
          light: "#33DFBB",
          dark: "#00A888",
        },
      },
      fontFamily: {
        display: ['"DM Sans"', "system-ui", "sans-serif"],
        body: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        glow: {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0, 102, 255, 0.15)" },
          "50%": { boxShadow: "0 0 40px rgba(0, 102, 255, 0.3)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out forwards",
        "fade-in-delay-1": "fade-in 0.4s ease-out 0.1s forwards",
        "fade-in-delay-2": "fade-in 0.4s ease-out 0.2s forwards",
        "fade-in-delay-3": "fade-in 0.4s ease-out 0.3s forwards",
        "slide-in-right": "slide-in-right 0.3s ease-out forwards",
        "slide-in-left": "slide-in-left 0.2s ease-out forwards",
        "scale-in": "scale-in 0.3s ease-out forwards",
        glow: "glow 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
