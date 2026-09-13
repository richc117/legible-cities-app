# Installing Legible Cities

Legible Cities is a desktop app for macOS and Windows that turns a public
transit timetable (a GTFS feed) into a schematic map and an animation, and
exports stills, reels and GIFs. This page is for installing it from a
release. You do not need anything else: the app carries everything it runs.

The app is **pre-alpha**, and its installers are **not signed** yet. Your
computer will warn you before it opens the app the first time, and this page
shows you how to get past that warning on each system.

- [What you need](#what-you-need)
- [Which file to download](#which-file-to-download)
- [Check the download (optional)](#check-the-download-optional)
- [Install on a Mac](#install-on-a-mac)
- [Install on Windows](#install-on-windows)
- [What the app writes, and where](#what-the-app-writes-and-where)
- [Uninstall completely](#uninstall-completely)
- [Report a problem](#report-a-problem)

## What you need

- **A Mac** with macOS 13 Ventura or later, Apple silicon or Intel; or
  **a PC** with Windows 10 or Windows 11, 64-bit (x64).
- About 1 GB of free disk space for the app, and more for the feeds you add
  and the maps and videos you make.
- An internet connection to download a feed from its web address. Laying
  out a map and exporting it happen on your computer.

## Which file to download

Open the release on the repository's
[Releases page](https://github.com/richc117/legible-cities-app/releases)
and download the file for your computer from its **Assets** list:

| Your computer | The file whose name ends in |
|---|---|
| A Mac with Apple silicon (M1, M2, M3 or later) | `-mac-arm64.dmg` |
| A Mac with an Intel processor | `-mac-x64.dmg` |
| A Windows PC | `-windows-x64-setup.exe` |

**Which Mac do you have?** Open the Apple menu in the top-left corner of
the screen and choose **About This Mac**. If the window shows a line called
**Chip** naming Apple M1, M2, M3 or later, you have Apple silicon. If it
shows a line called **Processor** naming Intel, you have an Intel Mac.

The other files on the release are the checksums (`SHA256SUMS.txt`) and the
source code of the app and of the free software it includes; you do not
need them to install.

## Check the download (optional)

`SHA256SUMS.txt` lists a SHA-256 checksum for every file the release was
published with. A file added to a release after it was published is not in
it; the release's notes give that file's checksum instead. If the checksum of
the file you downloaded matches its line, the file arrived exactly as it was
built.

- **Mac**: open Terminal (in Applications › Utilities), type `shasum -a 256 `
  with a space after it, drag the downloaded file onto the Terminal window,
  and press Return.
- **Windows**: open PowerShell from the Start menu, type `Get-FileHash `
  with a space after it, drag the downloaded file onto the window, and press
  Enter.

Compare the long string it prints with the file's line in `SHA256SUMS.txt`.
PowerShell prints it in capital letters and the file has small ones; that
difference does not matter, only the letters and digits do. If they
differ, delete the file and download it again.

## Install on a Mac

1. Open the `.dmg` file you downloaded. A window opens showing Legible
   Cities.
2. Drag **Legible Cities** into your **Applications** folder.
3. Eject the disk image: click the eject button beside it in the Finder's
   sidebar.
4. Open **Legible Cities** from your Applications folder.

The first time, macOS stops the app, because it is not signed with an Apple
Developer ID. What you do next depends on your version of macOS (Apple menu
› About This Mac shows it).

### macOS 15 Sequoia and later

1. When macOS says **"Legible Cities" Not Opened** and that Apple could not
   verify it is free of malware, click **Done**. Do not click Move to Trash.
2. Open **System Settings** from the Apple menu, and choose **Privacy &
   Security** in the sidebar.
3. Scroll down to the **Security** section. It says **"Legible Cities" was
   blocked to protect your Mac.** Click **Open Anyway** beside it. The
   button is there for about an hour after you tried to open the app; if you
   do not see it, open the app again and come back.
4. macOS asks once more. Click **Open Anyway**, and enter your password or
   use Touch ID if asked.

### macOS 13 Ventura and macOS 14 Sonoma

1. When macOS says the app cannot be opened because Apple cannot check it,
   click **OK**.
2. In the Finder, open your Applications folder and **Control-click**
   **Legible Cities** (or click it with two fingers on a trackpad), then
   choose **Open** from the menu.
3. macOS asks whether you are sure. Click **Open**.

The **Open Anyway** button in System Settings › Privacy & Security, as
described for macOS 15, works on these versions too.

### After the first time

You only do this once. From then on the app opens like any other, from
Applications, Launchpad or the Dock.

If macOS says the app **is damaged and can't be opened**, the download did
not arrive intact: move the app to the Trash, download the `.dmg` again, and
check it as described above. If it happens again, [report it](#report-a-problem).

## Install on Windows

1. Your browser may warn that the file is not commonly downloaded. In
   Microsoft Edge, open the downloads list, hover over the file, click the
   **…** button and choose **Keep**; if it asks again, click **Show more**
   and then **Keep anyway**. In other browsers, choose **Keep**.
2. Open the `-windows-x64-setup.exe` file you downloaded.
3. Windows shows a blue window saying **Windows protected your PC**,
   because the installer is not signed. Click **More info**, then click
   **Run anyway**. (The publisher is shown as "Unknown publisher".)
4. The installer runs without asking any questions. It installs Legible
   Cities for your Windows user account only, so it does not ask for an
   administrator's password, adds it to the Start menu and the desktop, and
   opens it when it has finished.

After that, open Legible Cities from the Start menu or the desktop
shortcut.

## What the app writes, and where

The app never writes inside its own installed files. Everything it keeps is
in the places below.

### On a Mac

| What | Where |
|---|---|
| The app itself | `/Applications/Legible Cities.app` |
| The app's own data: its settings (`settings.json`) and the embedded browser's own storage and caches | `~/Library/Application Support/Legible Cities/` |
| The engine's data: your projects, the feeds you added, stored layouts and the maps drawn from them | `~/Library/Application Support/Legible Cities/engine/`, unless you chose another folder in Settings |
| The logs: `main.log` and `engine.log`, each started afresh past 5 MB with one older copy kept (`.old.log`) | `~/Library/Logs/Legible Cities/` |
| Your exports, in a folder per project | `~/Desktop/Legible Cities/`, unless you chose another folder in Settings |
| macOS's own records of the app's preferences and windows, if present | `~/Library/Preferences/com.richardcaballero.legiblecities.plist` and `~/Library/Saved Application State/com.richardcaballero.legiblecities.savedState/` |

`~` is your home folder. To open a folder under `~/Library`, which the
Finder hides, choose **Go › Go to Folder…** in the Finder's menu bar and
type the path.

### On Windows

| What | Where |
|---|---|
| The app itself | usually `%LOCALAPPDATA%\Programs\legible-cities-app\` |
| The app's own data: its settings (`settings.json`) and the embedded browser's own storage and caches | `%APPDATA%\Legible Cities\` |
| The engine's data: your projects, the feeds you added, stored layouts and the maps drawn from them | `%APPDATA%\Legible Cities\engine\`, unless you chose another folder in Settings |
| The logs: `main.log` and `engine.log`, each started afresh past 5 MB with one older copy kept (`.old.log`) | `%APPDATA%\Legible Cities\logs\` |
| Your exports, in a folder per project | `Legible Cities` on your desktop, unless you chose another folder in Settings. That is `Desktop\Legible Cities\` in your user folder, or, if OneDrive backs up your desktop, the Desktop folder inside OneDrive |

To open one of these folders, paste its path, such as `%APPDATA%\Legible
Cities`, into the address bar of File Explorer and press Enter.

### What Settings shows

**Settings**, from the button at the top right of the window, shows the
**Engine data folder** with its size, the **Export folder**, a button to
**Open logs folder**, and **Reset engine data**. Changing the engine data
folder takes effect the next time the app starts; changing the export
folder takes effect at once.

## Uninstall completely

Removing the app does not remove what it wrote. To leave nothing behind,
do these in order.

1. **Reset the engine's data** (optional, but do it if you chose your own
   engine data folder). In the app, open **Settings** and press **Reset
   engine data**. It removes the four folders the app and the engine keep
   in the engine data folder, `projects`, `out`, `data` and `frames`: every
   project, every downloaded feed, every stored layout and everything drawn
   from them. It leaves anything else in that folder alone, and it does not
   touch your exports. It cannot be undone. Then quit the app.
2. **Remove the app.**
   - **Mac**: quit Legible Cities, then drag it from Applications to the
     Trash.
   - **Windows 11**: open **Settings › Apps › Installed apps**, find
     **Legible Cities**, click **…** and choose **Uninstall**.
   - **Windows 10**: open **Settings › Apps › Apps & features**, select
     **Legible Cities** and click **Uninstall**.
3. **Delete the folders it wrote**, from the tables above:
   - **Mac**: `~/Library/Application Support/Legible Cities/`,
     `~/Library/Logs/Legible Cities/`, and, if they are there,
     `~/Library/Preferences/com.richardcaballero.legiblecities.plist` and
     `~/Library/Saved Application State/com.richardcaballero.legiblecities.savedState/`.
     Then empty the Trash.
   - **Windows**: `%APPDATA%\Legible Cities\`. The uninstaller removes the
     app's own folder, usually `%LOCALAPPDATA%\Programs\legible-cities-app\`;
     delete it too if it is still there.
   - If you chose your own engine data folder in Settings, it is not inside
     these folders: after step 1, delete it yourself if nothing else of yours
     is in it.
4. **Your exports** are yours and are not removed by any of this. Delete
   the `Legible Cities` folder on your desktop (inside OneDrive, if OneDrive
   backs up your desktop), or the export folder you chose, if you no longer
   want them.

## Report a problem

1. In the app, open **Settings** and press **Copy diagnostics**. It copies
   the app's and the engine's versions, the result of the check the app
   runs on its bundled tools when it starts, the last lines of both logs, and
   the reports from the maps made in this session. Your home folder is
   written as `~`, and web addresses lose their query values, their
   fragments and any user name or password in them. Nothing is sent
   anywhere.
2. Open a [bug report](https://github.com/richc117/legible-cities-app/issues/new?template=bug.yml)
   on the repository, say what you did and what happened, and paste the
   diagnostics into it. **Read what you paste first**, and remove anything
   you would rather not share, such as a feed address.

If the app cannot open at all, say so in the report with your version of
macOS or Windows, and attach the logs from the folder in the tables above
instead.

A security problem goes to the maintainer privately, not into an issue:
see [`SECURITY.md`](../SECURITY.md).
