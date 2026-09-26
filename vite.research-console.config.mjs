import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { researchConsoleBoundary } from "./scripts/research-console/boundary.mjs";

// The research console: the research service's build of Frontier (32-RESEARCH-SPLIT-PLAN.md,
// Phase 4). `npm run dev:research-console` serves it on 5198 against the service on 4400;
// `npm run build:research-console` writes dist/research-console, which the service serves.
const root = path.dirname(fileURLToPath(import.meta.url));
const fixtures = process.env.RESEARCH_CONSOLE_FIXTURES !== "off";
const FIXTURE_MODULE = path.join(root, "src/frontier/fixtures/research/questions.ts");

/** With fixtures off, the recorded questions module is replaced by an empty one, so the build
 *  never reads the eval data at all (Rollup loads a dynamic import even in dead code). */
function withoutFixtures() {
  return {
    name: "research-console-without-fixtures",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (fixtures || !importer) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id.split("?")[0] === FIXTURE_MODULE ? "\0research-console-no-fixtures" : null;
    },
    load(id) {
      if (id !== "\0research-console-no-fixtures") return null;
      return 'export const researchFixtureProjects = []; export function fixtureResearch() { throw new Error("This console was built without sample research."); }';
    },
  };
}

export default defineConfig({
  root: path.join(root, "src/frontier/research-console"),
  publicDir: path.join(root, "public/frontier"),
  plugins: [withoutFixtures(), react(), researchConsoleBoundary(root)],
  // The recorded sample questions (`?mode=fixture`), on unless RESEARCH_CONSOLE_FIXTURES=off. The
  // production image builds with them off: the eval set came from PlanCheck data whose
  // classification is still open (Phase 0.2), and a prod console has no use for samples.
  define: { __RESEARCH_CONSOLE_FIXTURES__: JSON.stringify(fixtures) },
  build: { outDir: path.join(root, "dist/research-console"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5198,
    strictPort: true,
    fs: { allow: [root] },
    proxy: { "/api": process.env.RESEARCH_SERVICE_URL ?? "http://127.0.0.1:4400" },
  },
});
