import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(root, "src/frontier"),
  publicDir: path.join(root, "public/frontier"),
  plugins: [react()],
  build: { outDir: path.join(root, "dist/frontier"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5199,
    strictPort: true,
    fs: { allow: [root] },
    proxy: { "/api": process.env.AGENT_HARNESS_API ?? "http://127.0.0.1:4321" },
  },
});
