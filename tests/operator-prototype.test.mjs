import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

async function withOperatorPrototype(run) {
  const vite = await createViteServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const [prototype, domain, preview] = await Promise.all([
      vite.ssrLoadModule("/src/components/operator/OperatorTaskPrototype.tsx"),
      vite.ssrLoadModule("/src/domain.ts"),
      vite.ssrLoadModule("/src/hostedAtlasPreview.ts"),
    ]);
    return await run({ ...prototype, ...domain, ...preview });
  } finally {
    await vite.close();
  }
}

test("operator preview route is explicit and does not overlap the atlas preview", async () => {
  await withOperatorPrototype(({ operatorTaskPreviewRequested }) => {
    assert.equal(operatorTaskPreviewRequested("?preview=operator"), true);
    assert.equal(operatorTaskPreviewRequested("?preview=atlas"), false);
    assert.equal(operatorTaskPreviewRequested("?view=map"), false);
  });
});

test("operator prototype exposes every workflow stage and the evidence switch", async () => {
  await withOperatorPrototype(({ OperatorTaskPrototype, workflowStages }) => {
    const markup = renderToStaticMarkup(
      React.createElement(OperatorTaskPrototype, { onExit: () => undefined }),
    );

    assert.match(markup, /Prototype state/);
    assert.match(markup, /persisted tasks are unchanged/);
    assert.match(markup, />Operator</);
    assert.match(markup, />Evidence</);
    assert.match(markup, /Operator briefing/);
    assert.match(markup, /Handoff readiness/);

    for (const stage of workflowStages) {
      assert.match(markup, new RegExp(`>${stage.shortLabel}<`));
    }
  });
});
