# The research service, alone: the research engine, the service, their production dependencies
# (`pg`) and poppler for PDF sources. No harness, no Frontier bundle yet (Phase 4), no Claude,
# Codex or OpenCode, and no .data. `scripts/check-image.sh` proves it after a build.
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
RUN install -d -o node -g node /data
USER node
EXPOSE 4400
# Listening on 0.0.0.0 inside the container turns the review console's routes off until sign-in
# exists (Phase 5); PlanCheck's batch routes still need a client token.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4400/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/research-service/src/index.mjs"]
