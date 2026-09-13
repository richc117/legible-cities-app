// The Licences section of Settings (issue 108, specs/027-licences): the
// app's own licence, every component it carries with that component's
// licence, and what the three buttons can open. One list, here, which the
// page shows and a unit test holds against THIRD_PARTY_NOTICES.md's table,
// so the two cannot drift.
//
// No Electron and no Node import: the page reads this too.

/** The app's own licence, as its `LICENSE` and `package.json` say. */
export const APP_LICENCE = 'GPL-3.0-or-later'

export interface BundledComponent {
  /** How the screen names it. */
  name: string
  /** Its licence, in the screen's words; the notices file says it at length. */
  licence: string
  /**
   * The licence identifiers that must appear both in `licence` and in the
   * licence cell of its row in THIRD_PARTY_NOTICES.md, so the screen and the
   * notices cannot name different licences.
   */
  identifiers: readonly string[]
  /**
   * The first cell of its row in THIRD_PARTY_NOTICES.md's table, exactly,
   * so a row renamed or removed there fails a test here.
   */
  notice: string
}

/**
 * What the installers carry, in the order a person would look for it: the
 * engine and the tools it runs, the Python runtime and what is inside it,
 * then the shell and the interface. Development tooling, test data and
 * anything not shipped are left out, as the notices file marks them.
 */
export const BUNDLED_COMPONENTS: readonly BundledComponent[] = [
  {
    name: 'The legible-cities engine',
    licence: 'GPL-3.0-or-later',
    identifiers: ['GPL-3.0-or-later'],
    notice: '`legible-cities` engine',
  },
  { name: 'LOOM', licence: 'GPL-3.0', identifiers: ['GPL-3.0'], notice: 'LOOM' },
  {
    name: 'LOOM’s Windows compatibility changes, by Transport for Cairo',
    licence: 'GPL-3.0',
    identifiers: ['GPL-3.0'],
    notice: 'LOOM Windows compatibility changes, by Transport for Cairo',
  },
  {
    name: 'FFmpeg',
    licence: 'GPL-3.0-or-later',
    identifiers: ['GPL-3.0-or-later'],
    notice: 'FFmpeg (ADR-012, ADR-040)',
  },
  {
    name: 'x264, inside FFmpeg',
    licence: 'GPL-2.0-or-later',
    identifiers: ['GPL-2.0-or-later'],
    notice: 'x264',
  },
  {
    name: 'zlib, inside the Windows FFmpeg and LOOM',
    licence: 'Zlib',
    identifiers: ['Zlib'],
    notice: 'zlib',
  },
  {
    name: 'bzip2, inside the Windows LOOM',
    licence: 'bzip2-1.0.6',
    identifiers: ['bzip2-1.0.6'],
    notice: 'bzip2 (libbzip2)',
  },
  {
    name: 'GCC’s and mingw-w64’s runtimes, inside the Windows FFmpeg and LOOM',
    licence:
      'GPL-3.0-or-later WITH GCC-exception-3.1; the mingw-w64 runtime’s own terms; MIT and BSD-3-Clause (winpthreads)',
    identifiers: ['GPL-3.0-or-later WITH GCC-exception-3.1', 'MIT', 'BSD-3-Clause'],
    notice: 'GCC runtime library and mingw-w64 runtime, with winpthreads',
  },
  {
    name: 'Python (CPython, built by python-build-standalone)',
    licence: 'PSF-2.0; MPL-2.0 for the build scripts',
    identifiers: ['PSF-2.0', 'MPL-2.0'],
    notice: 'python-build-standalone (ADR-020, ADR-038)',
  },
  {
    name: 'The libraries linked into Python: OpenSSL, libffi, xz, bzip2, zlib, mpdecimal, Expat, SQLite, Tcl/Tk, Tix and libuuid',
    licence:
      'Apache-2.0 (OpenSSL); MIT (libffi, Expat); 0BSD (xz); bzip2-1.0.6; Zlib; BSD-2-Clause (mpdecimal); public domain (SQLite); TCL (Tcl/Tk, Tix); BSD-3-Clause (libuuid); each text in the licence texts',
    identifiers: [
      'Apache-2.0',
      'MIT',
      '0BSD',
      'bzip2-1.0.6',
      'Zlib',
      'BSD-2-Clause',
      'public domain',
      'TCL',
      'BSD-3-Clause',
    ],
    notice: 'Libraries linked into the Python runtime',
  },
  {
    name: 'Software incorporated into CPython',
    licence: 'each as CPython-Doc-license.rst quotes it, among the licence texts',
    identifiers: ['CPython-Doc-license.rst'],
    notice: 'Software incorporated into CPython',
  },
  { name: 'pandas', licence: 'BSD-3-Clause', identifiers: ['BSD-3-Clause'], notice: 'pandas' },
  {
    name: 'NumPy',
    licence:
      'BSD-3-Clause; on Windows also BSD-3-Clause-Open-MPI (LAPACK) and GPL-3.0-or-later WITH GCC-exception-3.1 (the GCC runtime), inside OpenBLAS',
    identifiers: [
      'BSD-3-Clause',
      'BSD-3-Clause-Open-MPI',
      'GPL-3.0-or-later WITH GCC-exception-3.1',
    ],
    notice: 'NumPy',
  },
  { name: 'requests', licence: 'Apache-2.0', identifiers: ['Apache-2.0'], notice: 'requests' },
  {
    name: 'python-lsp-jsonrpc',
    licence: 'MIT',
    identifiers: ['MIT'],
    notice: 'python-lsp-jsonrpc',
  },
  {
    name: 'ujson',
    licence: 'BSD-3-Clause AND TCL',
    identifiers: ['BSD-3-Clause AND TCL'],
    notice: 'ujson',
  },
  {
    name: 'certifi, charset-normalizer, idna, urllib3, python-dateutil, six and tzdata',
    licence: 'MPL-2.0, MIT, BSD-3-Clause and Apache-2.0, each package its own',
    identifiers: ['MPL-2.0', 'MIT', 'BSD-3-Clause', 'Apache-2.0'],
    notice: 'certifi, charset-normalizer, idna, urllib3, python-dateutil, six, tzdata',
  },
  {
    name: 'pip',
    licence:
      'MIT, with the packages it vendors under Apache-2.0, BSD-2-Clause, MPL-2.0, PSF-2.0, BSD-3-Clause and ISC',
    identifiers: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'MPL-2.0', 'PSF-2.0', 'BSD-3-Clause', 'ISC'],
    notice: 'pip',
  },
  { name: 'Electron', licence: 'MIT', identifiers: ['MIT'], notice: 'Electron' },
  {
    name: 'Chromium, inside Electron',
    licence: "Chromium's licences (in LICENSES.chromium.html)",
    identifiers: ['LICENSES.chromium.html'],
    notice: 'Electron',
  },
  { name: 'React', licence: 'MIT', identifiers: ['MIT'], notice: 'React' },
  {
    name: 'FigUI3 core',
    licence: 'MIT; ISC for the polyfill it vendors',
    identifiers: ['MIT', 'ISC'],
    notice: 'FigUI3 core',
  },
  { name: 'Phosphor Icons', licence: 'MIT', identifiers: ['MIT'], notice: 'Phosphor Icons' },
  { name: 'react-colorful', licence: 'MIT', identifiers: ['MIT'], notice: 'react-colorful' },
  {
    name: 'Esri Calcite UI icons, inside the engine’s page',
    licence: 'Esri Master License Agreement',
    identifiers: ['Esri Master License Agreement'],
    notice: 'Esri Calcite UI icons',
  },
]

/**
 * Whether a file the section opens is there to open. `development`: an
 * unpackaged run, which carries no resources of its own; `missing`: a
 * packaged app without it, which the build refuses and should not happen.
 */
export type LicenceFileState = 'available' | 'development' | 'missing'

/** The three things the section can open. */
export type LicenceFile = 'notices' | 'texts' | 'chromium'

/**
 * What the section can open: the notices file, the folder of the Python
 * runtime's licence texts, and Chromium's licences as Electron ships them.
 */
export type LicencesView = Record<LicenceFile, LicenceFileState>

const THINGS: Record<LicenceFile, { subject: string; verb: 'is' | 'are' }> = {
  notices: { subject: 'The notices file', verb: 'is' },
  texts: { subject: 'The licence texts', verb: 'are' },
  chromium: { subject: "Chromium's licences", verb: 'are' },
}

/** Why a button cannot open its file, in the screen's words; null when it can. */
export function describeUnavailable(what: LicenceFile, state: LicenceFileState): string | null {
  const { subject, verb } = THINGS[what]
  if (state === 'development') {
    return `${subject} ${verb} not bundled in a development run, so there is nothing to open here.`
  }
  if (state === 'missing') return `${subject} ${verb} missing from this installation.`
  return null
}
