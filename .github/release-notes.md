{{prerelease_note}}Legible Cities turns a public transit timetable (a GTFS feed) into a schematic map and a timetable-driven animation, and exports stills, reels and GIFs. This is **{{version}}**, a pre-alpha.

## Which file to download

| Your computer | Download |
|---|---|
| A Mac with Apple silicon (M1 or later), macOS 13 or later | `{{mac_arm64}}` |
| A Mac with an Intel processor, macOS 13 or later | `{{mac_x64}}` |
| A PC with Windows 10 or 11, 64-bit (x64) | `{{windows_x64}}` |

Not sure which Mac you have? Apple menu › About This Mac: a "Chip" line naming Apple M1, M2 or later is Apple silicon; a "Processor" line naming Intel is Intel.

`{{sums}}` holds the SHA-256 of every other file attached here.

## These installers are not signed

The Mac app is not signed with an Apple Developer ID or notarised, and the Windows installer is not signed. macOS will say it cannot verify the app, and Windows SmartScreen will say it protected your PC. **[The install guide]({{install_url}})** walks through opening the app anyway on each system, what the app writes and where, how to remove it completely, and how to report a problem.

## What is inside

| Component | Version | Licence |
|---|---|---|
| The engine, [legible-cities]({{engine_repo}}) | {{engine_tag}} | GPL-3.0-or-later |
| [LOOM]({{loom_repo}}), native binaries built from source | commit `{{loom_commit}}`; on Windows with the changes of [the Windows port]({{port_repo}}) at commit `{{port_commit}}` | GPL-3.0 |
| FFmpeg (`ffmpeg` and `ffprobe`), built from source with only what the export uses | {{ffmpeg_version}}, with x264 at commit `{{x264_commit}}`, and zlib {{zlib_version}} on Windows | GPL-3.0-or-later |
| Python, from python-build-standalone | {{python_version}} (release {{python_release}}) | PSF-2.0 |
| Electron | {{electron_version}} | MIT |

Every component and its licence is listed in `THIRD_PARTY_NOTICES.md`, which the app carries beside its own `LICENSE`.

## Source code

The app is free software under the GNU General Public License, version 3 or later. The engine, LOOM and this build of FFmpeg are under the GPL too, at the versions in the table above, and their Corresponding Source is attached here:

- **The app**: the "Source code" archives GitHub attaches to this Release, the repository at {{tag}} ({{app_source_url}}).
- **`{{ffmpeg_source}}`**: FFmpeg {{ffmpeg_version}}'s release tarball and its signature, x264 at its commit, zlib {{zlib_version}}'s release tarball and its signature, each as fetched and verified against the pins; the script that builds them, the pins and the vendor workflow; and `BUILD.txt` with every target's configure lines and the commit they came from.
- **`{{loom_source}}`**: LOOM at commit `{{loom_commit}}` with its submodules, the Windows port at commit `{{port_commit}}`, `scripts/loom-windows-patch.py`, which applies the port's changes to LOOM for the Windows build, the release tarballs and signatures of zlib {{loom_zlib_version}} and bzip2 {{loom_bzip2_version}}, which the Windows tools link statically, the pins and the vendor workflow, `BUILD.txt` saying how each target is built, and `TOOLCHAIN-win-x64.txt` naming the MSYS2 packages the Windows tools were linked with.
- **`{{engine_source}}`**: the engine at {{engine_tag}}, as installed into the bundled Python, with the script that installs it and `BUILD.txt` naming the commit.

Maps made with the app derive from each transit agency's published feed and remain subject to that agency's terms.
