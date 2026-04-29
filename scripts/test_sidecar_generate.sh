#!/bin/bash
# Nivel 2: generate test con Gemma 4B.
# Carga el modelo y pide una respuesta de 20 tokens. Mide cold-start.

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR="$PROJECT_ROOT/target/release/llama-helper.exe"
MODEL_DIR="$APPDATA/com.maity.ai/models/summary"
MODEL="$MODEL_DIR/gemma-3-4b-it-Q4_K_M.gguf"

# Usamos forward slashes — llama.cpp acepta ambos en Windows.
# Backslashes requerirían escape doble en JSON.
MODEL_WIN="${MODEL//\\//}"

if [ ! -f "$SIDECAR" ]; then
    echo "❌ Sidecar no encontrado: $SIDECAR"
    exit 1
fi
if [ ! -f "$MODEL" ]; then
    echo "❌ Modelo no encontrado: $MODEL"
    echo "   Verifica $MODEL_DIR"
    exit 1
fi

MODEL_SIZE_MB=$(stat -c %s "$MODEL" 2>/dev/null | awk '{printf "%.0f", $1/1024/1024}')
echo "🦙 Sidecar: $SIDECAR"
echo "📦 Model:   $MODEL ($MODEL_SIZE_MB MB)"
echo ""

# Build JSON request usando jq para escape correcto del path
REQUEST=$(cat <<EOF
{"type":"generate","prompt":"Responde solo con la palabra 'OK': ","max_tokens":5,"model_path":"$MODEL_WIN","temperature":0.1}
EOF
)

echo "📤 Request: $REQUEST"
echo ""
echo "⏳ Cargando modelo (cold-start ~30-60s en CPU)..."
echo ""

START=$(date +%s)
RESPONSE=$(echo "$REQUEST" | "$SIDECAR" 2>&1)
END=$(date +%s)
ELAPSED=$((END - START))

echo "📥 Output completo:"
echo "$RESPONSE"
echo ""
echo "⏱️  Tiempo total: ${ELAPSED}s"
echo ""

if echo "$RESPONSE" | grep -q '"type":"response"'; then
    echo "✅ PASS — sidecar generó respuesta"
    if [ "$ELAPSED" -lt 90 ]; then
        echo "✅ Tiempo dentro del threshold (<90s)"
    else
        echo "⚠️  Tiempo excedió 90s — sidecar lento sin GPU"
    fi
    exit 0
else
    echo "❌ FAIL — no se encontró response"
    exit 1
fi
