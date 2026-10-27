import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiPlugin } from "./server/api";
export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: { host: "127.0.0.1", strictPort: false },
  preview: { host: "127.0.0.1", strictPort: false },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Interface sounds (src/sounds.ts) keep their set in the name:
        // assets/sounds/galaxy-select-<hash>.wav.
        assetFileNames: (asset) => {
          const source = asset.originalFileNames?.[0] ?? "";
          const sound = source.match(/art\/audio\/(\w+)\/([\w-]+)\.wav$/);
          return sound
            ? `assets/sounds/${sound[1]}-${sound[2]}-[hash][extname]`
            : "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
