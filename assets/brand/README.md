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

Not wired yet. A sketch for `electron-builder.yml`:

```yaml
mac:
  icon: assets/brand/macos/icon.icns
dmg:
  icon: assets/brand/macos/icon.icns
  background: assets/brand/macos/background.tiff
  contents:
    - { x: 165, y: 200 }
    - { x: 495, y: 200, type: link, path: /Applications }
win:
  icon: assets/brand/windows/icon.ico
nsis:
  installerIcon: assets/brand/windows/icon.ico
  uninstallerIcon: assets/brand/windows/icon.ico
  installerHeaderIcon: assets/brand/windows/icon.ico
  # The three bitmaps below only appear with oneClick: false (the assisted installer).
  installerSidebar: assets/brand/windows/installer-sidebar.bmp
  uninstallerSidebar: assets/brand/windows/uninstaller-sidebar.bmp
  installerHeader: assets/brand/windows/installer-header.bmp
linux:
  icon: assets/brand/linux/icons
```

On a Mac, combine the two disk-image backgrounds into one Retina TIFF:

```
tiffutil -cathidpicheck assets/brand/macos/dmg-background.png assets/brand/macos/dmg-background@2x.png -out assets/brand/macos/background.tiff
```
