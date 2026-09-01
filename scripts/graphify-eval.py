#!/usr/bin/env python3
"""Harness de evaluacion del grafo de conocimiento (graphify).

Por que existe: hasta ago-2026 la unica metrica del grafo era `graphify benchmark`,
que es SINTETICA -- cuando no se le pasa un conteo real de palabras estima el corpus
como `nodes * 50` (benchmark.py:113), asi que quitar nodos baja el numerador
mecanicamente y el "ratio de reduccion" no mide calidad. Este harness mide otra cosa:
dado un set de preguntas reales de este repo con respuesta conocida, comprueba si el
archivo que contiene la respuesta aparece de verdad en el subgrafo que devuelve
`graphify query`.

Es determinista y sin LLM: el criterio es "aparecio el archivo esperado, y en que
posicion". Invoca el CLI real (no APIs internas) para medir el camino que usa un agente.

Cada pregunta se corre con DOS presupuestos, y ahi esta el valor diagnostico:
  - budget normal (lo que un agente ve)  -> ¿entra en el contexto?
  - budget alto (traversal casi completo) -> ¿es siquiera alcanzable?

Y ademas se comprueba si el archivo esperado EXISTE en el grafo, leyendo graph.json
directo. Sin eso no se puede distinguir "el grafo no sabe" de "el grafo sabe pero la
busqueda no llega", que piden arreglos opuestos. De ahi los cinco veredictos:

  HIT       todos los archivos esperados dentro del budget normal
  PARTIAL   algunos dentro del budget normal
  BURIED    ninguno dentro del budget, pero alcanzables con budget alto
            -> problema de RANKING: el traversal los encuentra y los entierra
  UNREACHED el archivo ESTA en el grafo pero el traversal nunca lo alcanza
            -> problema de RECUPERACION: `graphify query` es BFS de profundidad 2 fija
               desde las anclas, sin flag para ampliarla
  ABSENT    el archivo no tiene un solo nodo en el grafo
            -> problema de COBERTURA: el grafo realmente no lo tiene

Uso:
    python scripts/graphify-eval.py
    python scripts/graphify-eval.py --compare graphify-out/2026-08-31-pre-cleanup/graph.json
    python scripts/graphify-eval.py --save-results

Solo libreria estandar -> corre con cualquier Python.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_TASKS = REPO / "scripts" / "graphify-eval-tasks.json"
DEFAULT_GRAPH = REPO / "graphify-out" / "graph.json"
DEFAULT_MEMORY = REPO / "graphify-out" / "memory"

# `NODE <label> [src=<path> loc=<loc> community=<name>]`
_NODE_RE = re.compile(r"^NODE\s+(?P<label>.*?)\s+\[src=(?P<src>[^\]]*?)\s+loc=", re.MULTILINE)
_HEADER_RE = re.compile(r"Start:\s*\[(?P<anchors>.*?)\]\s*\|\s*(?P<found>\d+)\s+nodes?\s+found")

VERDICTS = ("HIT", "PARTIAL", "BURIED", "UNREACHED", "ABSENT")
_GOOD = ("HIT", "PARTIAL")


def _norm(p: str) -> str:
    """Normaliza una ruta para comparar: separadores / y minusculas (Windows)."""
    return (p or "").replace("\\", "/").strip().lower()


def load_graph_sources(graph: Path) -> set[str]:
    """Conjunto de source_file normalizados presentes en el grafo.

    Permite separar ABSENT (el grafo no tiene el archivo) de UNREACHED (lo tiene pero
    el traversal no llega). Sin esta comprobacion ambos casos se veian igual, y piden
    arreglos opuestos: mas extraccion vs mejor recuperacion.
    """
    data = json.loads(graph.read_text(encoding="utf-8"))
    return {_norm(n.get("source_file") or "") for n in data.get("nodes", [])} - {""}


def _file_in_graph(expected: str, sources: set[str]) -> bool:
    w = _norm(expected)
    return any(s == w or s.endswith("/" + w) or w.endswith("/" + s) for s in sources)


def _graphify_bin() -> str:
    exe = shutil.which("graphify")
    if not exe:
        sys.exit("error: no encuentro el ejecutable `graphify` en el PATH.")
    return exe


def _run_query(binary: str, question: str, graph: Path, budget: int) -> str:
    """Corre `graphify query` y devuelve stdout. Nunca lanza por codigo de salida.

    PYTHONHASHSEED=0 para que el traversal sea reproducible entre corridas (es lo
    mismo que exporta el git hook). PYTHONIOENCODING=utf-8 porque la consola de
    Windows es cp1252 y el CLI emite UTF-8: sin esto la salida llega con mojibake
    y las rutas con acentos no matchean.
    """
    env = dict(os.environ)
    env["PYTHONHASHSEED"] = "0"
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(
        [binary, "query", question, "--budget", str(budget), "--graph", str(graph)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=env,
    )
    return (proc.stdout or "") + (proc.stderr or "")


def _parse(output: str) -> dict:
    """Extrae anclas, total de nodos del traversal y la lista ORDENADA de nodos."""
    nodes = [{"label": m.group("label").strip(), "src": m.group("src").strip()}
             for m in _NODE_RE.finditer(output)]
    header = _HEADER_RE.search(output)
    anchors: list[str] = []
    total = None
    if header:
        anchors = [a.strip().strip("'\"") for a in header.group("anchors").split(",") if a.strip()]
        total = int(header.group("found"))
    return {"nodes": nodes, "anchors": anchors, "total_found": total,
            "shown": len(nodes), "truncated": "truncated" in output}


def _match_files(nodes: list[dict], expect_files: list[str]) -> tuple[set[str], int | None]:
    """Devuelve (archivos esperados encontrados, rank 1-based del primer acierto)."""
    wanted = {_norm(f) for f in expect_files}
    found: set[str] = set()
    first_rank: int | None = None
    for i, n in enumerate(nodes, start=1):
        src = _norm(n["src"])
        if not src:
            continue
        for w in wanted:
            # El grafo puede almacenar la ruta con prefijo distinto; basta con que
            # una sea sufijo de la otra para considerarlo el mismo archivo.
            if src == w or src.endswith("/" + w) or w.endswith("/" + src):
                if w not in found:
                    found.add(w)
                    if first_rank is None:
                        first_rank = i
    return found, first_rank


def _match_symbols(nodes: list[dict], expect_symbols: list[str]) -> set[str]:
    labels = [(n["label"] or "").lower() for n in nodes]
    return {s for s in expect_symbols if any(s.lower() in lab for lab in labels)}


def evaluate_task(binary: str, task: dict, graph: Path, budget: int, deep_budget: int,
                  sources: set[str]) -> dict:
    expect = task.get("expect_files", [])
    normal = _parse(_run_query(binary, task["question"], graph, budget))
    deep = _parse(_run_query(binary, task["question"], graph, deep_budget))

    found_n, rank = _match_files(normal["nodes"], expect)
    found_d, _ = _match_files(deep["nodes"], expect)
    in_graph = [f for f in expect if _file_in_graph(f, sources)]

    if expect and len(found_n) == len(expect):
        verdict = "HIT"
    elif found_n:
        verdict = "PARTIAL"
    elif found_d:
        verdict = "BURIED"
    elif in_graph:
        verdict = "UNREACHED"
    else:
        verdict = "ABSENT"

    return {
        "in_graph": in_graph,
        "id": task["id"],
        "question": task["question"],
        "hops": task.get("hops", "single"),
        "verdict": verdict,
        "rank": rank,
        "found": sorted(found_n),
        "found_deep": sorted(found_d),
        "expected": expect,
        "coverage": f"{len(found_n)}/{len(expect)}" if expect else "0/0",
        "symbols_hit": sorted(_match_symbols(normal["nodes"], task.get("expect_symbols", []))),
        "symbols_expected": task.get("expect_symbols", []),
        "anchors": normal["anchors"],
        "shown": normal["shown"],
        "total_found": normal["total_found"],
        "deep_shown": deep["shown"],
        "why": task.get("why", ""),
        # Etiquetas de los nodos que aportaron el acierto: es lo que `save-result`
        # espera en --nodes (labels de nodos citados en la respuesta).
        "cited": [n["label"] for n in normal["nodes"]
                  if _match_files([n], expect)[0]][:8],
    }


def _save_trace(binary: str, res: dict, memory_dir: Path) -> bool:
    """Escribe una traza del resultado en la memoria de graphify.

    HIT/PARTIAL -> useful ; el resto -> dead_end.

    Que hace y que NO hace el overlay que produce `graphify reflect`:
      SI  aparece como linea `Lesson: preferred|tentative|contested` en
          `graphify explain <nodo>` (cli.py:743), en GRAPH_REPORT.md y en el viz.
      SI  llega como sufijo `learning=` en las lineas NODE, pero SOLO por el
          servidor MCP (serve.py:672) -- NO por `graphify query` en el CLI.
      NO  entra en el ranking ni en el traversal: la salida de la busqueda es
          byte-identica con y sin overlay (serve.py:50).
    O sea: es memoria documental y marcador de dead ends conocidos, no hace que la
    recuperacion mejore sola.
    """
    outcome = "useful" if res["verdict"] in _GOOD else "dead_end"
    anclas = ", ".join(res["anchors"][:6]) or "ninguna"
    if res["verdict"] == "HIT":
        answer = (f"El grafo responde: {', '.join(res['found'])} "
                  f"(rank {res['rank']} de {res['shown']} nodos mostrados).")
    elif res["verdict"] == "PARTIAL":
        answer = (f"El grafo responde a medias: encontro {res['coverage']} "
                  f"({', '.join(res['found'])}); faltan "
                  f"{', '.join(sorted(set(map(_norm, res['expected'])) - set(res['found'])))}.")
    elif res["verdict"] == "BURIED":
        answer = (f"Alcanzable pero fuera del presupuesto: {', '.join(res['found_deep'])} "
                  f"solo aparece con budget alto. Problema de RANKING, no de cobertura.")
    elif res["verdict"] == "UNREACHED":
        answer = (f"El grafo SI contiene {', '.join(res['in_graph'])}, pero el traversal "
                  f"BFS de profundidad 2 nunca lo alcanza desde las anclas ({anclas}). "
                  f"Problema de RECUPERACION.")
    else:
        answer = (f"El grafo no contiene ningun nodo de {', '.join(res['expected'])}. "
                  f"Anclas usadas: {anclas}. Problema de COBERTURA.")

    cmd = [binary, "save-result", "--question", res["question"], "--answer", answer,
           "--type", "query", "--outcome", outcome, "--memory-dir", str(memory_dir)]
    if res["cited"]:
        cmd += ["--nodes", *res["cited"]]
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=env)
    if proc.returncode != 0:
        print(f"  aviso: save-result fallo para {res['id']}: "
              f"{(proc.stderr or proc.stdout or '').strip()[:200]}")
        return False
    return True


def _tally(results: list[dict]) -> dict[str, int]:
    t = {v: 0 for v in VERDICTS}
    for r in results:
        t[r["verdict"]] += 1
    return t


def _tally_line(results: list[dict]) -> str:
    t = _tally(results)
    n = len(results) or 1
    return (f"{t['HIT']} HIT · {t['PARTIAL']} PARTIAL · {t['BURIED']} BURIED · "
            f"{t['UNREACHED']} UNREACHED · {t['ABSENT']} ABSENT  "
            f"({100 * t['HIT'] // n}% HIT)")


def _render(results: list[dict], graph: Path, compare: list[dict] | None,
            compare_graph: Path | None, budget: int, deep_budget: int) -> str:
    L: list[str] = []
    L.append(f"# Eval del grafo de conocimiento — {date.today().isoformat()}")
    L.append("")
    L.append(f"Grafo: `{graph}`  ·  budget normal {budget} / profundo {deep_budget}")
    L.append(f"Tareas: `scripts/graphify-eval-tasks.json`  ·  harness: `scripts/graphify-eval.py`")
    L.append("")
    L.append("Veredictos: **HIT** todos los esperados dentro del budget · **PARTIAL** algunos · "
             "**BURIED** fuera del budget pero alcanzables (*ranking*) · **UNREACHED** están en "
             "el grafo pero el traversal no llega (*recuperación*) · **ABSENT** no están en el "
             "grafo (*cobertura*).")
    L.append("")

    real = [r for r in results if r["hops"] != "control"]
    ctrl = [r for r in results if r["hops"] == "control"]

    L.append("## Resumen")
    L.append("")
    L.append(f"- **Todas ({len(real)})**: {_tally_line(real)}")
    for hop in ("single", "multi"):
        sub = [r for r in real if r["hops"] == hop]
        if sub:
            L.append(f"- **{hop}-hop ({len(sub)})**: {_tally_line(sub)}")
    for c in ctrl:
        ok = ("correcto" if c["verdict"] == "ABSENT"
              else "**HARNESS ROTO** (el archivo del control no existe; solo puede dar ABSENT)")
        L.append(f"- **Control** (`{c['id']}`): {c['verdict']} — {ok}")
    L.append("")

    if compare is not None and compare_graph is not None:
        L.append("## A/B contra el grafo anterior")
        L.append("")
        L.append(f"Comparado con `{compare_graph}`.")
        L.append("")
        L.append("| Tarea | hops | Antes | Después | rank antes → después |")
        L.append("|---|---|---|---|---|")
        by_id = {r["id"]: r for r in compare}
        for r in results:
            b = by_id.get(r["id"])
            if not b:
                continue
            arrow = "" if b["verdict"] == r["verdict"] else " ←"
            L.append(f"| `{r['id']}` | {r['hops']} | {b['verdict']} | {r['verdict']}{arrow} | "
                     f"{b['rank'] or '—'} → {r['rank'] or '—'} |")
        L.append("")
        rb = [r for r in compare if r["hops"] != "control"]
        L.append(f"- Antes: {_tally_line(rb)}")
        L.append(f"- Después: {_tally_line(real)}")
        L.append("")

    L.append("## Detalle por tarea")
    L.append("")
    L.append("| Tarea | hops | Veredicto | Cobertura | rank | nodos mostrados / traversal |")
    L.append("|---|---|---|---|---|---|")
    for r in results:
        L.append(f"| `{r['id']}` | {r['hops']} | **{r['verdict']}** | {r['coverage']} | "
                 f"{r['rank'] or '—'} | {r['shown']} / {r['total_found'] or '—'} |")
    L.append("")

    for r in results:
        L.append(f"### `{r['id']}` — {r['verdict']}")
        L.append("")
        L.append(f"> {r['question']}")
        L.append("")
        L.append(f"- **Espera**: {', '.join(f'`{f}`' for f in r['expected'])}")
        L.append(f"- **Encontrado (budget normal)**: "
                 f"{', '.join(f'`{f}`' for f in r['found']) or '_nada_'}")
        if r["verdict"] == "BURIED":
            L.append(f"- **Alcanzable con budget alto**: "
                     f"{', '.join(f'`{f}`' for f in r['found_deep'])}")
        if r["verdict"] == "UNREACHED":
            L.append(f"- **Sí está en el grafo, pero el traversal no llega**: "
                     f"{', '.join(f'`{f}`' for f in r['in_graph'])}")
        if r["verdict"] == "ABSENT":
            L.append("- **No hay ni un nodo de esos archivos en el grafo.**")
        if r["symbols_expected"]:
            L.append(f"- **Símbolos**: {len(r['symbols_hit'])}/{len(r['symbols_expected'])} "
                     f"({', '.join(f'`{s}`' for s in r['symbols_hit']) or '_ninguno_'})")
        L.append(f"- **Anclas**: {', '.join(f'`{a}`' for a in r['anchors'][:8]) or '_ninguna_'}")
        if r["why"]:
            L.append(f"- **Por qué esta pregunta**: {r['why']}")
        L.append("")
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Eval del grafo de graphify")
    ap.add_argument("--tasks", type=Path, default=DEFAULT_TASKS)
    ap.add_argument("--graph", type=Path, default=DEFAULT_GRAPH)
    ap.add_argument("--compare", type=Path, default=None,
                    help="segundo grafo para correr A/B (p.ej. el snapshot pre-limpieza)")
    ap.add_argument("--budget", type=int, default=2000)
    ap.add_argument("--deep-budget", type=int, default=20000)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--save-results", action="store_true",
                    help="escribe una traza por tarea en la memoria de graphify")
    ap.add_argument("--memory-dir", type=Path, default=DEFAULT_MEMORY)
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    if not args.tasks.exists():
        return print(f"error: no existe {args.tasks}") or 1
    if not args.graph.exists():
        return print(f"error: no existe {args.graph}") or 1

    tasks = json.loads(args.tasks.read_text(encoding="utf-8"))["tasks"]
    binary = _graphify_bin()

    def run_all(graph: Path, etiqueta: str) -> list[dict]:
        sources = load_graph_sources(graph)
        print(f"[{etiqueta}] {graph} — {len(sources)} archivos indexados", flush=True)
        out = []
        for i, t in enumerate(tasks, start=1):
            print(f"[{etiqueta} {i}/{len(tasks)}] {t['id']} ...", flush=True)
            r = evaluate_task(binary, t, graph, args.budget, args.deep_budget, sources)
            print(f"    {r['verdict']:8} cobertura {r['coverage']}"
                  f"{'  rank ' + str(r['rank']) if r['rank'] else ''}", flush=True)
            out.append(r)
        return out

    results = run_all(args.graph, "actual")

    compare_results = None
    if args.compare:
        if not args.compare.exists():
            return print(f"error: no existe {args.compare}") or 1
        compare_results = run_all(args.compare, "anterior")

    out_path = args.out or (REPO / "graphify-out" / f"EVAL-{date.today().isoformat()}.md")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        _render(results, args.graph, compare_results, args.compare,
                args.budget, args.deep_budget),
        encoding="utf-8")

    real = [r for r in results if r["hops"] != "control"]
    print(f"\n{_tally_line(real)}")
    for c in (r for r in results if r["hops"] == "control"):
        if c["verdict"] != "ABSENT":
            print(f"ATENCION: el control `{c['id']}` dio {c['verdict']}, deberia ser ABSENT. "
                  f"El harness o el set estan mal.")
    print(f"reporte -> {out_path}")

    if args.save_results:
        args.memory_dir.mkdir(parents=True, exist_ok=True)
        n = sum(_save_trace(binary, r, args.memory_dir) for r in results)
        print(f"trazas guardadas: {n}/{len(results)} -> {args.memory_dir}")
        print("agregalas con: graphify reflect")

    return 0


if __name__ == "__main__":
    sys.exit(main())
