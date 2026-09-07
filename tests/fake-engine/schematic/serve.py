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
            else:
                error(msg_id, -32000, "the stand-in draws nothing", "engine")
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
