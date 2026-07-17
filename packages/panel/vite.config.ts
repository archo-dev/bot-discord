import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Le socle React évolue moins souvent que l'interface et reste partagé par
        // toutes les routes. Les bibliothèques lourdes de graphiques restent lazy.
        manualChunks: {
          "react-core": ["react", "react-dom", "react-router"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
    },
  },
});
