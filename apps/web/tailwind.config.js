/**
 * The visual system.
 *
 * The brand indigo is used with discipline — primary actions, the active
 * navigation state, headings, and the "on site" status. It is never a
 * background wash.
 *
 * The neutral scale is a slightly cool grey rather than pure black, so the
 * indigo sits naturally against it.
 *
 * Status colours avoid the red/green pairing entirely: someone with
 * deuteranopia cannot separate those, and this is a screen read at a glance
 * from across a room. On site is the indigo, departed a mid neutral, late
 * amber, absent a desaturated rose, not-expected an outline with no fill.
 * Colour is never the only carrier — every status also has a label and a
 * distinct shape.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f0fb",
          100: "#e4e0f7",
          200: "#c6bdef",
          300: "#a396e4",
          400: "#7b68d6",
          500: "#5941c2",
          600: "#3f28a4",
          700: "#270286",
          800: "#1f0269",
          900: "#16014a",
        },
        // Cool grey: a touch of blue so it agrees with the indigo.
        neutral: {
          0: "#ffffff",
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dfe2e9",
          300: "#c6cad5",
          400: "#9aa0b0",
          500: "#6f7686",
          600: "#545a68",
          700: "#3d424e",
          800: "#292d36",
          900: "#181b21",
        },
        status: {
          onsite: "#270286",
          departed: "#6f7686",
          late: "#a65c00",
          lateBg: "#fdf3e3",
          absent: "#9b3b58",
          absentBg: "#fbeef1",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        // Dense by default: this is a tool scanned across a room, not a
        // marketing page.
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.125rem" }],
        base: ["0.875rem", { lineHeight: "1.25rem" }],
      },
      keyframes: {
        // The only non-user-triggered motion in the application.
        rowFlash: {
          "0%": { backgroundColor: "#e4e0f7" },
          "100%": { backgroundColor: "transparent" },
        },
        countPulse: {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(1.12)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        rowFlash: "rowFlash 1500ms ease-out",
        countPulse: "countPulse 400ms ease-out",
      },
    },
  },
  plugins: [],
};
