"""
Validar latencia del chat con Gemma local.

El chat (`coach_chat`) usa el mismo sidecar que los tips pero con:
- max_tokens=512 (vs 200 de tips)
- temperature=0.7 (vs 0.3, más creativo)
- prompts conversacionales (multi-turn)

Test: 3 mensajes consecutivos al sidecar manteniéndolo warm.
- Primer mensaje: cold-start (carga modelo a VRAM)
- Segundo y tercero: warm (modelo ya cargado)

Mide latencia por mensaje y throughput sostenido.
"""
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SIDECAR = PROJECT_ROOT / "target" / "release" / "llama-helper.exe"
APPDATA = Path(os.environ["APPDATA"])
MODEL_PATH = APPDATA / "com.maity.ai" / "models" / "summary" / "gemma-3-4b-it-Q4_K_M.gguf"

# System prompt del chat (replicado del backend, simplificado)
CHAT_SYSTEM_PROMPT = """Eres Maity, asistente de comunicación. Respondes preguntas del usuario sobre sus reuniones de forma breve, clara y útil. Siempre en español. Máximo 3 párrafos."""

# Conversación de prueba — 3 turnos típicos
CONVERSATION = [
    "Hola Maity, ¿qué tal?",
    "Tengo una junta de ventas mañana. ¿Algún consejo rápido para hacer buenas preguntas de descubrimiento?",
    "Y si el cliente dice que está caro al final, ¿qué le respondo?",
]

def format_gemma3_chat(system: str, messages: list[tuple[str, str]]) -> str:
    """Formato Gemma3 multi-turn."""
    parts = [f"<start_of_turn>user\n{system}<end_of_turn>"]
    for role, content in messages:
        # Gemma3 usa "user" para todo, no tiene separador "assistant"
        # Nuestro backend lo emula así
        if role == "user":
            parts.append(f"<start_of_turn>user\n{content}<end_of_turn>")
        else:
            parts.append(f"<start_of_turn>model\n{content}<end_of_turn>")
    parts.append("<start_of_turn>model\n")
    return "\n".join(parts)

def call_sidecar_persistent(prompts: list[str], max_tokens: int = 512, timeout_secs: int = 180):
    """
    Spawn llama-helper UNA vez, manda múltiples Generate requests
    secuencialmente para mantener el modelo en RAM/VRAM (warm).
    """
    request_args = [str(SIDECAR)]
    proc = subprocess.Popen(
        request_args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )

    results = []
    history = []  # (role, content)
    model_path_str = str(MODEL_PATH).replace("\\", "/")

    try:
        for i, user_msg in enumerate(prompts):
            history.append(("user", user_msg))
            full_prompt = format_gemma3_chat(CHAT_SYSTEM_PROMPT, history)

            request = {
                "type": "generate",
                "prompt": full_prompt,
                "max_tokens": max_tokens,
                "context_size": 4096,
                "model_path": model_path_str,
                "temperature": 0.7,
                "top_k": 64,
                "top_p": 0.95,
                "stop_tokens": ["<end_of_turn>"],
            }

            print(f"\n━━━ Turn {i+1}: \"{user_msg}\" ━━━")
            start = time.time()

            # Enviar request por stdin
            proc.stdin.write(json.dumps(request) + "\n")
            proc.stdin.flush()

            # Esperar respuesta con timeout
            response_line = None
            deadline = start + timeout_secs
            while time.time() < deadline:
                line = proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if line.startswith('{"type":"response"'):
                    response_line = line
                    break

            elapsed = time.time() - start

            if not response_line:
                print(f"❌ TIMEOUT after {elapsed:.1f}s")
                results.append((i+1, user_msg, None, elapsed, "TIMEOUT"))
                break

            try:
                response = json.loads(response_line)
                text = response.get("text", "").strip()
                history.append(("model", text))

                # Throughput estimado (chars / seg como proxy)
                tokens_estim = len(text) // 4  # ~4 chars per token
                tps = tokens_estim / max(elapsed, 0.1)

                print(f"⏱️  {elapsed:.1f}s  |  ~{tokens_estim} tokens  |  ~{tps:.1f} tok/s")
                print(f"📝 Response:")
                # Print response, limit width
                for line in text.split("\n"):
                    print(f"   {line[:120]}")

                results.append((i+1, user_msg, text, elapsed, "OK"))
            except json.JSONDecodeError as e:
                print(f"❌ JSON DECODE ERR: {e}")
                results.append((i+1, user_msg, None, elapsed, f"JSON_ERR: {e}"))
                break

    finally:
        try:
            proc.stdin.write(json.dumps({"type": "shutdown"}) + "\n")
            proc.stdin.flush()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()

    return results

def main():
    print(f"🦙 Sidecar: {SIDECAR}")
    print(f"📦 Model:   {MODEL_PATH}")
    print(f"💬 Mensajes a probar: {len(CONVERSATION)}")
    print()

    if not SIDECAR.exists() or not MODEL_PATH.exists():
        print("❌ Sidecar o modelo no encontrado")
        sys.exit(1)

    results = call_sidecar_persistent(CONVERSATION, max_tokens=512, timeout_secs=180)

    print("\n━━━ Resumen ━━━")
    cold_start = None
    warm_times = []
    for turn, msg, text, elapsed, status in results:
        flag = "✅" if status == "OK" else "❌"
        kind = "cold" if turn == 1 else "warm"
        print(f"  {flag} Turn {turn} ({kind}): {elapsed:5.1f}s  |  status={status}")
        if status == "OK":
            if turn == 1:
                cold_start = elapsed
            else:
                warm_times.append(elapsed)

    if cold_start is not None:
        print(f"\n  Cold-start (turn 1):     {cold_start:.1f}s")
    if warm_times:
        avg_warm = sum(warm_times) / len(warm_times)
        print(f"  Warm avg (turns 2+):     {avg_warm:.1f}s")
        print(f"  Warm range:              {min(warm_times):.1f}s - {max(warm_times):.1f}s")

    passed = sum(1 for r in results if r[4] == "OK")
    print(f"\n  {passed}/{len(results)} mensajes respondidos correctamente")
    sys.exit(0 if passed == len(results) else 1)

if __name__ == "__main__":
    main()
