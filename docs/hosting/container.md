# Running the Harness in a container

One Linux image carries the companion, the built Frontier UI and the tools the harness launches (`claude`, `codex`, `gh`, `git`, Python, Chromium, and the Docker CLI with Compose). The same image runs on a Mac under Docker Desktop or OrbStack and on the planned Azure VM, so what works locally is what gets deployed.

The UI and the API share one port. Open `http://localhost:4321/`; there is no Vite dev server in this path.

## Two ways to run the built version

| | Command | When |
|---|---|---|
| **On the Mac directly** | `npm run serve:frontier` → `http://localhost:4321/` | Quickest. Uses your Mac's logins, repositories and `.data/`, exactly as `dev:frontier-api` does today, with the built UI in place of Vite. |
| **In a container** | `docker compose up -d --build` → `http://localhost:4321/` | Rehearses Azure. Its own logins, clones and database, in Docker volumes. |

`npm run dev:frontier` (Vite on 5199) is unchanged for UI work.

Don't run both on port 4321 at once. Each has its own database, so tasks created in one don't appear in the other. The Linear webhook should point at only one of them.

## First run in a container

Give Docker Desktop or OrbStack at least 8 CPUs and 16 GB of memory. The harness runs verification at half the container's core count by default.

```sh
docker compose up -d --build
```

The container starts with no logins, so do these once. They're stored in the `harness-home` volume and survive rebuilds.

```sh
docker compose exec harness claude auth login  # choose the Claude subscription
docker compose exec harness codex login --device-auth   # choose ChatGPT, never an API key
docker compose exec harness gh auth login     # GitHub.com, HTTPS, browser or token
docker compose exec harness gh auth setup-git
docker compose exec harness git config --global user.name "Your Name"
docker compose exec harness git config --global user.email "you@example.com"
```

The subscription-only rule is unchanged: both runtimes still refuse an API-key login, and the image doesn't pass `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` through.

### Repositories

The container doesn't use your Mac's checkouts. It needs its own clones in the `harness-repos` volume, with dependencies installed *inside* the container. New worktrees copy `node_modules` and `.venv` from the source checkout, and macOS builds of native modules don't run on Linux.

The Docker CLI and Compose plugin let repository verification run commands such as `docker compose config` inside the container. The host Docker socket is not mounted, so those commands can inspect configuration but cannot start host containers.

After rebuilding the image for a previously blocked repository baseline, check the CLI with `docker compose exec harness docker compose version`, then use the task's **Recheck repository baseline** action. The Harness reruns the recorded failed command at the pinned base revision. If it passes, a task blocked in Test retries the retained candidate; the old failed evidence remains in its history.

```sh
docker compose exec harness git clone https://github.com/<org>/<repo>.git /repos/<repo>
```

Install each project's dependencies from the directory that contains its lockfile. `npm ci` requires a `package-lock.json` in the working directory; a root `package.json` alone is not enough. Pass `--include=dev` when installing a target repository's Node dependencies so its lint, test and build tools are present even if the operator environment sets `NODE_ENV=production`. The image no longer sets `NODE_ENV` globally, and Harness verification does not pass an inherited `NODE_ENV` to repository commands. A repository command can set its own value when needed.

For PlanCheck, the committed lockfile is in `frontend/`, not the repository root:

```sh
docker compose exec -w /repos/eversor-plancheck/frontend harness npm ci --include=dev
docker compose exec -w /repos/eversor-plancheck harness make backend-venv
```

Running `npm ci` at the PlanCheck root fails because there is no root lockfile. Running `npm install` there creates an untracked root `package-lock.json` that must be removed before Implement can start.

Then add the project in the UI with the path `/repos/<repo>`. To make one repository the suggested default, set `AGENT_HARNESS_REPOSITORY=/repos/<repo>` in `.env.harness.local`.

Sharing a Mac checkout into the container through a bind mount is deliberately not supported. `git worktree add` writes the container's paths into that checkout's `.git/worktrees`, and the Mac-built dependencies still wouldn't run.

### Secrets and configuration

Copy `.env.harness.example` to `.env.harness.local` (git-ignored) and fill in only what you use. Compose reads it if it exists. Linear's JSON config goes in the data volume:

```sh
docker compose cp linear-config.local.json harness:/app/.data/linear-config.local.json
```

Then set `AGENT_HARNESS_LINEAR_CONFIG=/app/.data/linear-config.local.json`. The webhook receiver is published on `127.0.0.1:4311`; point the tunnel at that, forwarding only `/linear/webhook`.

## Volumes

| Volume | Mounted at | Holds | Back up? |
|---|---|---|---|
| `harness-home` | `/home/node` | Claude, Codex and GitHub logins; git identity | No. Log in again instead. |
| `harness-data` | `/app/.data` | `tasks.sqlite3`, research captures, Linear config | **Yes**, but only while no run is active. See the live-database rule in `AGENTS.md`. |
| `harness-repos` | `/repos` | The harness's clones | Optional. They can be re-cloned. |
| `harness-worktrees` | `/w` | Candidate worktrees | No. Disposable. |

## Security model

The companion still has no user accounts. The network boundary is the access control:

- Inside the container the companion binds `0.0.0.0`, because the container's own loopback isn't reachable from outside it. Compose publishes the port to the **host's loopback only** (`127.0.0.1:4321`). Don't change that to `0.0.0.0`.
- Host and Origin checks still apply. A request must name a loopback host or one listed in `AGENT_HARNESS_ALLOWED_HOSTS`. A browser request must come from the companion's own origin, the Vite dev origins, or one listed in `AGENT_HARNESS_ALLOWED_ORIGINS`. Mutations still need the per-process CSRF token and JSON.
- **Claude sandbox:** the Claude CLI sandboxes on Linux with bubblewrap, which needs user namespaces. Docker's default seccomp profile blocks them, so `compose.yaml` runs the container with `seccomp=unconfined` and `apparmor=unconfined`. This loosens isolation between the container and the Docker VM, not the harness's own sandboxing. Without it, Claude stages fail their sandbox check and refuse to run: the harness sets `failIfUnavailable`, so it never runs Claude unconfined. **This Linux sandbox path hasn't been exercised with a logged-in CLI yet.** Run one small Claude-stage task before relying on it. Codex stages don't depend on it.

## Moving to Azure

The Azure plan (single operator, Tailscale-only portal, Terraform and Key Vault) uses this image unchanged:

- **VM:** a Linux VM running Docker. The four volumes become directories on the data disk.
- **Secrets:** the env file is written from Key Vault by the VM's managed identity before the container starts.
- **Portal:** `tailscale serve` on the VM forwards `https://harness.<tailnet>.ts.net` to `127.0.0.1:4321`. Set `AGENT_HARNESS_ALLOWED_HOSTS=harness.<tailnet>.ts.net`. The UI is served from that same origin, so no origin setting is needed.
- **Linear:** Tailscale Funnel forwards `/linear/webhook` to `127.0.0.1:4311`.
- **Logins:** the same one-off `docker compose exec … login` steps, run over Tailscale SSH.
