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
// `theme-writes.test.ts` holds the pieces this is made of, `nextWrite` and
// `writeThrough`; this holds what they do together, in the order the switch
// calls them.

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
    expect(failed).toEqual([null])
  })

  it('writes nothing for the theme the project is already in', async () => {
    const { chooser, started, asked } = harness('sepia')
    await chooser.choose('sepia')
    expect(started).toEqual([])
    expect(asked).toEqual([])
  })
})

describe('a second choice before the first write has landed', () => {
  it('is kept, shown throughout, and written after the first, in order', async () => {
    const { chooser, started, asked } = harness()
    const first = chooser.choose('sepia')
    await settle()
    const second = chooser.choose('warm-dark')
    await settle()
    expect(
      started.map((w) => w.theme),
      'only the first is being written',
    ).toEqual(['sepia'])
    expect(asked, 'the cards follow the last choice').toEqual(['sepia', 'warm-dark'])

    started[0].land()
    await settle()
    expect(
      started.map((w) => w.theme),
      'the kept choice follows the first',
    ).toEqual(['sepia', 'warm-dark'])
    expect(asked, 'and nothing was handed back to the record in between').toEqual([
      'sepia',
      'warm-dark',
    ])

    started[1].land()
    await Promise.all([first, second])
    expect(asked, 'the record carries the last choice when the cards let go of it').toEqual([
      'sepia',
      'warm-dark',
      null,
    ])
  })

  it('keeps only the last of several', async () => {
    const { chooser, started } = harness()
    const first = chooser.choose('sepia')
    await settle()
    void chooser.choose('warm-dark')
    void chooser.choose('sepia')
    await settle()
    started[0].land()
    await first
    // The last asked is what the first write already wrote: nothing more to say.
    expect(started.map((w) => w.theme)).toEqual(['sepia'])
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

describe('a write that fails', () => {
  it('says so, lets the cards go back to the record, and drops what was kept behind it', async () => {
    const { chooser, started, asked, failed } = harness()
    const first = chooser.choose('sepia')
    await settle()
    void chooser.choose('warm-dark')
    started[0].fail(new Error('the record could not be written'))
    await first
    await settle()
    expect(
      started.map((w) => w.theme),
      'nothing more is written after a failure',
    ).toEqual(['sepia'])
    expect(failed).toEqual([null, 'the record could not be written'])
    expect(asked.at(-1), 'the cards show the record again').toBeNull()
    // Nothing landed, so the same choice is a new one.
    const again = chooser.choose('sepia')
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia', 'sepia'])
    started[1].land()
    await again
  })
})

describe('the way closing under a kept choice', () => {
  it('forgets it, so it is not applied after the way has closed', async () => {
    const { chooser, started } = harness()
    const first = chooser.choose('sepia')
    await settle()
    void chooser.choose('warm-dark')
    chooser.forget()
    started[0].land()
    await settle()
    expect(started.map((w) => w.theme)).toEqual(['sepia'])
    await first
  })
})
