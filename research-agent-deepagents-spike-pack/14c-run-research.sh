#!/usr/bin/env bash
# Research one scenario on the Claude subscription. Never uses an API key.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="${MODEL:-claude-opus-5}"

[ $# -ge 1 ] || { echo "usage: MODEL=claude-sonnet-5 $0 <scenario.json> [out.json]" >&2; exit 2; }
SCENARIO="$1"; OUT="${2:-/dev/stdout}"

# Refuse to run if the CLI is not on a subscription.
AUTH=$(claude auth status --json 2>/dev/null || echo '{}')
python3 - "$AUTH" <<'PY'
import json,sys
a=json.loads(sys.argv[1] or "{}")
if a.get("authMethod")!="claude.ai" or not a.get("loggedIn"):
    sys.exit(f"REFUSING: CLI is not on a claude.ai subscription (authMethod={a.get('authMethod')!r}). Run `claude login`.")
print(f"auth: {a['authMethod']} | plan: {a.get('subscriptionType')} | org: {a.get('orgName')}", file=sys.stderr)
PY

# Strip every credential the harness denylists, so a stray env var cannot move
# this onto metered API billing. Matches CLAUDE_ENV_DENYLIST in claude-runtime.mjs.
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
  claude -p "$(cat "$SCENARIO")" \
    --model "$MODEL" \
    --append-system-prompt "$(cat "$HERE/sys.txt")" \
    --mcp-config "$HERE/mcp.json" \
    --allowed-tools "mcp__qv__search_qv,mcp__qv__get_qv_table,mcp__qv__list_qv_sections,WebSearch" \
    --output-format json < /dev/null > "$OUT"
