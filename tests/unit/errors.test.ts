import { describe, expect, it } from 'vitest'
import { unwrapIpcError } from '../../src/shared/errors'

describe('unwrapIpcError', () => {
  it("strips Electron's remote-method wrapper and the Error: prefix", () => {
    expect(
      unwrapIpcError("Error invoking remote method 'projects:create': Error: name is required"),
    ).toBe('name is required')
    expect(unwrapIpcError("Error invoking remote method 'projects:get': not found")).toBe(
      'not found',
    )
  })
  it('leaves a bare message alone', () => {
    expect(unwrapIpcError('read-only')).toBe('read-only')
    expect(unwrapIpcError('')).toBe('')
  })
})
