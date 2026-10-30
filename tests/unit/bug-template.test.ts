// The bug report form (issue 567): what a person is asked for, and the one
// thing about it that decides whether the logs can be attached. GitHub
// treats a text area with `render` as code and takes no attachment into it,
// so the field for the log files must not have one while the diagnostics
// field must (a `#` line would otherwise draw as a heading). No YAML parser
// is a dependency of the app, and the form is flat, so it is read as the
// text it is: a block for each `- type:`.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Field {
  type: string
  id: string
  text: string
}

async function fields(): Promise<Field[]> {
  const source = await readFile(join(__dirname, '../../.github/ISSUE_TEMPLATE/bug.yml'), 'utf8')
  const body = source.slice(source.indexOf('\nbody:\n'))
  return body
    .split(/^ {2}- type: /m)
    .slice(1)
    .map((text) => ({
      type: text.split('\n')[0].trim(),
      id: /^ {4}id: (\S+)/m.exec(text)?.[1] ?? '',
      text,
    }))
}

async function field(id: string): Promise<Field> {
  const found = (await fields()).find((f) => f.id === id)
  if (found === undefined) throw new Error(`the form has no field with the id ${id}`)
  return found
}

const labelOf = (f: Field): string => /^ {6}label: (.+)$/m.exec(f.text)?.[1].trim() ?? ''
const rendered = (f: Field): boolean => /^ {6}render:/m.test(f.text)
const required = (f: Field): boolean => /^\s+required: true$/m.test(f.text)

describe('the bug report form', () => {
  it('has a text area for log files that takes an attachment, so it sets no render', async () => {
    const logs = await field('logs')
    expect(logs.type).toBe('textarea')
    expect(labelOf(logs)).toBe('Log files (optional)')
    expect(rendered(logs)).toBe(false)
    expect(required(logs)).toBe(false)
    expect(logs.text).toContain('drag main.log and engine.log here')
  })

  it('keeps the diagnostics as text, which is why the logs have a field of their own', async () => {
    const diagnostics = await field('diagnostics')
    expect(diagnostics.type).toBe('textarea')
    expect(diagnostics.text).toMatch(/^ {6}render: text$/m)
  })

  it('asks where it went wrong, in seven places', async () => {
    const where = await field('where')
    expect(where.type).toBe('dropdown')
    expect(labelOf(where)).toBe('Where did it go wrong?')
    const options = [...where.text.matchAll(/^ {8}- (.+)$/gm)].map((m) => m[1].trim())
    expect(options).toEqual([
      'Installing or first opening',
      'Opening a sample city or a feed',
      'Laying out',
      'The map, style or lines',
      'Exporting',
      'Settings or reset',
      'Something else',
    ])
  })

  it('asks whether it worked in an earlier version', async () => {
    const earlier = await field('earlier')
    expect(earlier.type).toBe('input')
    expect(labelOf(earlier)).toBe('Did this work in an earlier version? Which?')
  })

  it('will not send until the person says they read what they pasted', async () => {
    const read = await field('read')
    expect(read.type).toBe('checkboxes')
    expect(read.text).toContain(
      '- label: I read what I pasted or attached and removed anything I would rather not share.',
    )
    expect(required(read)).toBe(true)
  })

  it('still asks for the version, with an example that is no version', async () => {
    const version = await field('version')
    expect(required(version)).toBe(true)
    const placeholder = /^ {6}placeholder: "(.*)"$/m.exec(version.text)?.[1]
    expect(placeholder, 'a placeholder').toBeTruthy()
    // A number in an example is read as the number to type, and goes stale
    // with the first release after it.
    expect(placeholder).not.toMatch(/\d/)
    expect(placeholder).toContain('Settings › Versions')
    // And for a person whose app will not open, who has no Settings to read.
    expect(version.text).toMatch(
      /^ {6}description: .*if the app opens; if it does not, the version you downloaded\.$/m,
    )
  })
})
