# ADR-0020: Reputação, score e progressão de nível (F9)

- **Status:** Aceito
- **Data:** 2026-10-12

## Contexto

A fila (ADR-0015) ordenava só por prioridade e vez. O nível vinha da aprovação do perfil e mudava só por reclassificação manual. A §6 (passo 10) prevê três coisas:

- um score de desempenho que ajuste a vez na fila;
- progressão de nível por regras configuráveis;
- tudo isso sem penalizar o iniciante.

## Decisão

### Estatísticas

- Módulo `reputation`, com a tabela `freelancer_stats` como read model.
- As contagens vêm dos contratos, das avaliações, dos convites e das disputas:
  - concluídos (`APPROVED`/`RELEASED`) e iniciados;
  - avaliações;
  - "no prazo": a última entrega chegou até o prazo combinado, que já inclui pausas e adicionais;
  - abandonos;
  - convites respondidos e expirados.
- Recalculadas:
  - todas as noites às 03:00 de Brasília (job scheduler do BullMQ com `tz`);
  - na hora para o freelancer afetado, quando um contrato é liberado, encerrado pela mediação ou abandonado;
  - sob demanda pelo painel ("Recalcular agora").

### Score (0–1)

- Média ponderada de quatro componentes:
  - nota dos clientes: 35%;
  - entregas no prazo: 25%;
  - confiabilidade (1 − abandonos): 25%;
  - resposta a convites: 15%.
- Cada componente tem **suavização bayesiana**: começa em 0,5 com peso de 4 observações neutras. Sem histórico, o score é exatamente 0,5 (o iniciante não é penalizado), e poucos dados mexem pouco.
- Quando o score muda, o evento `reputation.ScoreChanged` vai para o outbox, e a fila guarda o valor em `queue_entries.score`.

### Efeito na fila

- Entre os sem prioridade, a chave passa a ser `last_invited_at − bônus × (score − 0,5) × 2`.
- O bônus vem de `queue.performanceBonusHours` (padrão: 72 h).
- A prioridade (quem não foi escolhido) continua acima do desempenho. Quem nunca foi convidado continua na frente.
- O Admin vê o desempenho na tela da fila.

### Progressão

- Regra por nível (`levels.promotion`, editável em `/admin/niveis`, auditada):
  - mínimo de concluídos, nota média, % no prazo e score;
  - máximo de abandonos;
  - modo automático ou revisado.
- Valores iniciais (seed): Iniciante→Intermediário 3/4,0/70%/0,55/0 (automática), Intermediário→Avançado 8/4,3/80%/0,60/0 (automática), Avançado→Especialista 15/4,6/85%/0,70/0 (revisada).
- Promoção automática pela fachada de perfis (`ProfilesFacade.promote`):
  - registra o histórico com o motivo e sem autor;
  - publica `FreelancerLevelChanged` (a fila se sincroniza);
  - avisa o freelancer por e-mail.
- Regra revisada: o caso aparece em "Sugestões" e o Admin promove pela reclassificação manual que já existia.
- Não há rebaixamento automático: rebaixar continua manual.

### Transparência

- O freelancer vê no perfil:
  - estatísticas;
  - progresso critério a critério;
  - histórico de nível.
- O cliente vê nas propostas só o histórico real (nota média, avaliações e projetos concluídos), nunca o score interno.

## Consequências

- **Regras mudam na hora**: valem a partir do próximo cálculo e não são copiadas para as rodadas já abertas. O bônus de desempenho também é lido no momento de preencher a rodada.
- **Avaliação nova espera o recálculo**: não há evento de avaliação, então a nota entra no próximo cálculo (noturno ou na liberação do pagamento).
- **Recálculo completo varre todos os freelancers aprovados**: com muitos milhares, o recálculo noturno deve passar a ser em lotes (as consultas já aceitam lista de usuários).
