# Linear → Harness task intake

Mention **@Harness** on a Linear issue or its comment thread. The private Linear app receives an `AgentSessionEvent`, imports the ticket into the explicitly mapped Harness project, and links back to the new task. The task stays **queued** until an operator starts it. A second mention, webhook retry or companion restart reuses the same task, including after an operator edits or closes it.

This integration is opt-in and disabled unless `AGENT_HARNESS_LINEAR_CONFIG` is set. It is implemented in the `codex/linear-harness-intake` worktree. **Local activation and a real mention-to-task verification passed on 22 September 2026**, following Shaun's approval to register the private app and use his local Harness. Task execution remains an explicit operator action.

## Captured information

The brief includes the original issue description, identifier and link, Linear and Harness project names, team, status at import, priority, assignee, labels, due date, estimate, cycle, parent issue, incoming/outgoing issue relations, linked attachments, and the triggering thread comment. The structured `externalSource` preserves the fetched issue, source IDs, import time, session, prior thread comments, Linear guidance and prompt context for provenance. Issue status, relations and guidance are context, not executable commands or Harness workflow authority.

Priority maps urgent/high → high, medium/no priority → medium, low → low. Standard Harness policy selection, profile selection and repository-authority capture apply. Ticket text cannot select a repository, credentials, model, or permission policy. The workflow is implementation, with normal review gates.

Attachments are retained as links, not downloaded. Collections are bounded to 100 entries each and an incomplete collection is disclosed. A brief over the existing 20,000-character limit or a title over 300 characters is blocked without silent truncation. Missing descriptions are explicitly identified. Later ticket edits and prompted follow-up messages do not overwrite the accepted task brief; they do not create new tasks. Mentions outside issues are ignored.

## Activation

1. Register a **private** OAuth application named **Harness** in Linear Settings → API. Enable **Client credentials** and **Webhooks → Agent session events**. Do not enable unrelated event categories or public distribution. Linear agent apps are separate from the Codex Linear connector.
2. Obtain a stable public HTTPS endpoint that forwards **only** to the dedicated loopback webhook listener, default `127.0.0.1:4311`. Configure its path `/linear/webhook` as the app's webhook URL. Never tunnel the normal companion API port: it contains operator controls and local evidence. The webhook listener exposes only the signed POST endpoint; other routes return 404.
3. Supply `LINEAR_CLIENT_SECRET` and `LINEAR_WEBHOOK_SECRET` in the companion environment, using an ignored private environment file or secret manager. Do not place them in settings, the browser, task records, Git or command-line arguments. The client uses `read,write,app:mentionable` with the `client_credentials` grant. No personal API key is needed. Linear currently requires write scope for session links and completion activities. Restrict the app's team access in Linear to the intended teams.
4. Use `scripts/linear-identify.mjs` with `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` in the environment to obtain the app user and workspace IDs. It prints identifiers only; its token is in memory. It requests a new app token, so run this only after approving app installation/access.
5. Create a private JSON configuration using the example below. Use actual Linear **project UUIDs**, not display identifiers such as `P-ENG-14`, and registered Harness project IDs from `GET /api/projects`. Several Linear projects may map to one Harness project. Unknown, missing or archived project mappings do not default to a repository.
6. Set `AGENT_HARNESS_LINEAR_CONFIG` to the file's absolute path. Start the companion with this environment. SQLite is required. `AGENT_HARNESS_LINEAR_PORT` can override the dedicated receiver port. The normal operator API keeps its existing loopback and CSRF protections.
7. Test with one deliberately selected Linear issue. Confirm that it appears once in Harness with the right project and source brief, remains queued with zero agent runs, and has a usable task link in Linear. Mention it again to verify deduplication.

```json
{
  "organizationId": "LINEAR_WORKSPACE_UUID",
  "appUserId": "LINEAR_HARNESS_APP_USER_UUID",
  "clientId": "LINEAR_OAUTH_CLIENT_ID",
  "harnessUrl": "http://localhost:5199/",
  "projectMappings": {
    "LINEAR_PROJECT_UUID": "REGISTERED_HARNESS_PROJECT_ID"
  }
}
```

The `harnessUrl` is the URL a person uses to open Harness, separate from the receiver's public URL. A localhost link works only on the operator's machine. Do not make the operator API public just to share those links. If the computer sleeps or the tunnel stops, new imports cannot arrive; Linear retries on its schedule and may disable repeatedly failing webhooks. A continuously available receiver is a separate hosting decision.

## Activated local setup — 22 September 2026

- Private **Harness** app in Eversor AI, restricted to the **Engineering** team. Only Agent session webhooks are enabled. Client credentials use the app identity, not Shaun's personal API token.
- The public HTTPS tunnel forwards only to `127.0.0.1:4311/linear/webhook`. Request inspection is disabled. The operator API remains on loopback port 4321; the existing frontend remains at `http://localhost:5199/`.
- Private configuration and credentials are in the worktree's ignored, mode-600 `.data/linear-config.local.json` and `.env.linear.local`. They are not committed. The companion uses the existing database at `/Users/shaun/projects/agent-harness-ui/.data/tasks.sqlite3`. A private SQLite backup was made before switching the companion; no tasks or runs were active.
- Linear required a redirect URI in its registration form even with client credentials. `http://127.0.0.1:4311/linear/oauth/callback` satisfies that form; this integration does not use redirect authorization and that path returns 404.
- Select **Harness Agent** from Linear's `@` mention chooser in a comment on an issue. A pasted profile URL is not a verified trigger. Select the agent itself for a new session; follow-ups in an existing session do not reimport or edit the brief.

Current explicit mappings:

| Linear project | Harness project |
| --- | --- |
| Plancheck - JKGL | Eversor Plancheck |
| MyProperty Assist | Eversor MyStrataAssist |
| Levy – Financial Integration | Eversor MyStrataAssist |
| MyProperty Assist Post-Readiness Security Hardening | Eversor MyStrataAssist |
| MyProperty Assist ISO 27001 Readiness | Eversor MyStrataAssist |

Other projects, or tickets without a project, retain a blocked intake receipt until an explicit mapping is configured. They never default to an arbitrary repository.

The companion and tunnel are running as local processes, not installed login services. Keep this computer awake and both processes running. For recovery after a stop or reboot, use the following from `/Users/shaun/.codex/worktrees/linear-harness-intake/agent-harness-ui`, in separate terminals, after checking that no companion already owns the live database/port:

```sh
node --env-file=.env.linear.local server/index.mjs
ngrok http http://127.0.0.1:4311 --inspect=false --log=stdout --log-format=json --log-level=info
```

Keep the existing frontend on port 5199. Check the current tunnel URL against the private app's webhook URL before expecting delivery. Do not start the original companion alongside this worktree companion. When moving to internal hosting, configure `harnessUrl` to the authenticated internal frontend URL and update the private app's webhook destination to a reachable HTTPS receiver; the project mapping/import contract remains the same. An internal-only address must still have a route that Linear can reach for signed webhook delivery.

## Operations and recovery

`GET /api/integrations/linear` on the local companion reports enabled state, mappings, counts, and the latest 50 receipts with task ID, attempts and error. It does not expose secrets or full event bodies. API enablement is configuration state, not proof that an external webhook is reachable.

The receiver checks the raw-body HMAC-SHA256 signature, timestamp (five-minute clock tolerance), workspace, OAuth client and app user identity; it stores the receipt in SQLite before returning HTTP 200. Network fetches and task creation happen after acknowledgement. Invalid signatures and wrong identities never queue work. No more than 1,000 unfinished receipts or 1 MB per request are accepted.

The worker serially attempts imports, checks the token's workspace/app identity, and retries failures up to five times with bounded backoff. Blocked records remain visible. Correct the mapping or configuration and restart the companion to reload it; then POST `{ "sessionId": "..." }` to `/api/integrations/linear/retry` using the normal local CSRF token. Imported tasks and receipts share the existing database and runtime lock. Source-based task deduplication occurs inside the task-store transaction, closing the crash window between task creation and receipt update. Task creation succeeds independently of later Linear acknowledgement failures.

The worker links the session promptly and finally emits a completion activity that explicitly describes task intake, not code execution. Cold authentication, a queue backlog or Linear outages can exceed Linear's ten-second responsiveness expectation; the durable receipt still retries. A crash after the final response but before its receipt commit can repeat that response, but cannot duplicate the Harness task.

Disable intake by removing `AGENT_HARNESS_LINEAR_CONFIG` and restarting the companion. Disable the webhook/revoke the app in Linear and stop the dedicated tunnel when retiring the integration. Existing tasks and source receipts remain for audit. Back up the database with the normal Harness backup process; retained source payloads contain private ticket data.

## Local qualification

- `node --test tests/linear-intake.test.mjs` covers authentic and forged delivery, replay protection, cross-workspace rejection, import fidelity, standard admission, duplicate mentions, operator edits, recovery, mapping failures, API acknowledgement failures, collection limits and credential renewal.
- Existing task, project, authority and store tests cover compatibility of the shared creation path.
- Automated Linear calls use a fake external client. Live qualification is separately recorded below.

Official API references: [Agent setup](https://linear.app/developers/agents), [agent sessions](https://linear.app/developers/agent-interaction), [webhook security](https://linear.app/developers/webhooks), [client credentials](https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens).

## Qualification record — 22 September 2026

- Worktree: `codex/linear-harness-intake`, based on `3878a2419979465a53171cd59a5cff455a6a2646`.
- Final integration suite: **13/13 passed**. Focused compatibility run before the last two added integration cases: **77/77 passed**.
- Lint, formatting, TypeScript, application build, Frontier build and **4/4 Sites tests passed**. Builds retain the existing large-chunk warning.
- Full configured suite with test concurrency limited to two: **710/720 passed**. All ten failures are in `research-deepagents-adapter` and `research-vertical-slice`; running those same files in the original checkout reproduces the same ten failures. The dependency installation lacks the `better-sqlite3` native binding. No research implementation or shared dependency installation was modified to conceal or repair this unrelated environment problem.
- Browser qualification used a disposable SQLite store and fake Linear client. The preview at `http://127.0.0.1:5349/#task/AH-001` shows the synthetic `DEMO-123` issue, retained description, metadata and explicit Start task control. Zero agent runs. The preview API is on port 4349. This proves local import/display behavior, not real webhook delivery.
- The initial `.data/linear-config.proposed.json` remains an ignored, inactive draft. After approval, activation used the private `.data/linear-config.local.json`. The original checkout's files and frontend were preserved; the companion was deliberately replaced by the worktree version against the backed-up live database.
- **Live acceptance:** [ENG-970](https://linear.app/eversor-ai/issue/ENG-970/verify-harness-linear-intake-do-not-implement) produced two distinct signed sessions, each completing on its first attempt and linking to **AH-092**. Exactly one task was created in Eversor Plancheck, with the original title, description, low priority, project, source URL and triggering comment. The browser showed the imported brief and explicit Start task action. The persisted task had zero runs and zero tokens. After verification, ENG-970 was marked Done and AH-092 was closed as verification-only evidence; no implementation ran.
- Public isolation checks: an unsigned POST to the webhook returned 401; a request for `/api/tasks` on the tunnel returned 404. Linear's actual signed delivery and app API calls succeeded.
- Final intake test rerun: **13/13 passed**, including assertions that deduplicated and crash-recovered receipts retain the existing task ID. The companion was restarted with this reporting correction before the second real mention.
