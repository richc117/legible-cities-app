"""Record the method of every request the engine receives, for the
determinism test (A5-04).

The test launches the app with this folder on PYTHONPATH, which the app
passes to the engine in development only (src/main/interpreter.ts), so
Python imports this module as it starts, before the engine. It writes one
method name per line to ``engine-requests.log`` beside the engine's home,
which is how the test knows that no ``graph.build`` was sent: the export
must read the stored layout and never lay the network out again (ADR-023).

It reads the JSON-RPC library's own debug record of each request rather
than wrapping anything of the engine's, and changes nothing else: every
other debug record from that logger is dropped here, so the engine's log is
what it would have been. Nothing outside the test uses it.
"""

import logging
import os
from pathlib import Path

_home = os.environ.get("SCHEMATIC_HOME", "")

if _home:
    _log = Path(_home).absolute().parent / "engine-requests.log"

    class _Requests(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            if record.levelno > logging.DEBUG:
                return True
            if record.msg == "Handling request from client %s":
                # A single mapping argument is kept by logging as the mapping
                # itself rather than as a one-item tuple.
                args = record.args
                message = args[0] if isinstance(args, tuple) and args else args
                method = message.get("method") if isinstance(message, dict) else None
                if isinstance(method, str):
                    with _log.open("a", encoding="utf-8") as fh:
                        fh.write(method + "\n")
            return False

    _endpoint = logging.getLogger("pylsp_jsonrpc.endpoint")
    _endpoint.setLevel(logging.DEBUG)
    _endpoint.addFilter(_Requests())
