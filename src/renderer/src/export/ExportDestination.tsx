import { useEffect, useRef, useState, type JSX } from 'react'
import type { ProjectRecord } from '../../../shared/project/types'
import { focusLost } from '../focusHandback'
import Icon from '../icons/Icon'
import Button from '../kit/Button'

// Cell 06's "Where it goes" (A5.5-19; issue 433, part b): the one choice
// that is not the engine's and not the page's either. A folder is chosen
// in the platform's own dialog, which only the main process can open, and
// applied there: the page asks for the chooser by naming its project and
// is told the record that came back, so no path crosses the bridge inward
// - the rule Settings' two folders have followed since A1-04. What comes
// back *out* is the folder itself, shown to the person whose folder it is
// and to nobody else; it is in no message the app sends anywhere.
//
// Drawn inside the form with the rest of the choices (`ExportForm.tsx`),
// so an export that starts takes focus off it as it does off every other
// control there.

interface Props {
  projectId: string
  /** The record's folder for this project's exports; null for the app's own. */
  destination: string | null
  /** An export is running, or the project cannot be written. */
  locked: boolean
}

export default function ExportDestination({
  projectId,
  destination: recorded,
  locked,
}: Props): JSX.Element {
  // Where this project's exports go (A5.5-19). Held here rather than read
  // from the record on every render because the two calls that change it
  // answer the written record themselves, and the screen around this panel
  // is not re-read for a folder: nothing else on it shows one. A record
  // read again for any other reason - a run finishing, the project opened
  // afresh - brings the folder with it, and the effect below takes it.
  const [destination, setDestination] = useState<string | null>(recorded)
  const [folderProblem, setFolderProblem] = useState<string | null>(null)
  useEffect(() => {
    setDestination(recorded)
  }, [recorded])

  // The destination's two presses. Neither sends a path: `chooseDestination`
  // asks the main process to open the platform's dialog and apply what it
  // answers, and `useAppFolder` takes nothing at all. A cancelled chooser
  // comes back as the record unchanged, so nothing here has to tell the two
  // apart.
  //
  // "Use the app's folder" is the only control in this panel that removes
  // itself: it is drawn only while there is a folder to forget. Chromium
  // blurs an element that leaves the document, so focus is handed to
  // "Choose folder", where the next press about this would go (A6-07).
  const chooserRef = useRef<HTMLElement>(null)
  const handBackToChooser = useRef(false)
  useEffect(() => {
    if (!handBackToChooser.current) return
    handBackToChooser.current = false
    if (focusLost(document.activeElement, document.body)) chooserRef.current?.focus()
  }, [destination])
  // Neither button disables itself while its call is out. The chooser is
  // modal to the window, so a second press cannot reach it anyway, and a
  // control that disables itself under a person's hands drops the focus it
  // holds - which is exactly what the handback above exists to repair. The
  // guard is a ref rather than state for the same reason it is not drawn:
  // two presses in one render would both read the same `false`.
  const changing = useRef(false)
  const changeFolder = async (
    ask: () => Promise<ProjectRecord>,
    /** This press may remove its own button, so focus needs somewhere to go. */
    handBack = false,
  ): Promise<void> => {
    if (changing.current) return
    changing.current = true
    try {
      const record = await ask()
      setFolderProblem(null)
      // Only when the button that was pressed has actually gone: a refused
      // or cancelled change leaves it where it was, holding its own focus.
      handBackToChooser.current = handBack && record.destination === null
      setDestination(record.destination)
    } catch (error) {
      setFolderProblem(error instanceof Error ? error.message : String(error))
    } finally {
      changing.current = false
    }
  }

  return (
    <div className="field export-destination">
      <p className="field-label" id="export-destination-label">
        Where it goes
      </p>
      {destination === null ? (
        <p className="message" id="export-destination-where">
          This project&rsquo;s exports go to the app&rsquo;s export folder, which Settings names, in
          a folder named after the project.
        </p>
      ) : (
        /* A folder's path is shown to the person whose folder it
           is, as Settings shows its two; it is in no message the
           app sends anywhere else. */
        <p className="path" id="export-destination-where">
          {destination}
        </p>
      )}
      <div className="toolbar">
        <Button
          ref={chooserRef}
          disabled={locked}
          aria-describedby="export-destination-where"
          onClick={() => {
            void changeFolder(() => window.api.export.chooseDestination(projectId))
          }}
        >
          <Icon name="folder" />
          Choose folder
        </Button>
        {destination !== null && (
          <Button
            disabled={locked}
            aria-describedby="export-destination-where"
            onClick={() => {
              void changeFolder(() => window.api.export.useAppFolder(projectId), true)
            }}
          >
            Use the app&rsquo;s folder
          </Button>
        )}
      </div>
      {folderProblem !== null && (
        <p className="message error" role="alert">
          {folderProblem}
        </p>
      )}
    </div>
  )
}
