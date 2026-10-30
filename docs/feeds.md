# Finding a feed

Legible Cities draws a map from a transit agency's timetable. This page says
what that timetable is, where agencies publish it, and how to give it to the
app. You do not need it for the sample cities: they are in the Library
already, and pressing one starts a project.

- [What a feed is](#what-a-feed-is)
- [Where to find one](#where-to-find-one)
- [Giving the app a feed](#giving-the-app-a-feed)
- [If a feed will not load](#if-a-feed-will-not-load)

## What a feed is

A **feed** is a transit agency's timetable, published for anyone to use: its
stops, its routes, and the time every trip leaves every stop. The format is
called **GTFS** (the General Transit Feed Specification). A GTFS feed is
usually one zip file of plain text tables, and an agency usually publishes it
on its open-data page, or on the page of the city or region that pays for the
service.

The app draws from the feed alone. It does not need an account, and it does
not look anything else up.

## Where to find one

Start with the agency. Search the web for the agency's name and "open data" or
"developers", or look for a link called "GTFS" near the bottom of its website.
The page usually offers one zip, and sometimes also an address that always
serves the current one.

If you cannot find it that way, two sites may help:

- **[gtfs.org](https://gtfs.org)** is the format's own site, kept by
  MobilityData, the organisation that looks after the format.
- **[The Mobility Database](https://mobilitydatabase.org)** is a catalogue of
  feeds, also kept by MobilityData.

Check the terms the agency publishes the feed under before you use it for
anything beyond trying it out. Most open-data feeds say what is allowed on the
same page.

## Giving the app a feed

Press **New project** in the Library. The sheet's **Start from** choice has
three answers:

- **A sample city, or a feed you added.** The cities that come with the app,
  and any feed you have added before. Choose one in **Feed**.
- **A GTFS zip on this computer.** Download the zip from the agency in your
  browser, then press **Choose a zip** and pick the file.
- **A feed at an address.** Paste the feed's address into **Feed address**.
  It must start with `http://` or `https://`, and it should be the address of
  the zip itself, the one your browser would start downloading.

For a zip or an address, press **Add the feed**. The app downloads it and
checks its tables, and when the feed is in, **Name** is filled in and the
button reads **Create**. A feed you add stays in the Library under **Your
feeds**, even if you cancel before creating the project.

## If a feed will not load

The app says why in its own words, under the field that caused it. The
[install guide](install.md#a-feed-will-not-download) lists those sentences
and what each one means, and what to try when the address is right and the
download still stops.

A feed that downloads and is then refused is usually not a GTFS zip: the file
you saved may be a web page, or a zip of something else. Download it again
from the agency's own page, or look for the agency on the sites above.
