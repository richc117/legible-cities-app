// The words of the question a quit or a close asks first (issue 552,
// specs/039-quit-guard, FR-005), and the shape that crosses the bridge with
// them (`src/shared/quit.ts`). The sentences are the spec's, letter for
// letter; the gate documents quote the same ones. Each test was watched
// failing under its mutation in `quit-words.mutations.json`.

import { describe, expect, it } from 'vitest'
import {
  isAskedQuit,
  isQuitAnswer,
  KEEP_WORKING,
  quitQuestionListeners,
  quitWords,
  type AskedQuit,
  type QuitQuestion,
} from '../../src/shared/quit'

const question = (over: Partial<QuitQuestion> = {}): QuitQuestion => ({
  kind: 'quit',
  exports: 1,
  layouts: 0,
  names: ['Paris'],
  ...over,
})

describe('the question’s words', () => {
  it('asks about a quit during an export in the spec’s words', () => {
    expect(quitWords(question())).toEqual({
      title: 'Quit while an export is running?',
      description:
        'The export of Paris has not finished. Quitting stops it, and nothing of it is kept.',
      keep: 'Keep working',
      anyway: 'Quit anyway',
    })
  })

  it('asks about a quit during a layout in the spec’s words', () => {
    expect(quitWords(question({ exports: 0, layouts: 1 }))).toEqual({
      title: 'Quit while a layout is running?',
      description:
        'The layout of Paris has not finished. Quitting stops it, and nothing of it is kept.',
      keep: 'Keep working',
      anyway: 'Quit anyway',
    })
  })

  it('says Close in place of Quit for a close of the window', () => {
    expect(quitWords(question({ kind: 'close' }))).toEqual({
      title: 'Close while an export is running?',
      description:
        'The export of Paris has not finished. Closing stops it, and nothing of it is kept.',
      keep: 'Keep working',
      anyway: 'Close anyway',
    })
    expect(quitWords(question({ kind: 'close', exports: 0, layouts: 1 }))).toMatchObject({
      title: 'Close while a layout is running?',
      description:
        'The layout of Paris has not finished. Closing stops it, and nothing of it is kept.',
    })
  })

  it('counts several runs in the title and names each project in the sentence', () => {
    expect(quitWords(question({ exports: 1, layouts: 1, names: ['Paris', 'Lyon'] }))).toEqual({
      title: 'Quit while 2 runs are going?',
      description:
        'The runs of Paris and Lyon have not finished. Quitting stops them, and nothing of them is kept.',
      keep: 'Keep working',
      anyway: 'Quit anyway',
    })
    expect(
      quitWords(question({ kind: 'close', exports: 3, names: ['Paris', 'Lyon', 'Lille'] })),
    ).toMatchObject({
      title: 'Close while 3 runs are going?',
      description:
        'The runs of Paris, Lyon and Lille have not finished. Closing stops them, and nothing of them is kept.',
      anyway: 'Close anyway',
    })
  })

  it('says runs for two of one project, which is named once', () => {
    expect(quitWords(question({ exports: 1, layouts: 1, names: ['Paris'] }))).toMatchObject({
      title: 'Quit while 2 runs are going?',
      description:
        'The runs of Paris have not finished. Quitting stops them, and nothing of them is kept.',
    })
  })

  it('names the safe button Keep working, never Cancel', () => {
    expect(KEEP_WORKING).toBe('Keep working')
    for (const kind of ['quit', 'close'] as const)
      expect(quitWords(question({ kind })).keep).toBe('Keep working')
  })
})

describe('the question’s shape on the bridge', () => {
  const asked = { id: 1, ...question() }

  it('takes a question as main sends one', () => {
    expect(isAskedQuit(asked)).toBe(true)
    expect(
      isAskedQuit({ ...asked, kind: 'close', exports: 0, layouts: 2, names: ['A', 'B'] }),
    ).toBe(true)
  })

  it.each([
    ['nothing', null],
    ['a word', 'quit'],
    ['no number', { ...asked, id: undefined }],
    ['a number that is not whole', { ...asked, id: 1.5 }],
    ['a kind that is neither', { ...asked, kind: 'hide' }],
    ['a count that is not a number', { ...asked, exports: '1' }],
    ['a count below none', { ...asked, layouts: -1 }],
    ['no run at all', { ...asked, exports: 0, layouts: 0 }],
    ['no names', { ...asked, names: [] }],
    ['a name that is not text', { ...asked, names: [7] }],
    ['names that are not a list', { ...asked, names: 'Paris' }],
  ])('refuses %s', (_what, value) => {
    expect(isAskedQuit(value)).toBe(false)
  })

  it('knows the two answers and no other', () => {
    expect(isQuitAnswer('keep')).toBe(true)
    expect(isQuitAnswer('anyway')).toBe(true)
    expect(isQuitAnswer('cancel')).toBe(false)
    expect(isQuitAnswer(undefined)).toBe(false)
  })
})

// `api.app.onQuitQuestion` as the preload makes it: what reaches the page's
// listener, and what main is told about whether the page listens.
describe('the page’s subscription to the question', () => {
  /** The channel as the preload hears it, and what main was told. */
  function channel() {
    const handlers = new Set<(value: unknown) => void>()
    const told: boolean[] = []
    const subscribe = quitQuestionListeners({
      hear: (handler) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
      tell: (listening) => told.push(listening),
    })
    const send = (value: unknown): void => {
      for (const handler of [...handlers]) handler(value)
    }
    return { handlers, told, subscribe, send }
  }
  const asked: AskedQuit = { id: 1, ...question() }

  it('tells main the page listens once its listener is on, and hands it each question', () => {
    const { told, subscribe, send } = channel()
    expect(told, 'nothing is said before anything listens').toEqual([])
    const heard: (AskedQuit | null)[] = []
    subscribe((value) => heard.push(value))
    expect(told).toEqual([true])
    send(asked)
    // The null that takes a question back is heard too.
    send(null)
    expect(heard).toEqual([asked, null])
  })

  it('hands the listener nothing that is not a question', () => {
    const { subscribe, send } = channel()
    const heard: unknown[] = []
    subscribe((value) => heard.push(value))
    for (const value of [
      undefined,
      'quit',
      7,
      {},
      { ...asked, names: [] },
      { ...asked, id: 'one' },
    ])
      send(value)
    expect(heard).toEqual([])
  })

  it('tells main the page has stopped when its listener goes, and stops hearing', () => {
    const { handlers, told, subscribe, send } = channel()
    const heard: unknown[] = []
    const off = subscribe((value) => heard.push(value))
    off()
    expect(told).toEqual([true, false])
    expect(handlers.size).toBe(0)
    send(asked)
    expect(heard).toEqual([])
    // Once: stopping twice says nothing more, and counts nothing twice, so
    // the next listener's going is still said.
    off()
    expect(told).toEqual([true, false])
    subscribe(() => undefined)()
    expect(told).toEqual([true, false, true, false])
  })

  it('says the page has stopped only when its last listener has gone', () => {
    const { told, subscribe } = channel()
    const first = subscribe(() => undefined)
    const second = subscribe(() => undefined)
    first()
    expect(told, 'one still listens').toEqual([true, true])
    second()
    expect(told).toEqual([true, true, false])
    // And listening again is said again.
    subscribe(() => undefined)
    expect(told).toEqual([true, true, false, true])
  })
})
