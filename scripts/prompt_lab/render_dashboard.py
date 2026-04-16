"""
render_dashboard.py

Genera un HTML standalone con Chart.js que replica las gráficas del dashboard
de Maity Desktop (gauge, radar 8 dims, barras muletillas, dona participación,
timeline) a partir de una caja V4 JSON producida por run_prompt.py.

Uso:
    python render_dashboard.py --input out/sample_standup__v1_actual.json
    # genera out/sample_standup__v1_actual.html
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Prompt Lab — {fixture} × {prompt}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  :root {{
    --bg: #0b1220;
    --card: #121a2f;
    --border: #1f2a44;
    --text: #e7edf8;
    --muted: #8c9ab8;
    --accent: #6aa9ff;
    --good: #4ade80;
    --warn: #fbbf24;
    --bad: #f87171;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, 'Segoe UI', sans-serif; padding: 24px; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }}
  .meta {{ color: var(--muted); font-size: 13px; margin-bottom: 24px; }}
  .grid {{ display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }}
  .card {{ background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }}
  .card h2 {{ font-size: 14px; font-weight: 600; color: var(--muted); margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px; }}
  .hero {{ grid-column: span 12; display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: center; }}
  .score {{ font-size: 84px; font-weight: 700; background: linear-gradient(135deg, var(--accent), var(--good)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; line-height: 1; }}
  .nivel {{ font-size: 22px; font-weight: 600; margin-bottom: 8px; }}
  .feedback {{ color: var(--muted); font-size: 14px; line-height: 1.5; }}
  .span-6 {{ grid-column: span 6; }}
  .span-4 {{ grid-column: span 4; }}
  .span-8 {{ grid-column: span 8; }}
  .span-12 {{ grid-column: span 12; }}
  canvas {{ max-height: 280px; }}
  .kpi-row {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }}
  .kpi {{ background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px; text-align: center; }}
  .kpi-value {{ font-size: 24px; font-weight: 700; }}
  .kpi-label {{ font-size: 11px; color: var(--muted); text-transform: uppercase; margin-top: 4px; }}
  .problems {{ background: rgba(248,113,113,0.1); border-left: 3px solid var(--bad); padding: 8px 12px; border-radius: 4px; margin-bottom: 16px; font-size: 12px; color: var(--bad); }}
  details {{ margin-top: 24px; color: var(--muted); font-size: 12px; }}
  pre {{ background: #0a1020; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 11px; }}
</style>
</head>
<body>
<h1>📊 Maity Prompt Lab — Dashboard</h1>
<div class="meta">
  Fixture: <b>{fixture}</b> · Prompt: <b>{prompt}</b> · Modelo: <b>{model}</b> · Temp: <b>{temperature}</b> · Tiempo: <b>{elapsed_sec}s</b>
</div>

{problems_block}

<div class="grid">

  <!-- HERO: puntaje global + feedback -->
  <div class="card hero">
    <div>
      <div class="score">{score}</div>
      <div style="color: var(--muted); text-align: center; font-size: 12px;">de 100</div>
    </div>
    <div>
      <div class="nivel">{nivel}</div>
      <div class="feedback"><b style="color: var(--good);">Fortaleza:</b> {fortaleza}</div>
      <div class="feedback" style="margin-top: 8px;"><b style="color: var(--warn);">A mejorar:</b> {mejorar}</div>
    </div>
  </div>

  <!-- KPIs rápidos -->
  <div class="card span-12">
    <h2>KPIs</h2>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-value">{muletillas_total}</div><div class="kpi-label">Muletillas</div></div>
      <div class="kpi"><div class="kpi-value">{ratio_habla}%</div><div class="kpi-label">Ratio habla</div></div>
      <div class="kpi"><div class="kpi-value">{best_dim_name}</div><div class="kpi-label">Mejor dim ({best_dim_val})</div></div>
      <div class="kpi"><div class="kpi-value">{worst_dim_name}</div><div class="kpi-label">Peor dim ({worst_dim_val})</div></div>
    </div>
  </div>

  <!-- Radar de 8 dimensiones -->
  <div class="card span-6">
    <h2>🕸️ Radar de calidad (8 dimensiones)</h2>
    <canvas id="radar"></canvas>
  </div>

  <!-- Muletillas barras -->
  <div class="card span-6">
    <h2>📊 Muletillas detectadas</h2>
    <canvas id="muletillas"></canvas>
  </div>

  <!-- Participación dona -->
  <div class="card span-4">
    <h2>🥧 Participación</h2>
    <canvas id="participacion"></canvas>
  </div>

  <!-- Timeline -->
  <div class="card span-8">
    <h2>⏱️ Timeline de momentos</h2>
    <canvas id="timeline"></canvas>
  </div>

</div>

<details>
  <summary>Ver JSON completo</summary>
  <pre>{raw_json}</pre>
</details>

<script>
const feedback = {feedback_json};

// Radar 8 dims
new Chart(document.getElementById('radar'), {{
  type: 'radar',
  data: {{
    labels: Object.keys(feedback.dimensiones || {{}}),
    datasets: [{{
      label: 'Score',
      data: Object.values(feedback.dimensiones || {{}}),
      backgroundColor: 'rgba(106, 169, 255, 0.2)',
      borderColor: 'rgba(106, 169, 255, 1)',
      borderWidth: 2,
    }}],
  }},
  options: {{
    responsive: true,
    scales: {{
      r: {{
        suggestedMin: 0, suggestedMax: 10,
        angleLines: {{ color: 'rgba(255,255,255,0.1)' }},
        grid: {{ color: 'rgba(255,255,255,0.1)' }},
        pointLabels: {{ color: '#e7edf8', font: {{ size: 11 }} }},
        ticks: {{ color: '#8c9ab8', backdropColor: 'transparent' }},
      }},
    }},
    plugins: {{ legend: {{ display: false }} }},
  }},
}});

// Muletillas barras
const mulDet = (feedback.radiografia && feedback.radiografia.muletillas_detalle) || {{}};
new Chart(document.getElementById('muletillas'), {{
  type: 'bar',
  data: {{
    labels: Object.keys(mulDet),
    datasets: [{{
      label: 'Veces',
      data: Object.values(mulDet),
      backgroundColor: 'rgba(251, 191, 36, 0.7)',
    }}],
  }},
  options: {{
    responsive: true,
    indexAxis: 'y',
    scales: {{
      x: {{ ticks: {{ color: '#8c9ab8' }}, grid: {{ color: 'rgba(255,255,255,0.05)' }} }},
      y: {{ ticks: {{ color: '#e7edf8' }}, grid: {{ display: false }} }},
    }},
    plugins: {{ legend: {{ display: false }} }},
  }},
}});

// Participación dona
const part = (feedback.radiografia && feedback.radiografia.participacion_pct) || {{}};
new Chart(document.getElementById('participacion'), {{
  type: 'doughnut',
  data: {{
    labels: Object.keys(part),
    datasets: [{{
      data: Object.values(part),
      backgroundColor: ['rgba(106, 169, 255, 0.8)', 'rgba(74, 222, 128, 0.8)', 'rgba(251, 191, 36, 0.8)', 'rgba(248, 113, 113, 0.8)'],
      borderColor: 'transparent',
    }}],
  }},
  options: {{
    responsive: true,
    plugins: {{ legend: {{ labels: {{ color: '#e7edf8' }} }} }},
  }},
}});

// Timeline
const segs = (feedback.timeline && feedback.timeline.segmentos) || [];
new Chart(document.getElementById('timeline'), {{
  type: 'line',
  data: {{
    labels: segs.map(s => s.momento + ' (' + s.desde_s + 's)'),
    datasets: [{{
      label: 'Puntuación',
      data: segs.map(s => s.puntuacion),
      borderColor: 'rgba(74, 222, 128, 1)',
      backgroundColor: 'rgba(74, 222, 128, 0.2)',
      fill: true,
      tension: 0.3,
    }}],
  }},
  options: {{
    responsive: true,
    scales: {{
      y: {{ suggestedMin: 0, suggestedMax: 10, ticks: {{ color: '#8c9ab8' }}, grid: {{ color: 'rgba(255,255,255,0.05)' }} }},
      x: {{ ticks: {{ color: '#8c9ab8' }}, grid: {{ color: 'rgba(255,255,255,0.05)' }} }},
    }},
    plugins: {{ legend: {{ display: false }} }},
  }},
}});
</script>
</body>
</html>
"""


def format_problems(problems: list[str]) -> str:
    if not problems:
        return ""
    items = "".join(f"<li>{p}</li>" for p in problems)
    return f'<div class="problems"><b>⚠ Problemas de schema ({len(problems)}):</b><ul>{items}</ul></div>'


def best_and_worst(dims: dict) -> tuple[str, float, str, float]:
    if not dims:
        return "-", 0.0, "-", 0.0
    items = list(dims.items())
    items.sort(key=lambda x: x[1] if isinstance(x[1], (int, float)) else 0)
    worst = items[0]
    best = items[-1]
    return best[0], best[1], worst[0], worst[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    if not args.input.exists():
        sys.exit(f"[ERROR] input no existe: {args.input}")

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    meta = payload.get("_meta", {})
    resumen = payload.get("resumen", {})
    radiografia = payload.get("radiografia", {})
    dimensiones = payload.get("dimensiones", {})

    best_name, best_val, worst_name, worst_val = best_and_worst(dimensiones)

    html = HTML_TEMPLATE.format(
        fixture=meta.get("fixture", args.input.stem),
        prompt=meta.get("prompt", "-"),
        model=meta.get("model", "-"),
        temperature=meta.get("temperature", "-"),
        elapsed_sec=meta.get("elapsed_sec", "-"),
        score=resumen.get("puntuacion_global", 0),
        nivel=resumen.get("nivel", "-"),
        fortaleza=resumen.get("fortaleza", "-"),
        mejorar=resumen.get("mejorar", "-"),
        muletillas_total=radiografia.get("muletillas_total", 0),
        ratio_habla=radiografia.get("ratio_habla", 0),
        best_dim_name=best_name,
        best_dim_val=best_val,
        worst_dim_name=worst_name,
        worst_dim_val=worst_val,
        problems_block=format_problems(meta.get("schema_problems", [])),
        feedback_json=json.dumps(payload, ensure_ascii=False),
        raw_json=json.dumps(payload, ensure_ascii=False, indent=2),
    )

    out_path = args.output or args.input.with_suffix(".html")
    out_path.write_text(html, encoding="utf-8")
    print(f"[DONE] dashboard generado: {out_path}")
    print(f"       abrelo en navegador:  start {out_path}")


if __name__ == "__main__":
    main()
