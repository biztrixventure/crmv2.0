import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

function versionPlugin() {
  return {
    name: "write-version-json",
    closeBundle() {
      const version = Date.now().toString();
      const outDir = path.resolve(__dirname, "dist");
      fs.writeFileSync(path.join(outDir, "version.json"), JSON.stringify({ version }));
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
