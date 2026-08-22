import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration tuned for Tauri development.
// Tauri expects a fixed dev-server port and needs Vite to leave the process
// foreground-friendly; the settings below mirror the official Tauri template.
export default defineConfig({
  plugins: [react()],

  // Tauri reads TAURI_* env vars; keep Vite quiet about them and don't clear the
  // screen so Rust compiler output stays visible in the same terminal.
  clearScreen: false,

  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into separate chunks so the initial
        // bundle stays small and browsers can cache libs independently.
        // Function form is required: Vite 8 builds with rolldown, whose
        // manualChunks accepts a function (the object form fails the build).
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('plotly.js')) return 'vendor-plotly';
          if (id.includes('@xterm')) return 'vendor-xterm';
          if (id.includes('@codemirror') || id.includes('codemirror') || id.includes('@lezer')) {
            return 'vendor-codemirror';
          }
          if (id.includes('d3-force') || id.includes('d3-force-3d')) return 'vendor-d3';
          // NOTE: shiki is deliberately NOT grouped here. The /web bundle
          // code-splits every language grammar behind its own dynamic import;
          // folding them into one chunk would merge that lazy loading away and
          // ship all grammars whenever the AI panel opens. Leave shiki to
          // rolldown's default dynamic-import chunking.
          if (
            id.includes('react-markdown') ||
            id.includes('remark-') ||
            id.includes('micromark') ||
            id.includes('mdast') ||
            id.includes('unified')
          ) {
            return 'vendor-markdown';
          }
          return undefined;
        },
      },
    },
  },

  server: {
    // Fixed port so `tauri.conf.json > build.devUrl` can point at it.
    port: 1420,
    strictPort: true,
    // Fail loudly if HMR websocket can't bind rather than silently degrading.
    host: false,
    // The browser shell needs a way to reach the k7s-web axum server (the
    // Tauri runtime provides `invoke` directly, so this proxy is a no-op
    // there). k7s-web already uses `/api/*` paths, so the proxy passes
    // them through unchanged.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7180",
        changeOrigin: false,
        ws: false,
      },
    },
  },

  // Vitest configuration lives here too (single source of truth).
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    // Only unit-test the frontend; Rust has its own `cargo test`.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
