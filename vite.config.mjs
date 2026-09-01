import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.AGENT_HARNESS_API ?? "http://127.0.0.1:4310";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    watch: {
      ignored: ["**/.data/**"],
    },
    proxy: {
      "/api": apiTarget,
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react()],
});
