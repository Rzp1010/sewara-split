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
          DEFAULT: "#f3f4f6",
          secondary: "#e5e7eb",
          subtle: "#f9fafb",
          card: "#ffffff",
        },
        text: {
          primary: "#111827",
          secondary: "#6b7280",
          muted: "#9ca3af",
        },
        border: {
          DEFAULT: "#d1d5db",
          strong: "#9ca3af",
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
