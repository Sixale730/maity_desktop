#!/usr/bin/env python3
"""Re-inyecta el schema vivo de Supabase (tablas/funciones/FKs) al grafo de graphify.

Por que existe: el git-hook de auto-update de graphify reconstruye graphify-out/graph.json
SOLO desde el codigo, asi que cada commit/checkout borra los nodos del schema DB que no
vienen de archivos de codigo. Este script los reinyecta desde el DDL guardado -idempotente:
lo puedes correr las veces que quieras.

Uso:
    python scripts/graphify-apply-live-schema.py
    graphify tree --graph graphify-out/graph.json --output graphify-out/GRAPH_TREE.html --root .

El DDL vive en graphify-out/_schema-live.generated.sql (gitignored). Se regenera
re-introspectando la DB via el MCP de Supabase (queries read-only a
information_schema/pg_catalog). Solo usa la libreria estandar (json, re) -> corre con
cualquier Python.
"""
import json
import re
import sys
from pathlib import Path

OUT = Path("graphify-out")
GRAPH = OUT / "graph.json"
DDL = OUT / "_schema-live.generated.sql"
LABELS = OUT / ".graphify_labels.json"

COMMUNITY_LABELS = {
    "tables": "DB deployada: tablas & schema (maity)",
    "funcs": "DB deployada: funciones/RPCs (maity)",
}


def main() -> int:
    if not GRAPH.exists() or not DDL.exists():
        print(f"falta {GRAPH} o {DDL} -> corre `graphify extract . --code-only` y regenera el DDL primero.")
        return 1

    G = json.loads(GRAPH.read_text(encoding="utf-8"))
    ddl = DDL.read_text(encoding="utf-8")

    # Idempotencia: quita cualquier nodo/arista pg_* previa antes de re-inyectar.
    G["nodes"] = [n for n in G["nodes"] if not str(n.get("id", "")).startswith("pg_")]
    G["links"] = [
        l for l in G["links"]
        if not (str(l.get("source", "")).startswith("pg_") or str(l.get("target", "")).startswith("pg_"))
    ]

    sample = G["links"][0]
    ekeys = list(sample.keys())
    sk = "source" if "source" in sample else ekeys[0]
    tk = "target" if "target" in sample else ekeys[1]

    existing_comms = {int(n["community"]) for n in G["nodes"]
                      if str(n.get("community", "")).lstrip("-").isdigit()}
    base = (max(existing_comms) + 1) if existing_comms else 0
    C_TABLES, C_FUNCS = str(base), str(base + 1)

    def nid(prefix, qn):
        return f"pg_{prefix}_" + re.sub(r"[^a-zA-Z0-9]+", "_", qn).strip("_").lower()

    def mknode(label, node_id, comm):
        return {"label": label, "file_type": "code", "source_file": "postgresql://supabase/maity",
                "source_location": "", "_origin": "postgres", "id": node_id,
                "community": int(comm), "norm_label": label.lower(),
                "community_name": COMMUNITY_LABELS["tables"] if comm == C_TABLES else COMMUNITY_LABELS["funcs"]}

    def mkedge(s, t, rel):
        e = {}
        for k in ekeys:
            if k == sk:
                e[k] = s
            elif k == tk:
                e[k] = t
            elif k in ("relation", "type", "rel"):
                e[k] = rel
            elif k in ("confidence", "tag"):
                e[k] = "EXTRACTED"
            elif isinstance(sample[k], (int, float)):
                e[k] = sample[k]
            else:
                e[k] = ""
        return e

    tables = re.findall(r"CREATE TABLE (\S+) \(", ddl)
    views = re.findall(r"CREATE VIEW (\S+) AS", ddl)
    funcs = re.findall(r"CREATE FUNCTION (\S+)\(\) RETURNS", ddl)
    fks = re.findall(r"ALTER TABLE (\S+) ADD CONSTRAINT \S+ FOREIGN KEY \([^)]*\) REFERENCES (\S+)\(", ddl)

    new_nodes, new_edges, idmap = [], [], {}
    for sch in ("maity", "auth"):
        hid = nid("schema", sch)
        idmap[f"__hub__{sch}"] = hid
        new_nodes.append(mknode(f"{sch} (schema)", hid, C_TABLES))
    for qn in tables + views:
        i = nid("t", qn)
        idmap[qn] = i
        new_nodes.append(mknode(qn, i, C_TABLES))
        sch = qn.split(".")[0]
        if f"__hub__{sch}" in idmap:
            new_edges.append(mkedge(idmap[f"__hub__{sch}"], i, "contains"))
    for qn in funcs:
        i = nid("f", qn)
        idmap[qn] = i
        new_nodes.append(mknode(qn + "()", i, C_FUNCS))
        sch = qn.split(".")[0]
        if f"__hub__{sch}" in idmap:
            new_edges.append(mkedge(idmap[f"__hub__{sch}"], i, "contains"))
    fk_ok = 0
    # dict.fromkeys dedupea conservando el orden: dos FKs distintas entre el mismo
    # par de tablas (p.ej. user_id y cancelled_by_user_id) colapsan a la MISMA arista
    # `references`, y emitirlas dos veces deja duplicados exactos en graph.json
    # (los detecta `graphify diagnose multigraph`). El grafo es no dirigido y las
    # colapsa igual en el post-build, asi que no se pierde informacion.
    for ttbl, ftbl in dict.fromkeys(fks):
        if ttbl in idmap and ftbl in idmap:
            new_edges.append(mkedge(idmap[ttbl], idmap[ftbl], "references"))
            fk_ok += 1

    G["nodes"].extend(new_nodes)
    G["links"].extend(new_edges)

    labels = {C_TABLES: COMMUNITY_LABELS["tables"], C_FUNCS: COMMUNITY_LABELS["funcs"]}
    # Este grafo guarda community_labels en el TOP-LEVEL (lo escribe la fase de naming).
    # Actualiza ambos por robustez: top-level y el bloque graph.* si existiera.
    tl = G.get("community_labels")
    if isinstance(tl, dict):
        tl.update(labels)
    else:
        G["community_labels"] = labels
    gl = G.setdefault("graph", {})
    if isinstance(gl, dict):
        gl.setdefault("community_labels", {}).update(labels)

    GRAPH.write_text(json.dumps(G, ensure_ascii=False), encoding="utf-8")

    lj = json.loads(LABELS.read_text(encoding="utf-8")) if LABELS.exists() else {}
    lj.update(labels)
    LABELS.write_text(json.dumps(lj, ensure_ascii=False), encoding="utf-8")

    print(f"OK: reinyectados {len(new_nodes)} nodos ({len(tables)} tablas, {len(views)} vistas, "
          f"{len(funcs)} funcs) y {len(new_edges)} aristas ({fk_ok} FKs) -> {GRAPH}")
    print("Regenera el viz: graphify tree --graph graphify-out/graph.json "
          "--output graphify-out/GRAPH_TREE.html --root .")
    return 0


if __name__ == "__main__":
    sys.exit(main())
