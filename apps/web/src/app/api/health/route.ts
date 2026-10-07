/** Healthcheck do processo Next (usado pelo PaaS); não depende da API. */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' });
}
