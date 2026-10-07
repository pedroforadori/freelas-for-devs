import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from './domain-error.js';
import { defineStateMachine } from './state-machine.js';

type State = 'DRAFT' | 'OPEN' | 'CLOSED';
type Event = 'publish' | 'close' | 'reopen';
interface Ctx {
  hasTitle: boolean;
}

const machine = defineStateMachine<State, Event, Ctx>({
  name: 'Sample',
  initial: 'DRAFT',
  terminal: ['CLOSED'],
  transitions: {
    DRAFT: {
      publish: { target: 'OPEN', guard: (ctx) => ctx.hasTitle || 'título obrigatório' },
    },
    OPEN: { close: 'CLOSED' },
    CLOSED: {},
  },
});

describe('defineStateMachine', () => {
  it('follows declared transitions', () => {
    const result = machine.transition('OPEN', 'close', { hasTitle: true });
    expect(result).toEqual({ ok: true, value: 'CLOSED' });
  });

  it('rejects undeclared transitions with a typed error', () => {
    const result = machine.transition('CLOSED', 'reopen', { hasTitle: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidStateTransitionError);
      expect(result.error.details).toMatchObject({
        machine: 'Sample',
        from: 'CLOSED',
        event: 'reopen',
      });
    }
  });

  it('evaluates guards and reports the refusal reason', () => {
    expect(machine.can('DRAFT', 'publish', { hasTitle: true })).toBe(true);
    const refused = machine.transition('DRAFT', 'publish', { hasTitle: false });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.details).toMatchObject({ reason: 'título obrigatório' });
  });

  it('lists events and terminal states', () => {
    expect(machine.eventsFrom('DRAFT')).toEqual(['publish']);
    expect(machine.isTerminal('CLOSED')).toBe(true);
    expect(machine.isTerminal('OPEN')).toBe(false);
  });

  it('renders a Mermaid diagram from the table', () => {
    expect(machine.toMermaid()).toBe(
      [
        'stateDiagram-v2',
        '  [*] --> DRAFT',
        '  DRAFT --> OPEN: publish',
        '  OPEN --> CLOSED: close',
        '  CLOSED --> [*]',
      ].join('\n'),
    );
  });
});
