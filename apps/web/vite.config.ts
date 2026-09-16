import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API sets httpOnly cookies, so the browser must see one origin in
    // development as it does in production behind the reverse proxy.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/ingest": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
