"""
run_prompt.py

Ejecuta UN prompt contra UNA transcripción usando Ollama local.
Devuelve un JSON validado contra el schema V4 simplificado.

Uso:
    python run_prompt.py \\
        --fixture fixtures/sample_standup.txt \\
        --prompt prompts/v1_actual.txt \\
        --model qwen3:14b \\
        [--temperature 0.2] \\
        [--output out/custom_name.json]

Sin internet. Requiere Ollama corriendo en localhost:11434.
"""
from __future__ import annotations
import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib import request, error


OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_TIMEOUT_SEC = 600  # modelos grandes en frío pueden tardar varios minutos

EXPECTED_KEYS = {
    "resumen": {"puntuacion_global", "nivel", "fortaleza", "mejorar"},
    "dimensiones": {
        "claridad", "proposito", "estructura", "emociones",
        "muletillas", "adaptacion", "persuasion", "formalidad",
    },
    "radiografia": {
        "muletillas_total", "muletillas_detalle",
        "ratio_habla", "participacion_pct",
    },
    "timeline": {"segmentos"},
}


def call_ollama(model: str, system: str, user: str, temperature: float) -> str:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "options": {"temperature": temperature},
        "format": "json",  # pide JSON estricto a Ollama
    }
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        OLLAMA_URL,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with request.urlopen(req, timeout=DEFAULT_TIMEOUT_SEC) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.URLError as e:
        sys.exit(f"[ERROR] no pude conectar a Ollama ({OLLAMA_URL}): {e}")
    return data["message"]["content"]


def extract_json(text: str) -> dict:
    """El LLM a veces añade prosa alrededor. Extrae el primer objeto JSON."""
    text = text.strip()
    # Intento directo
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Buscar el primer {...} con balance de llaves
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        raise ValueError(f"No se encontró JSON en la respuesta del LLM:\n{text[:200]}...")
    return json.loads(match.group(0))


def validate_schema(payload: dict) -> list[str]:
    """Valida shape básica. Retorna lista de problemas (vacía = OK)."""
    problems: list[str] = []
    for top_key, subkeys in EXPECTED_KEYS.items():
        if top_key not in payload:
            problems.append(f"falta top-key '{top_key}'")
            continue
        node = payload[top_key]
        if not isinstance(node, dict):
            # timeline.segmentos es lista — caso especial
            if top_key == "timeline" and isinstance(node, dict) and "segmentos" in node:
                pass
            else:
                problems.append(f"'{top_key}' no es dict")
                continue
        for sub in subkeys:
            if sub not in node:
                problems.append(f"falta '{top_key}.{sub}'")
    # Chequeos de rangos
    try:
        score = payload["resumen"]["puntuacion_global"]
        if not 0 <= score <= 100:
            problems.append(f"puntuacion_global fuera de rango: {score}")
    except (KeyError, TypeError):
        pass
    return problems


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--prompt", required=True, type=Path)
    parser.add_argument("--model", default="qwen3:14b")
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    if not args.fixture.exists():
        sys.exit(f"[ERROR] fixture no existe: {args.fixture}")
    if not args.prompt.exists():
        sys.exit(f"[ERROR] prompt no existe: {args.prompt}")

    transcript = args.fixture.read_text(encoding="utf-8")
    system_prompt = args.prompt.read_text(encoding="utf-8")

    print(f"[INFO] fixture:  {args.fixture.name} ({len(transcript)} chars)")
    print(f"[INFO] prompt:   {args.prompt.name}")
    print(f"[INFO] modelo:   {args.model}  temp={args.temperature}")
    print(f"[INFO] llamando a Ollama...")
    t0 = time.monotonic()
    raw = call_ollama(args.model, system_prompt, transcript, args.temperature)
    elapsed = time.monotonic() - t0
    print(f"[INFO] Ollama tardó {elapsed:.1f}s")

    try:
        payload = extract_json(raw)
    except (ValueError, json.JSONDecodeError) as e:
        print(f"[ERROR] JSON inválido: {e}")
        # Aún así escribir el raw para debug
        dump_path = (args.output or Path("out"))
        dump_path.mkdir(parents=True, exist_ok=True)
        raw_file = dump_path / f"{args.fixture.stem}__{args.prompt.stem}.raw.txt"
        raw_file.write_text(raw, encoding="utf-8")
        print(f"[INFO] raw guardado en {raw_file}")
        sys.exit(2)

    problems = validate_schema(payload)
    if problems:
        print(f"[WARN] problemas de schema ({len(problems)}):")
        for p in problems:
            print(f"        - {p}")
    else:
        print(f"[OK]   schema V4 válido")

    # Añadir metadata de la corrida
    payload["_meta"] = {
        "fixture": args.fixture.name,
        "prompt": args.prompt.name,
        "model": args.model,
        "temperature": args.temperature,
        "elapsed_sec": round(elapsed, 2),
        "schema_problems": problems,
    }

    out_path = args.output
    if out_path is None:
        out_dir = Path(__file__).parent / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{args.fixture.stem}__{args.prompt.stem}.json"
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[DONE] resultado en {out_path}")


if __name__ == "__main__":
    main()
