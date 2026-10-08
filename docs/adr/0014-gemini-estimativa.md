# ADR-0014: Gemini como provedor padrão da estimativa

- **Status:** Aceito (substitui o provedor definido no ADR-0013; o restante do ADR-0013 continua valendo)
- **Data:** 2026-10-08

## Contexto

O fundador já tem créditos no Gemini. A estimativa depende só da porta `ProjectEstimator` (ADR-0013), então trocar o provedor não afeta domínio, fila nem telas.

## Decisão

- **`ESTIMATOR=gemini`** é o provedor de produção, com o modelo em `GEMINI_MODEL` (padrão `gemini-3.8-flash`) e a chave em `GEMINI_API_KEY`. O adapter usa o SDK oficial `@google/genai` com **function calling obrigatório** (`mode: ANY` e `allowedFunctionNames`). Na 2ª rodada só a função de estimativa é oferecida, o que mantém a regra de perguntar uma única vez.
- **As ferramentas ficam em formato neutro** (JSON Schema em `prompt.ts`) e a validação da resposta é compartilhada (`estimator-output.ts`). Cada adapter só traduz a chamada para o seu provedor.
- **O adapter Claude continua disponível** com `ESTIMATOR=anthropic`, como alternativa.
- **O teto de saída é de 8.192 tokens**, porque o raciocínio dos modelos Gemini 3 conta nesse limite. O custo registrado em `ai_estimation_runs` soma os tokens de raciocínio aos de saída.
- **Retentativas ficam com o job**, não com o SDK (`retryOptions.attempts = 1`), e o tempo limite comum é `ESTIMATOR_TIMEOUT_MS`.

## Consequências

- A mesma `PROMPT_VERSION` vale para os dois provedores. Ao trocar de provedor ou de modelo, compare as estimativas dos primeiros projetos: os registros de `ai_estimation_runs` guardam o modelo de cada chamada.
- O pacote `@google/genai` tem script de instalação, que fica negado em `allowBuilds`: ele é no-op e o pacote já vem compilado.
