// k6: mistura de leituras autenticadas (painel do cliente e do dev) + saúde.
// Meta: p95 < 300 ms e erro < 1% com 200 usuários simultâneos.
//
//   k6 run -e API=https://api.staging.freelas4devs.com.br -e ORIGIN=https://app.staging.freelas4devs.com.br \
//          -e CLIENT_COOKIE="f4d_at=..." -e DEV_COOKIE="f4d_at=..." infra/load/api-read-mix.js
//
// Rode contra staging com RATE_LIMIT_PER_MINUTE alto (o limite por IP derrubaria o teste).
import http from 'k6/http';
import { check, group, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 200 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const API = __ENV.API;
const as = (cookie) => ({ headers: { Origin: __ENV.ORIGIN, Cookie: cookie } });

export default function () {
  group('saúde', () => {
    check(http.get(`${API}/v1/health`), { 'health 200': (r) => r.status === 200 });
  });
  group('cliente', () => {
    const params = as(__ENV.CLIENT_COOKIE);
    for (const path of ['/v1/me', '/v1/projects', '/v1/me/contracts', '/v1/conversations']) {
      check(http.get(`${API}${path}`, params), { [`cliente ${path}`]: (r) => r.status === 200 });
    }
  });
  group('dev', () => {
    const params = as(__ENV.DEV_COOKIE);
    for (const path of [
      '/v1/me',
      '/v1/me/invitations?view=open',
      '/v1/me/queue',
      '/v1/me/reputation',
    ]) {
      check(http.get(`${API}${path}`, params), { [`dev ${path}`]: (r) => r.status === 200 });
    }
  });
  sleep(1);
}
