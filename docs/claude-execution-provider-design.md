# Claude as a second execution provider — Phase 1 design

Status: **design only, awaiting review.** No implementation code written.
Branch: `claude-execution-provider` (from `main` @ `5c385ba`).
Date: 2026-08-05.

## 0. What was verified, and what could not be

Everything in this document about the Claude CLI was checked against the installed
binary and against real `claude -p` runs rather than assumed. Results are summarised in §6.

Installed CLI: `claude` 2.1.222, `~/.local/bin/claude` → a compiled native arm64
binary at `~/.local/share/claude/versions/2.1.222`. It is not a JS bundle, so the
settings-schema facts below come from string extraction against that binary plus the
`--help` output; the wire-format, sandbox and pricing facts come from real `claude -p` runs
captured during this session.

**Live verification is complete.** An earlier revision of this document recorded that a
child `claude` could not authenticate from this session. The operator has since logged the
CLI in (`claude auth status` → `{"loggedIn": true, "authMethod": "claude.ai",
"subscriptionType": "team"}`), and **every item that was previously marked
[UNVERIFIED] has now been checked against real `claude -p` runs.** Results are folded into
the sections below and summarised in §6. Four claims in the earlier revision were wrong and
are corrected in place; they are listed in §6 so a reviewer who read the earlier version
knows what changed.

Captured artefacts (scratchpad, to be committed as the Phase 2 step-2 fixture):
`fixture.jsonl` (12 events: Read, two parallel Bash calls, one failing, final text,
cumulative usage), `sb1.jsonl` / `sb2.jsonl` / `sb3.jsonl` (sandbox canary, escape-hatch
attempt, `--safe-mode` interaction).

---

## a) Sandbox mapping

### What Codex gives today

Seven stages run `codex exec --sandbox read-only`: triage, scouts, grill, specification,
plan, dev-review, final-review. Three run `workspace-write`: implement, repair, test
(`test` is forced to `workspace-write` with `networkAccess: true` at
[orchestrator.mjs:1166](../server/orchestrator.mjs)).

`read-only` is a **single OS-level guarantee covering everything the agent does** — its
own file-edit path and any command it spawns, plus no network. One flag, one enforcement
boundary, no model-reachable escape hatch.

Note which stages run *where*: triage, scouts, grill, specification and plan run against
`task.repositoryPath` — the operator's real working tree, not a worktree. dev-review,
test and final-review run against `candidate.worktreePath`.

### What Claude actually has

There is no equivalent single flag. `--permission-mode plan` is not it: plan mode is a
permission-layer posture, not a filesystem guarantee, and it does not confine Bash. A
read-only posture has to be assembled from four independent layers, and only the fourth
is ours.

**L1 — Tool surface.** `--tools Read,Grep,Glob,Bash` (and/or `--disallowed-tools`).
Tools not listed are not present in the request at all, so `Write`, `Edit`,
`NotebookEdit`, `WebFetch`, `WebSearch` and `Task` cannot be called. This is real
enforcement for the file-edit tools. It does nothing about Bash.

**L2 — OS sandbox for Bash.** The CLI has a genuine kernel-level sandbox
(`sandbox_exec`/seatbelt on macOS, seccomp on Linux), configured through a `sandbox`
object in settings. Verified keys: `sandbox.enabled`, `sandbox.failIfUnavailable`,
`sandbox.allowUnsandboxedCommands`, `sandbox.autoAllowBashIfSandboxed`,
`sandbox.filesystem.{allowRead,denyRead,allowWrite,denyWrite,disabled,allowManagedReadPathsOnly}`,
`sandbox.network.{allowedDomains,deniedDomains,strictAllowlist,allowManagedDomainsOnly}`,
`sandbox.credentials.*`. `--settings` accepts an inline JSON string, so the harness can
supply this per spawn without touching the operator's `~/.claude/settings.json`.

`sandbox.failIfUnavailable: true` is **mandatory**, not optional. Its own documented
default is `false`, and the documented `false` behaviour is: *"a warning is shown and
commands run unsandboxed."* A harness that omits it gets silent unconfined execution on
any host where the sandbox runtime is missing.

**It does not abort the run, though — it fails closed per command.** Verified against a
genuinely unavailable sandbox: individual Bash calls fail with the sandbox error and
nothing executes or escapes, but the run itself continues and the model simply reports the
failure. This matters for verification design rather than for safety: a canary built on
*"the write was refused and the guarded file is unchanged"* observes exactly the same two
things whether the sandbox is enforcing or dead, so it can pass while the mechanism it
exists to check is absent. A canary must therefore assert that the sandbox **started**
before interpreting any refusal, and treat inconclusive as failure.

**L3 — Closing the model-reachable escape hatch.** This is the difference in kind from
Codex. The Bash tool takes a `dangerouslyDisableSandbox: true` parameter, and the CLI's
own tool description instructs the model to *"Immediately retry with
`dangerouslyDisableSandbox: true` (don't ask, just do it)"* when a command fails for
sandbox reasons. Codex has nothing like this — its sandbox cannot be waived by the
model.

Two things gate it. First, unsandboxed execution *"goes through the permission gate"*,
and in non-interactive `-p` with no matching allow rule there is no one to approve, so it
is denied and recorded in `result.permission_denials`. Second,
`sandbox.allowUnsandboxedCommands: false` yields *"All commands MUST run in sandbox mode
— the `dangerouslyDisableSandbox` parameter is disabled by policy."* The internal
predicate behind that message is named `areUnsandboxedCommandsForbiddenByPolicy`, and a
sibling setting (`sandbox.filesystem.disabled`) is documented as managed-settings-only
under some conditions, so whether the flag form is honoured is still unconfirmed.

**Verified live, and the answer makes that question moot in the safe direction.** With
`allowUnsandboxedCommands` left at its default (i.e. *permissive*), and the model
explicitly instructed to escalate, it attempted `dangerouslyDisableSandbox: true` twice.
Both attempts were **denied by the permission gate**, the file was not mutated, and both
denials were recorded in `result.permission_denials` with the full `tool_input`:

```jsonc
// tool_use
{"command":"printf 'MUTATED' > guarded.txt","dangerouslyDisableSandbox":true}
// tool_result
{"is_error":true,"content":"Output redirection to '…/guarded.txt' was blocked. For
 security, Claude Code may only write to files in the allowed working directories…"}
// second attempt
{"is_error":true,"content":"Run outside of the sandbox"}
// result
{"permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_…","tool_input":{…}}, …]}
```

Two things worth noting. The permission gate holds under `-p` **without** relying on
`allowUnsandboxedCommands: false`; set it anyway as belt-and-braces, but the gate is the
load-bearing layer. And the first denial came from a **second, independent write guard** —
a permission-layer allowed-working-directories check, distinct from seatbelt — so two
unrelated mechanisms refused the same write.

**Since resolved, in the stronger direction.** The question above — whether
`allowUnsandboxedCommands: false` is honoured from `--settings` or only from managed
settings — is answered: **it is honoured from `--settings`.** The status-time canary made a
real `dangerouslyDisableSandbox: true` attempt and it was refused at the sandbox/policy
layer without ever reaching the permission gate. So the escape is closed one layer earlier
than this section assumed, and the permission gate is a backstop rather than the only thing
standing in the way.

**L4 — Harness verification.** Pre- and post-run exact-HEAD-SHA plus clean-status
checks. This is the only layer the harness controls end to end, and it is therefore the
enforcement of record. L1–L3 are defence in depth.

**L2 verified working.** With `sandbox.enabled: true`, `failIfUnavailable: true` and
`filesystem.denyWrite: ["<worktree>"]` supplied through `--settings`, a Bash write into the
guarded worktree was refused at the syscall boundary and the file was untouched:

```jsonc
{"type":"tool_use","name":"Bash","input":{"command":"echo MUTATED > guarded.txt"}}
{"type":"tool_result","is_error":true,"content":"Exit code 1\n(eval):1: operation not permitted: guarded.txt"}
```

Note the shape of that content — it carries an `Exit code 1` prefix. That has a direct
consequence for `commandFailed`; see §c.

**Write mode: the obvious config was a trap.** (Superseded in part — candidates now live
outside the checkout; see "Candidate worktrees moved out of the repository" below. The
conclusion still holds: no `denyWrite` is added in write mode.) The natural shape —
`denyWrite` on the source repo, `allowWrite` on the worktree — did not work, because the
harness nested the worktree *inside* the repo (`.data/worktrees/<task>/<candidate>`). The repo-root `denyWrite`
is therefore an ancestor of the `allowWrite`, and an ancestor deny unconditionally defeats a
nested allow: it blocks every write, including the legitimate ones the stage exists to make.
The failure presents as "Claude cannot write to its own worktree", which reads as a
capability limit rather than a misconfiguration.

The sandbox is **default-deny**, so `allowWrite: [worktreePath]` alone is both necessary and
sufficient. Do not add a repo-root `denyWrite` in write mode. Read-only mode is unaffected —
its `denyWrite` has no nested `allowWrite` to defeat, and is belt-and-braces on top of
default-deny.

Two further write-mode findings:

- The **Write tool** additionally needs `permissions.allow` plus
  `--permission-mode acceptEdits`. Bash writes need neither, and escalation is still denied
  under `acceptEdits`.
- **The sandbox matches resolved paths, not literal prefixes.** A write through the
  provisioned `node_modules` symlink — literal path inside the worktree, real target inside
  the source repo — was blocked. This closes the `provisionDependencies` escape route that
  this section previously flagged as the central open risk for write stages.

Evidence: `docs/claude-write-confinement-spike.md`, six tests captured from real runs.

**Operational limit worth monitoring.** On a long cwd the Bash sandbox profile hit `E2BIG`
at 212 filesystem deny paths; it did not reproduce on a short path. Write stages always run
with cwd inside a worktree, so hosts that accumulate worktrees may approach this. Whether
the deny list scales with worktree count or is fixed is not yet established — that
determines whether this is a monitoring note or a hard precondition.

**A fifth consideration the earlier revision missed: operator hooks run inside stages, and
they rewrite commands after the fact.** In the escape-hatch run, the recorded `tool_use`
carried `ls -la guarded.txt 2>&1; cat guarded.txt 2>&1`, but the denial's `tool_input`
recorded `rtk ls -la guarded.txt 2>&1; rtk read guarded.txt 2>&1` — the operator's global
RTK hook had rewritten the command *between* the `tool_use` event the harness would record
and the command that was actually submitted. For a system whose premise is that recorded
activity reflects what happened, `tool_use.input.command` is therefore **not necessarily
what executed**. This upgrades `--safe-mode` (which skips hooks) from a determinism nicety
to a **safety requirement**: without it, arbitrary operator hook code executes inside every
harness stage and can rewrite commands the harness has already attested to. Verified: with
`--safe-mode` the same command ran unrewritten.

### Where the two sandboxes are *not* equivalent

Stating these rather than glossing them:

1. **Two mechanisms instead of one.** Codex denies writes at the syscall boundary for the
   whole agent. Claude's file-edit tools are gated by the tool allowlist (L1) while Bash
   is gated by the OS sandbox (L2) — different mechanisms with different failure modes. A
   config error in either one leaves a distinct hole. Note also that
   `sandbox.filesystem.allowWrite` is documented as *"Merged with paths from `Edit(...)`
   allow permission rules"*, i.e. the sandbox layer governs *sandboxed commands*; the
   Edit tool is governed by the permission layer. They are not one system.
2. **The model can request a waiver.** L3 above. Codex cannot.
3. **Network isolation is opt-in, not implied.** Codex `read-only` has no network.
   Claude needs `sandbox.network.strictAllowlist: true` with an empty `allowedDomains` for
   deterministic denial, and that governs sandboxed commands only — `WebFetch`/`WebSearch`
   must be removed at L1, and the CLI's own API traffic is outside the sandbox (which is
   correct and necessary).
4. **Availability differs.** With `failIfUnavailable: true`, a host lacking the sandbox
   runtime cannot run read-only Claude stages at all, while Codex read-only still works
   there. That is the right failure direction, but it means the provider's status must
   report read-only execution as *unavailable* on such a host rather than degrading.

**Conclusion for (a): there is no single Claude flag with a guarantee equivalent to
`codex exec --sandbox read-only`.** That conclusion survives verification. What changed is
the confidence in the layered substitute: L2 demonstrably blocks writes at the syscall
boundary, the model-waivable escape is demonstrably denied by the permission gate under
`-p` and is loudly reported in `permission_denials`, and a second independent write guard
also fires. On this host, a correctly configured read-only Claude stage held against a
model actively instructed to break out.

That is a good result, and it is still four coupled configuration layers rather than one
guarantee — three of them provider-controlled, any of which a future CLI release could
change without notice, and one (hooks) that the operator's own settings can perturb. So
the design still takes the fallback the brief names: the harness's own pre- and post-SHA
and clean-status verification is the enforcement of record, provider configuration is
defence in depth, and the canary in §6 re-establishes the L2/L3 result **on every host at
status time** rather than trusting this one measurement.

### The invariant a mutating reviewer breaks — stated plainly

Promotion depends on exact-SHA equality in three places:

- [orchestrator.mjs:1568](../server/orchestrator.mjs) — `gateReservation.candidateHeadRevision !== candidate.headRevision` refuses approval.
- [orchestrator.mjs:1576](../server/orchestrator.mjs) — `sourceRun.candidateHeadRevision !== candidate.headRevision` refuses approval.
- [git-worktree.mjs:174](../server/git-worktree.mjs) — `merge()` refuses when the worktree HEAD no longer matches `candidate.headRevision`.

A reviewer that can mutate the candidate it is reviewing breaks these in two different
ways, and only one of them is currently caught:

**Shape 1 — the reviewer commits.** HEAD changes, so all three exact-SHA checks fail
closed and `merge()` refuses. Detected today, for any provider.

**Shape 2 — the reviewer dirties the worktree without committing.** HEAD is unchanged, so
every exact-SHA check above passes. `merge()` calls `assertClean` on the *source
repository root*, not on the worktree, and `merge --ff-only` takes the recorded commit —
so the dirt is not merged. But the gate's structured evidence now attests to file
contents that were never in the reviewed commit: the reviewer read, tested and passed
something other than the SHA the verdict is bound to. **Every exact-SHA check still
reports agreement, because the SHA genuinely did not change.** That is the silent
invalidation.

How far shape 2 gets today:

- `#runEvaluation` ([orchestrator.mjs:920](../server/orchestrator.mjs)) calls
  `verifyCandidate` (exact HEAD + `assertClean`) **before** the agent, and re-verifies
  **after** only when `stageId === "test"`.
- So a **dev-review** mutation is caught incidentally, at the next stage's pre-run
  `verifyCandidate`.
- A **final-review** mutation is caught nowhere. final-review is the last gate; after it
  passes, merge follows, and no code path between them calls `assertClean` on the
  worktree.

This is a hole today, not a hole Claude introduces — Codex's read-only sandbox is what
currently makes the missing post-check harmless. It stops being harmless the moment a
provider with weaker confinement runs a review stage.

**Design decision.** Before any Claude review stage is enabled, add a post-run
`verifyCandidate` to **all** read-only candidate-scoped stages, for **both** providers.
On failure the run is not a failed review — it is invalid evidence: route it through the
existing `structuredEvidenceError` / rerun-required path
([orchestrator.mjs:989](../server/orchestrator.mjs)) rather than accepting or rejecting
the verdict, and record explicitly that the reviewer mutated the candidate. Do not
silently `recoverCandidate` a review-stage mutation the way the test stage does; the test
stage is *expected* to dirty its worktree, a reviewer is not.

For the five stages that run against `task.repositoryPath`, there is no candidate and no
existing check at all. Add a symmetric snapshot: HEAD SHA plus
`git status --porcelain=v1 --untracked-files=all` before and after; any difference fails
the stage. Mutating the operator's real working tree is strictly worse than mutating a
disposable worktree.

Both additions strengthen existing checks. Neither weakens anything, and neither changes
the evidence contract, gate freshness, or merge safety.

---

## b) Non-interactive invocation and structured output

Verified against the installed CLI (2.1.222).

### Invocation

```
printf '%s' "<prompt>" | claude -p
  --output-format stream-json --verbose
  --model <id> [--effort <level>]
  --safe-mode
  --settings <path-or-inline-JSON>
  --tools Read Grep Glob Bash
  --strict-mcp-config
  --no-session-persistence
  --session-id <uuid>
```

**The prompt goes on stdin, not argv.** This is not merely an `ARG_MAX` preference — it is
forced. `--tools` is a *variadic* option (`<tools...>`), so `--tools Read Grep Glob Bash
'<prompt>'` silently consumes the prompt as another tool name and the CLI fails with
`Error: Input must be provided either through stdin or as a prompt argument when using
--print`. Verified both ways: argv form fails, stdin form works. The same trap applies to
`--allowedTools`, `--disallowedTools` and `--add-dir`.

- There is **no `--cd`**. Codex passes `--cd <cwd>`; Claude inherits the spawn cwd.
  `runProcess` already accepts `options.cwd` and simply never uses it for Codex.
- `--effort` takes `low|medium|high|xhigh|max`. This is the analogue of Codex's
  `model_reasoning_effort`. It must not be passed for models that do not support it
  (see §d).
- `--add-dir` is deliberately **not** used: the agent gets the stage cwd only.
- `--strict-mcp-config` with no `--mcp-config` means no MCP servers, regardless of the
  operator's configuration.
- **`--safe-mode` and `--settings` coexist — verified.** The concern that safe mode might
  drop flag settings (its help says *"Admin-managed (policy) settings still apply"*) does
  not materialise: with `--safe-mode --settings <sandbox>`, the guarded write was still
  refused with the identical seatbelt error, and the RTK hook no longer rewrote the
  command. Use `--safe-mode`; it disables CLAUDE.md, skills, hooks, plugins and custom
  agents while auth, model selection, built-in tools and permissions keep working.
- **Do not use `--bare`.** It also skips hooks, but its help states auth becomes *"strictly
  `ANTHROPIC_API_KEY` or `apiKeyHelper` … OAuth and keychain are never read"* — directly
  incompatible with the "no API keys, use the existing local CLI session" constraint.

### Output format — verified, not assumed to mirror `codex exec --json`

It does not mirror it. `--output-format stream-json` emits newline-delimited JSON, but the
envelope is a Claude-Code session stream, not Codex's `thread.started`/`item.*`/
`turn.completed` schema. Three top-level shapes, all observed live:

```jsonc
{"type":"system","subtype":"init","cwd":"…","session_id":"…","tools":[…],
 "mcp_servers":[],"model":"claude-sonnet-5","permissionMode":"plan","slash_commands":[…]}

{"type":"assistant","message":{ /* Messages-API message: id, model, role, stop_reason,
   usage{…}, content:[{type:"text"|"thinking"|"tool_use", …}] */ },
 "parent_tool_use_id":null,"session_id":"…","uuid":"…","timestamp":"…"}

{"type":"result","subtype":"success","is_error":false,"result":"<final assistant text>",
 "usage":{…},"modelUsage":{…},"total_cost_usd":0,"permission_denials":[],
 "num_turns":1,"duration_ms":45,"duration_api_ms":0,"stop_reason":"…",
 "terminal_reason":"…","session_id":"…","uuid":"…"}
```

Tool results arrive as a fourth shape:

```jsonc
{"type":"user","message":{"role":"user","content":[
  {"type":"tool_result","tool_use_id":"toolu_…","content":"<full output>","is_error":true}]}}
```

And there are **three further top-level types the earlier revision did not know about**, all
observed in the captured fixture. A parser that treats unknown types or unknown `system`
subtypes as errors will break on them:

```jsonc
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1785891600,
  "rateLimitType":"five_hour","overageStatus":"allowed","isUsingOverage":false}}
{"type":"system","subtype":"post_turn_summary","status_category":"review_ready",
  "status_detail":"completed 3 steps: …","needs_action":"","summarizes_uuid":"…"}
{"type":"system","subtype":"thinking_tokens", …}
```

`rate_limit_event` matters beyond tolerance: it is the plan-allocation signal (§d).

Four consequences that matter:

1. **Failures are reported in the `result` line, not on stderr.** The auth-failed run
   exited 1 with empty stderr and the message carried in `result.result` with
   `is_error: true`. Codex's `extractFailure` scans for `turn.failed`/`error` events and
   falls back to stderr; Claude needs its own failure extraction. Do not reuse
   `cleanStderr`.
2. **There is no structured exit code for Bash.** A failed command surfaces as
   `is_error: true` with content beginning `Exit code N\n`. See §c for how `commandFailed`
   handles this, and for why the prefix cannot be used to classify *why* it failed.
3. **`is_error` is asymmetric across tools.** On a successful `Bash` result it is present
   and `false`; on a successful `Read` result it is **absent entirely**. So the success test
   must be `is_error !== true`, never `is_error === false`.
4. **Tool results arrive out of order relative to their `tool_use`.** In the fixture, two
   Bash calls were issued and the *second* call's result arrived before the first's.
   Correlation must be strictly by `tool_use_id`; anything positional is wrong.
5. **`tool_result` carries the full output.** Codex's `item.completed` does not. The
   existing `STDOUT_BUDGET` of 2.5 MB will be hit far earlier and would abort legitimate
   stages. `STDOUT_BUDGET` becomes a per-provider value supplied through the seam
   (proposal: 32 MB streamed for Claude), while the retained tail (`STDOUT_LIMIT`, 2 MB)
   and the "content not retained" discipline in the internal event shape stay exactly as
   they are — the parser discards tool-result bodies at parse time. This is a
   resource-limit change, not a safety check.

---

## c) Event mapping

The internal event shape is unchanged. `run-activity.mjs`, the UI, and
`candidateVerificationCommandFailed` see the same three event types they see today:

```jsonc
{type:"activity", tone, title, detail, commandFailed?, runtimeScope?,
 toolCall:{id, name, category, server?, phase, result}}
{type:"message", text}
{type:"usage", usage:{inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, totalTokens}}
```

| Claude stream-json | Internal event |
|---|---|
| `system` / `subtype: "init"` | `activity`, tone `info`, title "Agent session started", detail = `session_id` |
| `assistant` → `content[]` `text` block | buffered; final text taken from `result.result` (fallback: last assistant `text` block) → `message` |
| `assistant` → `thinking` block | dropped — Codex never surfaced reasoning either |
| `assistant` → `tool_use`, `name: "Bash"` | `activity` info, title "Inspecting repository", detail = `input.command`, `toolCall{id: block.id, name:"command_execution", category:"repository-command", phase:"started"}` |
| `assistant` → `tool_use`, other built-in | `toolCall{name: block.name, category:"builtin-tool", phase:"started"}` |
| `assistant` → `tool_use`, `mcp__<server>__<tool>` | `toolCall{name:<tool>, category:"mcp", server:<server>, phase:"started"}` |
| `user` → `tool_result` | completion for the matching `tool_use_id`; `phase:"completed"`; success = `is_error !== true` |
| `result` → `usage` | `usage` event |
| `result` → `permission_denials[]` non-empty | one `activity` per denial, tone `danger`, **plus** a thrown stage error |

Reusing Codex's `category: "repository-command"` and `name: "command_execution"` for Bash
is deliberate: `run-activity.mjs` and the UI keep working with no changes, and the
provider seam stays confined to the runtime.

### `commandFailed` — the load-bearing detail

`candidateVerificationCommandFailed` ([orchestrator.mjs:1425](../server/orchestrator.mjs))
turns *any* event with `commandFailed === true` in the test stage into a `REPAIR` verdict.
Getting this wrong either injects spurious REPAIRs or launders real failures. Rules:

- **Set `commandFailed` only for `Bash`.** Codex only ever set it for
  `command_execution`. A failed `Read` or an errored `Grep` must not set it; widening the
  signal would inject spurious REPAIRs.
- **A permission denial never sets `commandFailed`.** It is not a failed verification
  command, it is a policy violation — in a read-only stage it means the agent attempted a
  mutation, and in a write stage it means the tool surface is misconfigured. Either way
  the run is untrustworthy evidence, so the Claude provider **throws** on a non-empty
  `permission_denials`, which routes through the existing failed-run path rather than
  producing a verdict.
- **A sandbox denial is not distinguishable from an ordinary failure, so do not try.** The
  earlier revision proposed classifying by content prefix: `/^Exit code (\d+)/` present ⇒
  ordinary non-zero exit; absent ⇒ policy failure. **Verification killed that rule.** A
  seatbelt-blocked write returns
  `{"is_error":true,"content":"Exit code 1\n(eval):1: operation not permitted: guarded.txt"}`
  — *with* the prefix, because the shell itself exits 1 when the syscall is refused. The
  prefix therefore does not discriminate.

  Revised rule: set `commandFailed: true` for **any** `is_error !== false|undefined` Bash
  result, which is precisely what Codex does (it also cannot tell a blocked command from a
  failing one). Parse `/^Exit code (\d+)/` only to populate
  `toolCall.result = "Exit code N"`, byte-identical to Codex's `commandResult`, falling back
  to the existing concise summary. Detect policy problems **out of band** — via
  `permission_denials` and the harness's own pre/post verification — not by pattern-matching
  tool-result prose. Text like `operation not permitted` is worth logging as a heuristic
  hint; it must not gate a verdict.

  Consequence worth stating: in the `test` stage a sandbox misconfiguration will present as
  an ordinary `REPAIR` rather than as a configuration error. The mitigation is the
  status-time canary (§6), which establishes that the sandbox is configured as intended
  *before* any stage runs, rather than trying to infer it from stage output afterwards.
- **`runtimeScope` is always `"candidate"` for Claude.** The existing
  `"context-preflight"` exemption is Codex-specific: `isRuntimeContextPreflightCommand`
  whitelists a failed `rg` against `~/.codex/memories/{MEMORY.md,memory_summary.md}`.
  Claude has no equivalent preflight. That function and its shell tokenizer stay in the
  Codex provider, unmoved and untouched, so all of its existing tests keep passing.

### Token usage — the mapping is not the identity

`result.usage` fields (verified): `input_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`, `output_tokens`, `cache_creation:{ephemeral_1h_input_tokens,
ephemeral_5m_input_tokens}`, `service_tier`, `iterations[]`, plus `modelUsage` keyed by
model id.

The two providers define `input_tokens` differently, and a naive pass-through mis-prices:

- Codex's `input_tokens` is **inclusive** of `cached_input_tokens`. `priceUsage`
  ([model-catalog.mjs:182](../server/model-catalog.mjs)) computes
  `uncached = input − cached − cacheWrite`, which only makes sense for an inclusive total.
- Anthropic's `input_tokens` is the **uncached remainder only**; the total prompt is
  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.

So the mapping must sum:

```
inputTokens       = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
cachedInputTokens = cache_read_input_tokens
cacheWriteTokens  = cache_creation_input_tokens
outputTokens      = output_tokens
totalTokens       = inputTokens + outputTokens
```

`priceUsage` then recovers `uncached = input_tokens`, correct by construction, and
`enrichUsage`/`priceCredits` need no changes. Passing `input_tokens` straight through
would under-report input by the entire cached prefix — which for a cached agent run is
most of it. Verified on the fixture: `input_tokens: 63` against
`cache_read: 10308` and `cache_creation: 52740`, i.e. the naive reading would have
under-reported input by ~1000×.

**Cumulativeness — resolved.** Top-level `result.usage` is cumulative across the whole run
(4 turns in the fixture) and equals `modelUsage["claude-sonnet-5"]` exactly. So: one `usage`
event per run, emitted from `result`, no accumulation.

**Do not sum `usage.iterations`.** It is not a complete breakdown. The fixture's 4-turn run
carried a single `iterations` entry whose numbers (`input 62`, `cache_creation 46309`,
`output 5`) reconcile with neither the top-level totals nor each other. Treat it as
diagnostic only.

---

## d) Model catalogue and pricing

### What is Codex-shaped today

`readCodexModelCatalog()` reads `~/.codex/models_cache.json`. `MODEL_PRICING` is keyed by
`gpt-5.6-*` / `gpt-5.x`. `MODEL_CREDIT_RATES` are ChatGPT credit rates.
`validatePricingRates` hard-requires all three GPT-5.6 ids. `defaultStagePolicies()`
returns GPT ids for all ten policies. `DEFAULT_RUNTIME_MODEL` is a single global default
(recently and deliberately unified in `abbccb1`).

### Catalogue

Catalogue entries gain `provider: "codex" | "claude"`. `getStatus()` merges both
providers' catalogues into one `catalog.models[]`, so existing consumers see a superset.
`withConfiguredModels` is unchanged except that a configured id with no known provider
resolves to `provider: null, availability: "unsupported"` instead of being attributed to
the wrong provider.

There is no Claude analogue of `models_cache.json`, and `--help` only lists aliases.
Recommendation: a **bundled static list** (`provenance: "bundled"`), because the harness
must not depend on network access and the model set changes slowly:

| id | label | effort levels | default |
|---|---|---|---|
| `claude-opus-5` | Claude Opus 5 | low, medium, high, xhigh, max | xhigh |
| `claude-sonnet-5` | Claude Sonnet 5 | low, medium, high, xhigh, max | xhigh |
| `claude-fable-5` | Claude Fable 5 | low, medium, high, xhigh, max | xhigh |
| `claude-haiku-4-5` | Claude Haiku 4.5 | *(none)* | — |

Codex's `reasoning` maps onto `--effort`; the level names coincide except Codex also has
`ultra`. Levels are validated per model against `reasoningLevels`, and an unsupported
level **refuses to spawn** rather than silently downgrading — mirroring the existing
`Unsupported Codex sandbox` throw. For `claude-haiku-4-5` the provider must omit
`--effort` entirely.

`normalizeModelId` needs no change for Claude ids: `claude-opus-5` is already lowercase
and hyphenated and passes through untouched. Only the *fallback* default becomes
provider-aware. `DEFAULT_RUNTIME_MODEL` / `DEFAULT_RUNTIME_REASONING` become per-provider
defaults behind a single selected provider, preserving the single-source-of-truth
property that `abbccb1` established.

`defaultStagePolicies()` becomes per-provider. Proposed Claude split, mirroring the
existing sol/luna shape: `claude-opus-5` @ `xhigh` for plan, repair, dev-review,
final-review; `claude-sonnet-5` @ `high` for triage, scouts, grill, specification,
implement, test.

### Pricing

Claude entries use the existing `rate(input, cachedInput, cacheWrite, output)` per-1M
shape. Anthropic first-party rates, with cache read at ≈0.1× input and cache write at
**2× input** — the 1-hour TTL multiplier, not the 5-minute 1.25×, because the observed
usage from a real Claude Code session shows `ephemeral_1h_input_tokens: 13783` and
`ephemeral_5m_input_tokens: 0`:

| model | input | cachedInput | cacheWrite | output |
|---|---|---|---|---|
| `claude-fable-5` | 10 | 1 | 20 | 50 |
| `claude-opus-5` | 5 | 0.5 | 10 | 25 |
| `claude-sonnet-5` | 3 | 0.3 | 6 | 15 |
| `claude-haiku-4-5` | 1 | 0.1 | 2 | 5 |

**The Sonnet 5 row is confirmed to the cent against the CLI's own accounting**, which also
settles two open questions. From the fixture:

```
63 × $3      +  10308 × $0.30  +  52740 × $6      +  304 × $15   , all ÷ 1e6
= 0.000189   +  0.0030924      +  0.31644         +  0.00456     = $0.3242814
CLI-reported modelUsage["claude-sonnet-5"].costUSD =                $0.32428140
```

So cache write is **2× input** (the 1-hour TTL multiplier, not the 5-minute 1.25×) — as
predicted — and the CLI prices Sonnet 5 at the **standard $3/$15, not the $2/$10
introductory rate**, despite the intro rate being live on 2026-08-05. The earlier
revision recommended encoding the intro rate; that is now withdrawn. **Match the CLI's
rates, not the published intro rates** — a harness whose cost figures disagree with the
tool doing the spending is worse than one that is uniformly slightly high.

`long: null` for every Claude entry — these models are 1M context at standard rates with no
long-context premium, so the existing `inputTokens > 272_000` branch simply never fires.

### How per-token cost is presented for a plan rather than API billing

This is the part that needs to be honest, and verification changed the answer twice.

**Correction 1: `total_cost_usd` is populated, not zero.** The earlier revision claimed it
is `0` for subscription sessions. That was an artefact of reading it off the auth-failed run,
which did zero work. On a real team-subscription run it reported **`$0.3249354`**, and
`modelUsage[*].costUSD` sums to that value exactly. The CLI computes API-equivalent cost
itself and reports it per model.

**Correction 2: a second model runs that the harness did not ask for.** With `--model
sonnet`, `modelUsage` contained *two* entries — `claude-sonnet-5` and
`claude-haiku-4-5-20251001` (579 in / 15 out, $0.000654) — Haiku doing internal work.
Attributing a run's whole usage to `policy.model` is therefore wrong in cost terms. Small
here (0.2% of the run), but real and systematic.

Consequences for the design:

- **Take `cost` from the CLI, not from the bundled rate card.** For Claude runs,
  `enrichUsage` uses `result.total_cost_usd` as the authoritative figure, and keeps
  `priceUsage()` against the bundled card only as a cross-check (log a warning on material
  divergence — that is also how the harness notices Anthropic changing prices). The bundled
  card stays necessary for pre-run estimation and for the model picker, but it is no longer
  the source of truth after a run.
- **Record the per-model breakdown.** Persist `modelUsage` alongside the aggregate so a run
  that silently used a second model is visible rather than mis-attributed. `modelUsage` also
  carries `canonicalModel`, `contextWindow`, `maxOutputTokens` and `provider`, which is
  better catalogue metadata than anything bundled statically.
- **It is still not an attributable charge.** The harness runs on a subscription; the figure
  is the CLI's own API-equivalent computation, not money leaving an account. Keep
  `costBasis: "api-equivalent"` on the usage record and label it as an estimate in the UI.
  Codex runs carry the same marker, which is exactly what its existing
  *"not an attributable dollar charge for plan sessions"* comment already says.

**Correction 3: there *is* a plan-allocation signal.** The earlier revision asserted the CLI
exposes no per-run allocation state. It does — a `rate_limit_event` on the stream:

```jsonc
{"rate_limit_info":{"status":"allowed","rateLimitType":"five_hour",
  "resetsAt":1785891600,"overageStatus":"allowed","isUsingOverage":false}}
```

This is the closest Claude analogue to Codex's credits, and it is more useful than a
cost estimate for the thing an operator actually cares about ("will the next stage run?").
Design: surface it as an activity event, persist the latest `rate_limit_info` on the run, and
**fail the stage fast** when `status !== "allowed"` rather than burning a workflow attempt on
a request that will be throttled. `credits` stays `null` for Claude; allocation state is a
separate, better-typed field.

`verifyPricing()` ([orchestrator.mjs:97](../server/orchestrator.mjs)) currently prompts a
Codex agent for OpenAI prices and `validatePricingRates` hard-requires the GPT-5.6 ids. It
becomes provider-scoped, with its own required-id set per provider. Until that lands it
stays Codex-only and must not be invoked when the selected provider is Claude — otherwise
it fails closed on the GPT-5.6 requirement.

---

## e) The provider seam

One interface, two implementations. Exactly the five Codex-specific concerns named in the
brief live behind it: binary discovery and auth, spawn arguments, event schema, usage
extraction, sandbox mapping. Nothing else moves.

```js
ExecutionProvider {
  id: "codex" | "claude"
  label: string

  locate(): Promise<string | null>
  status(): Promise<{ id, label, available, authenticated, executionEnabled, detail, authMethod }>
  catalog(): Promise<{ models, fetchedAt, source }>
  defaults(): { model, reasoning }

  // The seam's honesty mechanism — the harness reads this, it does not assume.
  capabilities(): {
    sandboxes: { "read-only": "os-enforced" | "layered", "workspace-write": ... }
    confinementVerifiedBy: "provider" | "harness"
    networkIsolation: boolean
    supportsReasoningLevels: boolean
    stdoutBudgetBytes: number
  }

  run({ cwd, prompt, signal, timeoutMs, sandbox, networkAccess,
        tempDirectory, model, reasoning, onEvent }): Promise<{ finalText, usage }>

  parseEvent(line): InternalEvent | null   // exported for fixture tests
}
```

### Shared, extracted verbatim

`server/process-runtime.mjs` takes, unchanged: `runProcess`, `terminateProcessTree`,
`runTreeKill`, `waitForClose`, `ProcessTimeoutError`, `isProcessTimeoutError`,
`formatCommand`, `conciseToolResult`. The only edit is that `STDOUT_BUDGET` becomes a
per-call option the provider supplies. Process-tree termination, abort handling and the
timeout path are provider-agnostic and must not be duplicated.

### Provider-owned

Binary discovery and candidate selection (Codex keeps `selectCodexCandidate` and the
Windows sandbox-setup preference; Claude resolves `CLAUDE_BIN` then `which`/`where.exe`),
the auth probe, spawn argv, the env allowlist, event parsing, usage extraction, failure
extraction, and sandbox mapping.

**The Claude env allowlist deliberately excludes `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`.** The constraint is "no API keys, both
providers use their existing local CLI session"; excluding these at the allowlist means a
stray environment variable cannot silently move execution off-plan onto metered API
billing. It needs `HOME` (and `CLAUDE_CONFIG_DIR` when set) for the OAuth profile, where
Codex needs `CODEX_HOME`/`CODEX_BIN`.

### How stage policy selects a provider

`stagePolicies[policyId]` gains an optional `provider`. `resolveAgentPolicy` returns
`{provider, model, reasoning}`, defaulting `provider` from `settings.defaultProvider`,
which itself defaults to `"codex"` — so nothing changes until an operator opts in.
`#executeAgent` resolves the provider from a registry and calls its `run`. A model/provider
mismatch is rejected at settings validation and again at spawn.

**Implemented per stage policy, and the blocker is gone.** An earlier revision of this
section recorded the implementation as scoping the provider to `task.agentConfig.provider`,
on the grounds that candidate revisions do not persist a provider and so the
repair-authorizer reconstruction could not tell which runtime produced an authorizing gate.
That reasoning was right about the hole and wrong about the remedy: scoping per task did not
close it either. A pure-Claude task that repaired and then needed a retry grant hit the same
`provider_mismatch`, because the synthetic reservation rebuilt from lineage defaulted to the
default provider regardless of what the task was configured to use.

The actual fix was to persist it. Candidate revisions now record `authorizingGateProvider`
alongside the other `authorizingGate*` fields, so the reconstruction reads the provider
rather than assuming one. With that in place per-stage selection is safe, and it is what
ships:

- Each of the ten stage policies selects its own model, and the provider **follows from
  that model** — there is no separate provider field to keep in sync with it, and therefore
  no way for the two to disagree.
- Reasoning is validated against the chosen model's own `reasoningLevels`. These differ by
  model, not merely by provider: `ultra` exists on Codex and not on Claude, and
  `claude-haiku-4-5` supports no effort at all and carries the explicit level `none`, which
  resolves to omitting `--effort`.
- `task.agentConfig.provider` survives only as a fallback for a model no provider claims.
  Absent still means the default provider, so tasks persisted before provider identity
  existed stay on Codex.
- `implement` is reached by two policies, so the run *kind* decides which owns the provider
  for an attempt: a repair reserves on `repair`, an implementation on `implement`.
- Settings and task creation read a **merged** catalogue across providers. Reading one
  provider's catalogue left the other's models with no reasoning levels, so every reasoning
  value for them was rejected — the models were selectable in name only.

So "Claude implements, Codex reviews" works. None of it weakens the binding: a reservation
records the provider that will execute it, a run cannot execute on a provider its
reservation did not reserve, and a gate whose run and reservation disagree is
`provider_mismatch` rather than a cross-provider fallback.

### What actually causes the write-stage E2BIG — measured

Three prior explanations were guesses, two of them written into this document, and each
would have produced a different fix. This is the measurement, so the next person does not
guess a fourth time. Method: a scratch git repo per data point under a short root, one
factor varied at a time, and the argv the CLI hands the outer shell captured exactly by
standing a measuring shim in front of it via `CLAUDE_CODE_SHELL` — which yields a number
on a *passing* configuration, not just "it worked". CLI 2.1.222, macOS, `ARG_MAX` =
1,048,576.

**The mechanism.** On macOS the Bash tool does not spawn `sandbox-exec` directly. It
builds one command *string* — `env … /usr/bin/sandbox-exec -p <PROFILE> <shell> -c <cmd>`
— and passes it to the outer shell as `zsh -c <string>`. The seatbelt profile is
therefore **inlined on the command line**, and `E2BIG` is that string exceeding `ARG_MAX`.
Hence "command line 1.1MB across 3 args": three args, one of which is the whole profile.
The environment is accounted in the same limit but is negligible here (1.5 KB, 24 vars).
Inside the profile each deny path expands into a rule per ancestor component, so a
measured 959 KB profile was 11,538 lines: 3,750 `deny` rules over 256 deny paths.

| registered worktrees | cwd chars | argv bytes | Bash |
|---|---|---|---|
| 3 | 64 | 702,185 | ok |
| 3 | 120 | 719,041 | ok |
| 3 | 175 | 735,596 | ok |
| 3 | 240 | 755,161 | ok |
| 11 | 64 | 817,433 | ok |
| 21 | 64 | 961,628 | ok |
| 28 | 64 | ~1.0 MB (CLI-reported) | **E2BIG** |
| 31 | 64 | ~1.1 MB (CLI-reported) | **E2BIG** |
| 11 | 700 | ~2.5 MB (CLI-reported) | **E2BIG** |

Four things follow, and the third is why the obvious fix is the wrong one.

1. **The quantity that fails is total exec bytes, not either variable.** Both factors move
   it because both feed the same profile.
2. **Registered worktree count dominates.** Each adds three deny paths — `config.worktree`,
   `config.worktree.lock`, `commondir`, exactly as the CLI's own message names — and
   ≈ 14.4 KB of argv at a short cwd: 1 worktree ≈ 48 cwd characters. At a 64-char cwd, 28
   registered worktrees fail on their own. The originally reported failure (43 worktrees,
   92-char cwd) reproduces here at 31 worktrees and a 64-char cwd, same "1.1MB across 3
   args" — so that failure was in the worktree-count regime, and the 43 → 5 cleanup that
   flipped the canary green was acting on the dominant term.
3. **cwd length is a real but secondary term, and it is not independent.** ≈ 301 bytes per
   character at 3 worktrees, but ≈ 2,670 bytes per character at 11 worktrees with a deeper
   path — a deeper cwd both lengthens every rule and *adds* deny paths (226 → 300 at 11
   worktrees when the cwd went 64 → 700 chars). The factors interact multiplicatively
   through ancestor expansion, so **"length alone" is false** and a length-matched canary
   or a length-keyed canary cache would certify the wrong axis. Issue #39's proposed fix
   does not follow from the measurement; #36's cleanup precondition does.
4. ~~**The floor is high.**~~ **Corrected — see below. There is no host floor**; the
   702,185 figure is a property of the layout it was measured in, not a constant, and the
   "roughly two dozen registered worktrees" ceiling derived from it is layout-specific too.

The shape a fix should take follows from (1): the check has to be against total exec
bytes, not against either variable and not a CLI run at an unrelated path. Implemented as
the byte-budget preflight below (#42).

### Correction: the "floor" and the worktree ceiling are layout-specific, not host constants

Point 4 above claimed a ~700 KB floor and, from it, a ceiling of roughly two dozen
registered worktrees. Both were wrong in the same way the three earlier explanations were
wrong — a number measured in one layout, read as a property of the host. Two measurements
taken while building the preflight, both `workspace-write`, both on this host:

| repository | registered worktrees | cwd chars | measured argv bytes | Bash |
|---|---|---|---|---|
| scratch repo at a short root | 30 | 12 | **726,741** | **ok** |
| `--reference` clone of that same repo | 0 | 11 | **346,302** | ok |
| scratch repo under `/private/var/folders/…` | 3 | 75 | 765,023 | ok |

Three corrections follow.

1. **A minimal repository does not spend ~700 KB.** At a 12-char path it spent 346,302
   bytes — under a third of the budget, less than half the claimed floor. The 702,185
   figure carried its scratch repo's own root prefix through every rule in the profile.
2. **28 registered worktrees do not fail on their own.** Thirty of them at a 12-char path
   measured 726,741 bytes and ran fine. The sweep's failure at 28 was 28 worktrees *plus*
   that layout's path prefix. Point 2's "1 worktree ≈ 48 cwd characters" exchange rate is
   sound; the absolute boundary it was combined with is not.
3. **The per-worktree cost reproduces independently, and it is the one number here that
   travels.** The two rows of the same repo differ only in worktree registrations:
   (726,741 − 346,302) / 30 = **12,681 bytes per worktree**, against the sweep's ≈ 14.4 KB
   measured a different way. That agreement is why the preflight prices a worktree at the
   higher of the two.

### This repository's actual numbers

Measured on this repository rather than a scratch one, `workspace-write`, at 5 registered
worktrees, both cwds pre-existing so the probe created nothing:

| cwd | chars | measured argv bytes | worktrees of headroom |
|---|---|---|---|
| repo root | 38 | 358,696 | 43 |
| linked worktree at candidate depth | 81 | 604,342 | 26 |

Headroom is after the four-worktree concurrency reserve, priced at 14,414 B each. What it
means for fan-out at candidate depth: 26 more worktrees fit, so ~26 concurrent tasks at one
worktree each, ~8 at three, and **~5 at the five worktrees AH-003 actually used** (S1–S4
plus C1). #41's "roughly five concurrent tasks" conclusion therefore survives — but by
coincidence, since the arithmetic it came from used the retracted floor.

Those two rows differ by 245,646 bytes over 43 characters, ≈5,712 B/char, but they differ in
*kind* as well as length — a repo root against a linked worktree whose `.git` is a file — so
that rate was confounded. The clean comparison, two **registered worktrees** of this
repository at the same worktree count:

| cwd | chars | measured argv bytes | worktrees of headroom |
|---|---|---|---|
| `/tmp/ahw1` | 9 | 420,514 | 39 |
| `…/.claude/worktrees/wonderful-lamport-038472` | 81 | 617,644 | 25 |

197,130 bytes over 72 characters, **≈2,738 B/char** — the sweep's 2,670 rate, confirmed
independently. The 5,712 figure is retracted.

Two things follow.

1. **Candidate path depth is a cheap lever on the harness's own spend.** `git worktree add`
   takes any path, so candidates need not live at `<repo>/.data/worktrees/<task>/<candidate>`.
   Relocating them to a short path recovers ~197 KB here, taking headroom from 25 to 39
   registered worktrees — roughly five to seven concurrent tasks at the five-worktree fan-out
   AH-003 used. Real, and bounded: it raises the ceiling, it does not remove it. Done — see
   below.
2. **There is an unexplained ~128 KB term, and it is not path length.** At the same
   repository and worktree count, the linked-worktree cwd cost ~128 KB more than the repo
   root beyond what 2,738 B/char accounts for. Not isolated — it could be a cwd-kind term
   (`.git` as a file versus a directory) or non-linearity in depth — so nothing prices it.
   Its practical shape: a cwd that *is* a repository root appears cheaper than a linked
   worktree of the same repository, which is a point in favour of clone-per-candidate on
   bytes as well as on coupling.

### Dependency provisioning costs nothing in the exec budget — measured

Copying dependency directories into a candidate worktree (#46, replacing the per-entry
symlinks) does not move the exec-argument budget. Two worktrees of this repository at the
same worktree count and the **same path length** — one provisioned with a real 139-entry
`node_modules`, one bare — both measured **592,049 bytes**, a delta of zero.

Mechanistically that is the expected answer: the profile is generated from repository
metadata and configured paths, not by scanning what is inside the worktree. It is recorded
here because it was an assumption first, and assumptions about this budget have a bad record
in this document — three of them have been retracted.

**A trap for anyone repeating this.** The first attempt produced the same zero delta without
measuring anything. Both cwds were the *same* cache state — same repository, same worktree
count, same 50-char cwd bucket — so the second call returned the first call's probe. Two
cwds that differ only in something the cache key does not capture will always read as
byte-identical, which looks exactly like "the difference does not matter". Call
`resetClaudeSandboxCanaryCache()` between measurements when using the preflight as an
instrument rather than as a gate.

### Candidate worktrees moved out of the repository

`defaultWorktreeRoot()` in `server/git-worktree.mjs` now resolves to `~/.ah/w`, overridable
with `AGENT_HARNESS_WORKTREE_ROOT`, replacing `<repo>/.data/worktrees`. Candidates are
`<root>/<task>/<candidate>`; the escape guard is unchanged, only the root moved.

Three consequences worth recording, because two of them are couplings that were easy to miss.

1. **The write canary's scratch layout moved with it.** It deliberately nested its scratch
   worktree inside a scratch "source repository", because that nesting was what made an
   ancestor `denyWrite` defeat a nested `allowWrite`. Candidates are no longer nested, so the
   canary now builds the worktree as a *sibling* of the source repository. A canary left
   testing the old shape would certify a layout no stage uses — the standing rule's failure
   in its purest form. The escape it now proves matters more, not less: the source checkout
   is a separate tree reachable only by absolute path, and it is the operator's real code.
2. **A repo-root `denyWrite` stopped being a footgun, and is still not added.** With
   candidates outside the checkout, such a rule would no longer be an ancestor of the
   `allowWrite` and would be genuine defence in depth. Adding it is a change to a
   safety-relevant profile and needs its own canary run to establish, so it is recorded as
   available rather than taken.
3. **Nothing now depends on `.gitignore` covering `.data/`** for the source checkout to read
   clean during a candidate run, since the harness no longer writes working directories into
   the repository at all.

The operational consequence is the opposite of a relaxation. The deny paths are generated
from the repository containing the cwd, so **a clone carries none of the source
repository's worktree registrations** — 0 against 30, for the same content. That makes
worktree-based candidate isolation, not Claude Code, the source of the growth term, and it
means the ceiling is a harness design consequence rather than a host limit. It also means
any figure of the form "this host tops out at N worktrees" is unanswerable without naming
the layout, which is why `provider.status()` reports measured bytes for a specific cwd
instead of a global N. Tracked on #41.

### The exec-argument preflight — measured, not modelled

`server/claude-exec-budget.mjs` decides before a Claude stage spawns whether the budget
will hold at that cwd in that repository, and reports the remaining headroom either way.
`claudeExecutionProvider.preflight` exposes it; `#assertProviderConfinement` calls it
ahead of the canary. An exhausted write-stage budget refuses before anything is spawned.
An exhausted read-only budget instead removes Bash from that run and continues with
permission-scoped `Read`, `Grep`, and `Glob`: the limit prevents a shell from starting,
not the Claude CLI or its built-in filesystem readers.

The number comes from measurement rather than from a reimplementation of the CLI's rule
expansion. A model of that expansion would look exact and go stale silently, in the
optimistic direction, the first time the CLI changes profile generation — the false-green
class the standing rule exists for. So a short-lived probe run stands the same
byte-counting shim used for the sweep in front of the outer shell via
`CLAUDE_CODE_SHELL`, runs `/usr/bin/true` at the stage's real cwd and posture, and reports
what the CLI actually built. The probe is a separate run, never the stage's own spawn —
the shim sits in the exec path of every command it fronts — and `CLAUDE_CODE_SHELL` stays
out of `CLAUDE_ENV_ALLOWLIST`, applied to the probe's environment only. One probe per
(repository, worktree count, cwd-length bucket) state, cached in the same map as the
canary rather than in a second cache beside it, which also means a canary green obtained
at one worktree count is no longer served for another.

Two things measured while building it, both of which changed the design:

1. **`CLAUDE_CODE_SHELL` is validated by path, not by behaviour.** A path that does not
   read as a bash/zsh path is rejected — "is not a valid bash/zsh path, falling back to
   detection" — and the override is then ignored *silently*. Measured on 2.1.222 with one
   shim under three names: `zsh` and `measure-zsh` both took effect, `measure-shell.sh`
   recorded nothing at all. Hence the shim is named after the shell it hands off to. A
   rejected override degrades to no measurement, which is safe but invisible, so anyone
   renaming the shim should expect the feature to stop working without an error.
2. **The extrapolated bound is not reliably conservative, so it may not gate.** A probe in
   a scratch repo at 3 registered worktrees under a deep `/private/var/folders` root
   measured **765,023** bytes where extrapolating from the floor gives **731,555** — an
   under-estimate of ~33 KB, because the repository root prefix repeats in every rule and
   the deny-path *set* varies by layout, neither of which is an input to the
   extrapolation. Making it pessimistic enough to be safe (charging every cwd character
   at the worst measured 2,670 B rate) produced refusals at worktree counts that in fact
   run. So **only a measurement, or an observed E2BIG, marks Bash unavailable.** The
   bound reports headroom, is labelled a bound wherever it appears, and when it lands
   past the ceiling it says so and names the mid-run guard instead of disabling Bash.

Three deliberate consequences:

- **Degrade read-only, refuse write, never prune.** A measured read-only exhaustion is
  surfaced in run activity and continues without Bash. Write stages still refuse because
  edits that cannot be checked by a shell must never be committed. The write-stage
  refusal names the count, the ceiling, the fact that the budget is shared per repository,
  and `git worktree list` / `git worktree remove <path>` / `git worktree prune`. Nothing
  is removed automatically — a worktree may hold uncommitted work, so pruning to make
  room for a stage would trade a loud recoverable failure for a quiet unrecoverable one —
  and there is no flag that skips the check.
- **Headroom is a first-class output.** `provider.status()` carries `execArgBudget` with
  bytes used, bytes available, cost per additional worktree and how many more fit, so the
  ceiling is visible before an operator queues work rather than after a stage dies. The
  status path uses the free bound, because a probe costs a model call.
- **`856ed50` stays.** The budget is per repository, so a task can register a worktree
  between the preflight and the spawn, or during the run. A correct preflight can still be
  overtaken, which is the argument for a generous reserve rather than an exact threshold,
  and it is why the mid-run shell-start failure check is not redundant: the preflight
  removes Bash from a read-only run or stops a doomed write stage, while the guard stops
  an overtaken run from being trusted or committed.

### Operational requirements the spike did not surface

Three things the harness must satisfy for a Claude stage to run at all, each found by a
canary failing rather than by reading documentation:

1. **The sandbox needs an existing, writable `TMPDIR`.** It creates a unix mux socket there
   (`srt-mux-<pid>-N.sock`); a non-existent temp directory yields `Sandbox is required but
   failed to initialize: ENOENT`. This is a *second*, independent cause of
   sandbox-unavailable beside the deny-path `E2BIG` limit, and it fails the same way, so
   diagnosing one as the other will send you to the wrong place.
2. **Network access cannot be granted.** The test stage needs loopback binding, which needs
   `sandbox.network.allowLocalBinding`. Enabling it makes the CLI stop treating the sandbox
   as fully sandboxed, so `autoAllowBashIfSandboxed` no longer auto-approves and every
   command strands on a permission gate with nobody to answer it. The provider therefore
   advertises `grantsNetworkAccess: false` and the **test stage stays on Codex** — refused
   before spawning rather than failing mid-run.
3. **Provisioned dependency directories must be per-entry links, not one directory link.**
   Because both sandboxes match resolved paths (§a), a wholesale `node_modules` symlink
   makes every path under it resolve into the shared source checkout, so *legitimate* writes
   are refused too — Vite writes `node_modules/.vite-temp` while merely loading its config,
   which broke `npm run build` in any provisioned worktree, on **both** providers. The fix
   is a real directory of per-entry links: packages stay immutable, the directory is
   worktree-local and writable, and tool caches are not inherited so each worktree makes its
   own. Widening `allowWrite` to the resolved dependency paths would have reopened the
   escape and let one test stage corrupt every concurrent worktree.

Behaviour preservation: `TaskOrchestrator` currently takes `options.runCodex` and
`options.getStatus`. Both injection points are **kept and honoured** — `options.runCodex`
continues to override the resolved provider's `run`. That is what lets all 193+ existing
tests pass unchanged in step 1, since they inject `runCodex` directly.

### The seam's teeth

`#executeAgent` reads `provider.capabilities().sandboxes[effectiveSandbox]`. If the
provider reports anything weaker than `"os-enforced"`, the harness **requires** its own
pre/post verification for that stage and refuses to run the stage if the verification
hook is not wired. Concretely:

- Claude `read-only` reports `"layered"` ⇒ allowed only once §a's pre/post verification is
  in place.
- Claude `workspace-write` stays unavailable — `executionEnabled: false` for write stages
  — until Phase 5 establishes genuine confinement. If it cannot be established, write
  stages stay on Codex and the design says so rather than shipping a weaker
  `workspace-write`.

---

## Build order (Phase 2, on approval)

1. **Provider seam, Codex refactored behind it.** Behaviour-preserving; all 193+ tests
   pass unchanged. No Claude code paths reachable.
2. **Claude event parsing**, tested against a committed fixture captured from the real
   CLI. The fixture is already captured (§6, item 1) — commit it as-is.
3. **Claude auth, model catalogue, usage.** Includes the usage-summing fix in §c and the
   `costBasis` widening in §d.
4. **Read-only stages end to end** — gated on the pre/post verification from §a and on the
   sandbox canary (§6) passing on the host.
5. **Write stages last, and only if §a's confinement is established.** *Established* — see
   the write-mode findings in §a and `docs/claude-write-confinement-spike.md`. Confinement
   holds: writes land inside the worktree, writes outside are refused by default-deny,
   escalation is denied, symlink traversal into the source repo is blocked because the
   sandbox resolves paths, git commit works while push and remote changes do not, and
   network can be re-enabled selectively without reopening the filesystem.

Verification after each step, reported individually: `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build`, `npm run test:sites`, `git diff --check`. No push, no PR.

---

## 6. Verification results

All six items from the earlier revision's open list are resolved. Nothing blocks the build
order.

| # | Question | Result |
|---|---|---|
| 1 | Fixture capture | **Done.** 12-event `fixture.jsonl` with Read, parallel Bash, a failing Bash, final text, cumulative usage. Commit as-is in step 2. |
| 2 | Is `allowUnsandboxedCommands: false` honoured from `--settings`? | **Yes** — resolved by the status-time canary. A real escalation attempt was refused at the sandbox/policy layer without reaching the permission gate. Stronger than this table's earlier "moot in the safe direction". |
| 3 | Does `--safe-mode` suppress the `--settings` sandbox? | **No.** Guarded write still refused, and hooks stopped rewriting commands. Use `--safe-mode`. |
| 4 | Does `-p` read the prompt from stdin? | **Yes, and stdin is mandatory** — variadic `--tools` swallows a positional prompt. |
| 5 | Negative sandbox canary | **Validated as a technique.** Seatbelt refused the write (`operation not permitted`); the unsandboxed retry was denied. Ship it as a status-time check. |
| 6 | Is `result.usage` cumulative? | **Cumulative for the primary model**, equal to `modelUsage[primary]`. Do not sum `usage.iterations` — it does not reconcile. |

**Four claims in the earlier revision were wrong** and are corrected in place above, listed
here so a reviewer who read that version knows what moved:

1. `total_cost_usd` is **not** `0` on subscription sessions — it is populated and accurate
   (§d, Correction 1). The `0` came from a zero-work auth-failed run.
2. There **is** a plan-allocation signal — `rate_limit_event` (§d, Correction 3).
3. The `Exit code N` prefix **cannot** classify a sandbox denial versus an ordinary command
   failure; the sandbox denial carries the prefix too (§c).
4. Sonnet 5's `$2/$10` introductory rate should **not** be encoded; the CLI bills the
   standard `$3/$15` (§d).

Two findings the earlier revision did not anticipate at all: **operator hooks rewrite Bash
commands after the `tool_use` event is emitted** (§a — this is why `--safe-mode` is a safety
requirement, not a preference), and **a second model runs inside a run without being asked
for** (§d, Correction 2).

### The canary stays, and it is the thing to keep

The measurements above are one host, one CLI build, one moment. The layered read-only posture
depends on four coupled mechanisms that a CLI release can change without a changelog entry
the harness reads. So `provider.status()` runs the canary at status time on every host:
attempt a sandboxed write inside a scratch worktree and assert it is refused; attempt the
unsandboxed retry and assert it is denied. `executionEnabled` for Claude read-only stages
stays `false` until both assertions pass locally. Configuration is not evidence, and neither
is a design document.

### One defect worth fixing regardless of provider work

### One defect worth fixing regardless of provider work

`getClaudeStatus()` ([codex-runtime.mjs:97](../server/codex-runtime.mjs)) parses
`JSON.parse(status.stdout).loggedIn`, which is the correct field for
`claude auth status --json`, and it works when a stored profile exists — it now reports
`{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "team"}`.

The failure mode is narrower than the earlier revision implied but still real: when
credentials arrive from the process environment rather than a stored profile, the same
command reports `{"loggedIn": false, "authMethod": "none"}` for a CLI that is in fact
usable. So `auth status` is a good fast-path hint and a bad authority. The provider's status
probe should treat *"binary present, and the status-time canary run completed"* as the
authoritative execution signal — which costs nothing extra, since the canary already has to
run for the sandbox assertions above.
