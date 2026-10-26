// The foot of the project's screen, and what its delete confirmation says
// (issue 543): the confirmation named what goes and what stays, but not
// that exported files, which live in the person's own folder outside the
// project, stay where they are.
//
// Rendered to static markup inside the provider, as the notebook's other
// adapters are; the confirmation's dialog and its description are in the
// document whether or not it is open.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import ProjectFooter from '../../src/renderer/src/notebook/ProjectFooter'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'

const state = {
  project: {
    id: 'p1',
    name: 'Los Angeles',
    created: '2026-09-13T14:03:00+00:00',
    modified: '2026-09-13T14:03:00+00:00',
    readOnly: false,
  },
  rename: { open: false, buttonRef: { current: null } },
  remove: {
    confirming: false,
    problem: null,
    buttonRef: { current: null },
    begin: () => {},
    confirm: async () => {},
    cancel: () => {},
    setProblem: () => {},
  },
  exporting: false,
  layingOut: false,
} as unknown as ProjectState

describe('the delete confirmation', () => {
  const html = renderToStaticMarkup(
    <ProjectProvider value={state}>
      <ProjectFooter />
    </ProjectProvider>,
  )

  it('says what goes, what stays and that exported files stay where they are', () => {
    expect(html).toContain(
      'This removes the project and its generated output. The feed stays. Exported files stay where they are.',
    )
  })

  it('draws no alert while nothing has gone wrong', () => {
    expect(html).not.toContain('role="alert"')
  })

  it('is titled with the project it would delete', () => {
    expect(html).toContain('Delete Los Angeles?')
  })
})
