import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  APP_THEMES,
  describeSize,
  isAppTheme,
  THEME_LABELS,
  type FolderSize,
  type FolderView,
  type SettingsView,
} from '../../shared/settings'
import type { EngineState } from '../../shared/engine'
import type { EngineInfo } from '../../shared/protocol'
import ConfirmDialog from './ConfirmDialog'
import { engineClient } from './engine/runs'
import Icon from './icons/Icon'
import Button from './kit/Button'
import Select from './kit/Select'

// What the app decides for itself: where the engine keeps its data and how
// much of it there is, where exports go, which theme the interface wears,
// what versions are running, where the logs are, and how to throw the
// engine's data away. No path is ever sent to the main process: a folder is
// chosen in the platform's dialog, which the main process opens and whose
// answer it applies itself (specs/019-settings/contracts/bridge.md).

interface Props {
  settings: SettingsView
  /** A view the main process answered with: the screen never edits its own. */
  onChanged: (next: SettingsView) => void
  engine: EngineState | null
  onBack: () => void
}

const sentenceOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Where a folder came from, in the screen's words. */
const SOURCE_WORDS: Record<FolderView['source'], string> = {
  default: 'the default',
  settings: 'chosen here',
  environment: 'set in the environment',
}

/** A value the engine reports as null: said in words, never left blank. */
function reported(value: string | null, absent: string): string {
  return value === null || value === '' ? absent : value
}

export default function Settings({ settings, onChanged, engine, onBack }: Props): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [size, setSize] = useState<FolderSize | null>(null)
  const [info, setInfo] = useState<EngineInfo | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const ready = engine?.state === 'ready'

  // Focus the heading when the screen appears, so a screen reader says
  // where the person is.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const measure = useCallback((): Promise<void> => {
    setSize(null)
    return window.api.settings.engineSize().then(
      (measured) => setSize(measured),
      () => setSize(null),
    )
  }, [])

  useEffect(() => {
    void measure()
  }, [measure])

  // The versions are the engine's own answer, read once it is ready and
  // again if it restarts into a different build.
  useEffect(() => {
    if (!ready) {
      setInfo(null)
      return
    }
    let left = false
    engineClient()
      .request('engine.info')
      .result.then(
        (answer) => {
          if (!left) setInfo(answer)
        },
        () => undefined,
      )
    return () => {
      left = true
    }
  }, [ready])

  // Every change is the main process's answer: it opens the dialog, applies
  // what the dialog said, and hands back the whole view.
  const change = (ask: () => Promise<SettingsView>): void => {
    setMessage(null)
    ask().then(
      (next) => onChanged(next),
      (error: unknown) => setMessage(sentenceOf(error)),
    )
  }

  // A refusal - something running, or a folder the app will not remove -
  // stays in the dialog, which is what ConfirmDialog does with a rejection.
  const reset = async (): Promise<void> => {
    await window.api.settings.resetEngineData()
    setConfirming(false)
    setNotice(
      'The engine data folder was emptied: every project, feed and layout is gone. Start the app again so the engine reads it afresh.',
    )
    await measure()
  }

  const folder = (which: 'engine' | 'export', view: FolderView, label: string): JSX.Element => (
    <div className="setting">
      <p className="field-label" id={`${which}-folder-label`}>
        {label}
      </p>
      {/* A folder's path is shown to the person whose folder it is; it is
          not in any message the app sends anywhere else. */}
      <p className="path" id={`${which}-folder-path`}>
        {view.path}
      </p>
      <p className="message" id={`${which}-folder-source`}>
        {SOURCE_WORDS[view.source]}
        {view.locked && '; the app does not change it here'}
      </p>
      {view.pending !== null && (
        <p className="message pending" role="status">
          Waiting for a restart: {view.pending}
        </p>
      )}
      {!view.locked && (
        <div className="toolbar">
          <Button
            aria-label={`Choose the ${label.toLowerCase()}`}
            aria-describedby={`${which}-folder-path`}
            onClick={() =>
              change(() =>
                which === 'engine'
                  ? window.api.settings.chooseEngineFolder()
                  : window.api.settings.chooseExportFolder(),
              )
            }
          >
            <Icon name="layers" />
            Choose folder
          </Button>
          {/* There is a stored folder to clear: either it is the one in
              force, or it is the one waiting for a restart. Without the
              second, a folder just chosen for the engine could not be
              taken back until the app had started on it. */}
          {(view.source === 'settings' || view.pending !== null) && (
            <Button
              aria-label={`Use the default ${label.toLowerCase()}`}
              onClick={() =>
                change(() =>
                  which === 'engine'
                    ? window.api.settings.useDefaultEngineFolder()
                    : window.api.settings.useDefaultExportFolder(),
                )
              }
            >
              Use the default
            </Button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <main className="panel settings" aria-labelledby="settings-heading">
      <h1 id="settings-heading" tabIndex={-1} ref={headingRef}>
        Settings
      </h1>
      <div className="toolbar">
        <Button onClick={onBack}>
          <Icon name="back" />
          Back to Library
        </Button>
      </div>
      {message && (
        <p role="alert" className="notice error">
          {message}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}

      <section aria-labelledby="settings-folders">
        <h2 id="settings-folders">Folders</h2>
        {folder('engine', settings.engine, 'Engine data folder')}
        <p className="message" id="engine-folder-size" role="status">
          {size === null ? 'Measuring…' : describeSize(size)}
        </p>
        {settings.engine.pending !== null && (
          <p className="message">
            The engine, the projects and the exports still use the folder above until the app starts
            again. Nothing is moved: the old folder stays where it is.
          </p>
        )}
        {folder('export', settings.export, 'Export folder')}
        <div className="toolbar">
          <Button
            onClick={() => {
              setMessage(null)
              window.api.settings.openLogsFolder().catch((error: unknown) => {
                setMessage(sentenceOf(error))
              })
            }}
          >
            <Icon name="info" />
            Open logs folder
          </Button>
        </div>
        <p className="message">
          The app writes its log to standard error for now; the folder is where a log file will go.
        </p>
      </section>

      <section aria-labelledby="settings-appearance">
        <h2 id="settings-appearance">Appearance</h2>
        <div className="field">
          {/* The kit names the native select itself; this is the visible word. */}
          <span className="field-label" aria-hidden="true">
            Theme
          </span>
          <Select
            className="theme-select"
            label="Theme"
            value={settings.theme}
            onChange={(value) => {
              if (isAppTheme(value)) change(() => window.api.settings.setTheme(value))
            }}
          >
            {APP_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </Select>
          <p className="message">
            Warm dark and sepia are the engine&rsquo;s own two. This is the interface&rsquo;s; a
            project&rsquo;s own theme, which its page wears, is the project&rsquo;s.
          </p>
        </div>
      </section>

      <section aria-labelledby="settings-versions">
        <h2 id="settings-versions">Versions</h2>
        {info === null ? (
          <p className="message" role="status">
            {ready
              ? 'Asking the engine…'
              : 'The engine is not running, so it cannot say what versions it has.'}
          </p>
        ) : (
          <dl className="fields">
            <dt>Engine</dt>
            <dd>{info.engine}</dd>
            <dt>Protocol</dt>
            <dd>{info.protocol}</dd>
            <dt>Python</dt>
            <dd>{info.python}</dd>
            <dt>LOOM backend</dt>
            <dd>{info.loom.backend}</dd>
            <dt>LOOM commit</dt>
            <dd>{reported(info.loom.commit, 'the host reported no commit')}</dd>
            <dt>ffmpeg</dt>
            <dd>{reported(info.ffmpeg, 'none found')}</dd>
          </dl>
        )}
      </section>

      <section aria-labelledby="settings-reset">
        <h2 id="settings-reset">Engine data</h2>
        <p className="message" id="reset-description">
          Resetting removes everything the engine keeps: every project, every downloaded feed and
          every stored layout. It cannot be undone, and it will not run while a layout or an export
          is going.
        </p>
        <div className="toolbar">
          <Button
            variant="destructive"
            aria-describedby="reset-description"
            onClick={() => {
              setMessage(null)
              setNotice(null)
              setConfirming(true)
            }}
          >
            <Icon name="trash" />
            Reset engine data
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirming}
        title="Reset the engine's data?"
        description="This removes every project, every downloaded feed and every stored layout, and makes the folder again, empty. Exported files are not touched. It cannot be undone."
        confirmLabel="Reset"
        onConfirm={reset}
        onCancel={() => setConfirming(false)}
      />
    </main>
  )
}
