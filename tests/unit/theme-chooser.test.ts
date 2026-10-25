import { describe, expect, it } from 'vitest'
import type { Theme } from '../../src/shared/project'
import { createThemeChooser } from '../../src/renderer/src/themeChooser'

// What the theme switch does with a choice, driven with writes that resolve
// on command (A7-13, issue 285). The component cannot be rendered here - the
// suite has no DOM - and the end-to-end suite cannot hold a write open on
// purpose, so the sequences that matter are these: two choices close
// together, and a choice made in the gap between a write landing and the
// screen having the theme it wrote.
//
// Since spec 037 every choice is written the moment it is made: the bridge
// and the store keep the order of the writes, and answer in it, so nothing
// here holds one back. The writes below land in the order they started, as
// the store's answers do.

/** A write the test settles by hand. */
interface Write {
  theme: Theme
  land: () => void
  fail: (why: Error) => void
}

/** A chooser over writes that wait to be landed, and everything it said. */
function harness(initial: Theme = 'warm-dark') {
  const started: Write[] = []
  const asked: (Theme | null)[] = []
  const failed: (string | null)[] = []
  const chooser = createThemeChooser({
    initial,
    write: (theme) =>
      new Promise<void>((resolve, reject) => {
        started.push({ theme, land: resolve, fail: reject })
      }),
    asked: (theme) => asked.push(theme),
    failed: (message) => failed.push(message),
  })
  return { chooser, started, asked, failed }
}

/** Let every promise that is ready run, however deep the chain. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('one choice', () => {
  it('writes it, shows it until it has landed, and then hands the cards back to the record', async () => {
    const { chooser, started, asked, failed } = harness()
    const done = chooser.choose('sepia')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia'])
    expect(asked, 'the cards show the choice at once').toEqual(['sepia'])
    started[0].land()
    await done
    expect(asked).toEqual(['sepia', null])
    expect(failed, 'cleared as it starts, and again as it lands').toEqual([null, null])
  })

  it('writes nothing for the theme the project is already in', async () => {
    const { chooser, started, asked } = harness('sepia')
    await chooser.choose('sepia')
    expect(started).toEqual([])
    expect(asked).toEqual([])
  })
})

describe('a second choice before the first write has landed', () => {
  it('is written at once, shown throughout, and the cards let go only at its own answer', async () => {
    // Mutation: the chooser holding a choice back while a write is on its
    // way (the keep-latest serialiser it had) - only the first is written
    // until the first has landed.
    const { chooser, started, asked } = harness()
    const first = chooser.choose('sepia')
    await settle()
    const second = chooser.choose('warm-dark')
    await settle()
    expect(
      started.map((w) => w.theme),
      'both are on their way, in order',
    ).toEqual(['sepia', 'warm-dark'])
    expect(asked, 'the cards follow the last choice').toEqual(['sepia', 'warm-dark'])

    started[0].land()
    await first
    expect(asked, 'nothing was handed back to the record at the first answer').toEqual([
      'sepia',
      'warm-dark',
    ])

    started[1].land()
    await second
    expect(asked, 'the record carries the last choice when the cards let go of it').toEqual([
      'sepia',
      'warm-dark',
      null,
    ])
  })

  it('writes nothing for the theme the last choice already asked for', async () => {
    const { chooser, started } = harness()
    const first = chooser.choose('sepia')
    await settle()
    void chooser.choose('sepia')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia'])
    started[0].land()
    await first
  })
})

describe('a choice in the gap after a write has landed', () => {
  // The switch learns the record's theme a render after its write has
  // returned, from a task of React's own, and a key pressed in that gap is
  // handled first. It was compared with the theme the screen still had,
  // found to be what the project already was, and dropped, while the radio
  // the browser had checked was put back by React: a card that stayed
  // unchecked for good, seen on a slow macOS runner. Nothing here tells the
  // chooser what the screen has, as the screen has not been told.
  it('is written, though the screen has not yet been given the theme the last write landed', async () => {
    const { chooser, started, asked } = harness()
    const first = chooser.choose('sepia')
    await settle()
    started[0].land()
    await first
    expect(asked).toEqual(['sepia', null])

    const back = chooser.choose('warm-dark')
    await settle()
    expect(
      started.map((w) => w.theme),
      'warm-dark is not what the project is: sepia has landed',
    ).toEqual(['sepia', 'warm-dark'])
    expect(asked, 'and the cards show it from the first moment').toEqual([
      'sepia',
      null,
      'warm-dark',
    ])
    started[1].land()
    await back
    expect(asked.at(-1)).toBeNull()
  })

  it('writes nothing for the theme that has just landed', async () => {
    const { chooser, started } = harness()
    const first = chooser.choose('sepia')
    await settle()
    started[0].land()
    await first
    void chooser.choose('sepia')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia'])
  })
})

describe('the record’s theme as the screen has it', () => {
  it('is taken as a change made elsewhere', async () => {
    const { chooser, started } = harness('warm-dark')
    chooser.sync('sepia')
    await chooser.choose('sepia')
    expect(started, 'sepia is what the project is now').toEqual([])
    const back = chooser.choose('warm-dark')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['warm-dark'])
    started[0].land()
    await back
  })
})

describe('a write landing and a sync that arrived while it was going', () => {
  // The landing is the last word. A record rewritten elsewhere while a write
  // is in flight reaches the chooser as a `sync` of the theme the project
  // had; the write then lands and the record holds what it wrote. A chooser
  // that let the sync win would compare the next choice with the old theme
  // and drop it: the bug of the gap above, brought back by another road.
  it('wins over it: what was written is what the project is', async () => {
    const { chooser, started } = harness('warm-dark')
    const first = chooser.choose('sepia')
    await settle()
    chooser.sync('warm-dark')
    started[0].land()
    await first

    // Sepia is what the record holds, and so a choice of it is nothing...
    void chooser.choose('sepia')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia'])
    // ...and warm dark is a change, which the sync must not have hidden.
    const back = chooser.choose('warm-dark')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia', 'warm-dark'])
    started[1].land()
    await back
  })
})

describe('a write that fails', () => {
  it('says so, lets the cards go back to the record, and leaves the theme it had to compare with', async () => {
    const { chooser, started, asked, failed } = harness()
    const first = chooser.choose('sepia')
    await settle()
    started[0].fail(new Error('the record could not be written'))
    await first
    expect(failed).toEqual([null, 'the record could not be written'])
    expect(asked.at(-1), 'the cards show the record again').toBeNull()
    // Nothing landed, so the theme the project had is still what it is, and
    // choosing it is nothing...
    void chooser.choose('warm-dark')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia'])
    // ...and the same choice is a new one.
    const again = chooser.choose('sepia')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia', 'sepia'])
    started[1].land()
    await again
  })

  it('an earlier one that fails under a later one that lands: the later is the record, and nothing is unsaved', async () => {
    // Mutation: the cards let go at the earlier failure - the later choice is
    // taken off the cards while it is still on its way; or the later landing
    // leaves the earlier failure said - the switch says a theme was not saved
    // over a record that holds the last choice.
    const { chooser, started, asked, failed } = harness()
    const first = chooser.choose('sepia')
    await settle()
    const second = chooser.choose('warm-dark')
    await settle()
    started[0].fail(new Error('the record could not be written'))
    await first
    expect(asked.at(-1), 'still the later choice').toBe('warm-dark')
    started[1].land()
    await second
    expect(asked.at(-1)).toBeNull()
    expect(failed, 'said, and taken back once the last choice landed').toEqual([
      null,
      null,
      'the record could not be written',
      null,
    ])
  })
})

describe('the way closing under a choice on its way', () => {
  it('leaves it to land: it was written when it was made', async () => {
    const { chooser, started } = harness()
    const first = chooser.choose('sepia')
    await settle()
    const second = chooser.choose('warm-dark')
    chooser.forget()
    started[0].land()
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia', 'warm-dark'])
    started[1].land()
    await Promise.all([first, second])
  })
})
