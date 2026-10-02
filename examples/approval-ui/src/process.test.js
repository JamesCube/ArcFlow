import { describe, it, expect } from 'vitest'
import { cloneDefinition, validateDefinition, stepState, stepStateLabel } from './process'
const definition = () => ({ schemaVersion: 2, id: 'leave-approval', version: 1, name: 'Leave approval', nodes: [{ id: 'start', type: 'start', name: 'Start', assigneeId: null }, { id: 'manager', type: 'approval', name: 'Manager', assigneeId: 'bob' }, { id: 'end', type: 'end', name: 'End', assigneeId: null }] })
describe('process definition helpers', () => {
  it('clones a valid sequential template without shared references', () => {
    const original = definition(), copy = cloneDefinition(original)
    copy.nodes[1].name = 'Changed'
    expect(original.nodes[1].name).toBe('Manager'); expect(validateDefinition(original)).toEqual([])
  })
  it('rejects unavailable templates, empty sequences, invalid ids and assignments', () => {
    expect(validateDefinition(null)).toHaveLength(1)
    const empty = definition(); empty.nodes = [empty.nodes[0], empty.nodes[2]]
    expect(validateDefinition(empty).join(' ')).toContain('between 1 and 8')
    const invalid = definition(); invalid.nodes[1].id = 'start'; invalid.nodes[1].assigneeId = 'alice'
    expect(validateDefinition(invalid).join(' ')).toContain('unique identifier')
    expect(validateDefinition(invalid).join(' ')).toContain('Choose Bob or Carol')
    invalid.nodes[1].id = '_bad'; expect(validateDefinition(invalid).join(' ')).toContain('start with a letter')
  })
  it('validates fixed boundary identifiers, name limits, and control characters', () => {
    const invalid = definition(); invalid.nodes[0].id = 'other'; invalid.name = 'x'.repeat(121)
    invalid.nodes[1].name = 'bad\nname'
    const errors = validateDefinition(invalid).join(' ')
    expect(errors).toContain('fixed start'); expect(errors).toContain('120 characters'); expect(errors).toContain('control characters')
  })
  it('uses step IDs rather than repeated names or assignees to identify completed steps', () => {
    const node = definition().nodes[1]
    const request = { status: 'PENDING', currentStepId: 'again', history: [{ stepId: node.id, action: 'APPROVE' }] }
    expect(stepState(request, node)).toBe('approved')
    expect(stepState(request, { ...node, id: 'again' })).toBe('current')
    expect(stepStateLabel('current')).toBe('Awaiting review')
  })
})

describe('malformed process responses', () => {
  it.each([null, [], 7, 'bad', {}, { nodes: {} }, { nodes: [null] }, { nodes: ['node'] }, { name: 2, nodes: [] }])('returns validation errors without throwing for %j', value => {
    expect(() => validateDefinition(value)).not.toThrow()
    expect(validateDefinition(value).length).toBeGreaterThan(0)
  })
  it.each([{ schemaVersion: 1 }, { id: 'other' }, { version: 0 }, { version: 1.5 }, { version: '1' }])('rejects unsupported identity/version %j', overrides => {
    expect(validateDefinition({ ...definition(), ...overrides }).join(' ')).toContain('schema 2')
  })
  it('rejects assigned boundary nodes and invalid boundary names', () => {
    const invalid = definition(); invalid.nodes[0].assigneeId = 'bob'; invalid.nodes[2].name = ' '
    expect(validateDefinition(invalid).join(' ')).toContain('Start and end must have no assigned approver')
    expect(validateDefinition(invalid).join(' ')).toContain('Give end node a name')
  })
  it('rejects ISO control characters and non-string names', () => {
    const invalid = definition(); invalid.name = 'Leave\u0085approval'; invalid.nodes[1].name = 4
    expect(validateDefinition(invalid).join(' ')).toContain('control characters')
    expect(validateDefinition(invalid).join(' ')).toContain('Give approval step 1 a name')
  })
})
