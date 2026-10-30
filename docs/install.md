# Installing Legible Cities

Legible Cities is a desktop app for macOS and Windows that turns a public
transit timetable (a GTFS feed) into a schematic map and an animation, and
exports stills, reels and GIFs. This page is for installing it from a
release. You do not need anything else: the app carries everything it runs.

The installers are **not signed**, and the app does not update itself. Your
computer will warn you before it opens the app the first time, and this page
shows you how to get past that warning on each system. To get a newer version,
download it from the Releases page and install it over the old one; your
projects and settings stay where they are.
[Updating from an earlier release](#updating-from-an-earlier-release) says
what is different the first time you open the new one.

- [What you need](#what-you-need)
- [Which file to download](#which-file-to-download)
- [Check the download (optional)](#check-the-download-optional)
- [Install on a Mac](#install-on-a-mac)
- [Install on Windows](#install-on-windows)
- [Updating from an earlier release](#updating-from-an-earlier-release)
- [What the app writes, and where](#what-the-app-writes-and-where)
- [Uninstall completely](#uninstall-completely)
- [Troubleshooting](#troubleshooting)
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

### Check who built it (optional)

A checksum shows that a file arrived whole, not who made it: whoever could
replace a file on the release could replace its line in `SHA256SUMS.txt`
too. So each installer and `SHA256SUMS.txt` also has a signed attestation,
kept by GitHub apart from the release, saying it was built by this
repository's build workflow from the release's tagged commit. Releases after
0.1.0 have one; 0.1.0 was published before it was added.

To check one, install the GitHub command-line tool from
[cli.github.com](https://cli.github.com), sign in with `gh auth login`, and
run this in the folder that holds the download, with the file's own name:

```
gh attestation verify Legible-Cities-<version>-mac-arm64.dmg --repo richc117/legible-cities-app
```

It says the verification succeeded, and names the repository and the
workflow that built the file, or it fails. If it fails, delete the file and
do not open it. Adding
`--signer-workflow richc117/legible-cities-app/.github/workflows/build.yml`
also requires that the build workflow itself made it. Checking
`SHA256SUMS.txt` the same way, and then each file against its line as
above, covers the source archives as well.

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

You do this once for each version you install. From then on that version
opens like any other app, from Applications, Launchpad or the Dock. To
install a newer version over an old one, quit the app first; on a Mac, choose
**Replace** when the Finder asks, because **Keep Both** leaves two copies.

If macOS says the app **is damaged and can't be opened**, see
[Troubleshooting](#macos-says-the-app-is-damaged-and-cant-be-opened).

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

## Updating from an earlier release

If you may go back to 0.1.0, quit the app and copy the engine's data folder
somewhere safe before you install the new version. It is the row in the
tables below that names it, which Settings shows as the **Engine data
folder**. The copy holds your projects as 0.1.0 left them. To go back, quit
the new version and remove it (step 2 of
[Uninstall completely](#uninstall-completely); removing the app leaves its
data where it is), install 0.1.0, and put the copy in place of the engine
data folder: move or delete that folder first rather than copying over it.
Anything you made in the new version is lost.

Install the new version over the old one, as the steps above say: quit the
app first, and on a Mac choose **Replace**. Your projects, feeds and
settings stay where [What the app writes, and where](#what-the-app-writes-and-where)
puts them. Four things are different the first time you open the new
version.

**A project with a map is redrawn once.** The first time you open a
project that has a map, the app draws that map again with the engine in the
new version, from the layout the project already stored. Nothing is laid out
again, so the layout does not move. The map on screen is replaced when the
redraw has finished, and the project's picture in the Library follows. A
project with no map yet is left alone. So is one that cell 02 or cell 03
says is out of date, for example a day you chose and have not drawn, or a
layout that was made again since the map was drawn: it stays as it was drawn
until you run it. If a redraw fails, cell 03 (Day) says
that the map could not be redrawn as the project opened, gives the engine's
reason, and the old map stays on screen. The redraw is tried again the next
time the project opens.

**Projects you open or change in the new version open read-only in 0.1.0.**
Each project is kept in a record that has a version number. The first
release, 0.1.0, reads version 1; the new version writes version 2, and
0.1.0 opens a record of a higher version read-only. Redrawing a project
writes its record, so every project with a map is version 2 once it has
opened and been redrawn, and so is any project you change. Going back to
0.1.0 then shows it marked read-only in the Library: 0.1.0 cannot change or
export it there, and can still delete it. A project with no map that you
open without changing anything, and one whose redraw failed, are still
version 1.

**The warnings come back.** The new installer is not signed either, so macOS
or Windows warns again, as it did the first time. Follow
[Install on a Mac](#install-on-a-mac) or
[Install on Windows](#install-on-windows) again; a Mac needs it once for
each version you install (see [After the first time](#after-the-first-time)).

**The engine is newer.** The engine inside the app draws the maps, and
0.1.0 carried engine v0.10.1; the release's notes name the one the new
version carries. A map that is redrawn is drawn as the newer engine draws
it, and the names on it, and how they are placed, may look different from
before. Exports are still stills, videos and GIFs, and the ones you made
before stay where they are.

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

The installer keeps no copy of itself. The release candidates up to
0.1.0-rc.3 did: about 160 MB in `%LOCALAPPDATA%\legible-cities-app-updater\`,
for an automatic updater the app does not have, and their uninstaller left
it behind. Installing a later version removes that folder, and so does
uninstalling a later version.

To open one of these folders, paste its path, such as `%APPDATA%\Legible
Cities`, into the address bar of File Explorer and press Enter.

### What Settings shows

**Settings**, from the button at the top right of the window, shows the
**Engine data folder** with its size and the **Export folder**; under
**Logs and diagnostics**, a button to **Open logs folder** and **Copy
diagnostics**; under **Versions**, the app's own version first and then the
engine's; and **Reset engine data**. Changing the engine data
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
   from them. It leaves anything else in that folder alone. If your export
   folder, or a project's own export folder, is inside one of those four, the
   reset refuses and says so; exports left there from an earlier choice are
   removed with it. It cannot be undone. Then quit the app.
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
     delete it too if it is still there. If
     `%LOCALAPPDATA%\legible-cities-app-updater\` is there, a release
     candidate up to 0.1.0-rc.3 left it: delete it as well.
   - If you chose your own engine data folder in Settings, it is not inside
     these folders: after step 1, delete it yourself if nothing else of yours
     is in it.
4. **Your exports** are yours and are not removed by any of this, unless
   some were left inside one of the four folders step 1 removes by an
   earlier choice of export folder (the reset refuses while the current one
   is there). Delete the `Legible Cities` folder on your desktop (inside
   OneDrive, if OneDrive backs up your desktop), or the export folder you
   chose, if you no longer want them.

## Troubleshooting

Each of these says what you see, what it means and what to do. Where a
sentence is set apart like this, it is the app's own, word for word.
If none of them fits, or the fix does not hold, [report it](#report-a-problem).

### macOS says the app "is damaged and can't be opened"

The download did not arrive intact. Move the app to the Trash, download the
`.dmg` again, and check it as described in
[Check the download](#check-the-download-optional). If it happens again,
[report it](#report-a-problem).

### The app says a bundled tool could not run

The app carries two tools it cannot work without: LOOM, which lays a map
out, and ffmpeg, which makes the exports. Each time it starts, it runs both
once. If one will not run, a window opens over the Library with a title
naming the tool or tools, one of these sentences for each, and a button to
**Copy diagnostics**, a button called **How to install** that opens this
page, and **OK**. The title is one of:

> LOOM will not run

> ffmpeg will not run

> LOOM and ffmpeg will not run

The sentences, and what each means:

> The bundled LOOM tools are missing, so maps cannot be laid out.

The LOOM files are not where the app looks for them: the install is damaged,
or something removed them.

> The bundled LOOM tools did not answer in time, so maps cannot be laid out.

They started and did not finish. If it comes back each time, report it.

> The bundled LOOM tools did not run, so maps cannot be laid out.

They could not start, stopped with an error or printed something unexpected.
Security software that blocks programs can cause this: see the next section.

> This installation is incomplete: the small feed the app checks LOOM with is missing, so the LOOM tools could not be checked and maps cannot be laid out.

A file the app uses to test LOOM is missing, so LOOM itself was not judged.
The install is damaged.

> The bundled ffmpeg is missing, so exports cannot be made.

> The bundled ffmpeg did not answer in time, so exports cannot be made.

> The bundled ffmpeg did not run, so exports cannot be made.

These mean the same for ffmpeg as the three sentences above mean for LOOM.

The Library still opens, and everything that does not need the tool that
failed still works: a missing LOOM stops laying out maps, a missing ffmpeg
stops exports. **Reinstalling the app usually puts it right**: quit it,
download the file for your computer again from the
[Releases page](https://github.com/richc117/legible-cities-app/releases)
and install it over the old one, as [Install on a Mac](#install-on-a-mac) or
[Install on Windows](#install-on-windows) says. Reinstalling does not touch
your projects. Settings keeps what the check found, under **Bundled tools**, after
you press **OK**, and **Copy diagnostics** includes it.

### Your antivirus quarantined ffmpeg or LOOM

Security software sometimes takes a program it does not know out of the
folder it is in. The tools it may take are `gtfs2graph`, `topo`, `loom` and
`octi` (the LOOM tools) and `ffmpeg` and `ffprobe`, each with `.exe` after its
name on Windows. The start-up check runs `gtfs2graph`, `ffmpeg` and `ffprobe`,
so if one of those is taken the app says, in the sentences above, that a tool
is missing or did not run. If one of the others is taken, the check passes,
and a layout or an export fails later instead: cell 02 (Process) or cell 06
(Export) says so, with the engine's reason, which may name the file.

The installers are not signed (see the start of this page), which makes a
flag more likely. If the download's checksum matched, a flag on these tools
is most likely a false alarm. In this order:

1. **Check the download** first, as
   [Check the download](#check-the-download-optional) and
   [Check who built it](#check-who-built-it-optional) say. If it does not
   match, delete it and do not open it.
2. **Allow that one detection.** Open your security software and find its
   list of quarantined or blocked items. On Windows with Microsoft Defender,
   that is **Windows Security**, then **Virus & threat protection**, then
   **Protection history**. Open the entry for the file and choose
   **Actions**, then **Allow on device**, which restores it and allows
   that detection. Allow the file, not the app's folder: that folder is
   one you can write to, and a folder exclusion would hide whatever else
   is put there. Then start Legible Cities again. If a file was removed and
   cannot be restored, reinstall the app.
3. **Submit the file** as a false positive. Microsoft takes submissions at
   [its file submission portal](https://www.microsoft.com/en-us/wdsi/filesubmission),
   and other vendors have a similar form.
4. **[Report it](#report-a-problem)** here too, saying which tool and which
   software, so that it is known.

### A feed will not download

A feed is downloaded from the address you gave. Laying out a map needs a
download first, and the app cannot make the agency's server answer.

- **The app refuses the address before it tries.** Two of its sentences are
  worth knowing:

  > Use an address that starts with http:// or https://.

  > Use an address on a public host; a feed cannot be fetched from this machine or its network.

  The first means what you typed does not start with `http://` or
  `https://`: paste the whole address. The second means the address names
  your own computer or a private network, such as `localhost` or an address
  that begins `192.168.`. The app downloads feeds from public servers only.
  If you have the feed as a zip file, add the file instead of its address.
  A name that looks public but turns out to point at a private address is
  not caught until the download: the engine refuses it then, in cell 01, in
  its own words.
- **Open the address in a web browser.** If the browser cannot download the
  zip either, the agency's server is down or the address has changed. Try
  later, or look for the feed's current address on the agency's website.
- **A proxy or a firewall.** On a network that reaches the internet through a
  proxy, or that blocks downloads of zip files, the browser may have the
  setting that the app lacks. Download the zip in the browser, then add the
  file in the app.
- **Read what cell 01 says.** The download is drawn in cell 01 (Data) of the
  project, with its progress and, when it stops, the engine's reason. When
  the feed did not download, cell 02 (Process) says:

  > Nothing was laid out: the feed did not download. Cell 01 says why.

  **Copy diagnostics** includes the engine's log.

### The engine is unavailable

The engine is the program that does the work behind the maps. If the app
cannot start it, the Library and the project say so with a reason, and
nothing that needs it works. In an installed app the reason is one of these
two:

> Reinstall the app. The bundled Python runtime is missing.

> Reinstall the app. The bundled engine could not be started.

Both mean the same thing for you: the engine's files are missing or will not
start. Do as the sentence says: reinstall the app, over the old one, as above.
If the same sentence comes back, [report it](#report-a-problem) with the
diagnostics and the engine's log, `engine.log`, named in the next section.

An engine that starts and then keeps failing is a different case. The app
starts it again by itself a few times, and when it gives up the Library
leads with this sentence, then the engine's last reason and how many times in
a row it failed:

> Press Try again to start the engine once more, or quit and open Legible Cities again.

Either begins the engine afresh; **Try again** is the button under the
sentence, beside **Copy diagnostics**. If it fails again,
report it with the diagnostics and `engine.log`.

### Where the logs are

The app writes two logs, `main.log` and `engine.log`. **Settings**, under
**Logs and diagnostics**, has a button, **Open logs folder**, that opens the
folder; the tables in
[What the app writes, and where](#what-the-app-writes-and-where) say where it
is on a [Mac](#on-a-mac) and on [Windows](#on-windows), for when the app
will not open at all. **Copy diagnostics**, beside it, copies the last lines
of both, with your home folder written as `~`; read it before you share it.

## Report a problem

1. In the app, open **Settings**. The app's version is under **Versions**,
   at the top. Under **Logs and diagnostics**, press **Copy diagnostics**.
   It copies the app's and the engine's versions, the result of the check the app
   runs on its bundled tools when it starts, the last lines of both logs, and
   the reports from the maps made in this session. Your home folder is
   written as `~`, and web addresses lose their query values, their
   fragments and any user name or password in them. Nothing is sent
   anywhere. A copy has to fit in an issue, so when the logs and reports
   are long, the oldest log lines and the reports of the projects you
   opened first in the session are left out, and a line under the heading
   says so.
2. Open a [bug report](https://github.com/richc117/legible-cities-app/issues/new?template=bug.yml)
   on the repository, say what you did and what happened, and paste the
   diagnostics into it. **Read what you paste first**, and remove anything
   you would rather not share, such as a feed address.
3. If the diagnostics say they were trimmed, press **Open logs folder** in
   Settings and drag `main.log` and `engine.log` into the report's **Log
   files** box. Read them first too.

If the app cannot open at all, say so in the report with your version of
macOS or Windows, and attach the logs from the folder in the tables above
instead.

A security problem goes to the maintainer privately, not into an issue:
see [`SECURITY.md`](../SECURITY.md).
