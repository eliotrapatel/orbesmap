import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build into ONE self-contained index.html: theorbes.com/maps serves only that file,
// so scripts, styles, fonts and images must all be inlined.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 4000 },
  server: { port: 5178 },
});
