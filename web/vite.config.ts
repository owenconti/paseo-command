import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { apiPlugin } from "./server/api";
export default defineConfig({
  // Tailwind only compiles the landing page's stylesheet (landing/landing.css).
  plugins: [react(), tailwindcss(), apiPlugin()],
  server: {
    host: "0.0.0.0",
    strictPort: false,
    // The Atlas world is bundled straight from the sibling rendering package.
    fs: { allow: [".", "../rendering"] },
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    strictPort: false,
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // The app at /, its landing page at /landing/.
      input: {
        app: fileURLToPath(new URL("index.html", import.meta.url)),
        landing: fileURLToPath(new URL("landing/index.html", import.meta.url)),
      },
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
