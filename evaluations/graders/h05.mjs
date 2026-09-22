import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [repository, output] = process.argv.slice(2);
if (!repository || !output) throw new Error("Usage: h05.mjs <candidate-checkout> <new-output-directory>");
if (!process.env.EVAL_PLAYWRIGHT_MODULE) throw new Error("EVAL_PLAYWRIGHT_MODULE is required.");
const candidate = path.resolve(repository);
await mkdir(output); // Never replace retained grading evidence.
const { withConfiguredModels } = await import(
  pathToFileURL(path.join(candidate, "server/model-catalog.mjs")).href
);
const checks = [];
const check = async (id, run) => {
  try {
    await run();
    checks.push({ id, passed: true });
  } catch (error) {
    checks.push({ id, passed: false, detail: error.message });
  }
};
const claude = {
  id: "claude-sonnet-5",
  label: "Discovered Claude fixture",
  description: "Synthetic discovery",
  provider: "claude",
  defaultReasoning: "high",
  reasoningLevels: ["medium", "high"],
  pricing: null,
  provenance: "bundled",
  availability: "discovered",
  editable: true,
};
const codex = {
  ...claude,
  id: "gpt-5.6-luna",
  label: "Discovered Codex fixture",
  provider: "codex",
  provenance: "discovered",
};
const missing = "gpt-eval-unreported";
const catalog = { models: [claude, codex], fetchedAt: "2026-09-22T00:00:00Z", source: "Synthetic fixture" };
const entry = (result, id) => result.models.find((model) => model.id === id);
for (const [name, settings] of Object.entries({
  default: { defaultModel: claude.id },
  allowlist: { allowedModels: [claude.id] },
  stage: { stagePolicies: { implement: { model: claude.id, reasoning: "high" } } },
})) {
  await check(`discovered-claude-${name}`, () =>
    assert.deepEqual(entry(withConfiguredModels(catalog, settings), claude.id), claude),
  );
}
await check("codex-and-catalog-metadata", () => {
  const result = withConfiguredModels(catalog, { defaultModel: codex.id, allowedModels: [codex.id] });
  assert.deepEqual(entry(result, codex.id), codex);
  assert.equal(result.source, catalog.source);
  assert.equal(result.fetchedAt, catalog.fetchedAt);
});
await check("undiscovered-stays-disabled", () => {
  const result = withConfiguredModels(
    { models: [{ ...claude, availability: "unsupported", editable: false }] },
    { defaultModel: claude.id, allowedModels: [missing] },
  );
  for (const id of [claude.id, missing]) {
    assert.equal(entry(result, id).editable, false);
    assert.notEqual(entry(result, id).availability, "discovered");
  }
  assert.deepEqual(entry(result, missing).reasoningLevels, []);
});
await check("unique-and-immutable", () => {
  const input = structuredClone(catalog);
  const settings = {
    defaultModel: claude.id,
    allowedModels: [claude.id, claude.id, missing],
    stagePolicies: { plan: { model: missing } },
  };
  const before = JSON.stringify([input, settings]);
  const result = withConfiguredModels(input, settings);
  assert.equal(JSON.stringify([input, settings]), before);
  assert.equal(result.models.length, new Set(result.models.map((model) => model.id)).size);
});
await check("actual-policy-editor", async () => {
  const settings = {
    pricing: { rates: {}, version: 1, verifiedAt: null, verifiedBy: null },
    allowedModels: [claude.id, codex.id, missing],
    defaultModel: codex.id,
    defaultReasoning: "high",
    stagePolicies: { plan: { model: claude.id, reasoning: "high" } },
  };
  const status = {
    authenticated: false,
    providers: [],
    settings,
    catalog: withConfiguredModels(catalog, settings),
  };
  const contents = `import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsScreen} from ${JSON.stringify(path.join(candidate, "src/components/SettingsScreen.tsx"))};createRoot(document.getElementById('root')).render(<SettingsScreen runtimeStatus={${JSON.stringify(status)}} evaluationSummary={null} onRefresh={async()=>{}} onSave={async(settings)=>{window.savedSettings=settings;return settings}} onVerifyPricing={async()=>{}} refreshing={false}/>);`;
  const bundle = await build({
    stdin: { contents, resolveDir: candidate, loader: "tsx" },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    logLevel: "silent",
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
    response.end(
      request.url === "/bundle.js"
        ? bundle.outputFiles[0].text
        : '<!doctype html><html><head><meta charset="utf-8"><title>H05 independent policy editor check</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const { chromium } = await import(pathToFileURL(process.env.EVAL_PLAYWRIGHT_MODULE).href);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('select[id$="-model"]').first().waitFor({ timeout: 10000 });
    const options = await page
      .locator('select[id$="-model"] option')
      .evaluateAll((nodes) => nodes.map((node) => node.value));
    assert.ok(options.includes(claude.id), "Discovered Claude missing from policy choices");
    assert.ok(options.includes(codex.id), "Discovered Codex missing from policy choices");
    assert.ok(!options.includes(missing), "Undiscovered model became selectable");
    const row = page.locator(".model-option").filter({ has: page.locator("code", { hasText: missing }) });
    assert.equal(await row.count(), 1);
    assert.equal(await row.locator("input").isDisabled(), true);
    await page.locator('select[id$="-model"]').first().selectOption(claude.id);
    assert.equal(await page.locator('select[id$="-model"]').first().inputValue(), claude.id);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "settings.png"), fullPage: true });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
const result = {
  caseId: "H05",
  graderVersion: "h05-v1",
  repository: candidate,
  checks,
  passed: checks.every((check) => check.passed),
  inferenceCalls: 0,
};
await writeFile(path.join(output, "checks.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(result));
process.exitCode = result.passed ? 0 : 1;
