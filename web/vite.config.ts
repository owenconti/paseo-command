import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { apiPlugin } from "./server/api";
export default defineConfig({
  // Tailwind only compiles the landing page's stylesheet (landing/landing.css).
  plugins: [react(), tailwindcss(), apiPlugin()],
  server: {
    host: "127.0.0.1",
    strictPort: false,
    // The Atlas world is bundled straight from the sibling rendering package.
    fs: { allow: [".", "../rendering"] },
    // Opt-in tailnet access through `tailscale serve`; the server stays on loopback.
    allowedHosts: process.env.PASEO_COMMAND_TAILNET_HOST
      ? [process.env.PASEO_COMMAND_TAILNET_HOST]
      : [],
  },
  preview: {
    host: "127.0.0.1",
    strictPort: false,
    allowedHosts: process.env.PASEO_COMMAND_TAILNET_HOST
      ? [process.env.PASEO_COMMAND_TAILNET_HOST]
      : [],
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
