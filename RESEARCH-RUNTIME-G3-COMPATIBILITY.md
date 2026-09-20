# G3 Compatibility Gate — Deep Agents JS dependency set

**Gate:** G3 from `RESEARCH-RUNTIME-ARCHITECTURE.md` §14
**Date:** 16 September 2026
**Scope:** investigation and compatibility verification only. No production application code was modified. No implementation slice was started.
**Method:** two isolated scratch projects outside the repository, using the repository's own Node runtime. Failures were captured, not worked around.

---

## 1. Environment

| Item | Value |
|---|---|
| Node | **v26.8.1** |
| `NODE_MODULE_VERSION` (ABI) | **147** |
| npm | **11.19.0** |
| OS | macOS 26.4 (build 25E246), Darwin 25.4.0 |
| Architecture | **arm64** (Apple Silicon) |
| Repository `engines.node` | `>=22.13.0` — host satisfies it |
| Scratch project A | `…/scratchpad/g3` — main dependency set |
| Scratch project B | `…/scratchpad/g3-sqlite` — SQLite checkpointer, installed separately to isolate the native build |

Both scratch projects are ESM (`"type": "module"`), matching the repository.

---

## 2. Install — main dependency set

Command (project A):

```
npm install deepagents@1.13.4 @langchain/langgraph@1.4.15 langchain@1.5.11 \
            @langchain/core@1.2.11 langsmith @langchain/langgraph-sdk \
            @langchain/langgraph-checkpoint
```

**Result: clean.** `added 43 packages, and audited 44 packages in 7s`, `found 0 vulnerabilities`. No build step, no install scripts, no native compilation.

### Resolved versions

| Requested | Resolved | Note |
|---|---|---|
| `deepagents@1.13.4` | **1.13.4** | exact |
| `@langchain/langgraph@1.4.15` | **1.4.15** | exact |
| `langchain@1.5.11` | **1.5.11** | exact |
| `@langchain/core@1.2.11` | **1.2.11** | exact |
| `langsmith` (floating) | **0.9.0** | inside the peer range `>=0.7.1 <0.10.0` |
| `@langchain/langgraph-sdk` (floating) | **1.11.0** | architecture cited peer `^1.9.23`; 1.11.0 satisfies it |
| `@langchain/langgraph-checkpoint` (floating) | **1.1.5** | matches peer `^1.1.5` |

**Total transitive tree: 47 packages.** Notable transitives: `zod@4.6.5`, `js-tiktoken@1.0.21`, `openai` (optional, unmet), `fast-glob`, `micromatch`, `yaml`, `p-queue`, `p-retry`, `mustache`, `@cfworker/json-schema`, `@langchain/protocol@0.0.19`.

### Peer dependency warnings

**No unmet required peers.** Five unmet **optional** peers, all expected and all unused by the proposed design:

| Unmet optional peer | Owner | Relevance |
|---|---|---|
| `react@^18 \|\| ^19`, `react-dom@^18 \|\| ^19` | `@langchain/langgraph-sdk` | React `useStream` hooks. Not used — the design polls. |
| `@opentelemetry/api`, `@opentelemetry/exporter-trace-otlp-proto`, `@opentelemetry/sdk-trace-base` | `langsmith` | OTel trace export. Not used. |
| `openai@*` | `langsmith` | OpenAI wrapper helpers. Not used. |
| `ws@>=7` | `@langchain/langgraph-sdk` | WebSocket transport. Not used. |

That `langsmith`'s OTel and `openai` integrations are *optional* peers is a useful confirmation: the tracing and provider integrations are genuinely opt-in at the dependency level, not merely at the config level.

---

## 3. Import and public API verification

Script: `verify-api.mjs`. All imports resolved in **1059 ms**. **27 of 27 checks passed.**

### APIs the architecture depends on — all present

| API | Source | Status |
|---|---|---|
| `createDeepAgent` | `deepagents` | ✅ |
| `createSubAgentMiddleware`, `createSubAgent` | `deepagents` | ✅ |
| `StateBackend`, `FilesystemBackend`, `CompositeBackend`, `StoreBackend` | `deepagents` | ✅ |
| `createFilesystemMiddleware`, `createSummarizationMiddleware` | `deepagents` | ✅ |
| `GENERAL_PURPOSE_SUBAGENT` | `deepagents` | ✅ |
| `modelCallLimitMiddleware`, `toolCallLimitMiddleware` | `langchain` | ✅ |
| `summarizationMiddleware`, `humanInTheLoopMiddleware`, `toolRetryMiddleware`, `tool` | `langchain` | ✅ |
| `MemorySaver`, `GraphRecursionError` | `@langchain/langgraph` | ✅ |
| `BaseCheckpointSaver` | `@langchain/langgraph-checkpoint` | ✅ |

### Constructed successfully, not merely present

- `new StateBackend()` → `StateBackend`
- `new MemorySaver()` → `MemorySaver`
- `toolCallLimitMiddleware({ toolName: "task", runLimit: 3, exitBehavior: "error" })` → `ToolCallLimitMiddleware[task]`
- `modelCallLimitMiddleware({ runLimit: 10, exitBehavior: "error" })` → `ModelCallLimitMiddleware`

The exact option shapes the architecture specifies are accepted at runtime, not just type-compatible.

### Avoid-list APIs confirmed to exist

`LocalShellBackend`, `ContextHubBackend`, `LangSmithSandbox` all exist and are constructible. The architecture's decision to avoid them is therefore a real choice with real consequences, not a moot point about absent features.

---

## 4. Minimal Deep Agents execution

Script: `minimal-graph.mjs`. Executed with a locally defined `FakeToolCallingModel` (extends `BaseChatModel`, implements `bindTools` and `_generate`) — **no provider package, no API key, no network**.

```
createDeepAgent returned: ReactAgent
has .invoke: function | has .stream: function
has .getState: function | has .checkpointer: true
invoke OK in 24ms; messages=2
last message: "Final answer: 42."
usage_metadata surfaced: {"input_tokens":11,"output_tokens":7,"total_tokens":18}
checkpoint thread readable; next=[] | checkpoint_id=present
NETWORK ATTEMPTS: 0
```

Confirmed: graph construction, execution, `thread_id` handling, `getState` retrieval, `checkpoint_id` presence, and `usage_metadata` propagating from the model to the final `AIMessage` — the mechanism `ResearchUsage` normalisation depends on (§8.3).

`recursionLimit: 8` and `maxConcurrency: 2` were accepted on the invoke config.

---

## 5. LangSmith independence

Method: a **network sentinel** (`net-sentinel.mjs`) patched `globalThis.fetch`, `http.request` and `https.request` to record and then *throw* on any outbound attempt. Every scenario ran with `LANGSMITH_API_KEY`, `LANGSMITH_TRACING`, `LANGCHAIN_API_KEY` and `LANGCHAIN_TRACING_V2` removed from the environment.

| Scenario | Network attempts |
|---|---|
| Minimal graph | **0** |
| Subagent fan-out (parent + 2 workers) | **0** |
| SQLite-backed graph, turn 1 | **0** |
| SQLite-backed graph, after restart | **0** |

Environment confirmed clean at runtime: `LANGSMITH_*` → `(none)`, `LANGCHAIN_*` → `(none)`.

**Result: no required LangSmith runtime dependency and no network requirement.** The `langsmith` package is resident and resolvable (it is a mandatory peer dependency, as the architecture states), but it is entirely inert without configuration. This matches §12 exactly.

---

## 6. Subagent API verification

Script: `subagents.mjs`. Parent with two subagents, each given a **distinct model instance** so routing could be observed rather than assumed.

```
planner.calls: 2     worker1.calls: 1     worker2.calls: 1
distinct models actually invoked: YES
parent bound tools:       ["delete","edit_file","glob","grep","ls","read_file","task","write_file"]
researcher-1 bound tools: ["delete","edit_file","glob","grep","ls","read_file","write_file"]
DEPTH-1 STRUCTURAL: 'task' absent from subagent tools: YES
```

**Per-role model routing works.** Three separate model objects were each invoked the expected number of times. The planner/researcher/verifier/synthesiser tiering in §8.1 is sound.

**Depth-1 containment works.** `task` is present on the parent and absent from the subagent. A researcher physically cannot delegate. This is the architecture's strongest control and it holds.

---

## 7. Budget ceiling verification (§9.1)

Script: `ceilings.mjs`. This is the R1 mitigation — the claim that Eversor can enforce ceilings the runtime does not provide.

| Test | Setup | Result |
|---|---|---|
| **A — fan-out, `exitBehavior:"error"`** | planner requests 6 `task` calls, `runLimit: 3` | **ENFORCED.** Threw `ToolCallLimitExceededError: 'task' tool call limit reached: run limit exceeded (6/3 calls).` |
| **B — fan-out, `exitBehavior:"continue"`** | same, `exitBehavior:"continue"` | **ENFORCED, gracefully.** Exactly 3 subagents executed; 3 blocked with `"Tool call limit exceeded. Do not call 'task' again."` |
| **C — model call ceiling** | `runLimit: 2, exitBehavior:"error"`, model scripted for 4 turns | **ENFORCED.** Threw `ModelCallLimitMiddlewareError` after exactly 2 calls. |
| **E — recursion limit** | infinite tool loop, `recursionLimit: 4` | **ENFORCED.** Threw `GraphRecursionError`. |
| **F — AbortSignal** | pre-aborted `AbortController` passed as `signal` | **HONOURED.** Threw `DOMException: This operation was aborted`. |

**All five hard ceilings in §9.1 are technically enforceable on this version.** Mode B is a better default than the architecture assumed: `"continue"` caps fan-out at exactly N *and* feeds the model a corrective message, so the run completes with a bounded result instead of failing outright. Recommend `"continue"` for the researcher ceiling and `"error"` only where a breach should abort the run.

### Test D — `generalPurposeAgent: false` — corrected finding

The first measurement was inconclusive because it inspected the `task` tool's description text. A direct probe (`gp-probe.mjs`) that actually invokes `subagent_type: "general-purpose"` is definitive:

| Construction | Invoking `general-purpose` |
|---|---|
| `createDeepAgent({ subagents: [...] })` | **ACCEPTED** — general-purpose silently available |
| `createSubAgentMiddleware({ generalPurposeAgent: false })` | **REJECTED** — `Error: invoked agent of type general-purpose, the only allowed types are \`researcher-1\`` |
| `createSubAgentMiddleware({ generalPurposeAgent: true })` | **ACCEPTED** |

Two consequences, both discrepancies with the architecture as written — see §10.

---

## 8. SQLite checkpointer — `@langchain/langgraph-checkpoint-sqlite@1.0.4`

Installed separately in project B.

### 8.1 Native build

**Prebuilt binary used. No compilation.**

```
npm info run better-sqlite3@12.11.1 install: prebuild-install || node-gyp rebuild --release
prebuild-install info looking for local prebuild @ prebuilds/better-sqlite3-v12.11.1-node-v147-darwin-arm64.tar.gz
prebuild-install info found cached prebuild
prebuild-install info install Successfully installed prebuilt binary!
npm info run better-sqlite3@12.11.1 install { code: 0, signal: null }
```

| Detail | Value |
|---|---|
| `better-sqlite3` resolved | **12.11.1** |
| Binary | `build/Release/better_sqlite3.node`, Mach-O 64-bit bundle arm64, 1,932,672 bytes |
| Provenance | **prebuilt**, served from the local npm prebuild cache |
| `node-gyp` invoked? | **No.** No `Makefile` in `build/` — compilation never ran. |
| Install time | 3 s total for 51 packages |

The local hit came from cache, so upstream availability was verified independently. **Upstream prebuilds for ABI v147 (Node 26) exist for every platform that matters**: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linux-arm`, `linuxmusl-{x64,arm64,arm}`, `win32-x64`, `win32-arm64`. A fresh machine or CI runner will not compile either.

Two warnings, both benign:

- `npm warn deprecated prebuild-install@7.1.3: No longer maintained.` — the download helper, not the library. If it eventually breaks, the fallback is `node-gyp` compilation, not failure.
- `npm warn install-scripts 1 package has install scripts not yet covered by allowScripts: better-sqlite3@12.11.1` — npm 11 lifecycle-script policy. **This is the one operational consequence**: the repository currently has zero packages with install scripts, so adding this one introduces an install-script approval step for anyone with a strict `allowScripts` policy. The repository `.npmrc` (`fund=false`, `audit=false`) does not currently set such a policy.

### 8.2 Functional verification

```
instantiated: SqliteSaver
put OK; returned thread_id: g3-thread | checkpoint_id: 0000-g3-checkpoint-0001
read-back in SAME process: {"note":"written before restart"}
read-back checkpoint id matches: true
DB file: g3-checkpoints.sqlite3, 20480 bytes
```

Fresh Node process (`cp-read.mjs`, pid 59078, separate invocation):

```
read-back AFTER RESTART: {"note":"written before restart"}
checkpoint id: 0000-g3-checkpoint-0001
list() returned 1 checkpoint(s): ["0000-g3-checkpoint-0001"]
EXIT=0
```

`SqliteSaver` exposes `fromConnString` plus `setup`, `getTuple`, `list`, `put`, `putWrites`, `deleteThread`, `migratePendingSends`.

### 8.3 Graph-level durability across restart

Beyond the raw checkpointer, a real Deep Agents graph was checkpointed to SQLite and continued in a **separate Node process**:

```
--- WRITE ---   turn 1 committed with durability:'sync'; network attempts: 0
--- RESTART --- FRESH process pid: 59281
state restored from disk; messages in thread: 2
first user message: "remember: alpha"
continued thread; total messages now: 4
network attempts: 0
```

**Thread state survives process death and the conversation continues from it.** `durability: "sync"` was accepted on the invoke config. This is strong evidence for slice 3, though it does **not** yet answer the harder question (R6): whether a node interrupted *mid-execution* resumes or re-executes. That still requires the slice-3 crash experiment.

### 8.4 Coexistence with `node:sqlite`

```
node:sqlite rows: 1 | SqliteSaver: SqliteSaver -> COEXIST OK
```

`node:sqlite` `DatabaseSync` and `better-sqlite3` operate in the same process without conflict. The architecture keeps them in separate processes anyway, but this removes a latent concern.

---

## 9. Warnings — complete list

| Warning | Where | Severity |
|---|---|---|
| 5 unmet **optional** peers (react, react-dom, 3× opentelemetry, openai, ws) | main set | None — all unused |
| `prebuild-install@7.1.3` deprecated | SQLite set | Low — helper only, node-gyp fallback exists |
| `install-scripts not yet covered by allowScripts: better-sqlite3@12.11.1` | SQLite set | **Low–medium — the only real operational change** |
| `0 vulnerabilities` | both | — |

No runtime incompatibilities were found. No deprecation warnings from Node itself. No ESM/CJS interop problems.

---

## 10. Discrepancies with `RESEARCH-RUNTIME-ARCHITECTURE.md`

Five. Two require wording changes to the architecture; one requires a substantive correction; two are favourable.

### D1 — **Substantive.** "An explicit `tools` array overrides inherited tools entirely" is wrong

**Architecture claims** (§9.1, §10.2): passing `tools` replaces inherited tools entirely, and lists "Tool allowlist — `tools` replaces, not extends. **Technical.**"

**Observed:** a subagent declared with `tools: []` was still bound eight tools: `delete`, `edit_file`, `glob`, `grep`, `ls`, `read_file`, `write_file` — plus `task` on the parent. Filesystem tools arrive from **middleware**, not from the `tools` list, so `tools` does not control them.

**Why it does not break the design:** the depth-1 control survives intact, because `task` *is* excluded from subagents (verified). And the filesystem tools are backed by `StateBackend`, which never touches the host filesystem — so there is no security breach, only an inaccurate description of the mechanism.

**Smallest correction:** §10.2 must say the tool boundary is enforced by **the backend and the middleware set**, not by the `tools` array. To remove filesystem tools entirely, the agent must be composed from explicit middleware rather than relying on `tools: []`. The `StateBackend` choice is doing more of the security work than §10.2 credits it for.

Also note an undocumented tool: `delete` is bound but is not in the documented filesystem tool list (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`). It must be accounted for in the allowlist review.

### D2 — **Substantive.** `generalPurposeAgent: false` only works via explicit middleware

**Architecture claims** (§8.4): "Set it `false`."

**Observed:** `createDeepAgent({ subagents: [...] })` silently includes a working `general-purpose` subagent — there is no `generalPurposeAgent` option on `createDeepAgent` itself. Disabling requires composing `createSubAgentMiddleware({ generalPurposeAgent: false, subagents: [...] })` and passing it as `middleware`.

**Smallest correction:** §8.1's code sample must be rewritten to build subagents through `createSubAgentMiddleware`, not through the `subagents` shorthand. Without this the worker-count ceiling leaks — an unaudited extra worker with filesystem tools, which is exactly what §8.4 set out to prevent.

**Additional finding:** even when disabled, the `task` tool's *description* still advertises `general-purpose` as an available type. Enforcement is real (the call is rejected), but the model will be told the worker exists and will waste calls attempting it. Worth a corrective line in the planner prompt.

### D3 — Minor. `createDeepAgent` returns `ReactAgent`, not a compiled graph

The `deepagentsjs` README states it "returns a compiled LangGraph graph". It returns a `ReactAgent` exposing `invoke`, `stream`, `getState` and `checkpointer` — but **not** `getGraph`, and without `lg_is_pregel`. Every method the architecture actually uses is present, so this is a labelling correction to the §2.2 diagram, nothing more.

### D4 — Favourable. The dependency tree is far smaller than implied

§6 argues against in-process execution partly on dependency weight. The real number is **47 packages, zero native, zero install scripts**. The child-process recommendation still stands — it is justified by crash isolation, OOM containment and the exclusive store lock, which are the strong arguments — but the "dependency weight" argument should be dropped, because it is not true.

### D5 — Favourable. R5 is substantially smaller than ranked

§13 ranks R5 (`better-sqlite3` native dependency) at Medium/Medium with Node 26 prebuild availability "UNVERIFIED". Verified: prebuilds exist for ABI v147 across all nine relevant platform triples, and no compilation occurred. **R5 should be downgraded to Low/Low**, with the residual risk restated as *"adds the repository's first install-script package"* rather than *"may require native compilation"*.

Consequently the §7.2 three-option ladder collapses. Option 3 (hand-writing a `BaseCheckpointSaver` over `node:sqlite`) can be struck — it was only ever insurance against a native build failure that does not occur.

---

## 11. Verdict

Every load-bearing claim in the architecture was tested. The dependency set installs cleanly on the repository's Node runtime, every assumed API exists and behaves as specified, all five hard ceilings are technically enforceable, LangSmith is genuinely inert, and the SQLite checkpointer installs prebuilt and survives process restart at both the raw and graph level.

Two API-composition details were wrong in the architecture. Neither invalidates the design, neither changes the process boundary, the persistence split or the runtime recommendation — but both must be corrected before slice 4, because both concern the worker-count and tool-allowlist controls that the whole guardrail argument rests on.

### `G3_PASS_WITH_CHANGES`

**Smallest architectural change required** — three edits to `RESEARCH-RUNTIME-ARCHITECTURE.md`, no change to any decision:

1. **§8.1 / §8.4** — rewrite the agent-construction sample to compose subagents via `createSubAgentMiddleware({ defaultModel, generalPurposeAgent: false, subagents: [...] })` passed as `middleware`, instead of the `createDeepAgent({ subagents })` shorthand. *(Reason: D2 — the shorthand silently admits an unaudited general-purpose worker, defeating the worker-count ceiling.)*

2. **§9.1 / §10.2** — restate the tool boundary as enforced by **the backend plus the middleware set**, not by the `tools` array. Keep the depth-1 claim, which is verified, but stop attributing it to "`tools` replaces inherited tools entirely". Add `delete` to the tool inventory. *(Reason: D1.)*

3. **§13 / §7.2** — downgrade R5 to Low/Low, restate its residual as "introduces the repository's first install-script dependency", and strike the hand-written-checkpointer fallback. *(Reason: D5.)*

Optional, recommended: change the researcher fan-out ceiling to `exitBehavior: "continue"` (test B), which caps the count *and* returns a usable bounded result rather than aborting the run.

**Gate G3 is satisfied. Implementation slices were not started, as instructed.**

---

## Appendix — artefacts

All under `…/scratchpad/`, outside the repository:

| Path | Purpose |
|---|---|
| `g3/install-main.log` | main dependency set install transcript |
| `g3/verify-api.mjs` · `.log` | 27 API existence and construction checks |
| `g3/fake-model.mjs` | `BaseChatModel` subclass — no network, no key |
| `g3/net-sentinel.mjs` | records and blocks all outbound network |
| `g3/minimal-graph.mjs` · `.log` | smallest graph, execution, usage, checkpoint |
| `g3/subagents.mjs` · `.log` | per-role model routing, depth-1 containment |
| `g3/ceilings.mjs` · `.log` | tests A–F: fan-out, model calls, recursion, abort |
| `g3/gp-probe.mjs` · `.log` | definitive `generalPurposeAgent` behaviour |
| `g3-sqlite/install-sqlite.log` | native install transcript (prebuild evidence) |
| `g3-sqlite/cp-write.mjs`, `cp-read.mjs` | checkpoint write / cross-process read |
| `g3-sqlite/graph-restart-{write,read}.mjs` | graph-level durability across restart |
