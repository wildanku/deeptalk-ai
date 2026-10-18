import type { PlainMessage } from '../messages/messages.service';

/** Marker the agent sees where the safety protocol replaced a persona reply. */
export const PROTOCOL_MARKER =
  '[Protokol keamanan ditampilkan kepada pengguna]';

/** Stored messages → agent history. Protocol messages become a marked assistant turn. */
export function toAgentHistory(
  messages: PlainMessage[],
): { role: 'user' | 'assistant'; content: string }[] {
  return messages.map((message) =>
    message.role === 'protocol'
      ? {
          role: 'assistant' as const,
          content: `${PROTOCOL_MARKER}\n${message.content}`,
        }
      : { role: message.role, content: message.content },
  );
}
