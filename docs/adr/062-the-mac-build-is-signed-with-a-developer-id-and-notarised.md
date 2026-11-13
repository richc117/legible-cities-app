# ADR-062: The Mac build is signed with a Developer ID and notarised

- **Status:** Proposed; it becomes Accepted when a signed candidate has passed
  what "What must be shown first" lists
- **Date:** 2026-11-12
- **Decided by:** the maintainer (issue 686)
- **Supersedes:** [ADR-054](054-1-0-ships-unsigned-with-no-automatic-update.md),
  in part: the Mac's signature. Its "no automatic update" stands, and so
  does the unsigned Windows installer
- **Superseded by:** none
- **See also:** [ADR-037](037-the-first-release-is-unsigned.md), whose checks
  before signing are answered here;
  [ADR-043](043-electrons-ffmpeg-source-is-attached-to-every-release.md),
  whose entitlement is kept

## Context

ADR-054 kept 1.0 unsigned on both systems and named what would reopen it,
among them a change in what a developer membership is worth to the
maintainer. There is now an Apple Developer Program membership (issue 686),
so the Mac build can carry a Developer ID signature and be notarised.
Nothing has changed for Windows: there is no certificate for it.

**What a person meets today.** The Mac app is signed ad hoc
(`electron-builder.yml`, `identity: '-'`). macOS refuses to open it, and a
person gets past that only with `docs/install.md`: on macOS 15 and later,
Done and then **Open Anyway** in System Settings; on 13 and 14,
Control-click and Open (ADR-037, ADR-054). A notarised Developer ID build
opens with the one confirmation macOS gives anything downloaded from the
internet.

**What the build already is.** The ad-hoc build is signed by
electron-builder with the hardened runtime and its three template
entitlements (`com.apple.security.cs.allow-jit`,
`com.apple.security.cs.allow-unsigned-executable-memory`,
`com.apple.security.cs.disable-library-validation`) on the app and on every
nested executable, the bundled Python, the LOOM tools, ffmpeg and ffprobe
among them. The acceptance run passes against it, and nothing is written
inside the bundle (ADR-035), so a signature stays whole. ADR-037 listed
"the Python runtime's entitlements under the hardened runtime" as unknown
until a notarised build is launched. The runtime already runs under the
hardened runtime with those three, in every build and in the acceptance
run, so there is no entitlement left to find, only the notary's own verdict
to obtain.

**What the packager does**, read from the installed sources
(electron-builder, app-builder-lib and dmg-builder 26.18.0,
`@electron/osx-sign` 1.3.3, `@electron/notarize` 2.5.0):

- `mac.identity` is matched as a substring of the names of the keychain's
  valid identities, a "Developer ID Application" certificate first. With
  `forceCodeSigning`, which the base config has always set, no match fails
  the build. `-` is the ad-hoc identity and needs no certificate.
- With `CSC_LINK` and `CSC_KEY_PASSWORD` in its environment electron-builder
  imports the certificate into a temporary keychain of its own and signs
  from that. An **empty** `CSC_LINK` is not read as absent: it is read as a
  certificate to load, and fails.
- `@electron/osx-sign` runs `codesign` once for every file its detector
  calls binary, and `mac.signIgnore` takes patterns of paths to leave out.
  In a darwin-arm64 tree of the vendored components (an earlier pin's,
  measured for this record) the detector flags 1,706 files, and 1,593 of
  them are `.pyc`.
- electron-builder's own notarisation is of the app, never of the disk
  image, and runs inside the packaging call whenever any of its `APPLE_`
  variables is set and `mac.notarize` is not `false`, whatever the identity.
  It waits for the notary with no time limit, and it staples the app.
  dmg-builder neither notarises nor staples.
- `dmg.sign: true` signs the disk image with the same identity, by
  `codesign --sign` with no `--timestamp` argument.

**What Apple asks.** The notary is given the outermost container a person
downloads; the ticket is stapled to what is distributed; and the code
inside must be signed with a Developer ID certificate and a secure
timestamp, its executables with the hardened runtime.

## Options

**Stay ad hoc**, as ADR-054 decided. No secret in CI; every person on a Mac
is walked past a refusal.

**Let electron-builder do all of it**: a Team ID as the identity,
`notarize: true`, the notary's key in electron-builder's variables. One
config and no script. It notarises the app and leaves the disk image, the
file a person downloads, neither notarised nor stapled; its wait has no
limit; and the notary's key sits in the environment of the step that runs
npm's code and the packager's hooks.

**Sign by hand**: a keychain made in the workflow and `codesign` over every
Mach-O in a script of our own. Full control of every flag. It replaces a
signer that every branch build already exercises with one that would run
only in a release, where a mistake is found last.

**electron-builder signs; one script notarises the disk image, in a job of
its own; each job's secrets sit behind a protected environment of its own;
a repository variable switches it all on.** Chosen, below.

**Sign Windows as well.** Not available: there is no certificate, and
ADR-037's note on the signing service's eligibility is unanswered.

## Decision

**Signing stays electron-builder's.** `electron-builder.yml` stays ad hoc,
so every branch and pull-request build, and `npm run dist`, is what it was.
A second file, `electron-builder.release.yml`, extends it and sets three
keys and nothing else: `mac.identity`, the Developer ID Team ID (ten
characters, public, quoted so that an all-digit one stays a string);
`mac.notarize: false`; and `dmg.sign: true`. The values live in a file
because `-c.` overrides on the command line would read an all-digit
identity as a number and `true` as a string. The signed build is therefore
the build every branch tested, under another identity.

**Bytecode is sealed as a resource, not signed.** The base config gains
`mac.signIgnore: '\.pyc$'`. A `.pyc` is data: the bundle's signature covers
it as it covers every other resource, so one changed after signing breaks
the seal as before, and ADR-035's unchecked-hash bytecode is still never
rewritten. What goes is a `codesign` call per file, each of which would ask
Apple's timestamp server under a Developer ID. This is the one change the
ad-hoc build sees.

**The entitlements do not change, and no entitlements file is added.**
ADR-043 asked that signing keep
`com.apple.security.cs.disable-library-validation`, or say how a person
replaces Electron's FFmpeg library: the LGPL asks that a person can use a
modified `libffmpeg.dylib`, a replaced library is not signed by this team,
and ADR-043 found that an app re-signed ad hoc after the replacement
(`codesign --force --deep --sign -`) runs only while library validation
stays disabled. It is kept, which is the first of ADR-043's two answers and
needs nothing new written for a person. The same entitlement is what
electron-builder says an ad-hoc build under the hardened runtime needs in
order to load its own libraries, so both builds carry it for a reason.
`scripts/verify-mac-signing.mjs` holds the app and the bundled Python to it
in every build, signed or not.

**Notarisation is one script, on the disk image only.**
`scripts/notarize-dmg.mjs` submits the image
(`xcrun notarytool submit --wait --timeout 60m`), always fetches the
notary's log, goes on only if the status is `Accepted` and the log holds no
error, staples the ticket to the image and validates it. notarytool exits 0
for a submission the notary rejected, so the exit status is never the
verdict. The image is the outermost thing a person downloads, which is what
the notary is given; its ticket covers the app inside, which macOS looks up
when the app is opened. The app is not stapled: it is not distributed on
its own, and stapling it would change the bundle after the image was built
from it. electron-builder's notarisation is off because it does none of
this for an image and has no time limit.

**Signing mode is switched by a repository variable.** A run signs when
the variable `MAC_SIGNING` is `on` and the run is a pushed `v*` tag or a
dispatch with `sign` ticked; within it, the Mac targets sign. With the
variable off or unset a `v*` tag builds ad hoc exactly as it did before,
and its Release is drafted from those installers, so a candidate can be cut
before the certificate, the environments or the notary's key exist, and
tagging is never coupled to Apple by the tag alone. A dispatch that ticks
`sign` while the variable is off is refused in its first minute, since it
asked for something that would not happen. The condition is one
expression, written wherever a job needs it and held to the same text by a
unit test.

**Two jobs, two environments, each holding one half of the secrets.** In
signing mode each job is in an environment of its own, and in no
environment otherwise: for every other run their `environment` expression
is the empty string.

- **`package` is in `release-signing`, which holds the certificate and
  nothing else.** electron-builder signs, so the certificate and its
  password are given to electron-builder, under its own variable names,
  inside the signing branch of the packaging step's shell and nowhere else
  (never at the step: an empty `CSC_LINK` fails every Mac build). Plainly:
  that step runs npm's code, the packager, everything it depends on and
  this repository's `afterPack` hook, and all of it runs with the
  certificate in its environment. That exposure is what "signing stays
  electron-builder's" costs, and it is accepted. The job uploads the signed
  image as `unnotarised-<target>`, never as the installer.
- **`notarize` is in `release-notarize`, which holds the notary's key and
  nothing else, and which no other job joins.** It runs on a fresh runner,
  checks out the two scripts and the release config and nothing else,
  installs nothing and runs no npm code; the scripts import nothing but
  Node's own modules. It downloads the signed image, which it never runs,
  into a folder of its own and never over the checkout, and refuses the
  download, before the key exists, unless it is exactly one disk image and
  its target's manifest, both plain files: the artefact is the one thing
  here that a runner which ran npm's code made, and a file in it named
  like one of this job's scripts would otherwise have replaced the script.
  It then turns Gatekeeper's assessments on if the runner came with them
  off, notarises and staples, checks the result with the `dmg` mode, and
  uploads it as `installer-<target>`. The key is written to a file readable by the
  runner's user alone, in the notarising step alone, and removed when that
  step's shell exits normally or fails; on a cancelled or timed-out step
  the hosted runner is discarded with the file.

A later step of the packaging job would not have done: being later in a job
is not isolation. An earlier step can leave a `PATH` entry or a `BASH_ENV`
behind through the runner's own files, or a process that waits, and a later
step meets them. Another runner has none of them.

One environment for both jobs would not have done either. A job in an
environment is entitled to every secret in it, and what keeps one from the
job is then only that the job does not name it. GitHub's documentation
says secrets "not referenced in the workflow" are scrubbed from a runner's
memory, which is said of the workflow and not of the job, and a hosted
runner's own user has root. With two environments the question does not
arise: a job cannot be handed a secret of an environment it is not in. The
notary's key is out of the packaging job's reach, and the certificate out
of the notarising job's, by where each is kept.

**Why environments.** The five secrets (the certificate and its password
in one; the notary's key, its id and its issuer in the other) are
environments', not the repository's, for three reasons: a deployment rule
limits which refs can reach them at all (tags that start with `v`, and
`main`), the same rule on both; a required reviewer has to approve each
job that asks, so a workflow changed on a branch cannot take them by
running; and a job outside an environment is handed nothing of it, where a
repository secret would be handed to any job of any branch that named it.

**The stapled image is what every later job sees.** The release job needs
the notarising jobs and takes `installer-<target>` as it always did, which
in signing mode only the notarising job uploads, so it checksums, and the
attest and verify jobs attest and verify, the final bytes. It drafts only
if the notarising jobs succeeded, or were skipped because the variable is
off; skipped for any other reason, or failed, it drafts nothing.

**What checks it.** `scripts/verify-mac-signing.mjs` has three modes:
`adhoc`, which every unsigned build passes through; `developer-id`, for the
signed app before it is notarised; and `dmg`, for the notarised image and
the app inside it. `acceptance.yml`'s step 2 runs the Developer ID checks
on a Release's own download, and fails on any of them, when the tag carries
the release config and the image is signed. The tag cannot say whether the
variable was on when it was pushed; the image can, because only the
Developer ID build signs the disk image itself and the notarising job
refuses to hand on one that is not. An unsigned image is recorded as the
ad-hoc build it is. What macOS shows a person at the first open stays "not
automated": a runner's download is not quarantined.

**No automatic update, still.** ADR-054's decision on updates is not
touched, and the constitution's principle IV (no update pings) would have
to change first. A signed Mac build could be served by an updater; none is
added.

**Windows stays unsigned, and is called a beta until it has a
certificate.** Its installer is as ADR-054 describes it, SmartScreen's
warning included. Calling it a beta says plainly that one of the two
systems opens with a warning the other no longer has; the wording itself
is issue 687's.

## Consequences

**A person on a Mac gets one confirmation instead of a refusal**, once
this is Accepted and a Release is built this way. `docs/install.md`, the
release notes, the acceptance documents and ADR-037's and ADR-043's
descriptions of the Mac build still say ad hoc; they change with issue 687,
after a rehearsal has shown this works, and not before.

**CI holds secrets for the first time.** ADR-037 and ADR-054 counted "no
secrets in CI" among what staying unsigned bought. What stands in for it is
the two environments, each with its rule and its reviewer, the two jobs
above, and the unit tests that hold `build.yml` to them: ten references to
a secret in all, in four named steps of two jobs and in no job's own `env`;
each half named only by the one job that joins its environment; no
variable of electron-builder's set at a step; one condition wherever
signing is decided; and a notarising job with three files, no install and
no npm. The Team ID is public and committed; nothing else about the
account is in the repository.

**The certificate is within reach of npm's code, in one step of signing
runs, and the notary's key is not.** A dependency of the packager that
turned hostile could read the certificate where the packager is given it;
that is the accepted cost of the first decision. A certificate taken that
way signs; it does not notarise, which takes the notary's key, and macOS
stops a downloaded app that is signed and not notarised.

The key it could not take, and that rests on two things together, neither
enough alone. The packaging job is never in `release-notarize`, so GitHub
has nothing of that environment to hand its runner, in a step's
environment or in the runner's memory, whatever the job names and whatever
the runner's user can read. And the one thing that passes from the
packaging job to the notarising job, the artefact, cannot carry code into
it: it is unpacked into a folder of its own, not over the checkout, and
is refused before the key is written unless it holds exactly one disk
image and its target's manifest, both plain files, with no link and no
third file; and the workspace is then held to the checkout, at this
run's commit with its files as committed and nothing beside them, in case
anything landed outside that folder and inside the workspace. The rest of
the runner, outside both, rests on the download action's own guard against
an archive that names a path outside the folder it is unpacked into.
Without that second half the first would not hold: a packaging step that
had turned hostile could ship a file named like one of the notarising
job's scripts, or like the config it reads the team from, and have it run,
or trusted, with the key in hand. The reverse of the first half holds as
well: the notarising job is never in `release-signing`, and cannot sign.

**What is not stopped, and is accepted.** A packaging step that has turned
hostile decides which bytes go into `unnotarised-<target>`, and the
notarising job will notarise whatever image signed by this team it is
given that Apple's scan accepts. The two environments stop the key being
stolen and used outside this pipeline; they do not stop a notarised
hostile build coming out of a run whose packaging step is compromised.
The defence there is not in this record's machinery. It is the hygiene
that keeps the packaging step's code what it is meant to be, the lockfile
`npm ci` installs from, Dependabot and the weekly vulnerability watch
(`SECURITY.md`), and the attestation, which ties each installer to the
one workflow run that made it (ADR-057), so that a run found to be
compromised names exactly what it built.

**The variable is turned on last.** `MAC_SIGNING` goes to `on` only once
both environments exist, each with the deployment rule (`v*` tags and
`main`) and its required reviewer; `release-signing` holds the two
certificate secrets and `release-notarize` the three of the notary; and
the Team ID is in `electron-builder.release.yml`. Turned on earlier, the
first signing run would have GitHub create an environment itself, with no
rule and no reviewer, and then fail for want of secrets.
`docs/repository-settings.md` has the list, in that order. Until then
every tag is what it was, and the release procedure does not change.

**A signing run asks the reviewer twice**: once for the two packaging
jobs, to enter `release-signing`, and once more, when they are done, for
the two notarising jobs, to enter `release-notarize`. `docs/releasing.md`
says where in a release that falls.

**A release depends on Apple's notary only while the variable is on.** An
outage or a slow day then holds a release where nothing did. The script's
worst case is 84 minutes (70 for the submission, of which notarytool waits
60; three tries each of the log and the staple; the validation), its step
is given 90, the check after it 80 against its own 77, and the job 180;
past that the run fails and is run again. The notary's log is uploaded as
an artefact whatever the outcome. Turning the variable off is the way to
cut a release without Apple, ad hoc, and say so.

**The signing path runs only in signing mode.** A dependency bump that
breaks signing is green on its own branch and red at the next tag. A
dispatch with `sign` after a bump of Electron or electron-builder is the
check; it needs the reviewer's approval, by design.

**Replacing Electron's FFmpeg in a notarised app** is as ADR-043 describes
it for the ad-hoc one: the replacement breaks the seal, and the person
re-signs the app ad hoc, with library validation still disabled. The copy
is then theirs: no longer this team's, no longer notarised, and opened on
their own Mac as any locally signed app is. That the re-signed app starts
is still unchecked, as ADR-043 says.

**The certificate will expire.** A signature with a secure timestamp
outlives its certificate, which is one reason the timestamp is checked. A
new certificate is a new pair of secrets in `release-signing`; nothing in
the repository changes unless the team does.

## What must be shown first

The design rests on six things that reading the sources did not settle.
Each is named with what shows it; this record stays Proposed until all six
are shown and a signed candidate has passed the acceptance run.

1. **A job whose `environment` evaluates to the empty string is in no
   environment**: no deployment is recorded and no approval asked, for a
   packaging job that runs and for a notarising job that is skipped. Shown
   by a branch build with no secrets. If it is not so, signing moves to a
   second packaging job that names the environment outright.
2. **A bundle whose `.pyc` files are not signed one by one passes
   `codesign --verify --deep --strict` and launches.** Shown by the same
   branch build: its launch and verify steps.
3. **The notary accepts the bundle.** Shown by the notary's log in a
   dispatch with `sign`.
4. **The notary's credentials can be an App Store Connect API key.** If
   they cannot, notarytool also takes an Apple ID with an app-specific
   password and the Team ID, which changes the script's three variables and
   nothing else.
5. **The disk image's signature carries a secure timestamp**, though
   `dmg.sign` passes no `--timestamp`. The `dmg` mode reads it from
   `codesign -dvv` and fails without. If it is missing, the image is signed
   in the workflow instead, with `codesign --force --timestamp`.
6. **Gatekeeper's assessments are on for the checks**, so that `spctl`'s
   verdict means what it means on a person's Mac. Every Mac build prints
   `spctl --status`, so a branch build says how the hosted runners come. A
   runner that comes with them off does not fail for that alone: the
   notarising job, and `acceptance.yml`'s step 2, turn them on with `sudo
   spctl --global-enable` (or `--master-enable`, as older systems spell
   it), print the status before and after, and fail only if they are still
   off. The `dmg` mode then treats any `override=` line in a verdict as a
   failure.

It is done when a dispatched build with `sign`, the variable on, makes an
image that `spctl` accepts as Notarized Developer ID and the stapler
validates, the acceptance run passes against a candidate built that way,
and a branch build with no secret, and a tag with the variable off, are
still ad hoc and green.
