/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#4F46E5",
          strong: "#4338CA",
          light: "#EEF2FF",
        },
        success: "#10B981",
        warning: "#F59E0B",
        danger: "#EF4444",
        info: "#3B82F6",
        surface: {
          DEFAULT: "var(--bg-body)",
          body: "var(--bg-body)",
          secondary: "var(--bg-elevated)",
          elevated: "var(--bg-elevated)",
          subtle: "var(--bg-subtle)",
          inset: "var(--bg-inset)",
          card: "var(--bg-surface)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        border: {
          DEFAULT: "var(--border-color)",
          strong: "var(--border-strong)",
        },
      },
      fontSize: { 13: "13px" },
      fontFamily: {
        sans: [
          "var(--font-jakarta)",
          '"Plus Jakarta Sans"',
          "system-ui",
          "sans-serif",
        ],
        display: [
          "var(--font-jakarta)",
          '"Plus Jakarta Sans"',
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  prefix: "",
  important: false,
  corePlugins: { preflight: false },
  plugins: [],
};
