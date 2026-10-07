/** Contexto da requisição que originou uma ação (para auditoria e sessões). */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const SYSTEM_REQUEST: RequestMeta = { ip: null, userAgent: null, requestId: null };

export interface AuditEntry {
  /** Nulo para ações anônimas (ex.: login falho) ou do sistema. */
  actorId: string | null;
  /** `modulo.acao`, ex.: `auth.login`, `admin.freelancer.approved`. */
  action: string;
  targetType: string;
  targetId: string | null;
  /** Nunca incluir senhas, tokens ou documentos. */
  metadata?: Record<string, unknown>;
  request: RequestMeta;
}

/** Port de auditoria: grava na transação corrente, se houver (a ação e seu registro andam juntos). */
export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
}

export const AUDIT_LOGGER = Symbol('AUDIT_LOGGER');
