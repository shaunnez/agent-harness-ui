import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// "Age of Agents" — an Age-of-Empires-style look-and-feel prototype over the Frontier fixture data.
// It is a separate entry so the live Frontier app is untouched.
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(root, "src/empire"),
  plugins: [react()],
  build: { outDir: path.join(root, "dist/empire"), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5198, strictPort: true, fs: { allow: [root] } },
});
