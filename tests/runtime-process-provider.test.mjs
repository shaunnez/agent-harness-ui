import test from "node:test";
import {
  access,
  assert,
  buildCodexEnvironment,
  buildCodexSpawnArgs,
  DEFAULT_MODEL,
  DEFAULT_REASONING,
  DEFAULT_RUN_LABEL,
  DEFAULT_STDOUT_BUDGET,
  hasExecutionProvider,
  isProcessTimeoutError,
  listExecutionProviders,
  mkdtemp,
  os,
  ProcessTimeoutError,
  parseCodexEvent,
  path,
  readCodexModelCatalog,
  readFile,
  resolveExecutionProvider,
  rm,
  runProcess,
  SharedProcessTimeoutError,
  selectCodexCandidate,
  sharedRunProcess,
  waitUntil,
  withConfiguredModels,
  writeFile,
} from "./runtime-test-support.mjs";

test("parses Codex final messages and usage", () => {
  const memoryFile = path.join(
    process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    "memories",
    "MEMORY.md",
  );
  assert.deepEqual(
    parseCodexEvent(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Ready" } }),
    ),
    { type: "message", text: "Ready" },
  );
  assert.equal(
    parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution", command: "npm test", exit_code: 1 },
      }),
    ).commandFailed,
    true,
  );
  const memoryPreflight = parseCodexEvent(
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: `/bin/zsh -lc "rg -n AH-100 ${memoryFile}"`,
        exit_code: 1,
      },
    }),
  );
  assert.equal(memoryPreflight.commandFailed, true);
  assert.equal(memoryPreflight.runtimeScope, "context-preflight");
  const boundedMemoryPreflight = parseCodexEvent(
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: `/bin/zsh -lc "rg -n -m 20 'AH-010|Mailbox Queue modal|keyboard-safe|modalOwnedKeyboardEvents' ${memoryFile}"`,
        exit_code: 1,
      },
    }),
  );
  assert.equal(boundedMemoryPreflight.commandFailed, true);
  assert.equal(boundedMemoryPreflight.runtimeScope, "context-preflight");
  assert.equal(
    parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: `/bin/zsh -lc "rg -n AH-100 ${memoryFile}"`,
          exit_code: 0,
        },
      }),
    ).runtimeScope,
    "agent-diagnostic",
  );
  assert.equal(
    parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution", command: "rg -n defect tests", exit_code: 1 },
      }),
    ).runtimeScope,
    "agent-diagnostic",
  );
  for (const command of [
    `/bin/zsh -lc 'rg needle ./src ${memoryFile}'`,
    `/bin/zsh -lc 'rg needle | npm test ${memoryFile}'`,
    `/bin/zsh -lc 'rg needle & npm test ${memoryFile}'`,
    `/bin/zsh -lc 'rg --pre npm-test-wrapper needle ${memoryFile}'`,
    `/bin/zsh -lc 'rg -m unbounded needle ${memoryFile}'`,
    `/bin/zsh -lc 'rg needle ./src > ${memoryFile}'`,
    `/bin/zsh -lc 'rg needle\n${memoryFile}'`,
    `/bin/zsh -lc 'rg needle\r\n${memoryFile}'`,
    "/bin/zsh -lc 'rg needle /tmp/candidate/.codex/memories/MEMORY.md'",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: This is an intentionally literal shell expansion.
    "/bin/zsh -lc 'rg needle ${PWD}/.codex/memories/MEMORY.md'",
    `/bin/zsh -lc 'rg * ${memoryFile}'`,
    `/bin/bash -lc 'rg *.ts ${memoryFile}'`,
    `/bin/zsh -lc 'rg {needle,./src} ${memoryFile}'`,
    `/bin/zsh -lc 'rg [A-Z] ${memoryFile}'`,
    `/bin/zsh -lc 'rg =(false) ${memoryFile}'`,
    "/bin/zsh -lc 'rg needle =(false)/../../../../../../Users/shaun/.codex/memories/MEMORY.md'",
  ]) {
    assert.equal(
      parseCodexEvent(
        JSON.stringify({
          type: "item.completed",
          item: { type: "command_execution", command, exit_code: 1 },
        }),
      ).runtimeScope,
      "agent-diagnostic",
      command,
    );
  }
  for (const command of [
    ["rg", "'needle", "./src", "'", memoryFile],
    ["rg", '"needle', "./src", '"', memoryFile],
  ]) {
    assert.equal(
      parseCodexEvent(
        JSON.stringify({
          type: "item.completed",
          item: { type: "command_execution", command, exit_code: 1 },
        }),
      ).runtimeScope,
      "agent-diagnostic",
    );
  }
  assert.equal(
    parseCodexEvent(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: `/bin/zsh -lc "rg AH-100 ${memoryFile} && npm test"`,
          exit_code: 1,
        },
      }),
    ).runtimeScope,
    "agent-diagnostic",
  );
  const previousCodexHome = process.env.CODEX_HOME;
  const customCodexHome = path.join(os.tmpdir(), "agent-harness-custom-codex-home");
  process.env.CODEX_HOME = customCodexHome;
  try {
    const customMemoryFile = path.join(customCodexHome, "memories", "MEMORY.md");
    assert.equal(
      parseCodexEvent(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            command: `/bin/zsh -lc "rg -n AH-100 ${customMemoryFile}"`,
            exit_code: 1,
          },
        }),
      ).runtimeScope,
      "context-preflight",
    );
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
  assert.deepEqual(
    parseCodexEvent(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5 },
      }),
    ),
    {
      type: "usage",
      usage: { inputTokens: 10, cachedInputTokens: 4, cacheWriteTokens: 0, outputTokens: 5, totalTokens: 15 },
    },
  );
});

test("prefers a Windows Codex runtime with its sandbox helper", () => {
  const candidates = ["C:\\standalone\\codex.exe", "C:\\desktop\\codex.exe"];
  const selected = selectCodexCandidate(candidates, (candidate) =>
    candidate.endsWith("desktop\\codex-windows-sandbox-setup.exe"),
  );
  assert.equal(selected, process.platform === "win32" ? candidates[1] : candidates[0]);
});

test("rejects an already-aborted process before spawning", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-aborted-process-"));
  const marker = path.join(directory, "spawned.txt");
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        runProcess(
          process.execPath,
          ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`],
          { signal: controller.signal },
        ),
      /before launch/i,
    );
    await assert.rejects(() => access(marker));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation terminates descendants before the process reservation settles", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-process-tree-"));
  const marker = path.join(directory, "writes.txt");
  const childScript = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),15);`;
  const parentScript = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  try {
    const controller = new AbortController();
    const running = runProcess(process.execPath, ["-e", parentScript], {
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    await waitUntil(async () => (await readFile(marker, "utf8").catch(() => "")).length > 1);
    controller.abort();
    await assert.rejects(() => running, /cancelled/i);
    const sizeAfterClose = (await readFile(marker, "utf8")).length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal((await readFile(marker, "utf8")).length, sizeAfterClose);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("timeout terminates descendants before allowing a retry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-process-timeout-"));
  const marker = path.join(directory, "writes.txt");
  const childScript = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),15);`;
  const parentScript = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  try {
    await assert.rejects(
      () => runProcess(process.execPath, ["-e", parentScript], { timeoutMs: 120 }),
      (error) =>
        error instanceof ProcessTimeoutError && error.code === "PROCESS_TIMEOUT" && error.timeoutMs === 120,
    );
    const sizeAfterClose = (await readFile(marker, "utf8").catch(() => "")).length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal((await readFile(marker, "utf8").catch(() => "")).length, sizeAfterClose);
    const retry = await runProcess(process.execPath, ["-e", "process.stdout.write('retry')"], {
      timeoutMs: 1_000,
    });
    assert.equal(retry.stdout, "retry");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("builds a minimal Codex environment without inherited credentials", () => {
  const environment = buildCodexEnvironment(
    {
      PATH: "C:\\Windows\\System32",
      USERPROFILE: "C:\\Users\\agent",
      LOCALAPPDATA: "C:\\Users\\agent\\AppData\\Local",
      CODEX_HOME: "C:\\Users\\agent\\.codex",
      GH_TOKEN: "secret-github-token",
      AWS_SECRET_ACCESS_KEY: "secret-aws-key",
      DATABASE_URL: "postgres://secret",
      OPENAI_API_KEY: "secret-openai-key",
      ARBITRARY_SECRET: "secret-value",
    },
    "C:\\tmp\\agent-harness-runtime",
  );
  assert.equal(environment.PATH, "C:\\Windows\\System32");
  assert.equal(environment.CODEX_HOME, "C:\\Users\\agent\\.codex");
  assert.equal(environment.TEMP, "C:\\tmp\\agent-harness-runtime");
  assert.equal(environment.GH_TOKEN, undefined);
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.ARBITRARY_SECRET, undefined);
});

test("runs Harness Codex stages without user plugins, skills, memories, or persisted sessions", () => {
  const args = buildCodexSpawnArgs({
    cwd: "/repo/candidate",
    sandbox: "read-only",
    networkAccess: false,
    model: "gpt-5.6-sol",
    reasoning: "high",
  });
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.deepEqual(args.slice(args.indexOf("--disable"), args.indexOf("--disable") + 2), [
    "--disable",
    "memories",
  ]);
  assert.equal(args.includes("--add-dir"), false);
  assert.deepEqual(args.slice(args.indexOf("--cd"), args.indexOf("--cd") + 2), ["--cd", "/repo/candidate"]);
});

test("resolves the Codex provider through the execution-provider seam", () => {
  const codex = resolveExecutionProvider("codex");
  assert.equal(codex.id, "codex");
  assert.equal(codex.label, "Codex");
  assert.equal(codex.parseEvent, parseCodexEvent);
  assert.deepEqual(codex.defaults(), { model: DEFAULT_MODEL, reasoning: DEFAULT_REASONING });

  // Codex's sandbox is one OS-level guarantee with no model-reachable waiver, so
  // it is the only posture that needs no harness-side confinement check.
  const capabilities = codex.capabilities();
  assert.equal(capabilities.sandboxes["read-only"], "os-enforced");
  assert.equal(capabilities.sandboxes["workspace-write"], "os-enforced");
  assert.equal(capabilities.confinementVerifiedBy, "provider");
  assert.equal(capabilities.networkIsolation, true);
  assert.equal(capabilities.supportsReasoningLevels, true);
  assert.equal(capabilities.stdoutBudgetBytes, DEFAULT_STDOUT_BUDGET);

  assert.equal(resolveExecutionProvider(undefined).id, "codex");
  assert.equal(hasExecutionProvider("codex"), true);
  assert.equal(hasExecutionProvider("nope"), false);
  assert.throws(() => resolveExecutionProvider("nope"), /Unknown execution provider: nope/);
  assert.deepEqual(
    listExecutionProviders().map((provider) => provider.id),
    ["codex", "claude"],
  );
});

test("shares one process-runtime timeout identity across the seam", () => {
  // The extraction must not fork the error class: `isProcessTimeoutError` is what
  // the orchestrator uses to distinguish a timeout from a failed run, and a second
  // class identity would silently reclassify every Codex timeout.
  assert.equal(ProcessTimeoutError, SharedProcessTimeoutError);
  assert.equal(runProcess, sharedRunProcess);
  assert.equal(isProcessTimeoutError(new ProcessTimeoutError(900_000, "Codex")), true);
  assert.equal(isProcessTimeoutError(new Error("Codex run exceeded 900 seconds.")), false);
});

test("names the timed-out provider instead of always blaming Codex", () => {
  // Both providers pass an explicit label, so a real timeout names the runtime that
  // actually exceeded its deadline. The neutral default only surfaces for an error
  // constructed with no provider context, where "Codex" would be a lie.
  assert.equal(new ProcessTimeoutError(180_000, "Codex").message, "Codex run exceeded 180 seconds.");
  assert.equal(new ProcessTimeoutError(180_000, "Claude").message, "Claude run exceeded 180 seconds.");
  assert.equal(new ProcessTimeoutError(180_000).message, "Agent run exceeded 180 seconds.");
  assert.equal(DEFAULT_RUN_LABEL, "Agent");
  assert.equal(new ProcessTimeoutError(180_000, "Claude").label, "Claude");
});

test("labels a pre-launch cancellation with the requesting provider", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runProcess("node", ["-e", "0"], { signal: controller.signal, label: "Claude" }),
    /^Error: Claude run cancelled before launch\.$/,
  );
  await assert.rejects(
    runProcess("node", ["-e", "0"], { signal: controller.signal, label: "Codex" }),
    /^Error: Codex run cancelled before launch\.$/,
  );
});

test("distinguishes discovered, configured, fallback, and unsupported model provenance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-model-catalog-"));
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = directory;
    await writeFile(
      path.join(directory, "models_cache.json"),
      JSON.stringify({
        fetched_at: "2026-08-03T00:00:00.000Z",
        models: [
          {
            slug: "gpt-5.6-luna",
            display_name: "GPT-5.6-Luna",
            description: "Local cache entry",
            visibility: "list",
            default_reasoning_level: "xhigh",
            supported_reasoning_levels: [{ effort: "high" }, { effort: "xhigh" }],
          },
        ],
      }),
    );
    const discovered = await readCodexModelCatalog();
    assert.equal(discovered.models[0].provenance, "discovered");
    assert.equal(discovered.models[0].editable, true);

    await writeFile(path.join(directory, "models_cache.json"), JSON.stringify({ models: [] }));
    const fallback = await readCodexModelCatalog();
    assert.equal(
      fallback.models.every((model) => model.provenance === "bundled-fallback"),
      true,
    );
    assert.equal(
      fallback.models.every((model) => model.availability === "unsupported" && !model.editable),
      true,
    );
    const configured = withConfiguredModels(fallback, {
      allowedModels: ["gpt-5.6-luna"],
      defaultModel: "gpt-5.6-luna",
      defaultReasoning: "xhigh",
      stagePolicies: { triage: { model: "gpt-5.6-luna", reasoning: "xhigh" } },
    });
    assert.equal(configured.models.find((model) => model.id === "gpt-5.6-luna").provenance, "configured");
    assert.equal(configured.models.find((model) => model.id === "gpt-5.6-sol").availability, "unsupported");
  } finally {
    if (previousCodexHome == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(directory, { recursive: true, force: true });
  }
});
