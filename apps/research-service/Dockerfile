# The research service, alone: the research engine, the service, their production dependencies
# (`pg`), poppler for PDF sources, and the built review console (the research-only Frontier). No
# harness, no Claude, Codex or OpenCode, no sample research and no .data.
# `scripts/check-image.sh` proves it after a build.
#
# Build from the repository root, so the workspace manifests and the lockfile are in context:
#   docker build -f apps/research-service/Dockerfile -t eversor-research-service .
#
# Separate from the harness image (the root Dockerfile), which stays dev only.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/research-engine/package.json ./packages/research-engine/
COPY apps/research-service/package.json ./apps/research-service/
# Only the service's own production dependencies: none of the root's (the harness UI), and no
# dev tools such as PGlite, so the image can only reach a real Postgres. npm installs a named
# workspace's devDependencies even with --omit=dev (npm 10), so they are taken out of this stage's
# copy of the manifest first; the lockfile still matches, and the copy never leaves this stage.
RUN node -e 'const fs = require("fs"); const file = "apps/research-service/package.json"; const manifest = JSON.parse(fs.readFileSync(file, "utf8")); delete manifest.devDependencies; fs.writeFileSync(file, JSON.stringify(manifest, null, 2));' \
  && npm ci --omit=dev --workspace @eversor/research-service --include-workspace-root=false --no-audit --no-fund \
  && npm cache clean --force

# The review console, built with the recorded sample questions left out (RESEARCH_CONSOLE_FIXTURES=off):
# the build never reads them, and its boundary check fails on any harness delivery module.
FROM ${NODE_IMAGE} AS console
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/research-engine/package.json ./packages/research-engine/
COPY apps/research-service/package.json ./apps/research-service/
RUN npm ci --no-audit --no-fund
COPY vite.research-console.config.mjs ./
COPY scripts/research-console ./scripts/research-console
COPY packages/research-engine/src/engine/contracts ./packages/research-engine/src/engine/contracts
COPY design/mission-frontier/assets/staging/colony-v2/contract.json ./design/mission-frontier/assets/staging/colony-v2/
COPY public/frontier ./public/frontier
COPY src/frontier ./src/frontier
RUN RESEARCH_CONSOLE_FIXTURES=off npx vite build --config vite.research-console.config.mjs

FROM ${NODE_IMAGE}
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends poppler-utils ca-certificates; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    RESEARCH_SERVICE_HOST=0.0.0.0 \
    RESEARCH_SERVICE_PORT=4400 \
    RESEARCH_DATA_DIR=/data
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node packages/research-engine/package.json ./packages/research-engine/
COPY --chown=node:node packages/research-engine/src ./packages/research-engine/src
COPY --chown=node:node apps/research-service/package.json ./apps/research-service/
COPY --chown=node:node apps/research-service/src ./apps/research-service/src
COPY --from=console --chown=node:node /app/dist/research-console ./dist/research-console
RUN install -d -o node -g node /data
USER node
EXPOSE 4400
# Listening on 0.0.0.0 inside the container turns the review console and its routes off until
# sign-in exists (Phase 5); PlanCheck's batch routes still need a client token.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4400/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/research-service/src/index.mjs"]
