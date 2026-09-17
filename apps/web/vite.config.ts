import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/**
 * The API's port. Configurable so a second instance can be run alongside a
 * first without editing this file.
 */
const apiPort = process.env["API_PORT"] ?? "3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: Number(process.env["WEB_PORT"] ?? 5173),
    // The API sets httpOnly cookies, so the browser must see one origin in
    // development as it does in production behind the reverse proxy.
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      "/ingest": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // The charting library is a third of the bundle and only two pages
        // draw a chart; the rest of the app should not wait for it.
        manualChunks: {
          charts: ["recharts"],
          ui: ["radix-ui", "cmdk", "sonner", "lucide-react"],
          data: ["@tanstack/react-query", "@tanstack/react-virtual", "react-router-dom"],
        },
      },
    },
  },
});
