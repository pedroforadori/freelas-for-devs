# ADR-0010: Máquinas de estado declarativas no domínio

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

Projeto, convite/proposta, contrato/entregas, fora de escopo e disputa têm ciclos de vida críticos.

## Decisão

Tabela de transições tipada no `shared/kernel` (`StateMachine<State, Event, Ctx>`) com guards puros. Os agregados expõem métodos de intenção e emitem eventos. Lock otimista por `version`. Um teste compara o Mermaid gerado com a documentação.

## Alternativas descartadas

**XState**: excelente para UI, exagerado para estado persistido no backend.

## Consequências

Transições inválidas são impossíveis por construção e 100% testáveis sem banco.
