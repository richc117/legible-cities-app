import { useEffect, useMemo, useState, type JSX } from 'react'
import type { EngineState } from '../../shared/engine'
import { withoutPaths } from '../../shared/engine'
import type { Inspection, Route, RouteType } from '../../shared/protocol'
import type { ProjectInputs, ProjectRecord } from '../../shared/project'
import { validateAgency, validateMode } from '../../shared/project'
import Button from './kit/Button'
import Select from './kit/Select'
import TextInput from './kit/TextInput'

// What is in the project's feed, as the engine read it, and the two
// choices a person makes with that in view: what LOOM keeps (the mode)
// and whose routes (the agency). Every number, name and sentence here is
// the engine's; the app sorts and filters what it was given and draws
// nothing (constitution I and II). The choice is stored on the record and
// the next layout passes it to the engine, which names a layout for it.

export type SortKey = 'label' | 'type' | 'trips'

/** The routes in the order a column asks for; a tie keeps the engine's order. */
export function sortRoutes(routes: Route[], key: SortKey, descending: boolean): Route[] {
  const sorted = [...routes].sort((a, b) => {
    const cmp =
      key === 'trips'
        ? a.trips - b.trips
        : key === 'type'
          ? a.route_type - b.route_type
          : a.label.localeCompare(b.label, undefined, { numeric: true })
    return descending ? -cmp : cmp
  })
  return sorted
}

/**
 * Whether a mode keeps a route type, from the engine's mode per type:
 * "all" keeps every type, a name keeps the types it names, a number keeps
 * its own code; several are comma-joined, as gtfs2graph takes them.
 */
export function keeps(mode: string, type: RouteType): boolean {
  const parts = mode.split(',').map((p) => p.trim())
  return parts.some(
    (part) => part === 'all' || part === type.mode || part === String(type.route_type),
  )
}

/** The mode words the histogram offers: the engine's per type, "all", and the record's own if it is neither. */
export function modeOptions(types: RouteType[], current: string): string[] {
  const named = types.map((t) => t.mode).filter((m): m is string => m !== null)
  const options = ['all', ...new Set(named)]
  if (!options.includes(current)) options.push(current)
  return options
}

/** The routes the chosen agency keeps: all of them for none. */
export function routesOf(routes: Route[], agency: string | null): Route[] {
  return agency === null ? routes : routes.filter((r) => r.agency_id === agency)
}

interface Props {
  project: ProjectRecord
  engine: EngineState | null
  inspect: (key: string) => Promise<Inspection>
  /** Stores the two inputs; a rejection's message is shown beside the controls. */
  onInputs: (inputs: ProjectInputs) => Promise<void>
  /** The feed's registry entry's mode and agency, when the Library listed it. */
  registry?: { mode: string; agency: string | null } | null
  disabled?: boolean
}

type State =
  | { status: 'waiting' }
  | { status: 'ready'; inspection: Inspection }
  | { status: 'failed'; message: string }

export default function Inspect({
  project,
  engine,
  inspect,
  onInputs,
  registry = null,
  disabled = false,
}: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const [state, setState] = useState<State>({ status: 'waiting' })
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'label',
    descending: false,
  })
  const [mode, setMode] = useState(project.mode)
  const [custom, setCustom] = useState(false)
  const [agency, setAgency] = useState<string | null>(project.agency)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) {
      setState({ status: 'waiting' })
      return
    }
    let left = false
    inspect(project.feed).then(
      (inspection) => {
        if (!left) setState({ status: 'ready', inspection })
      },
      (error: unknown) => {
        if (left) return
        const reason = error as { data?: { hint?: string }; message?: string }
        setState({
          status: 'failed',
          message: withoutPaths(
            reason.data?.hint ?? reason.message ?? 'The feed could not be read.',
          ),
        })
      },
    )
    return () => {
      left = true
    }
  }, [ready, project.feed, inspect])

  // The record is what the controls show; a write comes back through it.
  useEffect(() => {
    setMode(project.mode)
    setAgency(project.agency)
  }, [project.mode, project.agency])

  const inspection = state.status === 'ready' ? state.inspection : null
  const options = useMemo(
    () => (inspection === null ? ['all'] : modeOptions(inspection.route_types, mode)),
    [inspection, mode],
  )
  const rows = useMemo(
    () =>
      inspection === null
        ? []
        : sortRoutes(routesOf(inspection.routes, agency), sort.key, sort.descending),
    [inspection, agency, sort],
  )

  const store = async (inputs: ProjectInputs): Promise<void> => {
    const problem = validateMode(inputs.mode) ?? validateAgency(inputs.agency)
    if (problem !== null) {
      setMessage(problem)
      return
    }
    setMessage(null)
    try {
      await onInputs(inputs)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const chooseMode = (value: string): void => {
    if (value === 'other') {
      setCustom(true)
      return
    }
    setCustom(false)
    setMode(value)
    void store({ mode: value, agency })
  }
  const chooseAgency = (value: string): void => {
    const next = value === '' ? null : value
    setAgency(next)
    void store({ mode, agency: next })
  }

  const heading = (key: SortKey, label: string): JSX.Element => {
    const active = sort.key === key
    return (
      <th scope="col" aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
        <button
          type="button"
          className="sort"
          onClick={() => setSort({ key, descending: active ? !sort.descending : key === 'trips' })}
        >
          {label}
          {active && <span aria-hidden="true">{sort.descending ? ' ↓' : ' ↑'}</span>}
        </button>
      </th>
    )
  }

  return (
    <section className="inspect" aria-labelledby="inspect-heading">
      <h2 id="inspect-heading">In the feed</h2>
      {state.status === 'waiting' && (
        <p className="hint" role="status">
          {ready ? 'Reading the feed…' : 'The engine is not ready, so the feed cannot be read yet.'}
        </p>
      )}
      {state.status === 'failed' && (
        <p className="message error" role="alert">
          {state.message}
        </p>
      )}
      {inspection !== null && (
        <>
          <dl className="fields">
            <dt>Operators</dt>
            <dd>
              {inspection.agencies.length === 0
                ? 'not named'
                : inspection.agencies.map((a) => a.agency_name || a.agency_id).join(', ')}
            </dd>
            <dt>Stops</dt>
            <dd>
              {inspection.stops.total.toLocaleString()}
              {inspection.stops.stations > 0 &&
                `, of which ${inspection.stops.stations.toLocaleString()} stations`}
            </dd>
            <dt>Trips</dt>
            <dd>
              {inspection.trips.toLocaleString()}
              {inspection.frequency_trips > 0 &&
                `, ${inspection.frequency_trips.toLocaleString()} of them headway templates`}
            </dd>
            <dt>Service</dt>
            <dd>
              {inspection.service === null
                ? 'no calendar'
                : `${inspection.service.start} to ${inspection.service.end}; the engine would draw ${inspection.service.busiest_weekday}`}
            </dd>
          </dl>
          {inspection.warnings.length > 0 && (
            <ul className="warnings" aria-label="Warnings">
              {inspection.warnings.map((w) => (
                <li key={w} className="prose">
                  {w}
                </li>
              ))}
            </ul>
          )}

          <div className="inputs">
            <div className="field">
              <span className="field-label" aria-hidden="true">
                Mode
              </span>
              <Select
                label="Mode"
                value={custom ? 'other' : mode}
                onChange={chooseMode}
                disabled={disabled}
              >
                {options.map((m) => (
                  <option key={m} value={m}>
                    {m === 'all'
                      ? 'all (every type)'
                      : m + (m === inspection.suggested_mode ? ' (the engine suggests it)' : '')}
                  </option>
                ))}
                <option value="other">other…</option>
              </Select>
              {custom && (
                <form
                  className="inline-form"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault()
                    void store({ mode, agency })
                  }}
                >
                  <label htmlFor="inspect-mode">Modes, comma-joined, or route_type numbers</label>
                  <TextInput id="inspect-mode" value={mode} onChange={setMode} spellCheck={false} />
                  <div className="actions">
                    <Button variant="primary" type="submit" disabled={disabled}>
                      Use this mode
                    </Button>
                  </div>
                </form>
              )}
            </div>
            {inspection.agencies.length > 1 && (
              <div className="field">
                <span className="field-label" aria-hidden="true">
                  Operator
                </span>
                <Select
                  label="Operator"
                  value={agency ?? ''}
                  onChange={chooseAgency}
                  disabled={disabled}
                >
                  <option value="">every operator</option>
                  {inspection.agencies.map((a) => (
                    <option key={a.agency_id} value={a.agency_id}>
                      {a.agency_name || a.agency_id}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {registry !== null && (registry.mode !== mode || registry.agency !== agency) && (
              <p className="hint" role="status">
                The feed's own entry draws {registry.mode}
                {registry.agency === null ? '' : ` for ${registry.agency}`}.
              </p>
            )}
            <p className="message error" role="alert">
              {message}
            </p>
          </div>

          <table className="histogram">
            <caption>Route types, and what the chosen mode keeps</caption>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Routes</th>
                <th scope="col">Trips</th>
                <th scope="col">Kept</th>
              </tr>
            </thead>
            <tbody>
              {inspection.route_types.map((t) => {
                const kept = keeps(mode, t)
                return (
                  <tr key={t.route_type} data-kept={kept}>
                    <td>
                      {t.name} ({t.route_type})
                    </td>
                    <td>{t.routes.toLocaleString()}</td>
                    <td>{t.trips.toLocaleString()}</td>
                    <td>{kept ? 'kept' : 'left out'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <table className="routes">
            <caption>
              Routes{agency === null ? '' : ` of ${agency}`}: {rows.length.toLocaleString()}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Colour</span>
                </th>
                {heading('label', 'Label')}
                <th scope="col">Name</th>
                {heading('type', 'Type')}
                {heading('trips', 'Trips')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.route_id}>
                  <td>
                    <span
                      className="swatch"
                      style={r.color === null ? undefined : { background: `#${r.color}` }}
                      aria-hidden="true"
                    />
                  </td>
                  <td>{r.label}</td>
                  <td>{r.long_name || r.short_name}</td>
                  <td>
                    {inspection.route_types.find((t) => t.route_type === r.route_type)?.name ??
                      r.route_type}
                  </td>
                  <td>{r.trips.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
