"""
Validar recuperación de conversaciones pasadas en el chat.

Replica `coach::commands::build_agent_system_prompt`:
- Consulta meetings de la DB (últimas 30, ordenadas por fecha desc)
- Cruza con summary_processes para obtener puntuaciones
- Construye perfil del usuario + lista de conversaciones recientes
- Inyecta todo en el system prompt antes de la pregunta del usuario

Pruebas:
1. "¿Cuántas reuniones tengo registradas?"
2. "Dime el nombre de mis 3 últimas reuniones"
3. "¿Cuál fue mi puntuación promedio?"

Verifica que el LLM cita datos reales de la DB.
"""
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SIDECAR = PROJECT_ROOT / "target" / "release" / "llama-helper.exe"
APPDATA = Path(os.environ["APPDATA"])
DB_PATH = APPDATA / "com.maity.ai" / "meeting_minutes.sqlite"
MODEL_PATH = APPDATA / "com.maity.ai" / "models" / "summary" / "gemma-3-4b-it-Q4_K_M.gguf"

# ─── Replicar build_agent_system_prompt ───────────────────────────────────
def build_agent_system_prompt(db_path: Path) -> tuple[str, dict]:
    """Replica la lógica de coach::commands::build_agent_system_prompt."""
    base = (
        "Eres Maity, asistente personal de comunicación. "
        "Tienes acceso completo a las conversaciones y análisis del usuario. "
        "Responde siempre en español. "
        "Sé conciso y orientado a acción (máximo 3 párrafos). "
        "Cita reuniones específicas por nombre cuando sea relevante."
    )

    if not db_path.exists():
        return f"{base}\n\nEl usuario aún no tiene conversaciones registradas.", {}

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Meetings (últimas 30)
    cur.execute(
        "SELECT id, title, created_at FROM meetings "
        "ORDER BY created_at DESC LIMIT 30"
    )
    meetings = cur.fetchall()

    if not meetings:
        conn.close()
        return f"{base}\n\nEl usuario aún no tiene conversaciones registradas.", {}

    # Summaries con puntuaciones
    cur.execute(
        "SELECT meeting_id, result FROM summary_processes "
        "WHERE status = 'completed' AND result IS NOT NULL"
    )
    summaries = cur.fetchall()
    score_map = {}
    for mid, result in summaries:
        try:
            v = json.loads(result)
            score = (
                v.get("resumen", {}).get("puntuacion_global")
                or v.get("calidad_global", {}).get("puntaje")
            )
            if score is not None:
                score_map[mid] = float(score)
        except (json.JSONDecodeError, AttributeError):
            continue

    conn.close()

    # Construir perfil
    scores = list(score_map.values())
    avg = sum(scores) / len(scores) if scores else None

    first_date = meetings[-1][2][:10] if meetings else ""
    last_date = meetings[0][2][:10] if meetings else ""

    profile = (
        f"PERFIL DEL USUARIO:\n"
        f"- Total de conversaciones: {len(meetings)}\n"
        f"- Período: {first_date} → {last_date}\n"
    )
    if avg is not None:
        profile += f"- Promedio de puntuación: {avg:.0f}/100\n"

    profile += "\nCONVERSACIONES (más recientes primero):\n"
    for i, (mid, title, created) in enumerate(meetings[:15]):
        date = created[:10]
        if mid in score_map:
            profile += f"{i+1}. \"{title}\" — {date} — Puntuación: {score_map[mid]:.0f}/100\n"
        else:
            profile += f"{i+1}. \"{title}\" — {date}\n"

    full_prompt = f"{base}\n\n{profile}"

    stats = {
        "total_meetings": len(meetings),
        "scored_meetings": len(score_map),
        "avg_score": avg,
        "first_date": first_date,
        "last_date": last_date,
        "first_3_titles": [m[1] for m in meetings[:3]],
    }

    return full_prompt, stats

# ─── Sidecar persistent ───────────────────────────────────────────────────
def format_gemma3_chat(system: str, user_msg: str) -> str:
    return (
        f"<start_of_turn>user\n{system}<end_of_turn>\n"
        f"<start_of_turn>user\n{user_msg}<end_of_turn>\n"
        f"<start_of_turn>model\n"
    )

def call_sidecar(system_prompt: str, questions: list[str], timeout_secs: int = 180):
    proc = subprocess.Popen(
        [str(SIDECAR)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )

    results = []
    model_path_str = str(MODEL_PATH).replace("\\", "/")

    try:
        for i, q in enumerate(questions):
            full_prompt = format_gemma3_chat(system_prompt, q)
            req = {
                "type": "generate",
                "prompt": full_prompt,
                "max_tokens": 350,
                "context_size": 4096,
                "model_path": model_path_str,
                "temperature": 0.7,
                "top_k": 64,
                "top_p": 0.95,
                "stop_tokens": ["<end_of_turn>"],
            }
            print(f"\n━━━ Q{i+1}: {q} ━━━")
            start = time.time()
            proc.stdin.write(json.dumps(req) + "\n")
            proc.stdin.flush()

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
                results.append((q, None, elapsed, "TIMEOUT"))
                break
            try:
                response = json.loads(response_line)
                text = response.get("text", "").strip()
                print(f"⏱️  {elapsed:.1f}s")
                print(f"📝 Response:")
                for line in text.split("\n")[:10]:
                    print(f"   {line[:150]}")
                results.append((q, text, elapsed, "OK"))
            except json.JSONDecodeError as e:
                print(f"❌ JSON ERR: {e}")
                results.append((q, None, elapsed, f"JSON_ERR"))
                break
    finally:
        try:
            proc.stdin.write(json.dumps({"type": "shutdown"}) + "\n")
            proc.stdin.flush()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()

    return results

# ─── Validar que las respuestas usan datos de la DB ───────────────────────
def validate_response(question: str, response: str, stats: dict) -> tuple[bool, str]:
    """Heurística: verifica que la respuesta cita datos de la DB cuando aplica."""
    if not response:
        return False, "no response"
    rl = response.lower()
    if "cuántas" in question.lower() or "total" in question.lower():
        # Esperamos que mencione el número total
        if str(stats["total_meetings"]) in response:
            return True, f"cita el total ({stats['total_meetings']})"
        return False, f"no cita total esperado ({stats['total_meetings']})"
    if "última" in question.lower() or "nombre" in question.lower():
        # Espera que cite al menos un título
        for title in stats["first_3_titles"]:
            if title and title.lower() in rl:
                return True, f"cita título '{title[:40]}'"
        return False, "no cita ningún título de la DB"
    if "puntuación" in question.lower() or "promedio" in question.lower():
        if stats.get("avg_score") is not None:
            avg_str = f"{stats['avg_score']:.0f}"
            if avg_str in response:
                return True, f"cita promedio ({avg_str})"
            return False, f"no cita promedio esperado ({avg_str})"
        else:
            return True, "(sin scores en DB, sin validación específica)"
    return True, "passed (no specific validation)"

def main():
    print(f"🦙 Sidecar: {SIDECAR}")
    print(f"💾 DB:      {DB_PATH}")
    print(f"📦 Model:   {MODEL_PATH}")
    print()

    if not SIDECAR.exists() or not MODEL_PATH.exists() or not DB_PATH.exists():
        print("❌ Falta sidecar/modelo/db")
        sys.exit(1)

    system_prompt, stats = build_agent_system_prompt(DB_PATH)
    print(f"📊 Stats de la DB:")
    print(f"   Total meetings: {stats.get('total_meetings', 0)}")
    print(f"   Scored: {stats.get('scored_meetings', 0)}")
    print(f"   Avg score: {stats.get('avg_score')}")
    print(f"   Período: {stats.get('first_date')} → {stats.get('last_date')}")
    print(f"   Top 3 titles: {stats.get('first_3_titles', [])[:3]}")
    print()
    print(f"📜 System prompt: {len(system_prompt)} chars")
    print()

    questions = [
        "¿Cuántas reuniones tengo registradas?",
        "Dime el nombre de mis 3 últimas reuniones.",
        "¿Cuál es mi puntuación promedio en mis conversaciones?" if stats.get("avg_score") else "Dame un consejo general basado en mi historial.",
    ]

    results = call_sidecar(system_prompt, questions)

    print("\n━━━ Validación ━━━")
    passed = 0
    for q, text, elapsed, status in results:
        if status != "OK":
            print(f"  ❌ Q: {q[:60]} — {status}")
            continue
        ok, reason = validate_response(q, text, stats)
        flag = "✅" if ok else "⚠️ "
        print(f"  {flag} Q: {q[:60]}")
        print(f"      Reason: {reason}  |  Time: {elapsed:.1f}s")
        if ok:
            passed += 1

    print(f"\n  {passed}/{len(results)} respuestas usan datos de la DB correctamente")
    sys.exit(0 if passed == len(results) else 1)

if __name__ == "__main__":
    main()
