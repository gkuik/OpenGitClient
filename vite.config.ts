import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Hôte optionnel utilisé par Tauri pour le dev mobile ; inoffensif sur desktop.
const host = process.env.TAURI_DEV_HOST;

// Configuration Vite adaptée à Tauri : port fixe 1420 (attendu par `tauri dev`),
// on ignore le dossier `src-tauri` pour éviter des rebuilds inutiles.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
