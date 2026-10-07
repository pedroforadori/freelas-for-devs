import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[\w-]{8,128}$/;

/**
 * Reaproveita o `x-request-id` recebido se for seguro (evita log injection); senão gera um UUID.
 * Grava o valor no header para que Fastify (`req.id`), pino-http e a resposta usem o mesmo id.
 */
export const resolveRequestId = (req: IncomingMessage): string => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.headers[REQUEST_ID_HEADER] = id;
  return id;
};
