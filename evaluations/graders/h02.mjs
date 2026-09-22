import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [repository, outputPath] = process.argv.slice(2);
if (!repository || !outputPath) throw new Error("Usage: h02.mjs <candidate-checkout> <receipt.json>");
const load = (file) => import(pathToFileURL(path.resolve(repository, file)).href);
const { SqliteTaskStore } = await load("server/sqlite-store.mjs");
const { TaskOrchestrator } = await load("server/orchestrator.mjs");
const { createApiServer } = await load("server/api.mjs");
const { buildStageRequest } = await load("server/prompts.mjs");
const { readExecutionProviderCatalog } = await load("server/model-catalog.mjs");
const results = [];
// The brief requires a task snapshot, not a particular nesting within the task.
const taskPolicy = (task) => task.grillPolicy ?? task.agentConfig?.grillPolicy;
const check = async (id, body) => {
  try { await body(); results.push({ id, passed: true }); }
  catch (error) { results.push({ id, passed: false, detail: error.message }); }
};
const questions = `<grill-questions>${JSON.stringify({ questions: [{ question: "Keep existing clients compatible?", whyItMatters: "Public contract", options: [{ label: "Preserve compatibility", description: "Existing callers keep working", recommended: true }, { label: "Break compatibility", description: "Not authorized", recommended: false }], allowCustom: true }] })}</grill-questions>`;
const scout = '<scout-report>{"status":"ok","findings":[{"file":"README.md","line":1,"fact":"Repository documentation exists.","confidence":"high"}],"uncertainties":[]}</scout-report>';

async function fixture(body, { policy, noQuestions = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eval-h02-"));
  const databasePath = path.join(directory, "tasks.sqlite3");
  let store = new SqliteTaskStore(databasePath);
  await store.init();
  if (policy) await store.updateSettings((settings) => { settings.grillPolicy = policy; });
  const specificationPrompts = [];
  const orchestrator = new TaskOrchestrator(store, {
    getStatus: async () => ({ available: true, authenticated: true, authMethod: "fixture", catalog: await readExecutionProviderCatalog() }),
    runCodex: async ({ prompt }) => {
      const specification = prompt.startsWith("You are the Task specification agent");
      if (specification) specificationPrompts.push(prompt);
      return { finalText: specification ? "## Grounded handoff\nApply the recorded decision." : prompt.includes("<scout-report>") ? scout : prompt.includes("<grill-questions>") ? noQuestions ? '<grill-questions>{"questions":[]}</grill-questions>' : questions : "## Grounded handoff\nPreserve the existing contract.", usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, totalTokens: 15 } };
    },
  });
  const server = createApiServer({ store, orchestrator, suggestedRepository: repository, csrfToken: "eval-h02" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method = "GET", data) => fetch(`${origin}${route}`, { method, headers: { "content-type": "application/json", "x-agent-harness-csrf": "eval-h02" }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const create = () => store.create({ title: "Preserve the public contract", description: "Investigate an explicit compatibility decision.", repositoryPath: repository, workflow: "investigate", priority: "medium" });
  try { await body({ store, databasePath, directory, origin, request, create, orchestrator, specificationPrompts, reopen: async () => { store.close(); store = new SqliteTaskStore(databasePath); await store.init(); return store; } }); }
  finally {
    if (orchestrator.shutdown) await orchestrator.shutdown();
    else {
      for (const task of await store.list()) await orchestrator.cancel(task.id);
      const deadline = Date.now() + 5000;
      while ((await store.list()).some((task) => task.activeRunKind || task.activeRunIds?.length || ["running", "cancelling"].includes(task.status))) {
        if (Date.now() > deadline) throw new Error("Fixture teardown did not drain its fake runs.");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    await new Promise((resolve) => server.close(resolve)); store.close(); await rm(directory, { recursive: true, force: true });
  }
}

async function settled(store, id, expected) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const task = await store.get(id);
    if (task.status === expected && !task.activeRunIds?.length) return task;
    if (Date.now() > deadline) throw new Error(`Expected ${expected}; observed ${task.status}: ${task.error ?? ""}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

await check("default-and-persistence", () => fixture(async ({ store, reopen }) => {
  assert.equal((await store.settings()).grillPolicy, "manual");
  await store.updateSettings((settings) => { settings.grillPolicy = "auto-accept-recommendations"; });
  const reopened = await reopen();
  assert.equal((await reopened.settings()).grillPolicy, "auto-accept-recommendations");
}));
await check("api-validation", () => fixture(async ({ store, request }) => {
  const settings = await store.settings();
  const bad = await request("/api/settings", "PUT", { ...settings, grillPolicy: "unrecognized" });
  assert.equal(bad.status, 400);
  const good = await request("/api/settings", "PUT", { ...settings, grillPolicy: "auto-accept-recommendations" });
  assert.equal(good.status, 200, await good.clone().text());
  assert.equal((await store.settings()).grillPolicy, "auto-accept-recommendations");
}));
await check("task-snapshot", () => fixture(async ({ store, create, request }) => {
  const before = await create();
  await store.updateSettings((settings) => { settings.grillPolicy = "auto-accept-recommendations"; });
  const after = await create();
  assert.equal(taskPolicy(await store.get(before.id)), "manual");
  assert.equal(taskPolicy(after), "auto-accept-recommendations");
  await store.updateSettings((settings) => { settings.grillPolicy = "manual"; });
  assert.equal(taskPolicy(await store.get(after.id)), "auto-accept-recommendations");
  const attemptedOverride = await request("/api/tasks", "POST", { title: "Preserve compatibility", description: "Investigate compatibility", repositoryPath: repository, workflow: "investigate", priority: "medium", grillPolicy: "auto-accept-recommendations" });
  if (attemptedOverride.status === 201) assert.equal(taskPolicy((await attemptedOverride.json()).task), "manual");
  else assert.equal(attemptedOverride.status, 400, await attemptedOverride.clone().text());
}));
await check("manual-decisions", () => fixture(async ({ store, create, orchestrator }) => {
  const task = await create();
  await orchestrator.start(task.id);
  const paused = await settled(store, task.id, "awaiting-grill");
  assert.equal(paused.grillSession.questions[0].answer, null);
  await assert.rejects(orchestrator.finishGrill(task.id, { acceptRemaining: true }));
  await orchestrator.finishGrill(task.id, { acceptRemaining: true, source: "operator" });
  const done = await settled(store, task.id, "awaiting-spec-approval");
  assert.equal(done.grillSession.completionSource, "operator");
  assert.equal(done.grillSession.questions[0].answerSource, "operator-accepted-recommendation");
}));
await check("automatic-provenance", () => fixture(async ({ store, create, orchestrator }) => {
  const task = await create();
  await store.updateSettings((settings) => { settings.grillPolicy = "manual"; });
  await orchestrator.start(task.id);
  const done = await settled(store, task.id, "awaiting-spec-approval");
  assert.equal(done.grillSession.policySnapshot, "auto-accept-recommendations");
  assert.equal(done.grillSession.completionSource, "automation-policy");
  assert.equal(done.grillSession.questions[0].answerSource, "automation-policy");
  assert.equal(done.grillSession.questions[0].answer, "Preserve compatibility");
}, { policy: "auto-accept-recommendations" }));
// Trace the actual dispatch, then vary only resolved decision records. Merely
// forwarding the original question/recommendation artifact cannot satisfy this.
function suppliesAnswerSource(prompt, answer, source) {
  // The contract requires truthful provenance, not a specific prompt serialization.
  // Accept explicit readable tags as well as the retained enum, bound to the answer.
  const readableTags = {
    "automation-policy": "[automated (policy-accepted recommendation)]",
    "operator-answer": "[operator decision]",
  };
  return prompt.split("\n").some((line) => line.includes(answer) && (
    line.includes(source) || line.toLowerCase().includes(readableTags[source])
  ));
}

function assertDecisionHandoff(task, prompts, expectedSource) {
  assert.equal(prompts.length, 1, "Expected one captured specification dispatch");
  const answer = task.grillSession.questions[0].answer;
  assert.ok(prompts[0].includes(answer), "Dispatched specification omitted the selected answer");
  assert.ok(suppliesAnswerSource(prompts[0], answer, expectedSource), "Dispatched specification omitted truthful provenance for the selected answer");
  const artifact = task.artifacts.find((item) => item.stage === "specification");
  assert.ok(artifact?.contextManifest?.sources.some((source) => source.includedCharacters > 0 && /decision|grill|answer/i.test(`${source.kind} ${source.id} ${source.label}`)), "Specification manifest omitted supplied Grill decision context");
  if (expectedSource === "automation-policy") {
    assert.doesNotMatch(prompts[0], /Recorded human decisions/i);
    assert.ok(!artifact.contextManifest.sources.some((source) => source.kind === "decisions" && /human/i.test(source.label)), "Manifest misattributes automatic answers to a human");
  }
  const altered = structuredClone(task);
  const marker = "RESOLVED_SELECTION_COUNTERFACTUAL_8c5a";
  for (const question of altered.grillSession.questions) question.answer = marker;
  for (const decision of altered.decisions ?? []) {
    if (decision.grillQuestionId === task.grillSession.questions[0].id || decision.answer === answer) decision.answer = marker;
  }
  const originalRequest = buildStageRequest(task, "specification");
  const alteredRequest = buildStageRequest(altered, "specification");
  assert.ok(!originalRequest.prompt.includes(marker));
  assert.ok(alteredRequest.prompt.includes(marker), "Specification ignores resolved answers and only sees proposed recommendations");
  const changedSource = structuredClone(task);
  const alternateSource = expectedSource === "automation-policy" ? "operator-answer" : "automation-policy";
  for (const question of changedSource.grillSession.questions) question.answerSource = alternateSource;
  for (const decision of changedSource.decisions ?? []) {
    if (decision.grillQuestionId === task.grillSession.questions[0].id || decision.answer === answer) decision.source = alternateSource;
  }
  const changedRequest = buildStageRequest(changedSource, "specification");
  assert.ok(suppliesAnswerSource(changedRequest.prompt, answer, alternateSource), "Specification ignores changes to recorded answer provenance");
  assert.ok(!suppliesAnswerSource(changedRequest.prompt, answer, expectedSource), "Specification retains stale provenance after the recorded source changes");
}

await check("automatic-specification-context", () => fixture(async ({ store, create, orchestrator, specificationPrompts }) => {
  const task = await create();
  await orchestrator.start(task.id);
  const done = await settled(store, task.id, "awaiting-spec-approval");
  assertDecisionHandoff(done, specificationPrompts, "automation-policy");
}, { policy: "auto-accept-recommendations" }));
await check("manual-specification-context", () => fixture(async ({ store, create, orchestrator, specificationPrompts }) => {
  const task = await create();
  await orchestrator.start(task.id);
  const paused = await settled(store, task.id, "awaiting-grill");
  await orchestrator.answerGrillQuestion(task.id, { questionId: paused.grillSession.questions[0].id, answer: "Keep existing clients and document the boundary", source: "operator" });
  await orchestrator.finishGrill(task.id, { source: "operator" });
  const done = await settled(store, task.id, "awaiting-spec-approval");
  assertDecisionHandoff(done, specificationPrompts, "operator-answer");
}));

await check("zero-questions", () => fixture(async ({ store, create, orchestrator }) => {
  const task = await create(); await orchestrator.start(task.id);
  const done = await settled(store, task.id, "awaiting-spec-approval");
  assert.equal(done.grillSession.questions.length, 0);
}, { noQuestions: true }));
await check("operator-api-boundary", () => fixture(async ({ request, create, store, orchestrator }) => {
  const task = await create(); await orchestrator.start(task.id); await settled(store, task.id, "awaiting-grill");
  const missing = await request(`/api/tasks/${task.id}/grill/answers`, "POST", { questionId: "Q1", answer: "Preserve compatibility" });
  assert.equal(missing.status, 400);
  const explicit = await request(`/api/tasks/${task.id}/grill/answers`, "POST", { questionId: "Q1", answer: "Preserve compatibility", interactionSource: "operator-ui" });
  assert.equal(explicit.status, 201, await explicit.clone().text());
  const answered = await store.get(task.id);
  assert.equal(answered.grillSession.questions[0].answerSource, "operator-answer");
}));
await check("legacy-evidence", () => fixture(async ({ store, create, reopen }) => {
  const task = await create();
  await store.update(task.id, (draft) => {
    delete draft.grillPolicy;
    if (draft.agentConfig) delete draft.agentConfig.grillPolicy;
    draft.grillSession = { status: "completed", questions: [{ id: "Q1", question: "Compatibility", options: [], answer: "Preserve compatibility", answerSource: "accepted-assumption" }], completionReason: "Historical reason", completedAt: "2026-08-01T12:00:00Z" };
  });
  const reopened = await reopen();
  const migrated = await reopened.get(task.id);
  assert.equal(taskPolicy(migrated), "manual");
  assert.equal(migrated.grillSession.completionSource, "legacy-unverified");
  assert.equal(migrated.grillSession.completionReason, "Historical reason");
  assert.equal(migrated.grillSession.questions[0].answer, "Preserve compatibility");
}));
await check("settings-browser", () => fixture(async ({ origin, store }) => {
  if (!process.env.EVAL_PLAYWRIGHT_MODULE) throw new Error("EVAL_PLAYWRIGHT_MODULE is required for the UI check.");
  const { chromium } = await import(pathToFileURL(process.env.EVAL_PLAYWRIGHT_MODULE).href);
  const { createServer: createVite } = await load("node_modules/vite/dist/node/index.js");
  // The frozen historical API allows the preview origin. Never drift to an
  // unapproved port when another local development server owns 5173.
  const vite = await createVite({ root: repository, configFile: false, server: { host: "127.0.0.1", port: 4173, strictPort: true, proxy: { "/api": origin } } });
  await vite.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/#settings`);
    const automatic = page.getByRole("radio", { name: /Automatically accept recommendations/ });
    await automatic.check({ timeout: 10000 });
    await page.getByRole("button", { name: "Save interaction policy" }).click();
    await page.getByRole("status").filter({ hasText: /saved/i }).waitFor({ timeout: 10000 });
    assert.equal((await store.settings()).grillPolicy, "auto-accept-recommendations");
    await page.reload();
    await page.waitForFunction(() => document.querySelector('input[value="auto-accept-recommendations"]')?.checked, { timeout: 10000 });
    assert.equal(await automatic.isChecked(), true);
    await page.getByRole("radio", { name: /Pause for my answers/ }).check();
    await page.getByRole("button", { name: "Save interaction policy" }).click();
    await page.getByRole("status").filter({ hasText: /saved/i }).waitFor();
    assert.equal((await store.settings()).grillPolicy, "manual");
    await page.screenshot({ path: outputPath.replace(/\.json$/, ".png"), fullPage: true });
  } finally { await browser?.close(); await vite.close(); }
}));
await writeFile(outputPath, JSON.stringify({ graderVersion: "h02-v5", repository, checks: results, passed: results.every((result) => result.passed), inferenceCalls: 0 }, null, 2) + "\n");
console.log(JSON.stringify(results));
process.exitCode = results.every((result) => result.passed) ? 0 : 1;
