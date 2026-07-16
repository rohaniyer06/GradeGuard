import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "ui",
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3141"
    }
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"]
  }
});
