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
  delete it, and **Reset engine data** removes it with every other project.
  Nothing in the record is written, not even the moment you opened it, so
  the later version finds it exactly as it left it.
- **The later version stored a few more settings of the project under the
  same version number.** The earlier version edits the project as usual, and
  keeps the settings it has no name for. When it saves the project it writes
  those back as it found them, so the later version still has them. The one
  exception is the notes a record keeps of how its map was laid out and
  drawn: when the earlier version lays the map out or draws it again, it
  writes those notes afresh, and anything the later version had put in them
  is replaced, because the notes would otherwise describe a map that has
  since been drawn again.

**A new choice for a setting an earlier version already has raises the
version number.** An earlier version keeps a setting it has no name for, but
it cannot keep a choice it has no name for in a setting it does know: a
preset, a storyboard or a map theme that it does not offer, for example. It
would read that setting as unset and write it back that way, and for the
export that can mean the whole export choice (the fields of an opening are
read one by one, and are lost one by one). So a later 1.x that lets a person
choose something new, or widens a range, in a setting the earlier version has
raises the version number, and the earlier version opens that project
read-only instead. A test holds this: it lists the choices a record can hold
today, and the shapes its values must have, and fails when one of them grows
until the number moves.

**The version number may move within 1.x.** That is allowed, because an
earlier 1.x then opens the project read-only and cannot damage it. It is the
reason the promise runs one way: a project that you open or change in a newer
1.x may be one that an older 1.x can only look at. Opening can be enough: a
newer 1.x with a newer engine draws an older map again when you open the
project, and that writes the record (see
[Updating from an earlier release](install.md#updating-from-an-earlier-release)).
It is not a break of the promise. A 1.x that cannot open a project made by an
earlier 1.x, or that damages one made by a later 1.x, would be.

## Your settings

This section says what happens today. It is not a promise.

The app keeps its own settings in a file called `settings.json`, in the
app's own data folder (the same page says where). It holds four things: the
engine data folder, the export folder, the interface's theme, and where the
app's window was left.

A version reads each of them on its own. A setting that is missing, or that
it cannot use, takes its default and the rest are kept. A file that is not
settings at all, such as one that is not valid JSON, starts the app with every
setting at its default.

A version also keeps only the settings it knows, and only the values it knows
for them. When an earlier version saves its settings, which it does when you
change one, when you move or resize its window and when you close it, if it
has moved, it writes what it knows and leaves the rest out. A setting that only a later
version has is therefore reset to its default the next time that later
version reads the file, and so is a value that only a later version has for a
setting both have, such as a new theme. If you go back and forth between
versions, expect to choose such a setting again.

## Your exports

Your stills, reels and GIFs are yours, and the app does not take them back.
They go into your export folder, or into the folder you gave a project of
its own, and there into a folder named for the project. No update removes or
changes them. Deleting a project does not remove its exports, and neither
does **Reset engine data**, which refuses to run while a folder you export to
is in its way. The folder is named for the project's name, cleaned to make a
folder name: a character a filesystem refuses becomes a hyphen, and a name
past 80 characters is cut. Two projects with the same name share a folder,
and so do two whose names differ only in what the cleaning removes. An export
whose file is already there replaces it.

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
