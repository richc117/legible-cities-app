import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react'
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
 * Whether a mode keeps a route type, from the engine's list of the names
 * that keep it: "all" keeps every type, a name keeps the types it names
 * (subway and metro alike, as gtfs2graph takes them), a number keeps its
 * own code; several are comma-joined.
 */
export function keeps(mode: string, type: RouteType): boolean {
  const parts = mode.split(',').map((p) => p.trim())
  return parts.some(
    (part) => part === 'all' || type.modes.includes(part) || part === String(type.route_type),
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

/** What the handback reads of a control: whether it holds the element that has focus. */
export interface Holds<E> {
  contains(element: E): boolean
}

/**
 * Whether focus is handed to the cell's heading (issue 221): `was` and
 * `disabled` are the panel's `disabled` as it was last drawn and as it is
 * now, `active` what holds focus, and `going` the controls `disabled` takes.
 *
 * Only when `disabled` has just turned true. A sample city opens with its
 * layout already starting (issue 178), so the panel can be drawn disabled
 * from the first, and being drawn is not a change: nothing takes focus
 * because a screen opened. A run ending is not one either.
 *
 * And only when what holds focus is one of the controls that go, which is
 * narrower than "inside the panel". The table's sortable headers and the
 * typed mode's field stay live through a run, so focus on one of them is
 * as much a person's own as focus in another cell, and is left where it is.
 * A control that is not drawn - none yet, or the typed mode's button while
 * nothing is being typed - is null here and holds nothing.
 */
export function handsBack<E>(
  was: boolean,
  disabled: boolean,
  active: E | null,
  going: readonly (Holds<E> | null)[],
): boolean {
  if (was || !disabled || active === null) return false
  return going.some((control) => control !== null && control.contains(active))
}

interface Props {
  project: ProjectRecord
  engine: EngineState | null
  inspect: (key: string) => Promise<Inspection>
  /** Stores the two inputs; a rejection's message is shown beside the controls. */
  onInputs: (inputs: ProjectInputs) => Promise<void>
  /** The feed's registry entry's mode and agency, when the Library listed it. */
  registry?: { mode: string; agency: string | null } | null
  /**
   * True while a layout run or an export is going: the choice is what the
   * run was started with, so the mode, the operator and the two buttons
   * beside them wait for it to end.
   */
  disabled?: boolean
  /**
   * Where focus goes when one of those controls held it: the heading of the
   * cell the panel is drawn in (issue 221), since Chromium blurs a disabled
   * element and focus would fall to the body. `DataCell` always gives it.
   * It is optional only for the heading outline's unit test, which draws
   * the panel with no cell's heading to give; a call site in the app that
   * leaves it out drops the focus this exists to keep.
   */
  handback?: RefObject<HTMLElement | null>
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
  handback,
}: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const [state, setState] = useState<State>({ status: 'waiting' })
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'label',
    descending: false,
  })
  // `mode` and `agency` mirror the record; `draft` is the typed mode until
  // it is submitted, so a change of operator never writes a half-typed one,
  // and a write coming back never interrupts a person typing.
  const [mode, setMode] = useState(project.mode)
  const [draft, setDraft] = useState(project.mode)
  const [custom, setCustom] = useState(false)
  const [agency, setAgency] = useState<string | null>(project.agency)
  const [message, setMessage] = useState<string | null>(null)
  const modeRef = useRef<HTMLElement>(null)
  const typedRef = useRef<HTMLElement>(null)
  const operatorRef = useRef<HTMLElement>(null)
  const entryRef = useRef<HTMLElement>(null)

  // A run can start with nobody pressing anything here: a colour or an order
  // change is debounced, so its rebuild begins from a timer, and the control
  // a person is on in this cell is disabled under them. Chromium blurs a
  // disabled element, so focus is handed to the cell's heading first
  // (`handsBack` says when).
  //
  // A layout effect, where the theme switch's is a passive one. The kit's
  // buttons are disabled by their wrapper's own passive effect, which runs
  // straight before a parent's, so nothing comes between the two. The kit's
  // dropdown takes `disabled` as an attribute, which React writes in the
  // commit itself: the browser may update the rendering, and move focus to
  // the body, before any passive effect has run, and this would then find
  // nothing of its own holding focus. A layout effect runs in that same
  // commit, while the select just disabled is still what holds it.
  const was = useRef(disabled)
  useLayoutEffect(() => {
    const hand = handsBack<Node>(was.current, disabled, document.activeElement, [
      modeRef.current,
      typedRef.current,
      operatorRef.current,
      entryRef.current,
    ])
    was.current = disabled
    if (hand) handback?.current?.focus()
  }, [disabled, handback])

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
      setDraft(mode)
      return
    }
    setCustom(false)
    setMode(value)
    void store({ mode: value, agency })
  }
  const chooseAgency = (value: string): void => {
    const next = value === '' ? null : value
    setAgency(next)
    void store({ mode: project.mode, agency: next })
  }
  const useEntry = (): void => {
    if (registry === null) return
    // The sentence and its button go once the choice is the entry's, and
    // the button takes focus with it; the mode it just set is where focus
    // belongs (A6-07). The kit names its native select, which is what
    // takes focus.
    modeRef.current?.querySelector('select')?.focus()
    setCustom(false)
    setMode(registry.mode)
    setAgency(registry.agency)
    void store(registry)
  }
  // A stored agency the feed does not list is shown so it can be cleared.
  const agencyOptions = [...(inspection?.agencies ?? [])]
  if (agency !== null && !agencyOptions.some((a) => a.agency_id === agency))
    agencyOptions.push({ agency_id: agency, agency_name: `${agency} (not in this feed)` })
  const offerOperator = agency !== null || (inspection !== null && inspection.agencies.length > 1)

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
      {/* Cell 01 is called Data and holds three things - the record's three
          stored fields, this panel and the geographic view - so the cell's
          own heading cannot name any one of them, and a person reading down
          the cell has to be told where the stored fields end and the feed's
          own contents begin. The heading is a level below the cell's, as
          cell 05's two sections are (A5.5-18), and is what names this
          region (issue 197). It takes no focus, and nothing hands it any.
          When a run or an export disables the control a person is on here,
          focus goes to the cell's own heading, which `DataCell` makes and
          gives to `Cell` as `headingRef` and to this panel as `handback`,
          as cells 03 to 06 do (issue 221): that heading is the one the rail
          moves focus to, and a person sent there knows which cell they are
          in, where this one would say only which part of it. */}
      <h3 id="inspect-heading">In the feed</h3>
      {state.status === 'waiting' && (
        <p className="hint" role="status">
          {ready
            ? 'Reading the feed, and downloading it first if it is not on this machine yet…'
            : 'The engine is not ready, so the feed cannot be read yet.'}
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
                ref={modeRef}
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
                    setMode(draft)
                    void store({ mode: draft, agency })
                  }}
                >
                  <label htmlFor="inspect-mode">Modes, comma-joined, or route_type numbers</label>
                  <TextInput
                    id="inspect-mode"
                    value={draft}
                    onChange={setDraft}
                    spellCheck={false}
                  />
                  <div className="actions">
                    <Button ref={typedRef} variant="primary" type="submit" disabled={disabled}>
                      Use this mode
                    </Button>
                  </div>
                </form>
              )}
            </div>
            {offerOperator && (
              <div className="field">
                <span className="field-label" aria-hidden="true">
                  Operator
                </span>
                <Select
                  ref={operatorRef}
                  label="Operator"
                  value={agency ?? ''}
                  onChange={chooseAgency}
                  disabled={disabled}
                >
                  <option value="">every operator</option>
                  {agencyOptions.map((a) => (
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
                {registry.agency === null ? ' for every operator' : ` for ${registry.agency}`}.{' '}
                <Button ref={entryRef} onClick={useEntry} disabled={disabled}>
                  Use the feed's entry
                </Button>
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
                    />{' '}
                    {r.label}
                  </td>
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
