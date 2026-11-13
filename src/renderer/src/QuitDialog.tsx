import { useEffect, useRef, useState, type JSX } from 'react'
import type { Job } from '../../shared/jobs'
import { quitWords, type AskedQuit, type QuitAnswer, type QuitKind } from '../../shared/quit'
import ConfirmDialog from './ConfirmDialog'
import { cancelJob, jobs, subscribeToJobs } from './engine/runs'
import { reportRunningLayouts, runsToStop } from './quitRuns'

// The question a quit, or a close of the window, asks first while an export
// or a layout is running (issue 552, specs/039-quit-guard). Main decides
// whether to ask and sends the question; this shows it, in the page's own
// modal dialog - a native message box with no parent would hold the quit
// itself - and sends back the answer. Mounted once, at the root, so it is
// there on every screen and opens over any other dialog: a modal opened
// later is above the one before it, which waits behind it and has focus
// back when this one closes.
//
// "Keep working" is the safe button, focused first, and what Escape answers.
// It is not "Cancel", which on this screen already means stopping a run.
// The dialog stays until it is answered, though the run it asks about may
// end meanwhile: one that closed by itself would leave a press on whatever
// was behind it. Main takes it back in one case, a second quit, which is an
// answer.
//
// "Close anyway" stops every export and layout still running before it
// answers, each through its own run's cancel, the path its own Cancel takes;
// "Quit anyway" stops nothing here, since the quit stops everything.
//
// The same mount tells main which layouts are running, whenever that changes
// (`quitRuns.ts`): main cannot see a layout, and never asks at a quit.

/** What the dialog says while its answer is on its way to the main process. */
const BUSY: Record<QuitKind, string> = { quit: 'Quitting…', close: 'Closing…' }

/** The session's runs as the dialog needs them: the jobs, their changes, and a job's own cancel. */
export interface QuitRuns {
  jobs: () => readonly Job[]
  subscribe: (listener: () => void) => () => void
  cancel: (jobId: string) => void
}

/** The one registry `engine/runs.ts` keeps. */
const SESSION_RUNS: QuitRuns = { jobs, subscribe: subscribeToJobs, cancel: cancelJob }

interface Props {
  /** The runs to report and to stop; the session's own unless a test hands in others. */
  runs?: QuitRuns
}

export default function QuitDialog({ runs = SESSION_RUNS }: Props): JSX.Element | null {
  // The question last asked, whose words stay while its dialog closes, and
  // whether it is still open.
  const [asked, setAsked] = useState<AskedQuit | null>(null)
  const [open, setOpen] = useState(false)
  // The question awaiting its answer, or null once it has one: Escape tells
  // the dialog twice, as it is cancelled and as it closes.
  const awaiting = useRef<AskedQuit | null>(null)

  useEffect(() => {
    const offQuestion = window.api.app.onQuitQuestion((question) => {
      awaiting.current = question
      if (question === null) {
        setOpen(false)
        return
      }
      setAsked(question)
      setOpen(true)
    })
    const offReport = reportRunningLayouts({
      jobs: runs.jobs,
      subscribe: runs.subscribe,
      report: (layouts) => window.api.app.reportLayouts(layouts),
    })
    return () => {
      offQuestion()
      offReport()
    }
  }, [runs])

  const answer = (said: QuitAnswer): void => {
    const question = awaiting.current
    if (question === null) return
    awaiting.current = null
    setOpen(false)
    if (said === 'anyway' && question.kind === 'close')
      for (const id of runsToStop(runs.jobs())) runs.cancel(id)
    // An answer main does not take changes nothing here: the dialog is
    // closed either way, and a quit still wanted is asked for again.
    window.api.app.answerQuit(question.id, said).catch(() => undefined)
  }

  // Nothing in the document until a question has been asked.
  if (asked === null) return null
  const words = quitWords(asked)
  return (
    <ConfirmDialog
      open={open}
      title={words.title}
      description={words.description}
      confirmLabel={words.anyway}
      cancelLabel={words.keep}
      busyLabel={BUSY[asked.kind]}
      onConfirm={async () => answer('anyway')}
      onCancel={() => answer('keep')}
    />
  )
}
