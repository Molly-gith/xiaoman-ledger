import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pagesBase = process.env.GITHUB_PAGES_BASE ?? "/xiaoman-ledger/";

export default defineConfig({
  root: "github",
  publicDir: "../public",
  base: pagesBase,
  plugins: [react()],
  build: {
    outDir: "../github-dist",
    emptyOutDir: true,
  },
});
