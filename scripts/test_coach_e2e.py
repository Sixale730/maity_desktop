"""
Nivel 3: prueba end-to-end del coach LLM con transcripts reales.

Pipeline replicado:
1. Lee transcripts reales de meeting_minutes.sqlite
2. Construye user_prompt en formato build_user_prompt()
3. Aplica template Gemma3 (system + user con turns)
4. Spawn llama-helper.exe + manda JSON Generate via stdin
5. Valida respuesta JSON con shape de CoachTipUpdate

Uso:
    python scripts/test_coach_e2e.py
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

# Force UTF-8 stdout for emoji-rich logs on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ─── Paths ────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SIDECAR = PROJECT_ROOT / "target" / "release" / "llama-helper.exe"
APPDATA = Path(os.environ["APPDATA"]) if "APPDATA" in os.environ else None
DB_PATH = APPDATA / "com.maity.ai" / "meeting_minutes.sqlite" if APPDATA else None
MODEL_PATH = APPDATA / "com.maity.ai" / "models" / "summary" / "gemma-3-4b-it-Q4_K_M.gguf" if APPDATA else None

# ─── System prompt real (extraído de prompt.rs) ──────────────────────────
COACH_SYSTEM_PROMPT = """Eres Maity, coach de comunicación en vivo. Respondes SIEMPRE en español.

QUIÉN ES QUIÉN (CRÍTICO):
- Líneas "USUARIO:" = persona del micrófono. Es A QUIEN COACHEAS.
- Líneas "INTERLOCUTOR:" = persona de la bocina (cliente/audiencia). NO lo coacheas.
- TODOS tus tips son para el USUARIO. El interlocutor NO ve tus tips.

TU TRABAJO:
Leer la transcripción y dar UNA frase concreta que el usuario pueda DECIR AHORA MISMO.
- Si el INTERLOCUTOR dijo algo → dile al usuario QUÉ CONTESTARLE (frase exacta entre comillas).
- Si el USUARIO dijo algo mejorable → dale la frase CORREGIDA que debería usar.

REGLA #1 (LA MÁS IMPORTANTE):
Cada tip DEBE incluir entre comillas simples la FRASE EXACTA que el usuario debe decir.

PREFIJO OBLIGATORIO según el tipo:
- Para DECIR algo → "Dile:" o "Respóndele:"
- Para PREGUNTAR → "Pregúntale:"

FORMATO: SOLO este JSON, nada más:
{"tip":"máx 15 palabras español con frase entre comillas","tip_type":"recognition|observation|corrective|introspective","category":"discovery|objection|closing|pacing|rapport|service|negotiation|listening","subcategory":"corto","technique":"ninguna","priority":"critical|important|soft","confidence":0.0}

REGLAS:
- SIEMPRE español.
- SIEMPRE incluir frase textual entre comillas simples.
- Sin señal clara → confidence ≤ 0.3.
"""

# ─── Template Gemma3 ──────────────────────────────────────────────────────
def format_gemma3(system_prompt: str, user_prompt: str) -> str:
    return (
        "<start_of_turn>user\n"
        f"{system_prompt}<end_of_turn>\n"
        "<start_of_turn>user\n"
        f"{user_prompt}<end_of_turn>\n"
        "<start_of_turn>model\n"
    )

# ─── User prompt (replica build_user_prompt) ──────────────────────────────
def build_user_prompt(transcript: str, minute: int = 1) -> str:
    return (
        f"TIPO: auto\n"
        f"MINUTO: {minute}\n"
        f"\nCHEQUEO GENERAL. USUARIO: = micrófono. INTERLOCUTOR: = bocina.\n\n"
        f"<transcripcion>\n{transcript}\n</transcripcion>\n\n"
        f"<tips_previos>\n(sin tips previos en esta sesión)\n</tips_previos>\n\n"
        f"Responde con UN JSON."
    )

# ─── Etiquetar transcript como USUARIO/INTERLOCUTOR alternando ───────────
def label_transcript(text: str) -> str:
    """Simula etiquetado USUARIO/INTERLOCUTOR alternando por oraciones."""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    labeled = []
    for i, s in enumerate(sentences):
        if not s.strip():
            continue
        speaker = "USUARIO" if i % 2 == 0 else "INTERLOCUTOR"
        labeled.append(f"{speaker}: {s.strip()}")
    return "\n".join(labeled)

# ─── Llamar al sidecar ────────────────────────────────────────────────────
def call_sidecar(prompt: str, max_tokens: int = 200, timeout_secs: int = 180):
    """Spawn llama-helper, send Generate, parse response."""
    request = {
        "type": "generate",
        "prompt": prompt,
        "max_tokens": max_tokens,
        "context_size": 4096,
        "model_path": str(MODEL_PATH).replace("\\", "/"),
        "temperature": 0.3,
        "top_k": 64,
        "top_p": 0.95,
        "stop_tokens": ["<end_of_turn>"],
    }
    request_json = json.dumps(request)

    start = time.time()
    try:
        proc = subprocess.run(
            [str(SIDECAR)],
            input=request_json + "\n",
            capture_output=True,
            text=True,
            timeout=timeout_secs,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return None, time.time() - start, "TIMEOUT"

    elapsed = time.time() - start

    # Find the JSON response line in stdout
    response_line = None
    for line in proc.stdout.splitlines():
        if line.strip().startswith('{"type":"response"'):
            response_line = line.strip()
            break

    if not response_line:
        return None, elapsed, f"NO_RESPONSE (stdout tail: {proc.stdout[-300:]})"

    try:
        response = json.loads(response_line)
        return response.get("text", ""), elapsed, "OK"
    except json.JSONDecodeError as e:
        return None, elapsed, f"JSON_DECODE_ERR: {e}"

# ─── Validar el output del LLM ────────────────────────────────────────────
def parse_tip_json(raw: str):
    """Extrae el JSON del CoachTipUpdate de la respuesta del LLM."""
    # Buscar primer { y último }
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None, "NO_JSON_FOUND"
    json_str = raw[start:end+1]
    try:
        parsed = json.loads(json_str)
    except json.JSONDecodeError as e:
        return None, f"INVALID_JSON: {e}"

    # Verificar campos esperados
    required = ["tip"]
    for field in required:
        if field not in parsed:
            return None, f"MISSING_FIELD: {field}"

    if not parsed["tip"] or len(parsed["tip"].strip()) < 5:
        return None, "TIP_TOO_SHORT"

    return parsed, "OK"

# ─── Cargar transcripts de la DB ──────────────────────────────────────────
def load_transcripts(limit: int = 3):
    """Saca transcripts de tamaño variado de la DB."""
    if not DB_PATH or not DB_PATH.exists():
        print(f"⚠️  DB no encontrada en {DB_PATH}, usando fixtures hardcoded")
        return [
            ("fixture-short", "Mira, está caro. No sé si me alcanza ahorita."),
            ("fixture-medium",
             "Estamos analizando la propuesta pero el precio nos parece "
             "alto comparado con la competencia. ¿Hay alguna flexibilidad? "
             "Necesitamos cerrar esto pronto."),
            ("fixture-long",
             "La verdad es que llevamos varias semanas evaluando opciones. "
             "Tu producto tiene buenas reseñas pero la implementación nos "
             "preocupa porque mi equipo no es muy técnico. Además el precio "
             "está al límite del presupuesto. Necesito convencer al CFO de "
             "que esto vale la pena. ¿Qué garantías tienes? ¿Hay otros "
             "clientes con perfil similar al nuestro?"),
        ]

    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    # Buscar tabla con transcripts
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cur.fetchall()]
    print(f"📊 DB tables: {tables}")

    transcripts = []
    if "transcripts" in tables:
        cur.execute(
            "SELECT id, transcript FROM transcripts "
            "WHERE transcript IS NOT NULL AND length(transcript) > 50 "
            "ORDER BY length(transcript) ASC"
        )
        rows = cur.fetchall()

        if rows:
            # Dividir por tamaño
            n = len(rows)
            indices = [n // 4, n // 2, (3 * n) // 4][:limit]
            for i in indices:
                if i < n:
                    rid, text = rows[i]
                    # Truncar si es muy largo
                    if len(text) > 800:
                        text = text[:800] + "..."
                    transcripts.append((f"db-{rid}", text))

    conn.close()
    if not transcripts:
        return load_transcripts.__func__()  # fallback to fixtures
    return transcripts

# ─── Run tests ────────────────────────────────────────────────────────────
def main():
    print(f"🦙 Sidecar: {SIDECAR}")
    print(f"📦 Model:   {MODEL_PATH}")
    print(f"💾 DB:      {DB_PATH}")
    print()

    if not SIDECAR.exists():
        print(f"❌ Sidecar no encontrado")
        sys.exit(1)
    if not MODEL_PATH.exists():
        print(f"❌ Modelo no encontrado")
        sys.exit(1)

    # Cargar transcripts
    transcripts = load_transcripts(limit=3)
    print(f"📄 Cargados {len(transcripts)} transcripts\n")

    # Run tests
    results = []
    for tid, raw_text in transcripts:
        words = len(raw_text.split())
        print(f"━━━ Test [{tid}] ({words} palabras) ━━━")
        print(f"   Transcript preview: {raw_text[:100]}...")
        print()

        # Construir prompt completo
        labeled = label_transcript(raw_text)
        user_prompt = build_user_prompt(labeled)
        full_prompt = format_gemma3(COACH_SYSTEM_PROMPT, user_prompt)

        # Llamar al sidecar
        text, elapsed, status = call_sidecar(full_prompt, max_tokens=200)
        if status != "OK":
            print(f"❌ FAIL — {status} (took {elapsed:.1f}s)")
            results.append((tid, "FAIL", elapsed, status))
            print()
            continue

        # Validar JSON del tip
        tip, parse_status = parse_tip_json(text)
        if parse_status != "OK":
            print(f"❌ FAIL — {parse_status}")
            print(f"   Raw output: {text[:300]}")
            results.append((tid, "FAIL", elapsed, parse_status))
            print()
            continue

        print(f"✅ PASS — {elapsed:.1f}s, tip_len={len(tip['tip'])}")
        print(f"   Tip: {tip['tip']}")
        if 'category' in tip:
            print(f"   Category: {tip['category']}, Priority: {tip.get('priority', 'N/A')}")
        results.append((tid, "PASS", elapsed, tip['tip']))
        print()

    # Summary
    print("━━━ Resumen ━━━")
    for tid, status, t, info in results:
        print(f"  [{tid}] {status} — {t:.1f}s")
    passed = sum(1 for r in results if r[1] == "PASS")
    total = len(results)
    print(f"\n  {passed}/{total} tests pasaron")
    sys.exit(0 if passed == total else 1)

if __name__ == "__main__":
    main()
