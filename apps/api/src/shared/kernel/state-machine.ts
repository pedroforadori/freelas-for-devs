import { InvalidStateTransitionError } from './domain-error.js';
import { err, ok, type Result } from './result.js';

/** Guard puro: retorna `true` para permitir ou uma string com o motivo da recusa. */
export type Guard<TCtx> = (ctx: TCtx) => true | string;

export type TransitionTarget<TState extends string, TCtx> =
  TState | { readonly target: TState; readonly guard: Guard<TCtx>; readonly description?: string };

export type TransitionTable<TState extends string, TEvent extends string, TCtx> = {
  readonly [S in TState]: { readonly [E in TEvent]?: TransitionTarget<TState, TCtx> };
};

export interface StateMachineDefinition<TState extends string, TEvent extends string, TCtx> {
  readonly name: string;
  readonly initial: TState;
  /** Estados sem saída; o Mermaid os liga a `[*]`. */
  readonly terminal: readonly TState[];
  readonly transitions: TransitionTable<TState, TEvent, TCtx>;
}

export interface StateMachine<TState extends string, TEvent extends string, TCtx> {
  readonly definition: StateMachineDefinition<TState, TEvent, TCtx>;
  transition(from: TState, event: TEvent, ctx: TCtx): Result<TState, InvalidStateTransitionError>;
  can(from: TState, event: TEvent, ctx: TCtx): boolean;
  /** Eventos declarados a partir de um estado (ignora guards). */
  eventsFrom(from: TState): TEvent[];
  isTerminal(state: TState): boolean;
  toMermaid(): string;
}

/**
 * Máquina de estados declarativa (ADR-0010). Uma tabela tipada é a única fonte das transições:
 * agregados consultam-na, testes a percorrem e a documentação Mermaid é gerada dela.
 */
export const defineStateMachine = <TState extends string, TEvent extends string, TCtx = void>(
  definition: StateMachineDefinition<TState, TEvent, TCtx>,
): StateMachine<TState, TEvent, TCtx> => {
  const resolve = (from: TState, event: TEvent): TransitionTarget<TState, TCtx> | undefined =>
    definition.transitions[from][event];

  const transition = (
    from: TState,
    event: TEvent,
    ctx: TCtx,
  ): Result<TState, InvalidStateTransitionError> => {
    const entry = resolve(from, event);
    if (entry === undefined)
      return err(new InvalidStateTransitionError(definition.name, from, event));
    if (typeof entry === 'string') return ok(entry);
    const verdict = entry.guard(ctx);
    return verdict === true
      ? ok(entry.target)
      : err(new InvalidStateTransitionError(definition.name, from, event, verdict));
  };

  return {
    definition,
    transition,
    can: (from, event, ctx) => transition(from, event, ctx).ok,
    eventsFrom: (from) => Object.keys(definition.transitions[from]) as TEvent[],
    isTerminal: (state) => definition.terminal.includes(state),
    toMermaid: () => {
      const lines = ['stateDiagram-v2', `  [*] --> ${definition.initial}`];
      for (const from of Object.keys(definition.transitions) as TState[]) {
        for (const [event, entry] of Object.entries(definition.transitions[from]) as [
          TEvent,
          TransitionTarget<TState, TCtx>,
        ][]) {
          const target = typeof entry === 'string' ? entry : entry.target;
          lines.push(`  ${from} --> ${target}: ${event}`);
        }
      }
      for (const state of definition.terminal) lines.push(`  ${state} --> [*]`);
      return lines.join('\n');
    },
  };
};
