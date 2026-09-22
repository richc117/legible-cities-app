# Legible Cities brand assets

The app icon is G2: two pairs of lines, one running straight through and one
crossing it and stepping down on two rounded bends, with round stations. The
ground is parchment `#f5e6c8`, the ink is `#2d241d`, and the lines are
vermilion `#d6402a`, cobalt `#2a5bb5`, saffron `#eb9a1c` and jade `#1d8757`.
The night ground is `#1a1410`, with slightly lighter line colours. The name
is set in the app's prose serif (Iowan Old Style or Palatino); the PNGs were
rasterised with TeX Gyre Pagella, an open Palatino design.

Below 128 px the stations are left out so the lines stay clear.

## Contents

| Folder | File | Size | Use |
| --- | --- | --- | --- |
| `icon/` | `legible-cities-icon.svg` | vector | Master, full bleed |
| | `legible-cities-icon-night.svg` | vector | Master, night ground |
| | `legible-cities-icon-macos.svg` | vector | Master on Apple's 824 px grid, with shadow |
| | `legible-cities-icon-small.svg` | vector | Master without stations, for 64 px and below |
| | `png/icon-N.png`, `png-night/icon-night-N.png` | 16 to 1024 | Every size, both grounds |
| `macos/` | `icon.icns` | 16 to 1024, @1x and @2x | App and disk-image volume icon |
| | `icon-1024.png` | 1024 | The padded macOS icon as a PNG |
| | `dmg-background.png`, `dmg-background@2x.png` | 660 × 400, 1320 × 800 | Disk-image window |
| `windows/` | `icon.ico` | 16, 20, 24, 32, 40, 48, 64, 128, 256 | App, installer and uninstaller icon |
| | `installer-sidebar.bmp`, `uninstaller-sidebar.bmp` | 164 × 314 | NSIS welcome and finish pages |
| | `installer-header.bmp` | 150 × 57 | NSIS page header |
| `linux/` | `icons/NxN.png` | 16 to 1024 | electron-builder's Linux icon folder |
| | `icon.svg` | vector | hicolor scalable icon |
| `web/` | `favicon.ico`, `favicon.svg` | 16, 32, 48 | Project site |
| | `apple-touch-icon.png` | 180 | iOS home screen; square, iOS rounds it |
| | `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | | Web app manifest |
| `social/` | `github-social-preview.png` | 1280 × 640 | Repository settings, Social preview |
| | `open-graph.png` | 1200 × 630 | `og:image` on the project site |
| | `readme-header.png`, `readme-header@2x.png` | 1280 × 320 | Top of the README |
| | `square-post.png` | 1080 × 1080 | Square posts |
| | `x-header.png` | 1500 × 500 | X profile header |
| | `linkedin-banner.png` | 1584 × 396 | LinkedIn page banner |

## Wiring into electron-builder

Wired (issue 140). `electron-builder.yml` names, per platform:

| Where | File |
| --- | --- |
| `mac.icon`, `dmg.icon` | `macos/icon.icns` |
| `dmg.background` | `macos/background.tiff` |
| `win.icon` and the three `nsis` icons | `windows/icon.ico` |

Two things are deliberately left out, and both need their own issue:

- **The three bitmaps** (`installer-sidebar.bmp`, `uninstaller-sidebar.bmp`,
  `installer-header.bmp`). NSIS draws them only on the assisted installer,
  and `oneClick: false` changes how a person installs, what
  `docs/acceptance.md` describes and what `.github/workflows/acceptance.yml`
  derives and exercises.
- **`linux/`**. There is no Linux target.

`dmg.window` is not set either: dmg-builder takes the window from the
background's own pixel size and ignores a window block whenever a
background is set, so the art is the size and `dmg.contents` are points
inside its 660 x 400.

The disk-image background is committed as a Retina TIFF so no runner needs
a rasteriser. Rebuild it on a Mac after changing either PNG:

```
tiffutil -cathidpicheck assets/brand/macos/dmg-background.png assets/brand/macos/dmg-background@2x.png -out assets/brand/macos/background.tiff
```
