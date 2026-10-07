import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  InternalServerErrorException,
  type NestInterceptor,
} from '@nestjs/common';
import type { RouteContract } from '@f4d/contracts';
import type { FastifyReply } from 'fastify';
import { map, type Observable } from 'rxjs';
import { CONTRACT_ROUTE } from './contract-route.js';

/**
 * Valida a resposta contra o schema do contrato e remove campos não declarados
 * (evita vazar dados internos por engano). Uma divergência vira 500 e é investigada.
 */
@Injectable()
export class ResponseContractInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = Reflect.getMetadata(CONTRACT_ROUTE, ctx.getHandler()) as
      RouteContract | undefined;
    if (!route) return next.handle();

    return next.handle().pipe(
      map((body: unknown) => {
        const status = ctx.switchToHttp().getResponse<FastifyReply>().statusCode;
        const schema = route.responses[status];
        if (!schema) return body;
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          throw new InternalServerErrorException(
            `Resposta de ${route.operationId} (HTTP ${status}) diverge do contrato.`,
          );
        }
        return parsed.data;
      }),
    );
  }
}
