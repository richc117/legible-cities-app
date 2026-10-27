// The app's refusals read as sentences (issue 548, DESIGN.md section 11):
// a capital, a full stop, and what to do next before what went wrong. Each
// reached the screen as a lower-case fragment ("name is required"), because
// nothing between where a refusal is made and where it is shown capitalises
// or completes it - and nothing should, since the main process's refusals are
// shown as written (issue 519). So the rule is held where they are made.
//
// The sentences are collected from the modules that hold them: as exported
// constants where a module keeps them together, and as the functions'
// answers for a failing input where a function makes them.

import { describe, expect, it } from 'vitest'
import { withoutPaths } from '../../src/shared/engine'
import { NAME_MAX, validateName } from '../../src/shared/project/validate'
import { FEED_REFUSALS, PickedPaths, refuseUrl, registryGuard } from '../../src/main/feeds-ipc'
import { DESTINATION_REFUSALS, destinationLate, EXPORTS_THERE } from '../../src/main/export'
import { NO_BAND_FOR_ADDRESS, staleFrame, unreadFrame } from '../../src/main/capture'
import { SHEET_REFUSALS, validateFeedUrl } from '../../src/renderer/src/NewProjectSheet'
import { openFailed } from '../../src/renderer/src/Library'

const inUse = () => async () => []

/** Every refusal the issue names, and the ones made beside them, by where each is made. */
async function refusals(): Promise<Array<[string, string | null]>> {
  const guard = registryGuard(new PickedPaths(), inUse())
  return [
    ['validateName, empty', validateName('  ')],
    ['validateName, too long', validateName('x'.repeat(NAME_MAX + 1))],
    ['refuseUrl, not a URL', refuseUrl('https://')],
    ['refuseUrl, not http', refuseUrl('ftp://agency.example/gtfs.zip')],
    ['refuseUrl, this machine', refuseUrl('http://localhost/gtfs.zip')],
    ['feeds.add, no source', await guard('feeds.add', {})],
    ['feeds.add, a path no dialog answered', await guard('feeds.add', { source: '/a/feed.zip' })],
    ['feeds.remove, no key', await guard('feeds.remove', {})],
    ...Object.entries(FEED_REFUSALS).map(([k, s]): [string, string] => [`FEED_REFUSALS.${k}`, s]),
    ...Object.entries(DESTINATION_REFUSALS).map(([k, s]): [string, string] => [
      `DESTINATION_REFUSALS.${k}`,
      s,
    ]),
    ...(['folder', 'app', 'engine', 'waiting'] as const).map((asked): [string, string] => [
      `destinationLate(${asked})`,
      destinationLate(asked),
    ]),
    ['EXPORTS_THERE', EXPORTS_THERE],
    ['staleFrame', staleFrame(3)],
    ['unreadFrame', unreadFrame(0)],
    ['NO_BAND_FOR_ADDRESS', NO_BAND_FOR_ADDRESS],
    ['validateFeedUrl, empty', validateFeedUrl('  ')],
    ['validateFeedUrl, not http', validateFeedUrl('ftp://agency.example/gtfs.zip')],
    ...Object.entries(SHEET_REFUSALS).map(([k, s]): [string, string] => [`SHEET_REFUSALS.${k}`, s]),
    ['openFailed, a sentence', openFailed('LA Metro Rail', new Error('Give the project a name.'))],
    ['openFailed, a fragment', openFailed('LA Metro Rail', new Error('EACCES: permission denied'))],
    ['openFailed, nothing said', openFailed('LA Metro Rail', new Error(''))],
  ]
}

describe('a refusal', () => {
  it('is a sentence: it starts with a capital and ends with a full stop', async () => {
    const said = await refusals()
    // Not vacuous: every input above fails, so every entry has a sentence.
    expect(said.length).toBeGreaterThan(30)
    for (const [where, sentence] of said) {
      expect(sentence, where).not.toBeNull()
      expect(sentence, where).toMatch(/^[A-Z]/)
      expect(sentence, where).toMatch(/\.$/)
    }
  })

  it('leads with what to do where the issue names one', () => {
    expect(validateName('')).toBe('Give the project a name.')
    expect(DESTINATION_REFUSALS.insideApp).toMatch(/^Choose another folder: /)
    expect(refuseUrl('http://localhost/gtfs.zip')).toMatch(/^Use an address on a public host/)
    expect(validateFeedUrl('')).toMatch(/^Paste the address/)
    expect(openFailed('LA Metro Rail', new Error('gone.'))).toBe(
      'Try again. LA Metro Rail could not be opened: gone.',
    )
  })

  it('from a capture names where to send what Copy diagnostics copies', () => {
    for (const sentence of [NO_BAND_FOR_ADDRESS, unreadFrame(0)]) {
      expect(sentence).toContain('Copy diagnostics in Settings')
      expect(sentence).toContain("paste what it copies into a new issue on the project's tracker")
      expect(sentence).not.toMatch(/send what it copies/)
    }
  })

  it('from a capture reaches the screen whole, through the screen for paths', () => {
    // An export's failure is passed through withoutPaths before it is shown
    // (normalise in src/main/export.ts); a sentence it rewrote would not be
    // the sentence written here.
    for (const sentence of [NO_BAND_FOR_ADDRESS, unreadFrame(0), staleFrame(3)])
      expect(withoutPaths(sentence)).toBe(sentence)
  })

  it('about an address is the same sentence in the sheet and in the main process', () => {
    // The renderer may not import the main process's module, so the sheet
    // keeps its own copy of the sentence; this holds the two together.
    expect(SHEET_REFUSALS.httpOnly).toBe(FEED_REFUSALS.httpOnly)
    expect(validateFeedUrl('ftp://agency.example/gtfs.zip')).toBe(
      refuseUrl('ftp://agency.example/gtfs.zip'),
    )
  })
})
