#!/usr/bin/env bash
# Smoke test (mac/linux): launch the debug binary, wait 6s, kill, and grep
# the log for panic patterns + confirm AppState was managed.
#
# See smoke-test-startup.ps1 for the Windows equivalent.

set -e

# Resolve workspace root (this script lives at <root>/scripts/) so the smoke test
# works regardless of the cwd from which `pnpm run tauri:build:debug` was invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Detect platform
case "$(uname -s)" in
    Darwin*)
        EXE="$WORKSPACE_ROOT/target/debug/maity-desktop"
        LOG="$HOME/Library/Application Support/com.maity.ai/maity-desktop.log"
        ;;
    Linux*)
        EXE="$WORKSPACE_ROOT/target/debug/maity-desktop"
        LOG="$HOME/.local/share/com.maity.ai/maity-desktop.log"
        ;;
    *)
        echo "❌ Unsupported platform: $(uname -s) — use smoke-test-startup.ps1 on Windows"
        exit 1
        ;;
esac

if [ ! -f "$EXE" ]; then
    echo "❌ Binary not found at $EXE"
    echo "   Run: cd frontend && pnpm run tauri:build:debug"
    exit 1
fi

echo "🧪 Smoke test: $EXE"

# Backup existing log
if [ -f "$LOG" ]; then
    mv "$LOG" "$LOG.bak"
fi

# Launch + wait + kill
"$EXE" &
PID=$!
echo "   Launched PID $PID, waiting 6s..."
sleep 6
kill -9 "$PID" 2>/dev/null || true
# Cleanup orphans
pkill -9 -f maity-desktop 2>/dev/null || true
pkill -9 -f llama-helper 2>/dev/null || true

if [ ! -f "$LOG" ]; then
    echo "❌ Log file not created at $LOG"
    echo "   App likely crashed before logger init"
    exit 1
fi

PANIC_PATTERNS='PANIC|state\(\) called before manage|Failed to initialize database|VersionMismatch|previously applied migration was modified'

if grep -E -q "$PANIC_PATTERNS" "$LOG"; then
    echo ""
    echo "❌ Critical pattern detected:"
    grep -E "$PANIC_PATTERNS|ERROR" "$LOG" | head -15
    exit 1
fi

if ! grep -q '\[DB Init\] AppState managed successfully' "$LOG"; then
    echo ""
    echo "❌ '[DB Init] AppState managed successfully' not found in log"
    echo "   DB init likely failed silently. Recent [DB Init] lines:"
    grep '\[DB Init\]' "$LOG" | head -10
    exit 1
fi

echo ""
echo "✅ Startup smoke test passed"
echo "   - No panic patterns detected"
echo "   - AppState managed successfully"
