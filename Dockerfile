# Agent Harness companion + built Frontier UI, as one Linux image.
#
# The same image runs on a Mac (Docker Desktop or OrbStack) and on the Azure VM, so what works
# locally is what gets deployed. See docs/hosting/container.md for the login steps, volumes and
# the Azure mapping.
#
# The Claude and Codex CLIs are pinned: the harness parses their stream output, so an
# unplanned upgrade can break runs. Bump these deliberately and rerun a canary task.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:frontier

FROM ${NODE_IMAGE}
ARG CLAUDE_CODE_VERSION=2.1.281
ARG CODEX_VERSION=0.156.1
ARG UV_VERSION=0.8.22

# git/gh/ssh: worktrees, pushes and PRs. Docker CLI/Compose: repository-owned config
# checks, without a daemon or socket. python3: research helpers and target repos.
# chromium: prototype previews. bubblewrap/socat: the Claude CLI's Linux sandbox.
# build-essential: native modules in target repositories.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git openssh-client jq ripgrep less procps tini \
      python3 python3-venv python3-pip build-essential \
      chromium bubblewrap socat; \
    install -d -m 0755 /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list; \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc; \
    chmod go+r /etc/apt/keyrings/docker.asc; \
    . /etc/os-release; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh docker-ce-cli docker-compose-plugin; \
    rm -rf /var/lib/apt/lists/*; \
    pip3 install --no-cache-dir --break-system-packages "uv==${UV_VERSION}"; \
    npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "@openai/codex@${CODEX_VERSION}"; \
    npm cache clean --force

# The server has no npm dependencies of its own (it imports only Node built-ins and ../src), so
# the runtime image carries source plus the built UI and no node_modules.
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --from=build --chown=node:node /app/dist/frontier ./dist/frontier

# Mount points for the named volumes in compose.yaml, created here so a fresh volume inherits
# the right owner. /w is deliberately short: worktree path length is paid per sandbox rule.
RUN install -d -o node -g node /app/.data /w /repos /home/node/.config /home/node/.codex

ENV AGENT_HARNESS_HOST=0.0.0.0 \
    AGENT_HARNESS_PORT=4321 \
    AGENT_HARNESS_LINEAR_HOST=0.0.0.0 \
    AGENT_HARNESS_WORKTREE_ROOT=/w \
    AGENT_HARNESS_CHROME=/usr/bin/chromium \
    CODEX_HOME=/home/node/.codex

USER node
EXPOSE 4321 4311
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AGENT_HARNESS_PORT||4321)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# tini reaps the CLI subprocesses the orchestrator spawns and forwards SIGTERM so the companion
# shuts down cleanly (it cancels runs before closing the store).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.mjs"]
