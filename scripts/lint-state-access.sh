#!/usr/bin/env bash
# Forbid direct app.state::<AppState>() — must use try_state with explicit
# None handling. Direct .state() panics if AppState is not managed; if DB
# init failed silently (as in v0.2.38), the panic happens deep in a tokio
# worker and the user sees the app become unresponsive.
#
# To allow intentionally (e.g. inside setup() right after app.manage), add
# a comment "// state-allow: <reason>" on the same line.
#
# Usage:
#   bash scripts/lint-state-access.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$REPO_ROOT/frontend/src-tauri/src"

if [ ! -d "$SRC_DIR" ]; then
    echo "❌ Source directory not found: $SRC_DIR"
    exit 1
fi

# Pattern 1: app.state::<...AppState>()
# Pattern 2: <expr>.clone().state()  ← inferred type, often AppState
#
# Filters applied (in order):
#   - try_state         : already safe (Option-returning variant)
#   - // state-allow:   : explicit per-line opt-out with a reason
#   - line begins with //: pure comment (not real code)
#   - line begins with /*: block comment header
VIOLATIONS=$(grep -rn -E 'app\.state::<[^>]*AppState>\(\)|\.clone\(\)\.state\(\)' \
    --include='*.rs' \
    "$SRC_DIR" \
    | grep -v 'try_state' \
    | grep -v '// state-allow:' \
    | grep -vE ':[[:space:]]*//' \
    | grep -vE ':[[:space:]]*/\*' \
    || true)

if [ -n "$VIOLATIONS" ]; then
    echo "❌ Direct app.state::<AppState>() found — use try_state with explicit None handling:"
    echo ""
    echo "$VIOLATIONS" | sed 's/^/  /'
    echo ""
    echo "Pattern to use:"
    echo "  let state = match app.try_state::<AppState>() {"
    echo "      Some(s) => s,"
    echo "      None => return Err(\"AppState not initialized — DB init may have failed\".to_string()),"
    echo "  };"
    echo ""
    echo "If intentional (e.g. inside setup() after app.manage), add:"
    echo "  // state-allow: <short reason>"
    exit 1
fi

echo "✅ No unsafe state() calls found"
