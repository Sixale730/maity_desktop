#!/bin/bash
# Nivel 1: smoke test del sidecar llama-helper.
# Verifica que el binario arranca, responde Ping y termina limpio.

set -e
SIDECAR="$(cd "$(dirname "$0")/.." && pwd)/target/release/llama-helper.exe"

if [ ! -f "$SIDECAR" ]; then
    echo "❌ Sidecar no encontrado en: $SIDECAR"
    echo "   Compila primero: cargo build --release -p llama-helper"
    exit 1
fi

echo "🦙 Sidecar: $SIDECAR"
echo "📤 Sending: {\"type\":\"ping\"}"
echo ""

START=$(date +%s%3N)
RESPONSE=$(echo '{"type":"ping"}' | "$SIDECAR" 2>&1 | head -5)
END=$(date +%s%3N)
ELAPSED=$((END - START))

echo "📥 Response:"
echo "$RESPONSE"
echo ""
echo "⏱️  Time: ${ELAPSED}ms"
echo ""

if echo "$RESPONSE" | grep -q "pong"; then
    echo "✅ PASS — sidecar responde a ping"
    exit 0
else
    echo "❌ FAIL — sidecar no respondió pong"
    exit 1
fi
