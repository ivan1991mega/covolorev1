import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In sviluppo, /api viene inoltrato al backend su :3000.
// In produzione, frontend e backend sono serviti dallo stesso server.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
