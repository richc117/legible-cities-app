#!/usr/bin/env python3
"""Apply the Windows compatibility changes to a LOOM tree, for the MSYS2 build.

    scripts/loom-windows-patch.py <loom-src> <loom-windows-port>

The changes are the ones Transport for Cairo document in their port's
PATCHES.md (pinned in vendor/pins.json). Their tree vendors older copies
of LOOM's `util` and `cppgtfs` submodules than our pin resolves to, so the
port's files cannot simply replace ours. Instead:

- `win_compat.h` and the five cppgtfs files whose only difference is the
  `timezone` identifier rename are copied from the port (their base equals
  ours; a UTF-8 BOM and CRLF are stripped);
- the four entry points, the root CMakeLists.txt and three `util` headers
  and sources are edited in place, each edit anchored on exact text that
  must match exactly once, so a pin bump that moves an anchor fails here
  rather than in a compiler three minutes later.

Only the four tools this project ships are built (`gtfs2graph`, `topo`,
`loom`, `octi`), so the port's changes to `transitmap`, the HTTP server and
the test targets are not applied. Everything is guarded by `_WIN32` or only
runs in the Windows job, so the tree stays byte-identical for the other
platforms - this script never runs there.

Exit 0 when every edit applied; non-zero, naming the file and the anchor,
when one did not.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

TOOLS = ("gtfs2graph", "topo", "loom", "octi")
MAIN = {"gtfs2graph": "Gtfs2GraphMain.cpp", "topo": "TopoMain.cpp",
        "loom": "LoomMain.cpp", "octi": "OctiMain.cpp"}
CPPGTFS = ("gtfs/Agency.h", "gtfs/Stop.h", "gtfs/flat/Stop.h", "Parser.tpp", "Writer.cpp")

CMAKE_BLOCK = """
# Windows (MSYS2 UCRT64) build, after Transport for Cairo's port. Applied by
# scripts/loom-windows-patch.py in the app's vendor workflow; not upstream.
if(WIN32)
  message(STATUS "WIN32 build: applying Windows compatibility settings")
  include_directories(${CMAKE_SOURCE_DIR})
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN NOGDI NOUSER NOSOUND)
  set(CMAKE_CXX_STANDARD 17)
  set(CMAKE_CXX_STANDARD_REQUIRED ON)
  link_libraries(ws2_32 winmm)
  add_compile_options(-Wno-deprecated-declarations)
  # Self-contained executables: the GCC runtime, winpthread, zlib and bzip2
  # go in; only Windows' own DLLs stay outside. The vendor job checks.
  set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -static")
endif()
"""

LOG_UNDEF = """// Windows: windows.h defines these as macros; they are LogLevel names here.
#ifdef ERROR
#undef ERROR
#endif
#ifdef DEBUG
#undef DEBUG
#endif
#ifdef INFO
#undef INFO
#endif
#ifdef WARNING
#undef WARNING
#endif

"""

GEO_UNDEF = """
// Windows: wingdi.h (if it got in) defines these as functions.
#ifdef Polygon
#undef Polygon
#endif
#ifdef Rectangle
#undef Rectangle
#endif
"""


def text(path: Path) -> str:
    return path.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")


def edit(path: Path, old: str, new: str) -> None:
    t = text(path)
    n = t.count(old)
    if n != 1:
        sys.exit(f"loom-windows-patch: {path}: anchor found {n} times, expected 1:\n{old!r}")
    path.write_text(t.replace(old, new, 1))
    print(f"  edited  {path}")


def copy(src: Path, dst: Path) -> None:
    if not src.is_file():
        sys.exit(f"loom-windows-patch: missing in the port: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(text(src))
    print(f"  copied  {dst}  (from the port)")


def main() -> int:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    loom, port = Path(sys.argv[1]), Path(sys.argv[2])

    print("shim header")
    copy(port / "win_compat.h", loom / "win_compat.h")

    print("entry points")
    for tool in TOOLS:
        f = loom / "src" / tool / MAIN[tool]
        edit(f, "#include <unistd.h>\n", '#include "win_compat.h"\n')
        edit(f, "int main(int argc, char** argv) {\n",
             "int main(int argc, char** argv) {\n  win_set_binary_stdio();  // Windows: no CRLF translation on piped GeoJSON\n")

    print("root CMakeLists.txt")
    edit(loom / "CMakeLists.txt", "project (loom)\n", "project (loom)\n" + CMAKE_BLOCK)

    print("util")
    edit(loom / "src/util/Misc.h",
         "#if defined(_WIN32)\n#include <psapi.h>\n#include <windows.h>\n",
         "#if defined(_WIN32)\n#include <windows.h>  // before psapi.h, which needs its types\n#include <psapi.h>\n")
    edit(loom / "src/util/Misc.cpp", "#include <pwd.h>\n",
         '#include "win_compat.h"  // pwd.h, getpwuid_r and sysconf shims on Windows\n')
    edit(loom / "src/util/log/Log.h", "enum LogLevel {\n", LOG_UNDEF + "enum LogLevel {\n")
    edit(loom / "src/util/geo/Geo.h", '#include "Geo.tpp"\n', '#include "Geo.tpp"\n' + GEO_UNDEF)

    print("cppgtfs (timezone identifier rename; MinGW's time.h owns that name)")
    for rel in CPPGTFS:
        copy(port / "src/cppgtfs/src/ad/cppgtfs" / rel, loom / "src/cppgtfs/src/ad/cppgtfs" / rel)

    print("loom-windows-patch: every edit applied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
