import { auditLog } from '../../../db/schema/audit.js';
import type { AuditEntry, AuditLogger } from '../../application/audit-log.js';
import type { IdGenerator } from '../../kernel/domain-event.js';
import type { DatabaseContext } from '../database/database-context.js';

/** Grava no executor corrente: dentro de um caso de uso, a ação e sua auditoria são atômicas. */
export class DrizzleAuditLogger implements AuditLogger {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.ctx.executor.insert(auditLog).values({
      id: this.ids.next(),
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
      ip: entry.request.ip,
      userAgent: entry.request.userAgent?.slice(0, 512) ?? null,
      requestId: entry.request.requestId,
    });
  }
}
