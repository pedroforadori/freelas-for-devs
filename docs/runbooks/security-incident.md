# Incidente de segurança

1. **Conter:** rotacione os segredos envolvidos ([rotação](./secrets-rotation.md)); suspenda contas comprometidas (Admin → Moderação); se preciso, `access.signupMode = INVITE_ONLY`.
2. **Preservar evidências:** exporte `audit_log` e os logs do período antes de qualquer limpeza.
3. **Avaliar:** quais dados, quantos titulares, desde quando.
4. **Comunicar:** havendo risco relevante aos titulares, comunicar a ANPD e os afetados em prazo razoável (Resolução CD/ANPD nº 15/2024: 3 dias úteis). Envolver o jurídico.
5. **Corrigir e aprender:** correção + teste que impeça a regressão + registro do incidente (o que houve, impacto, ação).
