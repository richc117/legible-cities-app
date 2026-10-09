"""The stand-in engine: the real server's framing and shapes, none of its work.

Behaviour comes from ``<SCHEMATIC_HOME>/fake-engine.json``, which the test
writes before the app starts (every key optional):

    version           what engine.info reports as "engine"      (default "0.2.0")
    protocol          what it reports as "protocol"             (default 1)
    exit              "at-once" | "after-handshake" | null       exit code 3 at that moment
    garbage           true: write a line that is not a frame before anything else; a
                      string: write that string as the line
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
    presets_cached    keys of the two stand-in presets whose zip is "on disk" (default both);
                      one that is not is "downloaded" by the first graph.build that needs it,
                      in ten reported steps of stage download before gtfs2graph, as engine
                      v0.10.0 does (E36): a cancel between them answers -32800 and keeps
                      nothing, and a feeds.inspect that reaches the preset first records its
                      key in fake-engine.inspect-downloaded
    preset_download_delay_ms  wait between those ten reports (default 20)
    preset_download_refuses   a sentence: that download refuses with it after its last
                      report, kind feed, as the engine does for a page that is not a zip
                      (it checks the file once every byte has come)
    preset_download_fails_early  a sentence: that download fails with it before its first
                      report, kind feed, as the engine does offline or on a 404
    add_delay_ms      wait between the download's ten progress reports for a URL (default 20)
    add_refuses       a sentence: feeds.add from a URL refuses with it, kind feed
    remove_delay_ms   wait before feeds.remove answers, on a thread of its own (default 0), so
                      other requests are read and answered meanwhile; it does not stop for
                      a cancel, as an engine that cannot be stopped would not
    remove_blocks_ms  how long feeds.remove takes (default 0: it answers at once), as a job,
                      as the engine runs it since v0.11.0 (its issue 35): on a thread of its
                      own, so the reader goes on answering and reads a cancel meanwhile. The
                      name is from when the engine ran it on its one reader thread, from
                      v0.8.3 to v0.10.1, and nothing else was read until it had answered.
                      A cancel read before the point of no return answers -32800 and keeps the
                      feed and its files; one read after it lets the removal finish and
                      answers {"ok": true, "cancel_too_late": true}
    remove_commits_after_ms  when, counted from the start of that removal, the registry is
                      written without the feed: the point of no return (default: the end of
                      the removal, so any cancel during it is in time). The zip goes at the
                      end of the removal, as the engine removes files after forgetting the
                      feed
    remove_stalls     true: feeds.remove is read, recorded and never answered, a cancel
                      included, as an engine that has stopped answering would
    inspect_refuses   a sentence: feeds.inspect refuses with it, kind feed
    stage_refuses     a sentence: render.stage refuses with it, kind engine
    stage_waits_on    {stage: later stage}: while a build of the layout runs, render.stage for
                      a stage named here waits on the later one too, as the engine's answer
                      with a date waits on octi, and is refused as not yet until the later one
                      is reported (issue 382); without it nothing the app asks during a run is
                      ever refused as not yet, since the app asks for a stage at its report
    empty_modes       modes graph.build keeps no routes for: after gtfs2graph it refuses with
                      the engine's route-type sentence as the hint and a different detail
                      (pipeline.require_edges, classified), as the engine does
    build_log_lines   extra job/log lines graph.build sends first; "{home}" in one is replaced
                      by the user's home folder, so a copied log has one to hide
    octi_child        true: graph.build starts a child during octi, as the engine starts LOOM's
                      octi tool, and waits octi_ms (default 2000) for a cancel; a cancel ends
                      the child and records its pid in fake-engine.octi-ended; its pid while it
                      runs is in fake-engine.octi.pid

``graph.build`` takes a ``tuning`` as engine v0.14.0 does (its issue 37): it
refuses one the engine's ``serve._tuning`` refuses, with the ``params`` kind
and the engine's sentences, before any progress; it writes LOOM's flags for
the fields away from LOOM's defaults into ``meta.stages``; and the flags are
part of the layout's id, so a different tuning answers a different layout and
none, ``{}`` and nothing but defaults all answer the untuned one. The tuning
it was given is in ``fake-engine.received`` with the rest of the request.

It writes ``fake-engine.pid`` (its process id) and ``fake-engine.received``
(one JSON line per message it read) into the home so a test can end it from
outside and see what reached it. Standard library only; any Python 3 runs it.
"""

from __future__ import annotations

import datetime
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
# user-feeds.json is read, changed and written by feeds.add and feeds.remove
# on threads of their own, and read by feeds.list on the main one: one lock
# around each read-change-write, and every write a rename, so no reader sees
# half a file and two removals of one key cannot both find it.
FEEDS_LOCK = threading.RLock()
# The stand-in's registry: two presets, and whatever a test added, kept in
# the home so a new process sees it, as the engine's user-feeds.json is.
# Since engine v0.11.0 every entry says whether its feed runs from
# frequencies.txt (`headways`, required): Mexico City's does, among the
# presets, and Los Angeles' does not. A record a test wrote without the field
# reads as false, as one the engine wrote before it existed does.
FEEDS = {
    "la-metro-rail": {"key": "la-metro-rail", "name": "LA Metro Rail", "city": "Los Angeles",
                      "network": "Metro Rail", "url": "https://example.test/la.zip",
                      "mode": "all", "label_pattern": "^Metro (.+) Line$", "label_strip": None,
                      "agency": None, "geographic": True, "notes": [], "headways": False,
                      "source": "preset"},
    "cdmx-metro": {"key": "cdmx-metro", "name": "Mexico City Metro", "city": "Mexico City",
                   "network": "Metro", "url": "https://example.test/cdmx.zip",
                   "mode": "subway", "label_pattern": None, "label_strip": None,
                   "agency": "METRO", "geographic": True,
                   "notes": ["This is a 2025 snapshot."], "headways": True,
                   "source": "preset"},
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

# What engine v0.12.0 added to a plan, restated from its export.py (issues 31,
# 39 and 40; app ADR-051 and ADR-052): a storyboard written as a list of beats
# (`authored_beats`), a caption, and the corner the clock sits in.
VIEWS = ("geographic", "map", "linear", "time")
MAX_BEATS, BEAT_SECS, MAX_SECONDS, MAX_HOURS = 16, (0.5, 30.0), 90.0, 24.0
BEAT_FIELDS = ("secs", "view", "labels", "at", "speed", "sweep", "hours", "span", "tween")
BESIDE_A_LIST = "view and at go on a list's first beat (storyboard[0]), not beside the list"
CLOCK = re.compile(r"^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$")
CLOCK_CORNERS = ("top-left", "top-right", "bottom-left", "bottom-right")
DEFAULT_CORNER = "bottom-right"
CAPTION_MAX = 80
LINE_BREAKS = ("\r", "\n", "\u2028", "\u2029")
# The two stand-in presets with safe zones, as the engine's SAFE_ZONES rows
# (`instagram-reels`, `instagram-stories`) give them, in the order its `url_for`
# writes them on every address of the preset: top, bottom, side, rail width and
# rail top, as fractions of the frame, None where a row has no such zone.
ZONE_PARAMS = ("ztop", "zbottom", "zside", "zrail", "zrailtop")
ZONES = {"instagram-reel": (0.14, 0.35, 0.06, 0.21, 0.60),
         "instagram-story": (0.14, 0.20, None, None, None)}
ALT_MAX = 1000


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


# The layout's tuning at engine v0.14.0 (`pipeline`'s table, `serve._tuning`):
# each number as its refusal names it, with the tool it belongs to, its flag,
# LOOM's default, its closed range, what it counts and the flag's suffix.
TUNING_NUMBERS = {
    "merge_distance": ("topo", "-d", 50, 5, 500, "in metres", ""),
    "grid_size": ("octi", "-g", 100, 25, 400,
                  "as a percentage of the distance between adjacent stations", "%"),
}
TUNING_PENALTIES = {
    name: ("octi", flag, default, 0, 10, "as a cost without a unit", "")
    for name, flag, default in (("deg45", "--pen-45", 2), ("deg90", "--pen-90", 1.5),
                                ("deg135", "--pen-135", 1), ("deg180", "--pen-180", 0),
                                ("diagonal", "--diag-pen", 0.5))}
TUNING_GRIDS = ("octilinear", "ortholinear", "orthoradial", "hexalinear")


def _tuned(path: str, value, spec) -> str | None:
    _tool, _flag, _default, low, high, unit, _suffix = spec
    if not _number(value) or not low <= value <= high:
        return f"{path} must be from {low:g} to {high:g}, {unit}"
    return None


def tuning_problem(tuning) -> str | None:
    """The engine's refusal of a tuning, in its order and its sentences
    (`serve._tuning` at v0.14.0), or None when it takes it."""
    if not isinstance(tuning, dict):
        return "tuning must be an object of LOOM's own settings, or left out"
    left = dict(tuning)
    if "merge_distance" in left:
        problem = _tuned("tuning.merge_distance", left.pop("merge_distance"),
                         TUNING_NUMBERS["merge_distance"])
        if problem:
            return problem
    if "grid" in left:
        grid = left.pop("grid")
        if not isinstance(grid, str) or grid not in TUNING_GRIDS:
            return "tuning.grid must be one of " + ", ".join(TUNING_GRIDS)
    if "grid_size" in left:
        problem = _tuned("tuning.grid_size", left.pop("grid_size"), TUNING_NUMBERS["grid_size"])
        if problem:
            return problem
    if "penalties" in left:
        penalties = left.pop("penalties")
        if not isinstance(penalties, dict):
            return "tuning.penalties must be an object of " + ", ".join(TUNING_PENALTIES)
        rest = dict(penalties)
        for name, spec in TUNING_PENALTIES.items():
            if name in rest:
                problem = _tuned(f"tuning.penalties.{name}", rest.pop(name), spec)
                if problem:
                    return problem
        if rest:
            return f"tuning.penalties does not take {', '.join(sorted(rest))}"
    if left:
        return f"tuning does not take {', '.join(sorted(left))}"
    return None


def tuning_flags(tuning) -> dict:
    """LOOM's flags for a tuning the engine took, by tool, as
    `pipeline.stages_for` writes them: none for a field left out or at LOOM's
    default, numbers as LOOM prints them (50, 1.5), the grid size with its
    percent sign."""
    def written(value) -> str:
        number = float(value)
        return str(int(number)) if number.is_integer() else repr(number)

    flags: dict = {"topo": [], "loom": [], "octi": []}
    tuning = tuning or {}

    def add(spec, value) -> None:
        tool, flag, default, _low, _high, _unit, suffix = spec
        if value is not None and value != default:
            flags[tool] += [flag, written(value) + suffix]

    add(TUNING_NUMBERS["merge_distance"], tuning.get("merge_distance"))
    if tuning.get("grid") not in (None, "octilinear"):
        flags["octi"] += ["-b", tuning["grid"]]
    add(TUNING_NUMBERS["grid_size"], tuning.get("grid_size"))
    for name, spec in TUNING_PENALTIES.items():
        add(spec, (tuning.get("penalties") or {}).get(name))
    return flags


def _clock(value) -> bool:
    return isinstance(value, str) and CLOCK.match(value) is not None


def _hms(text: str) -> float:
    parts = [float(v) for v in text.split(":")]
    while len(parts) < 3:
        parts.append(0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def beats_problem(beats) -> str | None:
    """The engine's `authored_beats`, as the refusal it would raise: one
    sentence naming the beat, counted from 0, and the field."""
    if not isinstance(beats, list):
        return "storyboard must be a storyboard's name or a list of beats"
    if not beats:
        return f"storyboard holds no beats: a list holds 1 to {MAX_BEATS}"
    if len(beats) > MAX_BEATS:
        return (f"storyboard[{MAX_BEATS}] is one beat too many: a list holds "
                f"1 to {MAX_BEATS} beats")
    low, high = BEAT_SECS
    total = 0.0
    for i, fields in enumerate(beats):
        where = f"storyboard[{i}]"
        if not isinstance(fields, dict):
            return f"{where} must be an object with a beat's fields"
        extra = [str(name) for name in fields if name not in BEAT_FIELDS]
        if extra:
            return (f"{where} does not take {', '.join(extra)}; a beat's fields are "
                    + ", ".join(BEAT_FIELDS))
        secs = fields.get("secs")
        if not (_number(secs) and low <= secs <= high):
            return f"{where}.secs must be seconds, from {low:g} to {high:g}"
        total = round(total + secs, 6)
        if total > MAX_SECONDS:
            return (f"{where}.secs brings the storyboard to {total:g} seconds, past "
                    f"the {MAX_SECONDS:g} seconds a list may last")
        view = fields.get("view")
        if view is not None and view not in VIEWS:
            return f"{where}.view must be one of {', '.join(VIEWS)}, or null"
        if i == 0 and view is None:
            return f"{where}.view is missing: the first beat names the view frame 0 is in"
        labels = fields.get("labels")
        if labels is not None and not isinstance(labels, bool):
            return f"{where}.labels must be true, false or null"
        at = fields.get("at")
        if at is not None and not _clock(at):
            return f"{where}.at must be a clock, HH:MM, or null"
        speed = fields.get("speed")
        if speed is not None and not (_number(speed) and speed >= 0):
            return f"{where}.speed must be simulated seconds a second, 0 or more, or null"
        sweep = fields.get("sweep", False)
        if not isinstance(sweep, bool):
            return f"{where}.sweep must be true or false"
        hours = fields.get("hours")
        if hours is not None and not (_number(hours) and 0 < hours <= MAX_HOURS):
            return (f"{where}.hours must be more than 0 and at most {MAX_HOURS:g}, "
                    "or null")
        span = fields.get("span")
        if span is not None:
            if not (isinstance(span, list) and len(span) == 2 and all(_clock(c) for c in span)):
                return f"{where}.span must be two clocks, HH:MM, or null"
            if not _hms(span[0]) < _hms(span[1]):
                return f"{where}.span must run forward: {span[0]} is not before {span[1]}"
        tween = fields.get("tween")
        if tween is not None and not (_number(tween) and tween >= 0):
            return f"{where}.tween must be seconds, 0 or more, or null"
        if i == 0:
            if tween is not None and tween != 0:
                return (f"{where}.tween must be 0 or left out: frame 0 must already be in "
                        "a view, so the first beat cannot transition into one")
            if at is None and not (sweep and hours is None):
                return (f"{where}.at is missing: frame 0 is not reproducible without a "
                        "clock, so the first beat names one, unless it sweeps a span "
                        "rather than a number of hours")
    return None


def beat_payloads(beats: list) -> list:
    """The beats of a list as a plan carries them (the engine's `beat_payload`):
    the clock in seconds, a sweep's span as `lo` and `hi` unless it names hours,
    and a transition of min(secs, 1.2) where none was given."""
    out = []
    for i, b in enumerate(beats):
        hours, span, tween = b.get("hours"), b.get("span"), b.get("tween")
        if i == 0 and tween is None:
            tween = 0
        out.append({"secs": b["secs"], "view": b.get("view"), "labels": b.get("labels"),
                    "at": _hms(b["at"]) if b.get("at") else None, "speed": b.get("speed"),
                    "sweep": b.get("sweep", False), "hours": hours,
                    "lo": None if hours else (_hms(span[0]) if span else 0.0),
                    "hi": None if hours else (_hms(span[1]) if span else 86_400.0),
                    "tween": tween if tween is not None else min(b["secs"], 1.2)})
    return out


def caption_problem(caption) -> str | None:
    """The sentence the engine's handler refuses a caption with over the
    protocol (its `_caption`, in `serve.py`): one for not text, empty, over 80
    and a line break alike. `check_caption`'s three sentences are the command
    line's and are never reached here."""
    if (isinstance(caption, str) and 1 <= len(caption) <= CAPTION_MAX
            and not any(mark in caption for mark in LINE_BREAKS)):
        return None
    return f"caption must be text of 1 to {CAPTION_MAX} characters on one line"


def corner_problem(options: dict) -> str | None:
    """The handler's sentence for a corner the engine does not have."""
    asked = options.get("clock_corner")
    if asked is None or asked in CLOCK_CORNERS:
        return None
    return "clock_corner must be one of " + ", ".join(CLOCK_CORNERS)


def resolve_corner(preset: dict, options: dict, clock: bool) -> tuple[str, str, str | None]:
    """The corner the clock takes, a note for a person, and the refusal if there
    is one: the engine's `_clock_corner`, whose refusals are the plan's own, so
    they are export errors and not params ones. The corner is one the handler
    let through (`corner_problem`). Left out, it is bottom right, except on a
    preset with safe zones, where it is top right: the platform's own
    interface covers the bottom right there."""
    zone = ZONES.get(preset["name"])
    asked = options.get("clock_corner")
    corner = asked if asked is not None else ("top-right" if zone else DEFAULT_CORNER)
    if not clock:
        return corner, "", None
    platform = preset["platform"]
    if zone and corner == "bottom-right":
        what = "button rail" if zone[3] is not None else "bottom zone"
        return corner, "", (f"Choose another corner for the clock: on {preset['name']}, "
                            f"{platform}'s {what} covers the bottom right.")
    title, caption = options.get("title", True), bool(options.get("caption"))
    if corner == "top-left" and (title or caption):
        named = ("title and the caption sit" if title and caption
                 else "title sits" if title else "caption sits")
        return corner, "", f"Choose another corner for the clock: the {named} top left."
    if zone and corner == "bottom-left" and zone[1] is not None:
        return corner, (f"the clock sits bottom left, inside {platform}'s bottom zone (the "
                        f"lowest {zone[1]:.0%} of the frame), where {platform}'s own interface "
                        "can cover it; top right keeps it clear."), None
    return corner, "", None


def stage_date_problem(value) -> str | None:
    """The handler's refusals of render.stage's `date`: null is not the same as
    left out, and a day that fits the pattern may still not be on the calendar."""
    if value is None:
        return ("date must be the service day as YYYY-MM-DD, or left out for a "
                "description without minutes")
    if not isinstance(value, str) or re.match(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$", value) is None:
        return "date must be a calendar day as YYYY-MM-DD"
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return f"date: {value} is not a calendar day"
    return None


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


def error(msg_id, code: int, message: str, kind: str, detail: str | None = None) -> None:
    write({"jsonrpc": "2.0", "id": msg_id,
           "error": {"code": code, "message": message,
                     "data": {"kind": kind, "detail": detail or message, "hint": message}}})


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
        # Which build each stored layout is, by number, and each build in
        # flight: what it has reported, the counts it will store and its
        # number. render.stage draws a reported stage from the build, as
        # the engine draws from its scratch (E27, issue 382), and every
        # drawing names its build, so a test can tell a new build's from
        # the stored set's.
        self.layout_builds: dict = {}
        self.building: dict = {}
        # The presets not on disk at the start that a graph.build has since
        # downloaded whole (E36).
        self.downloaded: set = set()
        self.builds = 0
        self.child = None
        # The octi stage's children while they run, ended on shutdown or at
        # the end of input as the engine ends LOOM's, so no test leaves one.
        self.octi_children: set = set()
        # Their own lock, not the one write() holds, and a flag set under it
        # once shutting down begins, so a child started after that is ended
        # at once rather than outliving the stand-in.
        self.children_lock = threading.Lock()
        self.stopping = False
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
            self.end_children()
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
                # `style` and `lines` (engine v0.12.0) are taken and left alone:
                # the stand-in draws no map to restyle or hide a line from.
                # fake-engine.received keeps them, so a test reads what the
                # app sent.
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
                if not self.preset_on_disk(key):
                    # An inspection that reached the preset before the layout
                    # had downloaded it: the race the app holds its
                    # inspection back from (issue 178).
                    with open(HOME / "fake-engine.inspect-downloaded", "a") as out:
                        out.write(f"{key}\n")
                    self.downloaded.add(key)
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
            elif "date" in params and stage_date_problem(params["date"]) is not None:
                error(msg_id, -32602, stage_date_problem(params["date"]), "params")
            elif not isinstance(layout, str) or (layout not in self.layouts
                                                 and layout not in self.building):
                error(msg_id, -32000, f"{params.get('key', 'x')!r} has no stored {stage} graph; "
                      "lay the feed out first (graph.build)", "layout")
            elif self.control.get("stage_refuses"):
                error(msg_id, -32000, self.control["stage_refuses"], "engine")
            else:
                self.stage_answer(msg_id, params)
            return True
        if method == "feeds.list":
            write({"jsonrpc": "2.0", "id": msg_id, "result": {"feeds": self.feed_records()}})
            return True
        if method == "feeds.add":
            threading.Thread(target=self.replying, args=(msg_id, self.add, msg_id,
                                                         message.get("params") or {}),
                             daemon=True).start()
            return True
        if method == "feeds.remove":
            key = (message.get("params") or {}).get("key")
            if self.control.get("remove_stalls"):
                return True
            if self.control.get("remove_blocks_ms"):
                threading.Thread(target=self.replying,
                                 args=(msg_id, self.remove_job, msg_id, key),
                                 daemon=True).start()
            elif self.control.get("remove_delay_ms"):
                threading.Thread(target=self.replying,
                                 args=(msg_id, self.remove_feed, msg_id, key),
                                 daemon=True).start()
            else:
                self.replying(msg_id, self.remove_feed, msg_id, key)
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
                # The shape of the options is the caller's mistake (params,
                # -32602); what the plan itself refuses is an export error.
                kind, sentence = problem
                error(msg_id, -32602 if kind == "params" else -32000, sentence, kind)
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

    def octi(self, msg_id) -> bool:
        """The octi stage, when the control file asks for a child: start one, as
        the engine starts LOOM's tool, and wait for a cancel. A cancel ends the
        child before the answer, as the engine's cancel does, and says so in a
        file the test reads. True when the stage was cancelled, or when the
        stand-in had begun stopping and the child was ended at once."""
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(600)"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with self.children_lock:
            stopping = self.stopping
            if not stopping:
                self.octi_children.add(child)
        if stopping:
            child.kill()
            child.wait(timeout=10)
            return True
        try:
            (HOME / "fake-engine.octi.pid").write_text(str(child.pid))
        except OSError:
            pass
        deadline = time.monotonic() + self.control.get("octi_ms", 2000) / 1000
        try:
            while time.monotonic() < deadline:
                if msg_id in self.cancelled:
                    child.kill()
                    child.wait(timeout=10)
                    try:
                        (HOME / "fake-engine.octi-ended").write_text(str(child.pid))
                    except OSError:
                        pass
                    return True
                time.sleep(0.01)
            return False
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=10)
            with self.children_lock:
                self.octi_children.discard(child)

    def end_children(self) -> None:
        with self.children_lock:
            self.stopping = True
            children = list(self.octi_children)
        for child in children:
            if child.poll() is None:
                child.kill()

    def build(self, msg_id, params: dict) -> None:
        if self.control.get("silent"):
            return
        # The tuning is judged before any tool starts, as the engine judges
        # it (v0.14.0); its flags then name the layout with the rest.
        if "tuning" in params:
            problem = tuning_problem(params["tuning"])
            if problem is not None:
                error(msg_id, -32602, problem, "params")
                return
        flags = tuning_flags(params.get("tuning"))
        delay = self.control.get("progress_delay_ms", 30) / 1000
        # The lines follow the mode, so a narrower choice draws fewer: the
        # stand-in's feeds carry A (tram) and B (subway) for every key.
        mode = params.get("mode", FEEDS.get(params.get("key", "x"), {}).get("mode") or "all")
        for line in self.control.get("build_log_lines", []):
            write({"jsonrpc": "2.0", "method": "job/log",
                   "params": {"id": msg_id, "level": "info",
                              "line": line.replace("{home}", str(Path.home()))}})
        if not self.preset_download(msg_id, params.get("key", "x")):
            return
        lines = ["A", "B"] if mode == "all" else ["A"] if "tram" in mode else ["B"]
        summary = {"nodes": 3, "stations": 3, "junctions": 0, "edges": 2, "lines": lines}
        stages = {s: dict(summary) for s in ("gtfs2graph", "topo", "loom", "octi")}
        stages["octi"]["octilinear"] = 1.0
        key = params.get("key", "x")
        # The id names the inputs, as the real engine's does: the same feed
        # and options give the same id, so two projects on one feed share one.
        # A missing mode or agency is the registry entry's and an empty
        # agency is none, as the engine's resolved() reads them. It is known
        # before the first stage, which names it (engine v0.14.0).
        entry = FEEDS.get(key, {})
        agency = params.get("agency", entry.get("agency")) or None
        inputs = {"feed": key, "mode": mode, "agency": agency}
        # A tuned layout is a layout of its own; a tuning of nothing but
        # LOOM's defaults writes no flag and names the untuned layout's id.
        tuned = {tool: args for tool, args in flags.items() if args}
        if tuned:
            inputs["tuning"] = tuned
        layout = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
        builds = bool(params.get("force")) or layout not in self.layouts
        if builds:
            # A build of its own, readable stage by stage as it reports;
            # one already stored and not forced is read from the store, as
            # the engine replays it, and has none.
            self.building[layout] = {"reported": set(), "stages": stages,
                                     "build": self.builds + 1}
        try:
            self.lay_out(msg_id, key, mode, agency, layout, stages, builds, delay, flags)
        finally:
            # A cancel or a failure leaves nothing of the build to draw; a
            # build that answered is the store's by now.
            self.building.pop(layout, None)

    def lay_out(self, msg_id, key, mode, agency, layout, stages, builds, delay,
                flags) -> None:
        for i, stage in enumerate(("gtfs2graph", "topo", "loom", "octi"), start=1):
            if stage == "octi" and self.control.get("octi_child"):
                if self.octi(msg_id):
                    write({"jsonrpc": "2.0", "id": msg_id,
                           "error": {"code": -32800, "message": "Request Cancelled"}})
                    return
            else:
                time.sleep(delay)
            if msg_id in self.cancelled:
                write({"jsonrpc": "2.0", "id": msg_id,
                       "error": {"code": -32800, "message": "Request Cancelled"}})
                return
            write({"jsonrpc": "2.0", "method": "job/log",
                   "params": {"id": msg_id, "level": "info", "line": f"{stage}: running"}})
            if stage == "gtfs2graph" and mode in self.control.get("empty_modes", []):
                # The engine's own words (pipeline.require_edges at v0.8.2),
                # classified the way its serve.classify does: the hint is the
                # sentence, the detail the exception and where it was raised.
                hint = (f"{key}: the line graph is empty -- gtfs2graph -m {mode!r} "
                        "matched no routes. Check the feed's route_type values; agencies "
                        "disagree about which of tram/subway/rail their network is.")
                write({"jsonrpc": "2.0", "id": msg_id,
                       "error": {"code": -32000, "message": hint,
                                 "data": {"kind": "engine", "hint": hint,
                                          "detail": f"ValueError: {hint} (pipeline.py:403)"}}})
                return
            # Readable before it is reported, as the engine marks a stage
            # whole before its report goes out; the report names the layout.
            if builds:
                self.building[layout]["reported"].add(stage)
            write({"jsonrpc": "2.0", "method": "job/progress",
                   "params": {"id": msg_id, "stage": stage, "fraction": i / 4,
                              "message": f"{stage}: 3 nodes, 2 edges", "layout": layout}})
        if builds:
            self.builds += 1
            self.layouts[layout] = "2026-09-10T00:%02d:%02d+00:00" % divmod(self.builds, 60)
            self.layout_builds[layout] = self.builds
        self.layout_stages[layout] = stages
        self.building.pop(layout, None)
        paths = {s: str(HOME / "data" / "graphs" / key / layout / f"0{i}_{s}.json")
                 for i, s in enumerate(stages)}
        meta = {"feed": key, "feed_sha256": "0" * 64, "mode": mode,
                "agency": agency, "label_pattern": None, "label_strip": None,
                "loom": None, "stages": [["gtfs2graph", ["-m", mode]],
                                         ["topo", flags["topo"]], ["loom", flags["loom"]],
                                         ["octi", flags["octi"]]],
                "engine": self.control.get("version", "0.2.0"),
                "made": self.layouts[layout], "migrated": False}
        write({"jsonrpc": "2.0", "id": msg_id, "result": {
            "layout": layout, "meta": meta, "stages": stages, "paths": paths}})


    # Since engine v0.13.0 (issue 49) map.build answers `stations`: the stations
    # of the map it drew, each by the node id the page's `setTrip` takes and the
    # name the map writes, sorted by name as code points and then by id. The
    # stand-in's graph draws its three stations (the ones render.stage
    # describes). The ids are node addresses as LOOM writes them, and they are
    # listed here in neither the order of the names nor the order of the ids,
    # so an answer that was not sorted, or was sorted by the wrong key, would
    # show.
    MAP_STATIONS = (
        ("0x6000036f4c80", "Bravo"),
        ("0x6000036f4010", "Charlie"),
        ("0x6000036f4a40", "Alpha"),
    )

    @classmethod
    def map_stations(cls) -> list:
        """The `stations` of the map the stand-in draws. A line's `hidden` flag,
        like the rest of `lines`, is taken and not acted on: the stand-in has
        one line over all three, and draws no map to leave one out of."""
        return sorted(({"id": node, "name": name} for node, name in cls.MAP_STATIONS),
                      key=lambda station: (station["name"], station["id"]))

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
            report = {"id": msg_id, "stage": stage, "fraction": i / len(stages),
                      "message": message}
            # The four the map replays name the layout, as the engine's do
            # (v0.14.0); its own four name none.
            if i <= 4:
                report["layout"] = params["layout"]
            write({"jsonrpc": "2.0", "method": "job/progress", "params": report})
        files = {}
        for name, suffix in (("svg", ".svg"), ("html", ".html"),
                             ("positions", ".positions.json")):
            path = out / f"{key}{suffix}"
            path.write_text("<svg/>" if suffix == ".svg" else "{}")
            files[name] = str(path)
        # Since engine v0.11.0 (issue 51) a pair of small pictures of the map
        # is written into the same folder as the page, `<key>-thumb-dark.svg`
        # and `<key>-thumb-light.svg`, and both paths are required in `files`.
        # The stand-in draws one rectangle on each palette's ground; the
        # engine draws the network alone, with every colour a literal.
        for name, ground in (("thumb_dark", "#15120f"), ("thumb_light", "#f7efe1")):
            path = out / f"{key}-{name.replace('_', '-')}.svg"
            path.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">'
                            f'<rect width="400" height="250" fill="{ground}"/></svg>')
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
            "stations": self.map_stations(),
            "summary": "the stand-in drew a map",
            "diagnostics": diagnostics,
            # Since engine v0.8.0 (E05): the same numbers as sentences, and
            # the weighted proportion the atlas is ordered by. A clean
            # network answers no sentences and a score of zero.
            "caveats": list(self.control.get("map_caveats", [])),
            "issues": self.control.get("map_issues", 0)}})


    # -- render.stage (E15), in shape: an SVG naming the stage, and the
    # counts graph.build reported for the stage, which is what the engine
    # answers and what the app's real-engine test holds it to. Since engine
    # v0.12.0 (issue 54) it also answers a `description`, the fields the
    # geographic pane's text alternative is written from.

    STAGE_STATIONS = ("Alpha", "Bravo", "Charlie")

    @classmethod
    def stage_description(cls, lines: list, date) -> dict:
        """The stand-in graph in words' raw material: its three stations on one
        run, every line along the whole run, so each line has the same termini,
        each station is a meeting where there are two lines, and nothing
        branches. Timed only for a day: without `date` every trip and the
        extent are null, as the engine's are, and a line's trip is the minutes
        14, 11, 8 ... by label order from the first to the last station, so
        the extent is the first line's."""
        stations = list(cls.STAGE_STATIONS)
        labels = sorted(lines)
        described = []
        for i, label in enumerate(labels):
            others = [other for other in labels if other != label]
            described.append({
                "label": label, "termini": [stations[0], stations[-1]],
                "stations": stations,
                "meets": [{"station": s, "lines": others} for s in stations] if others else [],
                "branches": [],
                "trip": None if date is None else
                {"minutes": max(14 - 3 * i, 1), "from": stations[0], "to": stations[-1]}})
        timed = [(d["trip"]["minutes"], d) for d in described if d["trip"] is not None]
        extent = None
        if timed:
            minutes, line = max(timed, key=lambda t: t[0])
            extent = {"minutes": minutes, "line": line["label"], "from": line["trip"]["from"],
                      "to": line["trip"]["to"]}
        return {"extent": extent, "lines": described}

    def stage_answer(self, msg_id, params: dict) -> None:
        """render.stage's drawing, as the engine's _drawn_stage chooses it (E27,
        issue 43): from a build of the layout in flight once it has reported
        what the answer needs - the stage, octi too when a date asks for the
        minutes, and whatever `stage_waits_on` adds - and otherwise from the
        store. A layout that is building and not stored is refused as not
        yet, in the engine's sentence and shape; one being laid out again
        (force) is drawn from the store until its build has what is asked."""
        key = params.get("key", "x")
        layout = params["layout"]
        stage = params["stage"]
        date = params.get("date")
        width = params.get("width", 1200)
        needed = [stage] if date is None or stage == "octi" else [stage, "octi"]
        waits = self.control.get("stage_waits_on", {}).get(stage)
        if waits is not None and waits not in needed:
            needed.append(waits)
        building = self.building.get(layout)
        if building is not None:
            missing = next((s for s in needed if s not in building["reported"]), None)
            if missing is None:
                write({"jsonrpc": "2.0", "id": msg_id,
                       "result": self.stage_drawing(key, layout, stage, width, date,
                                                    building["stages"], building["build"])})
                return
            if layout not in self.layouts:
                hint = (f"{key!r} is still being laid out under layout {layout[:8]}, and the "
                        f"build has not reached its {missing} stage yet; ask again when "
                        "job/progress reports it")
                if missing != stage and missing == "octi" and date is not None:
                    hint += (f"; the minutes of a date are read from the {missing} stage, so "
                             f"leave date out to draw {stage} now")
                write({"jsonrpc": "2.0", "id": msg_id,
                       "error": {"code": -32000, "message": hint,
                                 "data": {"kind": "layout", "detail": hint, "hint": hint,
                                          "layout": layout, "stage": missing,
                                          "building": True}}})
                return
        write({"jsonrpc": "2.0", "id": msg_id,
               "result": self.stage_drawing(key, layout, stage, width, date,
                                            self.layout_stages.get(layout),
                                            self.layout_builds.get(layout))})

    def stage_drawing(self, key: str, layout: str, stage: str, width, date=None,
                      stages=None, build=None) -> dict:
        counts = (stages or {}).get(stage) or {
            "nodes": 3, "stations": 3, "junctions": 0, "edges": 2, "lines": ["A"]}
        lines = counts["lines"]
        height = round(float(width) * 0.6)
        # The build the drawing is of, where the stand-in knows it, as an
        # attribute: the stage's text is left as tests read it.
        built = "" if build is None else f' data-build="{build}"'
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg"{built} width="{width}" '
               f'height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" '
               f'fill="#eee"/><text x="20" y="40" font-size="24">{stage}: '
               f'{", ".join(lines)}</text></svg>')
        return {"layout": layout, "stage": stage, "svg": svg, "width": float(width),
                "height": float(height),
                "counts": {k: v for k, v in counts.items() if k != "octilinear"},
                "description": self.stage_description(lines, date)}

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

    @staticmethod
    def replying(msg_id, work, *args) -> None:
        """Run a request's work, and answer with an error if it raises, so a
        failure on a thread is a reply rather than a request never answered."""
        try:
            work(*args)
        except Exception as exc:  # noqa: BLE001 - any failure is the reply
            error(msg_id, -32603, f"the stand-in failed: {exc}", "engine")

    def remove_job(self, msg_id, key) -> None:
        """feeds.remove as the engine runs it since v0.11.0: a job. A built-in
        feed is refused, an unknown one too, at once. Then the removal takes
        remove_blocks_ms. Its point of no return, remove_commits_after_ms in,
        is the write of the registry without the feed: a cancel read before it
        is answered with the cancelled error and nothing has changed; one read
        after it is not honoured, the zip goes at the end, and the answer
        carries cancel_too_late. Without a cancel the answer is exactly
        {"ok": true}."""
        takes = self.control["remove_blocks_ms"] / 1000
        commits = min(self.control.get("remove_commits_after_ms",
                                       self.control["remove_blocks_ms"]) / 1000, takes)
        if key in FEEDS:
            error(msg_id, -32000, f"{key!r} is a built-in feed and cannot be removed", "feed")
            return
        if key not in self.user_feeds():
            error(msg_id, -32000, f"{key!r} is not a registered feed", "feed")
            return
        started = time.monotonic()
        while True:
            # Looked at last thing before the write, as the engine's commit is.
            if msg_id in self.cancelled:
                write({"jsonrpc": "2.0", "id": msg_id,
                       "error": {"code": -32800, "message": "Request Cancelled"}})
                return
            if time.monotonic() - started >= commits:
                break
            time.sleep(0.01)
        with FEEDS_LOCK:
            users = self.user_feeds()
            users.pop(key, None)
            self.write_user_feeds(users)
        time.sleep(max(0.0, takes - (time.monotonic() - started)))
        for path in (HOME / "data" / "feeds").glob(f"{key}.*zip"):
            path.unlink()
        answer = {"ok": True}
        if msg_id in self.cancelled:
            answer["cancel_too_late"] = True
        write({"jsonrpc": "2.0", "id": msg_id, "result": answer})

    def remove_feed(self, msg_id, key) -> None:
        """feeds.remove, in shape: a built-in feed is refused, an unknown one
        too, and a user feed is forgotten with its zip; after remove_delay_ms,
        so a test can act while the request is out. Since engine v0.11.0 the
        answer is FeedsRemoveResult, exactly {"ok": true} unless a cancel came
        too late for the registry's write to be undone; this path does not act
        on a cancel, so it never adds that field (remove_job does)."""
        time.sleep(self.control.get("remove_delay_ms", 0) / 1000)
        with FEEDS_LOCK:
            users = self.user_feeds()
            if key in FEEDS:
                error(msg_id, -32000, f"{key!r} is a built-in feed and cannot be removed", "feed")
                return
            if key not in users:
                error(msg_id, -32000, f"{key!r} is not a registered feed", "feed")
                return
            del users[key]
            self.write_user_feeds(users)
            for path in (HOME / "data" / "feeds").glob(f"{key}.*zip"):
                path.unlink()
        write({"jsonrpc": "2.0", "id": msg_id, "result": {"ok": True}})

    def user_feeds(self) -> dict:
        with FEEDS_LOCK:
            try:
                records = json.loads((HOME / "data" / "feeds" / "user-feeds.json").read_text())
            except (OSError, ValueError):
                return {}
        return {r["key"]: r for r in records}

    def write_user_feeds(self, records: dict) -> None:
        folder = HOME / "data" / "feeds"
        folder.mkdir(parents=True, exist_ok=True)
        with FEEDS_LOCK:
            staging = folder / "user-feeds.json.writing"
            staging.write_text(json.dumps(list(records.values()), indent=2))
            staging.replace(folder / "user-feeds.json")

    def preset_on_disk(self, key) -> bool:
        return (key not in FEEDS or key in self.control.get("presets_cached", list(FEEDS))
                or key in self.downloaded)

    def preset_download(self, msg_id, key) -> bool:
        """A preset not on disk, downloaded inside the request that needs it,
        as engine v0.10.0 does: ten reports of stage download, a cancel
        between them answered with -32800 and nothing kept, a refusal after
        the first. True when the request may go on."""
        if self.preset_on_disk(key):
            return True
        delay = self.control.get("preset_download_delay_ms", 20) / 1000
        total = 20480
        early = self.control.get("preset_download_fails_early")
        if early:
            write({"jsonrpc": "2.0", "id": msg_id,
                   "error": {"code": -32000, "message": early,
                             "data": {"kind": "feed", "hint": early,
                                      "detail": f"FeedError: {early} (feeds.py:582)"}}})
            return False
        for i in range(1, 11):
            time.sleep(delay)
            if msg_id in self.cancelled:
                write({"jsonrpc": "2.0", "id": msg_id,
                       "error": {"code": -32800, "message": "Request Cancelled"}})
                return False
            write({"jsonrpc": "2.0", "method": "job/progress",
                   "params": {"id": msg_id, "stage": "download", "fraction": i / 10,
                              "message": f"downloaded {i * 2048:,} of {total:,} bytes"}})
        refused = self.control.get("preset_download_refuses")
        if refused:
            write({"jsonrpc": "2.0", "id": msg_id,
                   "error": {"code": -32000, "message": refused,
                             "data": {"kind": "feed", "hint": refused,
                                      "detail": f"FeedError: {refused} (feeds.py:600)"}}})
            return False
        self.downloaded.add(key)
        return True

    def feed_records(self) -> list:
        cached = {k for k in FEEDS if self.preset_on_disk(k)}
        out = [dict(f, cached=k in cached) for k, f in FEEDS.items()]
        out += [dict(f, headways=f.get("headways", False),
                     cached=(HOME / "data" / "feeds" / f"{f['key']}.zip").exists())
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
                # The engine's own shape (v0.8.3, `serve.classify`): the
                # sentence as message and hint, and the detail the exception
                # line with where it was raised.
                sentence = self.control["add_refuses"]
                error(msg_id, -32000, sentence, "feed", f"FeedError: {sentence} (feeds.py:583)")
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
        with FEEDS_LOCK:
            users = self.user_feeds()
            if key in FEEDS or key in users:
                staging.unlink()
                error(msg_id, -32000, f"{key!r} is already a feed; choose another key", "feed")
                return
            staging.replace(folder / f"{key}.zip")
            record = {"key": key, "name": name, "city": "", "network": "", "url": url,
                      "mode": params.get("mode") or "all", "label_pattern": None,
                      "label_strip": None, "agency": params.get("agency"), "geographic": True,
                      "notes": [], "headways": False, "source": "user"}
            users[key] = record
            self.write_user_feeds(users)
        # The engine decides `headways` from the zip's frequencies.txt; a
        # stand-in feed has none, so it is false here.
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
    def plan_problem(params: dict) -> tuple[str, str] | None:
        """The real server's refusals, in shape, as (kind, sentence). In the
        engine's order: its handler first judges the options' shape (params),
        a list of beats on any preset, then refuses view and at beside a list
        on a video; then the plan refuses what it cannot take (export), here
        the clock's corner."""
        if not isinstance(params.get("key"), str) or not params["key"]:
            return "params", "key must be a feed key"
        if params.get("preset") not in PRESETS:
            return "params", "preset must be the name of an export preset; export.presets lists them"
        page = params.get("page")
        if page is not None and (not isinstance(page, str) or "://" not in page):
            return "params", "page must be the page's address, with its scheme"
        options = params.get("options") or {}
        if not isinstance(options, dict):
            return "params", "options must be an object"
        known = {"view", "labels", "title", "clock", "theme", "at", "lines", "storyboard",
                 "quality", "fade", "tag", "safe", "caption", "clock_corner"}
        extra = sorted(set(options) - known)
        if extra:
            return "params", f"export.plan options does not take {', '.join(extra)}"
        preset = PRESETS[params["preset"]]
        video = preset["kind"] == "video"
        board = options.get("storyboard")
        if isinstance(board, list):
            # The handler runs `authored_beats` on any list, before it looks at
            # the preset; a still then ignores a good one.
            problem = beats_problem(board)
            if problem is not None:
                return "params", problem
        elif board is not None and (not isinstance(board, str) or board not in STORYBOARDS):
            return "params", "storyboard must be the name of a storyboard; export.storyboards lists them"
        if options.get("caption") is not None:
            problem = caption_problem(options["caption"])
            if problem is not None:
                return "params", problem
        problem = corner_problem(options)
        if problem is not None:
            return "params", problem
        # Only a video's first beat is where it opens, so only there are a
        # view and a clock beside a list the caller's mistake.
        if video and isinstance(board, list) and (options.get("view") or options.get("at")):
            return "params", BESIDE_A_LIST
        # A vector preset is refused by the plan before its corner is judged.
        if preset["kind"] != "vector":
            problem = resolve_corner(preset, options, options.get("clock", video))[2]
            if problem is not None:
                return "export", problem
        return None

    @staticmethod
    def wants_geographic(params: dict) -> bool:
        options = params.get("options") or {}
        preset = PRESETS[params["preset"]]
        if (options.get("view") or preset["view"]) == "geographic":
            return True
        if preset["kind"] != "video":
            return False
        listed = options.get("storyboard")
        if isinstance(listed, list):
            return any(b.get("view") == "geographic" for b in listed)
        board = STORYBOARDS.get(listed or preset["storyboard"] or "")
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
        start time, the lines and the safe zones (A5-01), and since engine
        v0.12.0 the caption and the clock's corner, written after the rest and
        only where they say something (the corner only while the clock is on
        and off bottom right). A storyboard written as a list is the plan's
        `custom` one: its beats are the plan's, and its first beat is where
        the address opens, as in the engine."""
        from urllib.parse import urlencode

        key, name = params["key"], params["preset"]
        preset = PRESETS[name]
        page = params.get("page") or f"file:///maps/{key}.html"
        options = params.get("options") or {}
        theme = "dark" if options.get("theme", "dark") == "dark" else "light"
        video = preset["kind"] == "video"
        listed = video and isinstance(options.get("storyboard"), list)
        first = options["storyboard"][0] if listed else {}
        view = first.get("view") if listed else (options.get("view") or preset["view"])
        at = first.get("at") if listed else options.get("at")
        labels = options.get("labels", preset["labels"])
        title = options.get("title", True)
        clock = options.get("clock", video)
        caption = options.get("caption")
        corner, corner_note, _ = resolve_corner(preset, options, clock)
        query = {"present": "1", "view": view, "labels": "1" if labels else "0",
                 "title": "1" if title else "0", "clock": "1" if clock else "0",
                 "theme": "dark" if theme == "dark" else "sepia",
                 "frame": f"{preset['width']}:{preset['height']}",
                 "frametop": str(preset["frame_top"])}
        if at:
            query["at"] = at
        if options.get("lines"):
            query["lines"] = ",".join(options["lines"])
        if options.get("safe"):
            query["safe"] = "1"
        if caption:
            query["caption"] = caption
        if clock and corner != DEFAULT_CORNER:
            query["corner"] = corner
        # The preset's zones are on every address, preview and export alike; the
        # page lays its frame out from them and draws them only under `safe`.
        for param, value in zip(ZONE_PARAMS, ZONES.get(name, ())):
            if value is not None:
                query[param] = str(value)
        url = page + "?" + urlencode(query)
        quality = options.get("quality", "standard")
        tag = options.get("tag") or ""
        stem = (f"{key}-{name}" + (f"-{theme}" if theme != "dark" else "")
                + (f"-{tag}" if tag else ""))
        board = ("custom" if listed else (options.get("storyboard") or preset["storyboard"])
                 ) if video else ""
        pinned = None
        if not video:
            hms = [int(part) for part in (at or "07:00").split(":")]
            pinned = hms[0] * 3600 + hms[1] * 60 + (hms[2] if len(hms) > 2 else 0)
        elif listed and at:
            pinned = _hms(at)
        seconds = float(self.control.get("export_seconds", 1))
        if listed:
            beats = beat_payloads(options["storyboard"])
        else:
            beats = [] if not video else [
                {"secs": seconds, "view": view, "labels": None, "at": 8 * 3600, "speed": 120,
                 "sweep": False, "hours": None, "lo": None, "hi": None, "tween": 0}]
        return {"key": key, "preset": name, "mode": "video" if video else "still", "url": url,
                "width": max(1, preset["width"] // 2), "height": max(1, preset["height"] // 2),
                "scale": 1, "fps": preset["fps"], "format": preset["format"], "settle": 300,
                "beats": beats, "keep": quality != "standard", "crf": 26,
                "fade": float(options.get("fade", 0.0)), "stem": stem, "theme": theme,
                "view": view, "storyboard": board, "at": pinned,
                "notes": [corner_note] if corner_note else [],
                "caption": caption if caption else None, "clock_corner": corner,
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
        # Since engine v0.12.0 a person's own alt text goes into the sidecar
        # in place of the sentence the engine writes, trimmed and otherwise
        # as given; the engine refuses one that is not text, one over 1,000
        # code points and one that is blank, before any work.
        alt = (params.get("provenance") or {}).get("alt")
        if alt is not None:
            if not isinstance(alt, str):
                error(msg_id, -32602, "provenance.alt must be text", "params")
                return
            if len(alt) > ALT_MAX:
                error(msg_id, -32602, f"provenance.alt is {len(alt):,} characters; "
                      f"it may be at most {ALT_MAX:,}", "params")
                return
            alt = alt.strip()
            if not alt:
                error(msg_id, -32602, "provenance.alt is empty; omit it instead, and the "
                      "sidecar keeps the description the engine writes", "params")
                return
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
        # The engine's `_write_sidecar` fields, in its order, so a test that
        # reads a sidecar reads what the engine writes. One difference since
        # v0.10.1: the engine names a person's own feed without the secrets
        # in its address (`source`), and this stand-in has only presets,
        # whose public addresses the engine writes whole as well.
        meta = {"file": dest.name, "bytes": dest.stat().st_size, "feed": plan.get("key"),
                "city": feed.get("city"), "network": feed.get("network"),
                "preset": plan.get("preset"), "platform": preset.get("platform"),
                "size": (f"{preset['width']}x{preset['height']}" if preset.get("width")
                         else "native"),
                "view": (STORYBOARDS.get(board, {}).get("views") or plan.get("view")),
                "storyboard": board or None, "theme": plan.get("theme"),
                "alt": alt if alt is not None else f"The stand-in's {plan.get('key')} map.",
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
        stray = control["garbage"] if isinstance(control["garbage"], str) else "this is not a frame"
        OUT.write(stray.encode() + b"\n")
        OUT.flush()
    if control.get("ignore_sigterm") and os.name != "nt":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    engine = Engine(control)
    stream = sys.stdin.buffer
    while True:
        message = read_message(stream)
        if message is None:
            sys.stderr.write("fake engine: end of input\n")
            engine.end_children()
            return 0
        record(message)
        if not engine.handle(message):
            return 0


if __name__ == "__main__":
    sys.exit(main())
