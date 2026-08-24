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
#
# OJO: el log NO vive junto a la SQLite. `logging/file_logger.rs` lo resuelve como
# `dirs::data_local_dir()/<app_name>/logs/` con rotacion DIARIA (prefijo `maity`,
# sufijo `log`), o sea `maity.YYYY-MM-DD.log` — mientras que la base de datos usa
# el app_data_dir de Tauri (`com.maity.ai`). Este script apuntaba a
# `com.maity.ai/maity-desktop.log`, que es el layout de Windows: en macOS/Linux el
# archivo nunca existia y el check fallaba SIEMPRE, reportando "la app crasheo
# antes de iniciar el logger" aunque el arranque fuera perfecto.
case "$(uname -s)" in
    Darwin*)
        EXE="$WORKSPACE_ROOT/target/debug/maity-desktop"
        LOG_DIR="$HOME/Library/Application Support/Maity/logs"
        ;;
    Linux*)
        EXE="$WORKSPACE_ROOT/target/debug/maity-desktop"
        LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/Maity/logs"
        ;;
    *)
        echo "❌ Unsupported platform: $(uname -s) — use smoke-test-startup.ps1 on Windows"
        exit 1
        ;;
esac

# Devuelve el .log mas reciente del directorio, o cadena vacia si no hay ninguno.
newest_log() {
    ls -t "$LOG_DIR"/maity.*.log 2>/dev/null | head -1
}

if [ ! -f "$EXE" ]; then
    echo "❌ Binary not found at $EXE"
    echo "   Run: cd frontend && pnpm run tauri:build:debug"
    exit 1
fi

echo "🧪 Smoke test: $EXE"

# Apartar los logs previos para que el grep vea SOLO lo que produzca esta corrida.
# Con rotacion diaria, dos smoke tests el mismo dia comparten archivo: sin esto,
# un arranque sano heredaria el panic de la corrida anterior (y viceversa).
for old in "$LOG_DIR"/maity.*.log; do
    [ -f "$old" ] && mv "$old" "$old.bak"
done

# Launch + wait + kill
"$EXE" &
PID=$!
echo "   Launched PID $PID, waiting 6s..."
sleep 6
kill -9 "$PID" 2>/dev/null || true
# Cleanup orphans
pkill -9 -f maity-desktop 2>/dev/null || true
pkill -9 -f llama-helper 2>/dev/null || true

LOG="$(newest_log)"

if [ -z "$LOG" ] || [ ! -f "$LOG" ]; then
    echo "❌ No log file created under $LOG_DIR"
    echo "   App likely crashed before logger init"
    exit 1
fi

echo "   Log: $LOG"

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
