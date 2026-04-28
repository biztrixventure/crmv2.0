import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function versionPlugin() {
  return {
    name: "write-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: Date.now().toString() }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionPlugin()],
  server: {
    port: 5173,
    strictPort: false,
    host: "0.0.0.0",
    proxy: {
      // Proxy API requests to backend in dev mode
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "terser",
  },
  preview: {
    port: 5173,
    host: "0.0.0.0",
  },
});
