"""
compare_prompts.py

Corre TODOS los prompts contra TODAS las fixtures y genera:
  - out/<fixture>__<prompt>.json      (resultado crudo)
  - out/<fixture>__<prompt>.html      (dashboard individual)
  - out/index.html                    (índice navegable con todos los links)
  - out/summary.csv                   (resumen tabular para comparar a ojo)

Uso:
    python compare_prompts.py --model gemma3:4b
    python compare_prompts.py --model qwen3:14b --temperature 0.1
    python compare_prompts.py --fixtures-glob "fixtures/*.txt" --prompts-glob "prompts/*.txt"
"""
from __future__ import annotations
import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path


LAB_DIR = Path(__file__).parent
OUT_DIR = LAB_DIR / "out"


INDEX_HTML = r"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Prompt Lab — Índice</title>
<style>
  body {{ font-family: -apple-system,'Segoe UI',sans-serif; background: #0b1220; color: #e7edf8; padding: 32px; margin: 0; }}
  h1 {{ margin: 0 0 24px; }}
  table {{ width: 100%; border-collapse: collapse; background: #121a2f; border-radius: 12px; overflow: hidden; }}
  th, td {{ padding: 12px 16px; text-align: left; border-bottom: 1px solid #1f2a44; }}
  th {{ background: #1a2544; font-size: 12px; text-transform: uppercase; color: #8c9ab8; letter-spacing: 0.5px; }}
  tr:hover {{ background: rgba(106,169,255,0.05); }}
  .score {{ font-weight: 700; }}
  .score.good {{ color: #4ade80; }}
  .score.mid {{ color: #fbbf24; }}
  .score.bad {{ color: #f87171; }}
  a {{ color: #6aa9ff; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .problems {{ color: #f87171; font-size: 11px; }}
  .meta {{ color: #8c9ab8; font-size: 12px; margin-bottom: 24px; }}
</style></head><body>
<h1>📊 Prompt Lab — Resumen comparativo</h1>
<div class="meta">{rows_count} runs · generado con compare_prompts.py</div>
<table>
<thead><tr>
  <th>Fixture</th><th>Prompt</th><th>Modelo</th><th>Temp</th>
  <th>Score</th><th>Nivel</th><th>Muletillas</th><th>Tiempo</th><th>Problemas</th><th></th>
</tr></thead><tbody>
{rows}
</tbody></table>
</body></html>
"""


def score_class(score: int | float) -> str:
    if score >= 80:
        return "good"
    if score >= 60:
        return "mid"
    return "bad"


def run_one(fixture: Path, prompt: Path, model: str, temperature: float) -> dict | None:
    """Invoca run_prompt.py como subproceso. Retorna el payload o None si falló."""
    out_file = OUT_DIR / f"{fixture.stem}__{prompt.stem}.json"
    cmd = [
        sys.executable, str(LAB_DIR / "run_prompt.py"),
        "--fixture", str(fixture),
        "--prompt", str(prompt),
        "--model", model,
        "--temperature", str(temperature),
        "--output", str(out_file),
    ]
    print(f"\n{'='*60}\n[RUN] {fixture.name}  ×  {prompt.name}  @ {model}\n{'='*60}")
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        print(f"[FAIL] exit code {result.returncode}")
        return None
    try:
        return json.loads(out_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[FAIL] no pude leer output: {e}")
        return None


def render_one(payload_path: Path) -> None:
    cmd = [sys.executable, str(LAB_DIR / "render_dashboard.py"), "--input", str(payload_path)]
    subprocess.run(cmd, capture_output=False)


def build_index(rows: list[dict]) -> str:
    html_rows = []
    for r in rows:
        score = r.get("score", 0)
        sc = score_class(score)
        html_link = Path(r["json_file"]).with_suffix(".html").name
        problems = r.get("problems_count", 0)
        problems_txt = f'<span class="problems">{problems} issue(s)</span>' if problems else "—"
        html_rows.append(
            f'<tr>'
            f'<td>{r["fixture"]}</td>'
            f'<td>{r["prompt"]}</td>'
            f'<td>{r["model"]}</td>'
            f'<td>{r["temperature"]}</td>'
            f'<td><span class="score {sc}">{score}</span></td>'
            f'<td>{r["nivel"]}</td>'
            f'<td>{r["muletillas"]}</td>'
            f'<td>{r["elapsed_sec"]}s</td>'
            f'<td>{problems_txt}</td>'
            f'<td><a href="{html_link}">ver →</a></td>'
            f'</tr>'
        )
    return INDEX_HTML.format(rows="\n".join(html_rows), rows_count=len(rows))


def write_csv(rows: list[dict]) -> Path:
    csv_path = OUT_DIR / "summary.csv"
    if not rows:
        return csv_path
    fields = [
        "fixture", "prompt", "model", "temperature",
        "score", "nivel", "muletillas", "elapsed_sec", "problems_count",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in fields})
    return csv_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="gemma3:4b",
                        help="modelo Ollama (default gemma3:4b, rápido)")
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--fixtures-glob", default="fixtures/*.txt")
    parser.add_argument("--prompts-glob", default="prompts/*.txt")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fixtures = sorted(LAB_DIR.glob(args.fixtures_glob))
    prompts = sorted(LAB_DIR.glob(args.prompts_glob))

    if not fixtures:
        sys.exit(f"[ERROR] no hay fixtures en {args.fixtures_glob}")
    if not prompts:
        sys.exit(f"[ERROR] no hay prompts en {args.prompts_glob}")

    print(f"[INFO] {len(fixtures)} fixtures × {len(prompts)} prompts = {len(fixtures) * len(prompts)} runs")
    print(f"[INFO] modelo: {args.model}  temperatura: {args.temperature}")

    rows: list[dict] = []
    for fx in fixtures:
        for pr in prompts:
            payload = run_one(fx, pr, args.model, args.temperature)
            if payload is None:
                rows.append({
                    "fixture": fx.name, "prompt": pr.name,
                    "model": args.model, "temperature": args.temperature,
                    "score": 0, "nivel": "ERROR", "muletillas": 0,
                    "elapsed_sec": 0, "problems_count": 99,
                    "json_file": f"{fx.stem}__{pr.stem}.json",
                })
                continue
            render_one(OUT_DIR / f"{fx.stem}__{pr.stem}.json")
            meta = payload.get("_meta", {})
            resumen = payload.get("resumen", {})
            radiografia = payload.get("radiografia", {})
            rows.append({
                "fixture": fx.name, "prompt": pr.name,
                "model": meta.get("model", args.model),
                "temperature": meta.get("temperature", args.temperature),
                "score": resumen.get("puntuacion_global", 0),
                "nivel": resumen.get("nivel", "-"),
                "muletillas": radiografia.get("muletillas_total", 0),
                "elapsed_sec": meta.get("elapsed_sec", 0),
                "problems_count": len(meta.get("schema_problems", [])),
                "json_file": f"{fx.stem}__{pr.stem}.json",
            })

    index_path = OUT_DIR / "index.html"
    index_path.write_text(build_index(rows), encoding="utf-8")
    csv_path = write_csv(rows)

    print(f"\n{'='*60}\n[DONE] {len(rows)} runs completados")
    print(f"       Índice:  {index_path}")
    print(f"       CSV:     {csv_path}")
    print(f"       Abrir:   start {index_path}")


if __name__ == "__main__":
    main()
