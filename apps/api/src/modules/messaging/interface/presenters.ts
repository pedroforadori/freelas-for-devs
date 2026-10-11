import type { Message } from '@f4d/contracts';
import type { MessageRecord } from '../application/ports.js';

/** A equipe de especialistas responde como um todo: o nome de quem é Admin não é exposto. */
export const SPECIALIST_DISPLAY_NAME = 'Especialista Freelas 4 Devs';

export const toMessageDto = (message: MessageRecord, senderName: string): Message => ({
  id: message.id,
  conversationId: message.conversationId,
  sender: {
    userId: message.senderId,
    displayName: message.senderRole === 'SPECIALIST' ? SPECIALIST_DISPLAY_NAME : senderName,
    role: message.senderRole,
  },
  body: message.body,
  masked: message.masked,
  createdAt: message.createdAt.toISOString(),
});
