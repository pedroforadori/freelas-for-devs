// k6: conexões simultâneas no chat (Socket.IO sobre WebSocket, namespace /chat).
// Meta da §8: 1.000 conexões com 2 réplicas do realtime, entrega < 1 s no p95.
//
//   k6 run -e API=wss://api.staging.freelas4devs.com.br -e ORIGIN=https://app.staging.freelas4devs.com.br \
//          -e COOKIE="f4d_at=..." -e CONVERSATION=<uuid> infra/load/chat-connections.js
//
// COOKIE: access token de uma conta de teste participante da conversa (Admin serve: lê todas).
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import ws from 'k6/ws';

export const options = {
  scenarios: {
    connections: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: 500 },
        { duration: '1m', target: 1000 },
        { duration: '3m', target: 1000 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    ws_connecting: ['p(95)<1000'],
    chat_join_ms: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

const joinTime = new Trend('chat_join_ms', true);
const API = __ENV.API;
const url = `${API}/socket.io/?EIO=4&transport=websocket`;

export default function () {
  const params = { headers: { Origin: __ENV.ORIGIN, Cookie: __ENV.COOKIE } };
  const response = ws.connect(url, params, (socket) => {
    let joinedAt = 0;
    socket.on('message', (raw) => {
      // Protocolo engine.io/socket.io v4: 0=open, 2=ping, 40=connect, 43=ack.
      if (raw.startsWith('0')) socket.send('40/chat,');
      else if (raw === '2') socket.send('3');
      else if (raw.startsWith('40/chat')) {
        joinedAt = Date.now();
        socket.send(`42/chat,0["conversation:join",{"conversationId":"${__ENV.CONVERSATION}"}]`);
      } else if (raw.startsWith('43/chat,0')) {
        joinTime.add(Date.now() - joinedAt);
        check(raw, { 'entrou na sala': (text) => text.includes('"ok":true') });
      } else if (raw.startsWith('44/chat')) {
        check(raw, { 'handshake autenticado': () => false });
        socket.close();
      }
    });
    // Fica conectado como um usuário com a página aberta.
    socket.setTimeout(() => socket.close(), 60_000);
  });
  check(response, { 'upgrade 101': (r) => r && r.status === 101 });
  sleep(1);
}
