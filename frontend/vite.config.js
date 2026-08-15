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
    // esbuild, NOT terser. Terser minifies in worker threads that each hold a
    // whole chunk's AST — on the 1MB admin chunk that peaks past what the build
    // container has, and the worker is OOM-killed at "rendering chunks" with no
    // error message (the deploy just exits 255). esbuild minifies in-process,
    // an order of magnitude cheaper, for a couple of percent more output.
    minify: "esbuild",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out of the app chunks. Two
        // wins: no single chunk is huge while minifying, and an app change stops
        // busting the browser cache of the vendor code.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['chart.js', 'react-chartjs-2'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  preview: {
    port: 5173,
    host: "0.0.0.0",
  },
});
