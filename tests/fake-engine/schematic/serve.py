"""The stand-in engine: the real server's framing and shapes, none of its work.

Behaviour comes from ``<SCHEMATIC_HOME>/fake-engine.json``, which the test
writes before the app starts (every key optional):

    version           what engine.info reports as "engine"      (default "0.2.0")
    protocol          what it reports as "protocol"             (default 1)
    exit              "at-once" | "after-handshake" | null       exit code 3 at that moment
    garbage           true: write a line that is not a frame before anything else
    ignore_shutdown   true: answer engine.shutdown and keep running
    silent            true: long requests send no progress and never answer
    mute              true: answer nothing at all, not even engine.info
    spawn_child       true: start a child that sleeps (pid in fake-engine.child.pid), as
                      the engine starts a layout tool; ended on engine.shutdown
    ignore_sigterm    true: ignore SIGTERM (POSIX), so only SIGKILL ends it
    progress_delay_ms wait between the four progress notifications (default 30)
    map_draws         true: map.build draws (eight stages, three files); else it refuses
    map_diagnostics   keys merged over map.build's clean diagnostics block, a level
                      at a time, so {"stops": {"matched": 2}} keeps the rest of "stops"
    map_caveats       the sentences map.build answers as "caveats"  (default none)
    map_issues        the weighted proportion it answers as "issues" (default 0)
    service_window    [start, end] feeds.service answers (default the whole of 2026)
    busiest           the day feeds.service answers as busiest_weekday (default 2026-06-16)
    service_delay_ms  wait before feeds.service answers, so a cancel can land (default 30)
    service_refuses   a sentence: feeds.service refuses with it, kind feed, as the engine
                      does for a feed with neither calendar table
    export_seconds    the one beat's length in a video plan export.plan answers (default 1)
    export_refuses    a sentence: export.plan refuses with it as the hint
    no_geographic     true: the feeds carry no geographic geometry, so a plan whose view or
                      storyboard visits the geographic view is refused, as the engine does
    encode_delay_ms   wait between export.encode's five progress notifications (default 30)
    encode_fails      true: export.encode fails after its progress, leaving no file
    presets_cached    keys of the two stand-in presets whose zip is "on disk" (default both)
    add_delay_ms      wait between the download's ten progress reports for a URL (default 20)
    add_refuses       a sentence: feeds.add from a URL refuses with it, kind feed
    inspect_refuses   a sentence: feeds.inspect refuses with it, kind feed
    stage_refuses     a sentence: render.stage refuses with it, kind engine

It writes ``fake-engine.pid`` (its process id) and ``fake-engine.received``
(one JSON line per message it read) into the home so a test can end it from
outside and see what reached it. Standard library only; any Python 3 runs it.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

HOME = Path(os.environ.get("SCHEMATIC_HOME", "."))
OUT = sys.stdout.buffer
LOCK = threading.Lock()
# The stand-in's registry: two presets, and whatever a test added, kept in
# the home so a new process sees it, as the engine's user-feeds.json is.
FEEDS = {
    "la-metro-rail": {"key": "la-metro-rail", "name": "LA Metro Rail", "city": "Los Angeles",
                      "network": "Metro Rail", "url": "https://example.test/la.zip",
                      "mode": "all", "label_pattern": "^Metro (.+) Line$", "label_strip": None,
                      "agency": None, "geographic": True, "notes": [], "source": "preset"},
    "cdmx-metro": {"key": "cdmx-metro", "name": "Mexico City Metro", "city": "Mexico City",
                   "network": "Metro", "url": "https://example.test/cdmx.zip",
                   "mode": "subway", "label_pattern": None, "label_strip": None,
                   "agency": "METRO", "geographic": True,
                   "notes": ["This is a 2025 snapshot."], "source": "preset"},
}
REQUIRED = ("stops", "routes", "trips", "stop_times")

# The engine's export tables at the pinned tag (v0.8.2), restated from
# `PRESETS` and `STORYBOARDS` in its export.py in the same shape its
# `preset_table()` and `storyboard_table()` answer. The names are held equal
# to the generated `PresetName` and `StoryboardName` unions by
# tests/unit/export.test.ts, so a pin that moves them fails there first.


def _preset(name, platform, width, height, kind, fmt, *, storyboard=None, fps=30,
            max_bytes=None, safe_zones=False, note=""):
    return {"name": name, "platform": platform, "width": width, "height": height,
            "kind": kind, "format": fmt, "view": "map", "labels": True,
            "storyboard": storyboard, "fps": fps, "max_bytes": max_bytes, "frame_top": 0.46,
            "safe_zones": safe_zones, "note": note}


EXPORT_PRESETS = [
    _preset("instagram-post", "Instagram", 1080, 1350, "still", "png"),
    _preset("instagram-square", "Instagram", 1080, 1080, "still", "png"),
    _preset("instagram-story", "Instagram", 1080, 1920, "still", "png", safe_zones=True),
    _preset("linkedin", "LinkedIn", 1200, 1200, "still", "png"),
    _preset("linkedin-link", "LinkedIn", 1200, 627, "still", "png",
            note="link-preview shape; the map gets very little height"),
    _preset("bluesky", "Bluesky", 1200, 900, "still", "jpg", max_bytes=976_000),
    _preset("x", "X", 1600, 900, "still", "png"),
    _preset("instagram-reel", "Instagram", 1080, 1920, "video", "mp4", storyboard="tour",
            safe_zones=True),
    _preset("bluesky-video", "Bluesky", 1080, 1350, "video", "mp4", storyboard="tour",
            max_bytes=50_000_000),
    _preset("linkedin-video", "LinkedIn", 1200, 1200, "video", "mp4", storyboard="tour"),
    _preset("instagram-reel-gif", "Instagram", 630, 1120, "video", "gif", storyboard="morph",
            fps=12, note="9:16 as GIF; half the mp4's size and rate, or it is unusable"),
    _preset("linkedin-gif", "LinkedIn", 640, 640, "video", "gif", storyboard="morph", fps=12,
            note="square GIF"),
    _preset("bluesky-gif", "Bluesky", 640, 800, "video", "gif", storyboard="morph", fps=12,
            note="4:5 GIF. Bluesky caps an image at ~1 MB, which nothing this long will "
                 "meet -- post the mp4 there and keep this for a page"),
    _preset("portfolio-svg", "Portfolio", 0, 0, "vector", "svg",
            note="both palettes, at the map's own aspect"),
    _preset("portfolio-mp4", "Portfolio", 1200, 900, "video", "mp4", storyboard="tour"),
    _preset("portfolio-gif", "Portfolio", 900, 675, "video", "gif", storyboard="morph", fps=24,
            note="palette-based GIF; keep it short, they are heavy"),
]
PRESETS = {p["name"]: p for p in EXPORT_PRESETS}


def _beat(secs, view=None, labels=None, at=None, speed=None, sweep=False, hours=None,
          span=None, tween=None):
    return {"secs": secs, "view": view, "labels": labels, "at": at, "speed": speed,
            "sweep": sweep, "hours": hours, "span": span, "tween": tween}


def _storyboard(name, *beats):
    views = []
    for b in beats:
        if b["view"] and b["view"] not in views:
            views.append(b["view"])
    return {"name": name, "views": " -> ".join(views), "seconds": sum(b["secs"] for b in beats),
            "geographic": "geographic" in views, "beats": list(beats)}


_HOLD, _MORPH = 2.6, 1.8
EXPORT_STORYBOARDS = [
    _storyboard("transform", _beat(4, "geographic", at="08:00", speed=120, tween=0),
                _beat(5, "map"), _beat(5, "linear"), _beat(4, "time"),
                _beat(9, sweep=True, hours=3)),
    _storyboard("transform-loop", _beat(2.5, "geographic", at="08:00", speed=120, tween=0),
                _beat(3, "map"), _beat(3, "linear"), _beat(3, "geographic")),
    _storyboard("essay-loop", _beat(_HOLD, "geographic", at="08:00", speed=60, tween=0),
                _beat(_HOLD + _MORPH, "map", tween=_MORPH),
                _beat(_HOLD + _MORPH, "linear", tween=_MORPH),
                _beat(_HOLD + _MORPH, "map", tween=_MORPH),
                _beat(_HOLD + _MORPH, "geographic", tween=_MORPH)),
    _storyboard("tour", _beat(6, "map", at="05:30", speed=240), _beat(6, "linear"),
                _beat(3, "time"), _beat(10, sweep=True, hours=4)),
    _storyboard("reveal", _beat(4, "map", labels=True, at="05:30", speed=240),
                _beat(6, labels=False), _beat(6, "linear"), _beat(3, "time"),
                _beat(10, sweep=True, hours=4)),
    _storyboard("morph", _beat(1.5, "map", at="08:00", speed=120), _beat(2.5, "linear"),
                _beat(2.5, "time"), _beat(2.5, "map")),
    _storyboard("day", _beat(1, "map", at="05:00", speed=0), _beat(18, sweep=True),
                _beat(1, speed=0)),
    _storyboard("run", _beat(20, "map", at="07:30", speed=240)),
]
STORYBOARDS = {b["name"]: b for b in EXPORT_STORYBOARDS}


def load_control() -> dict:
    try:
        return json.loads((HOME / "fake-engine.json").read_text())
    except (OSError, ValueError):
        return {}


def write(message: dict) -> None:
    body = json.dumps(message).encode("utf-8")
    with LOCK:
        OUT.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
        OUT.flush()


def read_message(stream) -> dict | None:
    length = None
    while True:
        line = stream.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        name, _, value = line.decode("ascii", "replace").partition(":")
        if name.strip().lower() == "content-length":
            length = int(value.strip())
    if length is None:
        return None
    return json.loads(stream.read(length).decode("utf-8"))


def record(message: dict) -> None:
    try:
        with (HOME / "fake-engine.received").open("a") as f:
            f.write(json.dumps(message) + "\n")
    except OSError:
        pass


def error(msg_id, code: int, message: str, kind: str) -> None:
    write({"jsonrpc": "2.0", "id": msg_id,
           "error": {"code": code, "message": message,
                     "data": {"kind": kind, "detail": message, "hint": message}}})


class Engine:
    def __init__(self, control: dict) -> None:
        self.control = control
        self.cancelled: set = set()
        # The layouts graph.build has answered with, as the real engine stores
        # them, each with the time it was made: a map.build for any other id
        # is refused, an unforced answer repeats `made`, a forced one
        # rewrites it (A3-06).
        self.layouts: dict = {}
        self.layout_stages: dict = {}
        self.builds = 0
        self.child = None
        if control.get("spawn_child"):
            self.child = subprocess.Popen(
                [sys.executable, "-c", "import time; time.sleep(600)"],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                (HOME / "fake-engine.child.pid").write_text(str(self.child.pid))
            except OSError:
                pass

    def info(self) -> dict:
        return {"engine": self.control.get("version", "0.2.0"),
                "protocol": self.control.get("protocol", 1),
                "python": "%d.%d.%d" % sys.version_info[:3],
                "loom": {"commit": None, "backend": "docker"},
                "ffmpeg": None, "home": str(HOME)}

    def handle(self, message: dict) -> bool:
        """Answer one message; False when the server should stop."""
        method = message.get("method")
        msg_id = message.get("id")
        if method == "$/cancelRequest":
            self.cancelled.add(message["params"]["id"])
            return True
        if msg_id is None or self.control.get("mute"):
            return True
        if method == "engine.info":
            write({"jsonrpc": "2.0", "id": msg_id, "result": self.info()})
            if self.control.get("exit") == "after-handshake":
                sys.stderr.write("fake engine: exiting after the handshake as told\n")
                sys.stderr.flush()
                os._exit(3)
            return True
        if method == "engine.shutdown":
            write({"jsonrpc": "2.0", "id": msg_id, "result": {"ok": True}})
            if self.control.get("ignore_shutdown"):
                return True
            if self.child is not None:
                self.child.kill()
            return False
        if method == "graph.build":
            threading.Thread(target=self.build, args=(msg_id, message.get("params") or {}),
                             daemon=True).start()
            return True
        if method == "map.build":
            params = message.get("params") or {}
            layout = params.get("layout")
            if not isinstance(layout, str) or not re.fullmatch(r"[0-9a-f]{64}", layout):
                error(msg_id, -32602, "layout is required: the id graph.build answered with. "
                      "A map is drawn from a stored layout and never lays one out itself.",
                      "params")
            elif "date" not in params:
                error(msg_id, -32602, "date is required: the service day to draw, as "
                      "YYYY-MM-DD. The engine never picks one, because its choice "
                      "would depend on the day you asked.", "params")
            elif layout not in self.layouts:
                error(msg_id, -32000, f"{params.get('key', 'x')} has no stored layout "
                      f"{layout[:8]}; lay the feed out first (graph.build)", "layout")
            elif self.control.get("map_draws"):
                threading.Thread(target=self.draw, args=(msg_id, params),
                                 daemon=True).start()
            else:
                error(msg_id, -32000, "the stand-in draws nothing", "engine")
            return True
        if method == "feeds.service":
            threading.Thread(target=self.service, args=(msg_id, message.get("params") or {}),
                             daemon=True).start()
            return True
        if method == "feeds.inspect":
            params = message.get("params") or {}
            key = params.get("key")
            if key not in FEEDS and key not in self.user_feeds():
                error(msg_id, -32000, f"{key!r} is not a registered feed", "feed")
            elif self.control.get("inspect_refuses"):
                error(msg_id, -32000, self.control["inspect_refuses"], "feed")
            else:
                anchor = params.get("anchor") or "2026-06-15"
                write({"jsonrpc": "2.0", "id": msg_id,
                       "result": self.inspection(key, anchor)})
            return True
        if method == "render.stage":
            params = message.get("params") or {}
            layout = params.get("layout")
            stage = params.get("stage")
            if stage not in ("gtfs2graph", "topo", "loom", "octi"):
                error(msg_id, -32602, "stage must be one of gtfs2graph, topo, loom, octi", "params")
            elif not isinstance(layout, str) or layout not in self.layouts:
                error(msg_id, -32000, f"{params.get('key', 'x')!r} has no stored {stage} graph; "
                      "lay the feed out first (graph.build)", "layout")
            elif self.control.get("stage_refuses"):
                error(msg_id, -32000, self.control["stage_refuses"], "engine")
            else:
                write({"jsonrpc": "2.0", "id": msg_id,
                       "result": self.stage_drawing(params.get("key", "x"), layout, stage,
                                                    params.get("width", 1200))})
            return True
        if method == "feeds.list":
            write({"jsonrpc": "2.0", "id": msg_id, "result": {"feeds": self.feed_records()}})
            return True
        if method == "feeds.add":
            threading.Thread(target=self.add, args=(msg_id, message.get("params") or {}),
                             daemon=True).start()
            return True
        if method == "feeds.remove":
            key = (message.get("params") or {}).get("key")
            if key in FEEDS:
                error(msg_id, -32000, f"{key!r} is a built-in feed and cannot be removed", "feed")
            elif key not in self.user_feeds():
                error(msg_id, -32000, f"{key!r} is not a registered feed", "feed")
            else:
                users = self.user_feeds()
                del users[key]
                self.write_user_feeds(users)
                for path in (HOME / "data" / "feeds").glob(f"{key}.*zip"):
                    path.unlink()
                write({"jsonrpc": "2.0", "id": msg_id, "result": {"ok": True}})
            return True
        if method == "export.presets":
            write({"jsonrpc": "2.0", "id": msg_id, "result": {"presets": EXPORT_PRESETS}})
            return True
        if method == "export.storyboards":
            write({"jsonrpc": "2.0", "id": msg_id,
                   "result": {"storyboards": EXPORT_STORYBOARDS}})
            return True
        if method == "export.plan":
            params = message.get("params") or {}
            problem = self.plan_problem(params)
            if problem is not None:
                error(msg_id, -32602, problem, "params")
            elif self.control.get("export_refuses"):
                error(msg_id, -32000, self.control["export_refuses"], "export")
            elif PRESETS[params["preset"]]["kind"] == "vector":
                error(msg_id, -32000, f"{params['preset']} is a vector preset: nothing to "
                      "capture", "export")
            elif self.control.get("no_geographic") and self.wants_geographic(params):
                error(msg_id, -32000, f"{params['key']!r} carries no geographic geometry, so "
                      "the geographic view would silently render as the schematic map.",
                      "export")
            else:
                write({"jsonrpc": "2.0", "id": msg_id, "result": self.plan(params)})
            return True
        if method == "export.encode":
            threading.Thread(target=self.encode, args=(msg_id, message.get("params") or {}),
                             daemon=True).start()
            return True
        write({"jsonrpc": "2.0", "id": msg_id,
               "error": {"code": -32601, "message": f"Method Not Found: {method}"}})
        return True

    def build(self, msg_id, params: dict) -> None:
        if self.control.get("silent"):
            return
        delay = self.control.get("progress_delay_ms", 30) / 1000
        for i, stage in enumerate(("gtfs2graph", "topo", "loom", "octi"), start=1):
            time.sleep(delay)
            if msg_id in self.cancelled:
                write({"jsonrpc": "2.0", "id": msg_id,
                       "error": {"code": -32800, "message": "Request Cancelled"}})
                return
            write({"jsonrpc": "2.0", "method": "job/log",
                   "params": {"id": msg_id, "level": "info", "line": f"{stage}: running"}})
            write({"jsonrpc": "2.0", "method": "job/progress",
                   "params": {"id": msg_id, "stage": stage, "fraction": i / 4,
                              "message": f"{stage}: 3 nodes, 2 edges"}})
        # The lines follow the mode, so a narrower choice draws fewer: the
        # stand-in's feeds carry A (tram) and B (subway) for every key.
        mode = params.get("mode", FEEDS.get(params.get("key", "x"), {}).get("mode") or "all")
        lines = ["A", "B"] if mode == "all" else ["A"] if "tram" in mode else ["B"]
        summary = {"nodes": 3, "stations": 3, "junctions": 0, "edges": 2, "lines": lines}
        stages = {s: dict(summary) for s in ("gtfs2graph", "topo", "loom", "octi")}
        stages["octi"]["octilinear"] = 1.0
        key = params.get("key", "x")
        # The id names the inputs, as the real engine's does: the same feed
        # and options give the same id, so two projects on one feed share one.
        # A missing mode or agency is the registry entry's and an empty
        # agency is none, as the engine's resolved() reads them.
        entry = FEEDS.get(key, {})
        agency = params.get("agency", entry.get("agency")) or None
        inputs = {"feed": key, "mode": mode, "agency": agency}
        layout = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
        if params.get("force") or layout not in self.layouts:
            self.builds += 1
            self.layouts[layout] = "2026-09-10T00:%02d:%02d+00:00" % divmod(self.builds, 60)
        self.layout_stages[layout] = stages
        paths = {s: str(HOME / "data" / "graphs" / key / layout / f"0{i}_{s}.json")
                 for i, s in enumerate(stages)}
        meta = {"feed": key, "feed_sha256": "0" * 64, "mode": mode,
                "agency": agency, "label_pattern": None, "label_strip": None,
                "loom": None, "stages": [["gtfs2graph", ["-m", mode]],
                                         ["topo", []], ["loom", []], ["octi", []]],
                "engine": self.control.get("version", "0.2.0"),
                "made": self.layouts[layout], "migrated": False}
        write({"jsonrpc": "2.0", "id": msg_id, "result": {
            "layout": layout, "meta": meta, "stages": stages, "paths": paths}})


    def draw(self, msg_id, params: dict) -> None:
        """The map build, when the control file asks for one. Reports the same
        eight stages the real engine does, writes the same three files, and
        answers with the same shape, so a test can drive a whole run."""
        key = params.get("key", "x")
        delay = self.control.get("progress_delay_ms", 30) / 1000
        graphs = HOME / "data" / "graphs" / key / params["layout"]
        graphs.mkdir(parents=True, exist_ok=True)
        for i, stage in enumerate(("gtfs2graph", "topo", "loom", "octi")):
            path = graphs / f"0{i}_{stage}.json"
            if not path.exists():
                path.write_text(json.dumps({"stage": stage, "key": key}))
        out = HOME / "out" / params["out"] if params.get("out") else HOME / "out"
        out.mkdir(parents=True, exist_ok=True)
        stages = ("gtfs2graph", "topo", "loom", "octi",
                  "schedule", "render", "animate", "write")
        for i, stage in enumerate(stages, start=1):
            time.sleep(delay)
            if msg_id in self.cancelled:
                write({"jsonrpc": "2.0", "id": msg_id,
                       "error": {"code": -32800, "message": "Request Cancelled"}})
                return
            # The real engine's last message is the folder it wrote into,
            # which is a path; the app must not put that on a screen.
            message = str(out) if stage == "write" else f"{stage}: 3 nodes, 2 edges"
            write({"jsonrpc": "2.0", "method": "job/progress",
                   "params": {"id": msg_id, "stage": stage, "fraction": i / len(stages),
                              "message": message}})
        files = {}
        for name, suffix in (("svg", ".svg"), ("html", ".html"),
                             ("positions", ".positions.json")):
            path = out / f"{key}{suffix}"
            path.write_text("<svg/>" if suffix == ".svg" else "{}")
            files[name] = str(path)
        # The shape is the protocol's Diagnostics, not a flat guess: a
        # stand-in that answers a different shape lets a consumer pass
        # here and fail against the engine. The default is a clean little
        # network -- every stop placed, nothing fudged -- which is the case
        # the panel has to get right; the control file names the rest.
        diagnostics = {"stations": 3, "junctions": 0, "edges": 2, "lines": ["A"],
                       "octilinear": 1.0,
                       "stops": {"matched": 3, "total": 3, "unmatched": [],
                                 "by": {"station_id": 3, "parent_station": 0, "name": 0}},
                       "trips": {"total": 1, "paths": 1, "unrouted": 0},
                       "degraded": {"borrowed_track": 0, "skipped_calls": 0},
                       "labels_dropped": 0, "peak_concurrent": 1}
        # Merged a level down, not replaced: a control naming one figure
        # under "stops" would otherwise drop the rest of the sub-block and
        # answer a shape the real engine cannot produce, which is the one
        # thing a stand-in must never do.
        for key, value in self.control.get("map_diagnostics", {}).items():
            if isinstance(value, dict) and isinstance(diagnostics.get(key), dict):
                merged = dict(diagnostics[key])
                for inner, deep in value.items():
                    if isinstance(deep, dict) and isinstance(merged.get(inner), dict):
                        merged[inner] = {**merged[inner], **deep}
                    else:
                        merged[inner] = deep
                diagnostics[key] = merged
            else:
                diagnostics[key] = value
        write({"jsonrpc": "2.0", "id": msg_id, "result": {
            "layout": params["layout"], "date": params["date"], "files": files,
            "summary": "the stand-in drew a map",
            "diagnostics": diagnostics,
            # Since engine v0.8.0 (E05): the same numbers as sentences, and
            # the weighted proportion the atlas is ordered by. A clean
            # network answers no sentences and a score of zero.
            "caveats": list(self.control.get("map_caveats", [])),
            "issues": self.control.get("map_issues", 0)}})


    # -- render.stage (E15), in shape: an SVG naming the stage, and the
    # counts graph.build reported for the stage, which is what the engine
    # answers and what the app's real-engine test holds it to.

    def stage_drawing(self, key: str, layout: str, stage: str, width) -> dict:
        counts = self.layout_stages.get(layout, {}).get(stage) or {
            "nodes": 3, "stations": 3, "junctions": 0, "edges": 2, "lines": ["A"]}
        lines = counts["lines"]
        height = round(float(width) * 0.6)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
               f'viewBox="0 0 {width} {height}"><rect width="100%" height="100%" '
               f'fill="#eee"/><text x="20" y="40" font-size="24">{stage}: '
               f'{", ".join(lines)}</text></svg>')
        return {"layout": layout, "stage": stage, "svg": svg, "width": float(width),
                "height": float(height),
                "counts": {k: v for k, v in counts.items() if k != "octilinear"}}

    # -- the registry (E09c), in shape

    def inspection(self, key: str, anchor: str) -> dict:
        """feeds.inspect, in shape: LA with its six routes of two types, CDMX
        with eight operators and its headway timetable, a user feed with one
        route; the window is the control file's, as feeds.service answers."""
        start, end = self.control.get("service_window", ["2026-01-01", "2026-12-31"])
        service = {"start": start, "end": end,
                   "busiest_weekday": self.control.get("busiest", "2026-06-16"),
                   "anchor": anchor}
        stops = {"stops": 3, "stations": 0, "entrances": 0, "generic_nodes": 0,
                 "boarding_areas": 0, "total": 3}

        def route(rid, agency, short, long_, label, rtype, color, trips):
            return {"route_id": rid, "agency_id": agency, "short_name": short,
                    "long_name": long_, "label": label, "route_type": rtype,
                    "color": color, "text_color": "FFFFFF" if color else None, "trips": trips}

        if key == "la-metro-rail":
            routes = [route("801", "LACMTA", "", "Metro A Line", "A", 0, "0072BC", 380),
                      route("802", "LACMTA", "", "Metro B Line", "B", 1, "E3131B", 210),
                      route("803", "LACMTA", "", "Metro C Line", "C", 0, "58A738", 150),
                      route("804", "LACMTA", "", "Metro D Line", "D", 1, "A05DA5", 120),
                      route("805", "LACMTA", "", "Metro E Line", "E", 0, "FDB913", 260),
                      route("807", "LACMTA", "", "Metro K Line", "K", 0, "E96BB0", 40)]
            agencies = [{"agency_id": "LACMTA", "agency_name": "Los Angeles County MTA"}]
            types = [{"route_type": 0, "name": "tram", "mode": "tram", "modes": ["tram", "streetcar"], "routes": 4, "trips": 830},
                     {"route_type": 1, "name": "subway", "mode": "subway", "modes": ["subway", "metro"], "routes": 2,
                      "trips": 330}]
            warnings = ["6 of 6 routes have no route_short_name; their labels come from "
                        "route_long_name through the feed's label pattern"]
            return {"key": key, "name": "LA Metro Rail", "tables": ["agency", "calendar",
                    "routes", "stop_times", "stops", "trips"], "agencies": agencies,
                    "routes": routes, "route_types": types, "stops": stops, "trips": 1160,
                    "frequency_trips": 0, "service": service, "suggested_mode": "all",
                    "warnings": warnings}
        if key == "cdmx-metro":
            routes = [route("L1", "METRO", "1", "Linea 1", "1", 1, "F04E98", 30),
                      route("L2", "METRO", "2", "Linea 2", "2", 1, "005EB8", 30),
                      route("S1", "SUB", "1", "Tren Suburbano", "1", 2, "FF0000", 20),
                      route("B1", "RTP", "10", "Ruta 10", "10", 3, None, 400)]
            agencies = [{"agency_id": "METRO", "agency_name": "Sistema de Transporte Colectivo"},
                        {"agency_id": "SUB", "agency_name": "Ferrocarriles Suburbanos"},
                        {"agency_id": "RTP", "agency_name": "Red de Transporte de Pasajeros"}]
            types = [{"route_type": 1, "name": "subway", "mode": "subway", "modes": ["subway", "metro"], "routes": 2, "trips": 60},
                     {"route_type": 2, "name": "rail", "mode": "rail", "modes": ["rail", "train"], "routes": 1, "trips": 20},
                     {"route_type": 3, "name": "bus", "mode": "bus", "modes": ["bus", "coach"], "routes": 1, "trips": 400}]
            warnings = ["The timetable is headway-based: 72 of 480 trips are frequency templates "
                        "that are expanded into runs, so a day has more trains than the trip "
                        "count suggests",
                        "3 operators share this feed (Sistema de Transporte Colectivo, "
                        "Ferrocarriles Suburbanos, Red de Transporte de Pasajeros); set an "
                        "agency to keep one, or every operator's routes are drawn together",
                        "The calendar ended on 2025-12-31, so no day after it has service; the "
                        "engine picks a day inside the window"]
            return {"key": key, "name": "Mexico City Metro", "tables": ["agency", "calendar",
                    "frequencies", "routes", "stop_times", "stops", "trips"],
                    "agencies": agencies, "routes": routes, "route_types": types,
                    "stops": stops, "trips": 480, "frequency_trips": 72,
                    "service": {**service, "start": "2025-01-01", "end": "2025-12-31",
                                "busiest_weekday": "2025-07-01"},
                    "suggested_mode": "subway", "warnings": warnings}
        name = self.user_feeds().get(key, {}).get("name", key)
        return {"key": key, "name": name, "tables": ["agency", "calendar", "routes",
                "stop_times", "stops", "trips"],
                "agencies": [{"agency_id": "X", "agency_name": name}],
                "routes": [route("R1", "X", "1", "Line 1", "1", 1, None, 1)],
                "route_types": [{"route_type": 1, "name": "subway", "mode": "subway", "modes": ["subway", "metro"],
                                 "routes": 1, "trips": 1}],
                "stops": stops, "trips": 1, "frequency_trips": 0, "service": service,
                "suggested_mode": "all", "warnings": []}

    def user_feeds(self) -> dict:
        try:
            records = json.loads((HOME / "data" / "feeds" / "user-feeds.json").read_text())
        except (OSError, ValueError):
            return {}
        return {r["key"]: r for r in records}

    def write_user_feeds(self, records: dict) -> None:
        folder = HOME / "data" / "feeds"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "user-feeds.json").write_text(json.dumps(list(records.values()), indent=2))

    def feed_records(self) -> list:
        cached = set(self.control.get("presets_cached", list(FEEDS)))
        out = [dict(f, cached=k in cached) for k, f in FEEDS.items()]
        out += [dict(f, cached=(HOME / "data" / "feeds" / f"{f['key']}.zip").exists())
                for f in self.user_feeds().values()]
        return out

    def add(self, msg_id, params: dict) -> None:
        """feeds.add, in shape: a URL is "downloaded" in ten reported steps
        (a cancel between them leaves nothing), a file is copied; the zip is
        checked for the tables the engine requires, with the engine's own
        sentences; the record is kept in the home."""
        import shutil
        import zipfile
        source = params.get("source")
        if not isinstance(source, str) or not source:
            error(msg_id, -32602, "source must be a URL with its scheme, or an absolute path "
                  "to a zip the client owns", "params")
            return
        folder = HOME / "data" / "feeds"
        folder.mkdir(parents=True, exist_ok=True)
        staging = folder / ".adding.zip"
        delay = self.control.get("add_delay_ms", 20) / 1000
        if source.startswith(("http://", "https://")):
            if self.control.get("add_refuses"):
                error(msg_id, -32000, self.control["add_refuses"], "feed")
                return
            total = 10240
            for i in range(1, 11):
                time.sleep(delay)
                if msg_id in self.cancelled:
                    write({"jsonrpc": "2.0", "id": msg_id,
                           "error": {"code": -32800, "message": "Request Cancelled"}})
                    return
                write({"jsonrpc": "2.0", "method": "job/progress",
                       "params": {"id": msg_id, "stage": "download", "fraction": i / 10,
                                  "message": f"downloaded {i * 1024:,} of {total:,} bytes"}})
            # A URL yields a well-formed feed, named after its file.
            with zipfile.ZipFile(staging, "w") as z:
                for name in REQUIRED + ("calendar", "agency"):
                    body = ("agency_id,agency_name\nX,Remote Transit\n" if name == "agency"
                            else f"{name}_id\n1\n")
                    z.writestr(f"{name}.txt", body)
            url, what = source, source.rsplit("/", 1)[-1]
        else:
            src = Path(source)
            if not src.is_file():
                error(msg_id, -32000, f"{src.name} is not a file", "feed")
                return
            shutil.copyfile(src, staging)
            url, what = "", src.name
        write({"jsonrpc": "2.0", "method": "job/progress",
               "params": {"id": msg_id, "stage": "check", "fraction": 1.0,
                          "message": "checked the feed's tables"}})
        if not zipfile.is_zipfile(staging):
            staging.unlink()
            error(msg_id, -32000, f"{what} is not a zip file, so it is not a GTFS feed", "feed")
            return
        with zipfile.ZipFile(staging) as z:
            stems = {Path(n).stem for n in z.namelist() if n.endswith(".txt")}
            agency = None
            if "agency.txt" in z.namelist():
                lines = z.read("agency.txt").decode().splitlines()
                if len(lines) > 1:
                    cols = lines[0].split(",")
                    if "agency_name" in cols:
                        agency = lines[1].split(",")[cols.index("agency_name")].strip() or None
        for stem in REQUIRED:
            if stem not in stems:
                staging.unlink()
                why = ("so there is no timetable to animate" if stem == "stop_times"
                       else "so there is no network to draw")
                error(msg_id, -32000, f"{what} has no {stem}.txt, {why}", "feed")
                return
        if not ({"calendar", "calendar_dates"} & stems):
            staging.unlink()
            error(msg_id, -32000, f"{what} has neither calendar.txt nor calendar_dates.txt, "
                  "so there is no service day to draw", "feed")
            return
        name = params.get("name") or agency or Path(what).stem
        key = params.get("key") or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        users = self.user_feeds()
        if key in FEEDS or key in users:
            staging.unlink()
            error(msg_id, -32000, f"{key!r} is already a feed; choose another key", "feed")
            return
        staging.replace(folder / f"{key}.zip")
        record = {"key": key, "name": name, "city": "", "network": "", "url": url,
                  "mode": params.get("mode") or "all", "label_pattern": None,
                  "label_strip": None, "agency": params.get("agency"), "geographic": True,
                  "notes": [], "source": "user"}
        users[key] = record
        self.write_user_feeds(users)
        write({"jsonrpc": "2.0", "id": msg_id, "result": dict(record, cached=True)})

    def service(self, msg_id, params: dict) -> None:
        """feeds.service, in shape: the window and the busiest weekday from
        the anchor, which is echoed. A long request in the real engine, so
        it waits and honours a cancel; it sends no progress, as the engine
        does not."""
        key = params.get("key")
        if not isinstance(key, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", key):
            error(msg_id, -32602, "key must be a feed key", "params")
            return
        anchor = params.get("anchor", "2026-06-15")
        if not isinstance(anchor, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", anchor):
            error(msg_id, -32602, "anchor must be a day, YYYY-MM-DD", "params")
            return
        time.sleep(self.control.get("service_delay_ms", 30) / 1000)
        if msg_id in self.cancelled:
            write({"jsonrpc": "2.0", "id": msg_id,
                   "error": {"code": -32800, "message": "Request Cancelled"}})
            return
        if self.control.get("service_refuses"):
            error(msg_id, -32000, self.control["service_refuses"], "feed")
            return
        start, end = self.control.get("service_window", ["2026-01-01", "2026-12-31"])
        write({"jsonrpc": "2.0", "id": msg_id, "result": {
            "start": start, "end": end,
            "busiest_weekday": self.control.get("busiest", "2026-06-16"),
            "anchor": anchor}})

    @staticmethod
    def plan_problem(params: dict) -> str | None:
        """The real server's refusals, in shape: a feed key, a preset it has, a
        page with a scheme, and options it knows."""
        if not isinstance(params.get("key"), str) or not params["key"]:
            return "key must be a feed key"
        if params.get("preset") not in PRESETS:
            return "preset must be the name of an export preset; export.presets lists them"
        page = params.get("page")
        if page is not None and (not isinstance(page, str) or "://" not in page):
            return "page must be the page's address, with its scheme"
        options = params.get("options") or {}
        if not isinstance(options, dict):
            return "options must be an object"
        known = {"view", "labels", "title", "clock", "theme", "at", "lines", "storyboard",
                 "quality", "fade", "tag", "safe"}
        extra = sorted(set(options) - known)
        if extra:
            return f"export.plan options does not take {', '.join(extra)}"
        board = options.get("storyboard")
        if board is not None and board not in STORYBOARDS:
            return "storyboard must be the name of a storyboard; export.storyboards lists them"
        return None

    @staticmethod
    def wants_geographic(params: dict) -> bool:
        options = params.get("options") or {}
        preset = PRESETS[params["preset"]]
        if (options.get("view") or preset["view"]) == "geographic":
            return True
        if preset["kind"] != "video":
            return False
        board = STORYBOARDS.get(options.get("storyboard") or preset["storyboard"] or "")
        return bool(board and board["geographic"])

    def plan(self, params: dict) -> dict:
        """export.plan's answer: the recorder's job for the page the app named,
        at half the preset's size so the stand-in page captures quickly, plus
        what export.encode needs back. A still is pinned at its `at`, as the
        engine pins it; a video is one short beat pinned to a clock, as every
        real storyboard opens.

        The address echoes the options it was asked, in the engine's own
        spelling (`url_for`), so a test reads what reached the engine from the
        address the app shows: the theme (A4-03), the view, the flags, the
        start time, the lines and the safe zones (A5-01)."""
        from urllib.parse import urlencode

        key, name = params["key"], params["preset"]
        preset = PRESETS[name]
        page = params.get("page") or f"file:///maps/{key}.html"
        options = params.get("options") or {}
        theme = "dark" if options.get("theme", "dark") == "dark" else "light"
        video = preset["kind"] == "video"
        view = options.get("view") or preset["view"]
        labels = options.get("labels", preset["labels"])
        title = options.get("title", True)
        clock = options.get("clock", video)
        query = {"present": "1", "view": view, "labels": "1" if labels else "0",
                 "title": "1" if title else "0", "clock": "1" if clock else "0",
                 "theme": "dark" if theme == "dark" else "sepia",
                 "frame": f"{preset['width']}:{preset['height']}",
                 "frametop": str(preset["frame_top"])}
        if options.get("at"):
            query["at"] = options["at"]
        if options.get("lines"):
            query["lines"] = ",".join(options["lines"])
        if options.get("safe"):
            query["safe"] = "1"
        url = page + "?" + urlencode(query)
        quality = options.get("quality", "standard")
        tag = options.get("tag") or ""
        stem = (f"{key}-{name}" + (f"-{theme}" if theme != "dark" else "")
                + (f"-{tag}" if tag else ""))
        board = (options.get("storyboard") or preset["storyboard"]) if video else ""
        at = options.get("at")
        pinned = None
        if not video:
            hms = [int(part) for part in (at or "07:00").split(":")]
            pinned = hms[0] * 3600 + hms[1] * 60 + (hms[2] if len(hms) > 2 else 0)
        seconds = float(self.control.get("export_seconds", 1))
        beats = [] if not video else [
            {"secs": seconds, "view": view, "labels": None, "at": 8 * 3600, "speed": 120,
             "sweep": False, "hours": None, "lo": None, "hi": None, "tween": 0}]
        return {"key": key, "preset": name, "mode": "video" if video else "still", "url": url,
                "width": max(1, preset["width"] // 2), "height": max(1, preset["height"] // 2),
                "scale": 1, "fps": preset["fps"], "format": preset["format"], "settle": 300,
                "beats": beats, "keep": quality != "standard", "crf": 26,
                "fade": float(options.get("fade", 0.0)), "stem": stem, "theme": theme,
                "view": view, "storyboard": board, "at": pinned, "notes": [],
                "filename": f"{stem}.{preset['format']}"}


    @staticmethod
    def still_problem(plan: dict, source: Path) -> str | None:
        """What the engine's encode would get wrong with this still. At draft and
        high quality it keeps the captured file as it is (`shutil.copyfile`), so a
        PNG capture for a JPEG preset would be PNG bytes under a .jpg name. The
        engine writes it and says nothing; the stand-in refuses, so a test sees
        the app never asks for one."""
        captured = source.suffix.lstrip(".").lower()
        wanted = plan.get("format")
        if plan.get("keep") and captured != wanted:
            return (f"the stand-in will not keep a {captured} capture as a {wanted} file: "
                    "at this quality the engine copies the capture unchanged")
        return None

    def encode(self, msg_id, params: dict) -> None:
        """export.encode, in shape: reads the frames the app captured, reports
        five steps of progress, writes the file and the sidecar beside it, and
        answers with what it wrote. A cancel between steps, or a failure asked
        for by the control file, removes both, as the real encode does."""
        plan = params.get("plan") or {}
        source = Path(params.get("source") or "")
        dest = Path(params.get("dest") or "")
        # A video is encoded from a folder of frames, a still from its one
        # captured image, as the engine's encode takes them.
        if plan.get("mode") == "still":
            if not source.is_file():
                error(msg_id, -32000, "the captured still is not there", "io")
                return
            problem = self.still_problem(plan, source)
            if problem is not None:
                error(msg_id, -32000, problem, "export")
                return
            frames = [source]
        elif not source.is_dir():
            error(msg_id, -32000, "the frames directory is not there", "io")
            return
        else:
            frames = sorted(source.glob("*.png"))
        sidecar = dest.with_name(dest.name + ".json")
        dest.parent.mkdir(parents=True, exist_ok=True)
        delay = self.control.get("encode_delay_ms", 30) / 1000
        steps = 5

        def remove() -> None:
            for path in (dest, sidecar):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass

        for i in range(1, steps + 1):
            time.sleep(delay)
            if msg_id in self.cancelled:
                remove()
                write({"jsonrpc": "2.0", "id": msg_id,
                       "error": {"code": -32800, "message": "Request Cancelled"}})
                return
            # A partial file, so a cancel has something to leave no trace of.
            dest.write_bytes(b"stand-in %s, step %d of %d\n" % (plan.get("format", "").encode(), i, steps))
            write({"jsonrpc": "2.0", "method": "job/progress",
                   "params": {"id": msg_id, "stage": "encode", "fraction": i / steps,
                              "message": f"{len(frames) * i // steps} of {len(frames)} frames"}})
        if self.control.get("encode_fails"):
            remove()
            error(msg_id, -32000, "the stand-in could not encode", "export")
            return
        dest.write_bytes(b"stand-in %s: %d frames\n" % (plan.get("format", "").encode(), len(frames)))
        provenance = params.get("provenance") or {}
        preset = PRESETS.get(plan.get("preset"), {})
        feed = FEEDS.get(plan.get("key"), {})
        board = plan.get("storyboard") or ""
        # The engine's `_write_sidecar` fields at v0.8.2, in its order, so a
        # test that reads a sidecar reads what the engine writes.
        meta = {"file": dest.name, "bytes": dest.stat().st_size, "feed": plan.get("key"),
                "city": feed.get("city"), "network": feed.get("network"),
                "preset": plan.get("preset"), "platform": preset.get("platform"),
                "size": (f"{preset['width']}x{preset['height']}" if preset.get("width")
                         else "native"),
                "view": (STORYBOARDS.get(board, {}).get("views") or plan.get("view")),
                "storyboard": board or None, "theme": plan.get("theme"),
                "alt": f"The stand-in's {plan.get('key')} map.",
                "service_date": provenance.get("service_date"),
                "trips": provenance.get("trips"), "caveats": provenance.get("caveats", []),
                "notes": list(feed.get("notes", [])), "source": feed.get("url")}
        sidecar.write_text(json.dumps(meta, indent=2) + "\n")
        write({"jsonrpc": "2.0", "id": msg_id, "result": {
            "files": [{"path": str(dest), "bytes": dest.stat().st_size}], "sidecar": meta}})


def main() -> int:
    control = load_control()
    try:
        (HOME / "fake-engine.pid").write_text(str(os.getpid()))
    except OSError:
        pass
    sys.stderr.write("fake engine %s, protocol %s, home %s\n"
                     % (control.get("version", "0.2.0"), control.get("protocol", 1), HOME))
    sys.stderr.flush()
    if control.get("exit") == "at-once":
        sys.stderr.write("fake engine: exiting at once as told\n")
        return 3
    if control.get("garbage"):
        OUT.write(b"this is not a frame\n")
        OUT.flush()
    if control.get("ignore_sigterm") and os.name != "nt":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    engine = Engine(control)
    stream = sys.stdin.buffer
    while True:
        message = read_message(stream)
        if message is None:
            sys.stderr.write("fake engine: end of input\n")
            return 0
        record(message)
        if not engine.handle(message):
            return 0


if __name__ == "__main__":
    sys.exit(main())
