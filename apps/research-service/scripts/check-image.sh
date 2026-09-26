#!/bin/sh
# Proves a built research-service image carries research and nothing of the harness:
#   apps/research-service/scripts/check-image.sh eversor-research-service
# Fails on any Claude, Codex or OpenCode binary or package, any harness server or Frontier
# source, any .data directory, the harness UI's packages, PGlite, a missing review console or one
# carrying the sample research; then starts the service's config check to show the image runs.
set -eu
image="${1:?name the image to check}"
docker run --rm --entrypoint sh "$image" -c '
  set -eu
  fail=0
  bad() { echo "FAIL: $1"; fail=1; }
  for binary in claude codex opencode; do
    if command -v "$binary" >/dev/null 2>&1; then bad "$binary is on the PATH"; fi
  done
  for path in /app/server /app/src /app/scripts /app/dist/frontier /app/dist/client /app/.data /app/tests /app/design \
              /app/node_modules/@anthropic-ai /app/node_modules/@openai /app/node_modules/opencode-ai \
              /app/node_modules/react /app/node_modules/vite /app/node_modules/three \
              /app/node_modules/@electric-sql; do
    if [ -e "$path" ]; then bad "$path is in the image"; fi
  done
  if find /app \( -name "orchestrator*.mjs" -o -name ".data" \) 2>/dev/null | grep -q .; then
    bad "an orchestrator module or a .data directory is in the image"
  fi
  command -v pdftotext >/dev/null 2>&1 || bad "pdftotext is missing"
  [ -d /app/packages/research-engine/src ] || bad "the research engine is missing"
  [ -f /app/apps/research-service/src/index.mjs ] || bad "the research service is missing"
  [ -f /app/dist/research-console/index.html ] || bad "the review console is missing"
  if ls /app/dist/research-console/assets 2>/dev/null | grep -Eq "review-feed|codex-prompt-check"; then
    bad "the review console carries the recorded sample questions"
  fi
  [ "$fail" -eq 0 ] && echo "research-service image: contents OK"
  exit "$fail"
'
# Without a database or clients the service must refuse to start, and say why.
output="$(docker run --rm "$image" 2>&1 || true)"
echo "$output" | grep -q "RESEARCH_DATABASE_URL" || { echo "FAIL: the service did not run its config check"; echo "$output"; exit 1; }
echo "research-service image: starts and checks its configuration"
