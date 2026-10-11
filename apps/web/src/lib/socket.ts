'use client';

import { io, type Socket } from 'socket.io-client';
import { publicEnv } from './env';

let chat: Socket | null = null;

/**
 * Conexão única com o namespace /chat da API. A sessão vai no cookie httpOnly (mesmo site da
 * API); a API confere a origem e quem pode entrar em cada conversa.
 */
export const chatSocket = (): Socket => {
  chat ??= io(`${publicEnv.NEXT_PUBLIC_API_URL}/chat`, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  return chat;
};
