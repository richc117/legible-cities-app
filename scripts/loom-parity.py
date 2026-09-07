#!/usr/bin/env python3
"""Compare two LOOM line graphs for equivalence, not for byte equality.

    scripts/loom-parity.py A.json B.json
    scripts/loom-parity.py A.json B.json --tolerance 1e-6 --json

Two builds of LOOM agree if they produce the same graph, and a graph is not
its file. Feature order, coordinate precision and key order are all free to
differ without anything being wrong, so this compares what the pipeline
actually depends on:

- the set of nodes, matched by station identity and then by position;
- the set of edges, matched by their endpoints;
- the order of lines along each edge, which is what `loom` solves for and
  what the animation draws;
- coordinates, within a tolerance, in degrees.

Exit 0 when the graphs agree, 1 when they do not. A disagreement prints
what differs and how much, because "not equal" is not a finding - the size
of the difference is.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


def load(path: Path) -> dict:
    with path.open() as fh:
        return json.load(fh)


def split(graph: dict) -> tuple[list[dict], list[dict]]:
    """Nodes and edges, by geometry type - LOOM's GeoJSON convention."""
    nodes = [f for f in graph["features"] if f["geometry"]["type"] == "Point"]
    edges = [f for f in graph["features"] if f["geometry"]["type"] == "LineString"]
    return nodes, edges


def node_key(feature: dict) -> str:
    """Identity that survives renumbering: the station, else the position."""
    props = feature.get("properties") or {}
    for field in ("station_id", "station_label"):
        value = props.get(field)
        if value not in (None, ""):
            return f"{field}={value}"
    lon, lat = feature["geometry"]["coordinates"][:2]
    return f"at={lon:.6f},{lat:.6f}"


def lines_of(feature: dict) -> list[str]:
    """The ordered line labels along an edge.

    Deliberately `label` and never `id`: LOOM writes the in-memory pointer as
    the id, so `0x10370a150` on one machine is `0xaaaafbd128e0` on another and
    comparing ids reports every edge as different. The label is the route's
    short name, which is what the ordering means.
    """
    props = feature.get("properties") or {}
    lines = props.get("lines")
    if not isinstance(lines, list):
        return []
    out = []
    for entry in lines:
        if isinstance(entry, dict):
            label = entry.get("label")
            out.append(str(label) if label not in (None, "") else str(entry.get("id")))
        else:
            out.append(str(entry))
    return out


def node_index(nodes: list[dict]) -> dict[str, str]:
    """Pointer id -> stable node key, valid within one file only."""
    return {(f.get("properties") or {}).get("id"): node_key(f) for f in nodes}


def edge_key(feature: dict, index: dict[str, str]) -> tuple:
    """An edge is the pair of stable keys of the nodes it joins.

    Not its coordinates: `octi` moves every vertex, so a coordinate-keyed edge
    never matches across two builds even when the topology is identical.
    """
    props = feature.get("properties") or {}
    a = index.get(props.get("from"))
    b = index.get(props.get("to"))
    if a is None or b is None:          # no endpoint ids: fall back to geometry
        coords = feature["geometry"]["coordinates"]
        a = a or f"at={coords[0][0]:.6f},{coords[0][1]:.6f}"
        b = b or f"at={coords[-1][0]:.6f},{coords[-1][1]:.6f}"
    return tuple(sorted([a, b]))


def far(a: dict, b: dict, tolerance: float) -> float:
    """Distance in degrees between two point features."""
    (x1, y1), (x2, y2) = a["geometry"]["coordinates"][:2], b["geometry"]["coordinates"][:2]
    return math.hypot(x1 - x2, y1 - y2)


def compare(left: dict, right: dict, tolerance: float) -> dict:
    ln, le = split(left)
    rn, re_ = split(right)

    lk = {node_key(f): f for f in ln}
    rk = {node_key(f): f for f in rn}
    only_left = sorted(set(lk) - set(rk))
    only_right = sorted(set(rk) - set(lk))

    moved, worst, worst_key = [], 0.0, None
    for key in sorted(set(lk) & set(rk)):
        d = far(lk[key], rk[key], tolerance)
        if d > worst:
            worst, worst_key = d, key
        if d > tolerance:
            moved.append((key, d))

    li, ri = node_index(ln), node_index(rn)
    lek = {edge_key(f, li): f for f in le}
    rek = {edge_key(f, ri): f for f in re_}
    edges_only_left = len(set(lek) - set(rek))
    edges_only_right = len(set(rek) - set(lek))

    order_differs = []
    for key in set(lek) & set(rek):
        a, b = lines_of(lek[key]), lines_of(rek[key])
        if a and b and a != b:
            order_differs.append((key, a, b))

    return {
        "nodes": {"left": len(ln), "right": len(rn),
                  "only_left": only_left, "only_right": only_right,
                  "moved_beyond_tolerance": moved,
                  "worst_offset_degrees": worst, "worst_offset_at": worst_key},
        "edges": {"left": len(le), "right": len(re_),
                  "only_left": edges_only_left, "only_right": edges_only_right,
                  "line_order_differs": len(order_differs),
                  "line_order_examples": order_differs[:3]},
    }


def agrees(result: dict) -> bool:
    n, e = result["nodes"], result["edges"]
    return not (n["only_left"] or n["only_right"] or n["moved_beyond_tolerance"]
                or e["only_left"] or e["only_right"] or e["line_order_differs"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("left", type=Path)
    ap.add_argument("right", type=Path)
    ap.add_argument("--tolerance", type=float, default=1e-6,
                    help="coordinate tolerance in degrees (default 1e-6)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    a = ap.parse_args()

    result = compare(load(a.left), load(a.right), a.tolerance)
    ok = agrees(result)

    if a.json:
        print(json.dumps({"agree": ok, **result}, indent=2, default=str))
        return 0 if ok else 1

    n, e = result["nodes"], result["edges"]
    print(f"{a.left.name} vs {a.right.name}   tolerance {a.tolerance:g} degrees")
    print(f"  nodes {n['left']:4} vs {n['right']:4}"
          f"   only-left {len(n['only_left'])}  only-right {len(n['only_right'])}"
          f"   moved {len(n['moved_beyond_tolerance'])}")
    if n["worst_offset_at"]:
        print(f"        worst common-node offset {n['worst_offset_degrees']:.3e} deg"
              f" at {n['worst_offset_at']}")
    for key in n["only_left"][:5]:
        print(f"        only in {a.left.name}: {key}")
    for key in n["only_right"][:5]:
        print(f"        only in {a.right.name}: {key}")
    print(f"  edges {e['left']:4} vs {e['right']:4}"
          f"   only-left {e['only_left']}  only-right {e['only_right']}"
          f"   line-order differs {e['line_order_differs']}")
    for key, x, y in e["line_order_examples"]:
        print(f"        order at {key}: {x} vs {y}")
    print("  AGREE" if ok else "  DIFFER")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
