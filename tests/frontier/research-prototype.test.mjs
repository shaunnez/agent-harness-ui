// The research-projects prototype in the sample world: recorded questions only, the Relay base,
// reviews pinned to the evidence they saw, and asks that never reach a model.

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { assignMissingAppearances } from "../../src/frontier/world-3d/appearance.ts";

async function withVite(body) {
  const vite = await createServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    await body(vite);
  } finally {
    await vite.close();
  }
}

test("the sample world keeps recorded research while the live gateway serves saved questions", async () => {
  await withVite(async (vite) => {
    const { createFixtureGateway } = await vite.ssrLoadModule("/src/frontier/fixtures/gateway.ts");
    const gateway = createFixtureGateway();
    const research = (await gateway.projects()).filter((project) => project.kind === "research");
    assert.deepEqual(
      research.map((project) => project.name),
      ["QS cost research", "Codex prompt check"],
    );
    const appearances = assignMissingAppearances(await gateway.projects(), {});
    for (const project of research)
      assert.equal(appearances[`${project.id}:${project.repositoryPath}`].variant, "relay");

    const created = await gateway.createProject({
      name: "Tender pricing",
      repositoryPath: "",
      kind: "research",
    });
    assert.equal(created.kind, "research");
    assert.match(created.repositoryPath, /^research:\/\//);
    await assert.rejects(
      gateway.createProject({ name: "No path", repositoryPath: "" }),
      /absolute repository/,
    );

    const { liveGateway } = await vite.ssrLoadModule("/src/frontier/runtime/live-gateway.ts");
    assert.equal(liveGateway.research?.live, true);
  });
});

test("recorded questions keep their status, checks and fingerprint, and reviews pin to it", async () => {
  await withVite(async (vite) => {
    const { fixtureResearch } = await vite.ssrLoadModule("/src/frontier/fixtures/research/questions.ts");
    const { reviewState } = await vite.ssrLoadModule("/src/frontier/runtime/research.ts");
    const research = fixtureResearch(() => {});

    const opus = await research.questions("research-qs-costs");
    const recorded = opus.filter((question) => question.provenance === "recorded");
    assert.equal(recorded.length, 30);
    const count = (status) => recorded.filter((question) => question.status === status).length;
    assert.deepEqual([count("agreed"), count("disputed"), count("not_established")], [18, 10, 2]);
    // Recorded before citation checks: web figures were never fetched, so they are never shown as verified.
    const opusChecks = recorded.flatMap((q) => q.runs.flatMap((run) => run.components.map((c) => c.check)));
    assert.equal(opusChecks.includes("web-verified"), false);
    assert.ok(opusChecks.includes("web-not-fetched"));
    assert.equal(opus.filter((question) => question.provenance === "sample-activity").length, 1);

    const codex = await research.questions("research-codex-check");
    assert.equal(codex.length, 7);
    const switchboard = codex.find((question) => question.id.endsWith("switchboard-fault-rating-protection"));
    assert.equal(switchboard.status, "incomplete");
    assert.equal(switchboard.runs.find((run) => run.run === "r1").error.code, "repeated_tool_error");
    const doors = codex.find((question) => question.id.endsWith("door-hardware-sets"));
    const doorChecks = doors.runs.flatMap((run) => run.components.map((c) => c.check));
    assert.ok(doorChecks.includes("allowance") && doorChecks.includes("web-verified"));

    // The seeded sample review was made against older evidence.
    const wall = await research.question("research-qs-costs:retaining-wall-construction");
    assert.equal(reviewState(wall), "out-of-date");
    const reviewed = await research.review(wall.id, {
      decision: "approved",
      note: "",
      evidenceSha: wall.evidenceSha,
    });
    assert.equal(reviewState(reviewed), "approved");
    await assert.rejects(
      research.review(wall.id, { decision: "rejected", note: "x", evidenceSha: "stale" }),
      /evidence changed/,
    );
    await assert.rejects(
      research.review("research-qs-costs:sample-asbestos-soffit", {
        decision: "approved",
        note: "",
        evidenceSha: "any",
      }),
      /once its runs have finished/,
    );

    const asked = await research.ask("research-qs-costs", {
      objective: "What does a 1200 m2 membrane roof cost against long-run coloursteel?",
      runs: 1,
      engine: { runtime: "claude-cli", model: "claude-opus-5-5", reasoning: "high" },
    });
    assert.equal(asked.status, "queued");
    assert.equal(asked.runs.length, 1);
    assert.match(asked.provenanceNote, /nothing was sent to a model/);
  });
});
