# Linear → Harness task intake

Mention **@Harness** on a Linear issue or its comment thread. The private Linear app receives an `AgentSessionEvent`, imports the ticket into the explicitly mapped Harness project, and links back to the new task. The task stays **queued** until an operator starts it. A second mention, webhook retry or companion restart reuses the same task, including after an operator edits or closes it.

This integration is opt-in and disabled unless `AGENT_HARNESS_LINEAR_CONFIG` is set. It is implemented in the `codex/linear-harness-intake` worktree. **Live activation has not been performed.** No app, credentials, public endpoint, real ticket import or task execution was created during implementation.

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
7. Test with one deliberately selected Linear issue. Confirm that it appears once in Harness with the right project and source brief, remains queued with zero agent runs, and has a usable task link in Linear. Mention it again to verify deduplication. This live acceptance step is outstanding.

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

## Operations and recovery

`GET /api/integrations/linear` on the local companion reports enabled state, mappings, counts, and the latest 50 receipts with task ID, attempts and error. It does not expose secrets or full event bodies. API enablement is configuration state, not proof that an external webhook is reachable.

The receiver checks the raw-body HMAC-SHA256 signature, timestamp (five-minute clock tolerance), workspace, OAuth client and app user identity; it stores the receipt in SQLite before returning HTTP 200. Network fetches and task creation happen after acknowledgement. Invalid signatures and wrong identities never queue work. No more than 1,000 unfinished receipts or 1 MB per request are accepted.

The worker serially attempts imports, checks the token's workspace/app identity, and retries failures up to five times with bounded backoff. Blocked records remain visible. Correct the mapping or configuration and restart the companion to reload it; then POST `{ "sessionId": "..." }` to `/api/integrations/linear/retry` using the normal local CSRF token. Imported tasks and receipts share the existing database and runtime lock. Source-based task deduplication occurs inside the task-store transaction, closing the crash window between task creation and receipt update. Task creation succeeds independently of later Linear acknowledgement failures.

The worker links the session promptly and finally emits a completion activity that explicitly describes task intake, not code execution. Cold authentication, a queue backlog or Linear outages can exceed Linear's ten-second responsiveness expectation; the durable receipt still retries. A crash after the final response but before its receipt commit can repeat that response, but cannot duplicate the Harness task.

Disable intake by removing `AGENT_HARNESS_LINEAR_CONFIG` and restarting the companion. Disable the webhook/revoke the app in Linear and stop the dedicated tunnel when retiring the integration. Existing tasks and source receipts remain for audit. Back up the database with the normal Harness backup process; retained source payloads contain private ticket data.

## Local qualification

- `node --test tests/linear-intake.test.mjs` covers authentic and forged delivery, replay protection, cross-workspace rejection, import fidelity, standard admission, duplicate mentions, operator edits, recovery, mapping failures, API acknowledgement failures, collection limits and credential renewal.
- Existing task, project, authority and store tests cover compatibility of the shared creation path.
- All automated Linear calls use a fake external client. They do not prove live app installation, permissions, API connectivity or public webhook delivery.

Official API references: [Agent setup](https://linear.app/developers/agents), [agent sessions](https://linear.app/developers/agent-interaction), [webhook security](https://linear.app/developers/webhooks), [client credentials](https://linear.app/developers/oauth-2-0-authentication#client-credentials-tokens).

## Qualification record — 22 September 2026

- Worktree: `codex/linear-harness-intake`, based on `3878a2419979465a53171cd59a5cff455a6a2646`.
- Final integration suite: **13/13 passed**. Focused compatibility run before the last two added integration cases: **77/77 passed**.
- Lint, formatting, TypeScript, application build, Frontier build and **4/4 Sites tests passed**. Builds retain the existing large-chunk warning.
- Full configured suite with test concurrency limited to two: **710/720 passed**. All ten failures are in `research-deepagents-adapter` and `research-vertical-slice`; running those same files in the original checkout reproduces the same ten failures. The dependency installation lacks the `better-sqlite3` native binding. No research implementation or shared dependency installation was modified to conceal or repair this unrelated environment problem.
- Browser qualification used a disposable SQLite store and fake Linear client. The preview at `http://127.0.0.1:5349/#task/AH-001` shows the synthetic `DEMO-123` issue, retained description, metadata and explicit Start task control. Zero agent runs. The preview API is on port 4349. This proves local import/display behavior, not real webhook delivery.
- A private, ignored `.data/linear-config.proposed.json` contains workspace/project mappings discovered from the connected Linear workspace and existing local companion. Its app identity fields are deliberately unset; it cannot activate as-is. The Linear registration form is prepared but unsubmitted. The original checkout and existing services remain untouched.
