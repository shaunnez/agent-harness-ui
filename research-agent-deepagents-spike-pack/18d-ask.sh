#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="${MODEL:-claude-opus-5}"
AUTH=$(claude auth status --json 2>/dev/null || echo '{}')
python3 -c "
import json,sys
a=json.loads('''$AUTH''' or '{}')
sys.exit('REFUSING: not on a claude.ai subscription') if a.get('authMethod')!='claude.ai' else None"
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
  claude -p "$1" --model "$MODEL" \
    --append-system-prompt "$(cat "$HERE/ask-sys.txt")" \
    --mcp-config "$HERE/mcp.json" \
    --allowed-tools "mcp__qv__search_qv,mcp__qv__get_qv_table,mcp__qv__list_qv_sections,WebSearch" \
    --output-format json < /dev/null > "$2"
