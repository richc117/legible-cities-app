# What 1.0 keeps

From 1.0 on, the version number of Legible Cities means something. Every
release that begins with 1 keeps the promise below, and a release that has
to break it is 2.0. Releases before 1.0 did not carry it, which is why
[Updating from an earlier release](install.md#updating-from-an-earlier-release)
has to say what is different the first time you open a new version.

The promise is short on purpose. It covers your projects, which is the work
you put into the app, and it says plainly what it does not cover, because a
promise the app cannot keep is worse than none.

- [Your projects](#your-projects)
- [Your settings](#your-settings)
- [Your exports](#your-exports)
- [Not promised](#not-promised)

## Your projects

The app keeps each project in a record: a file called `project.json` in the
project's own folder, inside the `projects` folder of the engine's data (see
[What the app writes, and where](install.md#what-the-app-writes-and-where)).
The record holds what you chose: the feed, the day, the style, the line
colours, names and order, and how the project exports. Every record carries
a version number.

**Every 1.x opens and edits the projects made by any earlier 1.x.** A
project you made in 1.0 opens in 1.4 and can be changed there. The same is
true of a project made by 0.1.0, which opens in 1.0.

**A project made by a later 1.x is never damaged by an earlier one.** There
are two ways it can be, and the app tells them apart by the record's version
number.

- **The later version stored it under a higher version number.** The earlier
  version opens it **read-only**: the Library marks it `read-only`, and the
  earlier version cannot change, rename, lay out or export it. It can still
  delete it. Nothing in the record is written, not even the moment you
  opened it, so the later version finds it exactly as it left it.
- **The later version stored a few more things under the same version
  number.** The earlier version edits the project as usual, and keeps what
  it does not know. When it saves the project it writes those things back as
  it found them, so the later version still has them. The one exception is
  the notes a record keeps of how its map was laid out and drawn: when the
  earlier version lays the map out or draws it again, it writes those notes
  afresh, and anything the later version had put in them is replaced, because
  the notes would otherwise describe a map that has since been drawn again.

**The version number may move within 1.x.** When a later 1.x stores
something that an earlier 1.x could not keep safely, it raises the number,
and from then on the earlier one opens that project read-only, as above.
That is the reason the promise runs one way: a project that you change in a
newer 1.x may be one that an older 1.x can only look at, and that is how it
avoids damaging it. It is not a break of the promise. A 1.x that cannot open
a project made by an earlier 1.x, or that damages one made by a later 1.x,
would be.

## Your settings

This section says what happens today. It is not a promise.

The app keeps its own settings in a file called `settings.json`, in the
app's own data folder (the same page says where). It holds four things: the
engine data folder, the export folder, the interface's theme, and where the
app's window was left.

A version reads each of them on its own. A setting that is missing, or that
it cannot use, takes its default and the rest are kept, so a file that was
edited by hand or half written still starts the app.

A version also keeps only the settings it knows. When an earlier version
saves its settings, which it does when you change one and when you move or
resize its window, it writes the settings it knows and leaves the rest out.
A setting that only a later version has is therefore reset to its default
the next time that later version reads the file. If you go back and forth
between versions, expect to choose such a setting again.

## Your exports

Your stills, reels and GIFs are yours, and the app does not take them back.
They go into your export folder, in a folder for each project, and no update
removes or changes them. Deleting a project does not remove its exports, and
neither does **Reset engine data**, which refuses to run while a folder you
export to is in its way. An export made again under the same name replaces the earlier one.

What is not promised is what the files are called, and the small `.json`
file that is written beside each export. The engine writes both, so they can
change when the engine does. A new version can name a file differently, or
say more in the file beside it, than an earlier one did.

## Not promised

- **How a map looks.** The engine inside the app draws it, and a new version
  may carry a newer engine. A map that is drawn again can have its names, and
  how they are placed, different from before.
- **The engine and how the app talks to it.** They belong to the app and
  change from one release to the next.
- **The names of exported files, and the file beside each.** The engine
  writes them, as above.
- **The app's internal folders.** What is inside the engine data folder and
  the app's own data folder, other than the records and the settings file
  described above, is the app's business, and its layout may change.
- **Your settings**, as above: they are described, not promised.
