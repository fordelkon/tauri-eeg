/// <reference types="vitest" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { presetUno } from "unocss";
import UnoCSS from "unocss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Split heavy vendor deps into their own chunks so route code changes don't
// force clients to re-download the large, rarely-changing libraries.
const manualChunks = (id: string): string | undefined => {
  if (id.indexOf("node_modules") === -1) {
    return undefined;
  }

  if (id.indexOf("@mui") !== -1 || id.indexOf("@emotion") !== -1) {
    return "vendor-mui";
  }

  if (id.indexOf("matter-js") !== -1) {
    return "vendor-matter";
  }

  if (id.indexOf("lottie-web") !== -1) {
    return "vendor-lottie";
  }

  // echarts is dynamically imported by GlobalMentalScalePanel; without an
  // explicit chunk rollup merges it into the shared entry chunk (~1MB).
  if (id.indexOf("echarts") !== -1 || id.indexOf("zrender") !== -1) {
    return "vendor-echarts";
  }

  return undefined;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), UnoCSS({ presets: [presetUno()] })],
  define: {
    __TAURI_EEG_PROJECT_ROOT__: JSON.stringify(process.cwd()),
  },
  // Tauri ships an evergreen WebView2 / WKWebView, so we can target the latest
  // JS features instead of down-leveling for legacy browsers.
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  // Strip console/debugger from production bundles only; vitest runs with
  // mode "test" and `vite dev` with "development", so their logging survives.
  esbuild:
    mode === "production"
      ? { drop: ["console", "debugger"] }
      : undefined,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
