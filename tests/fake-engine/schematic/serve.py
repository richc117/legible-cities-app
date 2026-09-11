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
    export_seconds    the one beat's length in the plan export.plan answers (default 1)
    export_refuses    a sentence: export.plan refuses with it as the hint
    encode_delay_ms   wait between export.encode's five progress notifications (default 30)
    encode_fails      true: export.encode fails after its progress, leaving no file

It writes ``fake-engine.pid`` (its process id) and ``fake-engine.received``
(one JSON line per message it read) into the home so a test can end it from
outside and see what reached it. Standard library only; any Python 3 runs it.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

HOME = Path(os.environ.get("SCHEMATIC_HOME", "."))
OUT = sys.stdout.buffer
LOCK = threading.Lock()
PRESETS = {"instagram-reel": (1080, 1920, "mp4")}


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
            if "date" not in params:
                error(msg_id, -32602, "date is required: the service day to draw, as "
                      "YYYY-MM-DD. The engine never picks one, because its choice "
                      "would depend on the day you asked.", "params")
            elif self.control.get("map_draws"):
                threading.Thread(target=self.draw, args=(msg_id, params),
                                 daemon=True).start()
            else:
                error(msg_id, -32000, "the stand-in draws nothing", "engine")
            return True
        if method == "export.plan":
            params = message.get("params") or {}
            problem = self.plan_problem(params)
            if problem is not None:
                error(msg_id, -32602, problem, "params")
            elif self.control.get("export_refuses"):
                error(msg_id, -32000, self.control["export_refuses"], "export")
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
        summary = {"nodes": 3, "stations": 3, "junctions": 0, "edges": 2, "lines": ["A"]}
        stages = {s: dict(summary) for s in ("gtfs2graph", "topo", "loom", "octi")}
        stages["octi"]["octilinear"] = 1.0
        key = params.get("key", "x")
        paths = {s: str(HOME / "data" / "graphs" / key / f"0{i}_{s}.json")
                 for i, s in enumerate(stages)}
        write({"jsonrpc": "2.0", "id": msg_id, "result": {"stages": stages, "paths": paths}})


    def draw(self, msg_id, params: dict) -> None:
        """The map build, when the control file asks for one. Reports the same
        eight stages the real engine does, writes the same three files, and
        answers with the same shape, so a test can drive a whole run."""
        key = params.get("key", "x")
        delay = self.control.get("progress_delay_ms", 30) / 1000
        graphs = HOME / "data" / "graphs" / key
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
        write({"jsonrpc": "2.0", "id": msg_id, "result": {
            "date": params["date"], "files": files,
            "summary": "the stand-in drew a map",
            # The shape is the protocol's Diagnostics, not a flat guess: a
            # stand-in that answers a different shape lets a consumer pass
            # here and fail against the engine.
            "diagnostics": {"stations": 3, "junctions": 0, "edges": 2, "lines": ["A"],
                            "octilinear": 1.0,
                            "stops": {"matched": 3, "total": 3, "unmatched": [],
                                      "by": {"station_id": 3, "parent_station": 0, "name": 0}},
                            "trips": {"total": 1, "paths": 1, "unrouted": 0},
                            "degraded": {"borrowed_track": 0, "skipped_calls": 0},
                            "labels_dropped": 0, "peak_concurrent": 1}}})


    @staticmethod
    def plan_problem(params: dict) -> str | None:
        """The real server's refusals, in shape: a feed key, a preset it has, and
        a page with a scheme."""
        if not isinstance(params.get("key"), str) or not params["key"]:
            return "key must be a feed key"
        if params.get("preset") not in PRESETS:
            return "preset must be one of " + ", ".join(PRESETS)
        page = params.get("page")
        if page is not None and (not isinstance(page, str) or "://" not in page):
            return "page must be the page's address, with its scheme"
        return None


    def plan(self, params: dict) -> dict:
        """export.plan's answer: the recorder's job for the page the app named,
        at a size the stand-in page draws, plus what export.encode needs back.
        One beat, pinned to a clock, as every real storyboard opens."""
        key, preset = params["key"], params["preset"]
        width, height, fmt = PRESETS[preset]
        page = params.get("page") or f"file:///maps/{key}.html"
        url = (f"{page}?present=1&view=map&labels=1&title=1&clock=1&theme=dark"
               f"&frame={width}:{height}&frametop=0")
        seconds = float(self.control.get("export_seconds", 1))
        return {"key": key, "preset": preset, "mode": "video", "url": url,
                "width": 540, "height": 960, "scale": 1, "fps": 30, "format": fmt,
                "settle": 300,
                "beats": [{"secs": seconds, "view": "map", "labels": None, "at": 8 * 3600,
                           "speed": 120, "sweep": False, "hours": None, "lo": None,
                           "hi": None, "tween": 0}],
                "keep": True, "crf": 26, "fade": 0.0, "stem": f"{key}-{preset}",
                "theme": "dark", "view": "map", "storyboard": "tour", "at": None,
                "notes": [], "filename": f"{key}-{preset}.{fmt}"}


    def encode(self, msg_id, params: dict) -> None:
        """export.encode, in shape: reads the frames the app captured, reports
        five steps of progress, writes the file and the sidecar beside it, and
        answers with what it wrote. A cancel between steps, or a failure asked
        for by the control file, removes both, as the real encode does."""
        plan = params.get("plan") or {}
        source = Path(params.get("source") or "")
        dest = Path(params.get("dest") or "")
        if not source.is_dir():
            error(msg_id, -32000, "the frames directory is not there", "io")
            return
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
        meta = {"file": dest.name, "bytes": dest.stat().st_size, "feed": plan.get("key"),
                "preset": plan.get("preset"), "platform": "stand-in",
                "service_date": provenance.get("service_date"), "frames": len(frames),
                "caveats": []}
        sidecar.write_text(json.dumps(meta, indent=2))
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
