import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Standalone build for the isolated developer Studio SPA (M12). Served on the
// distinct studio host (STUDIO_HOST) — never on the client domain. Not wired into
// the root build/deploy; deployment of the studio surface is a later concern.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/studio-api": "http://localhost:8787",
      "/studio/auth": "http://localhost:8787",
    },
  },
});
