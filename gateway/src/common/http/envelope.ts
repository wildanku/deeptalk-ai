/**
 * Escape hatch for controllers that need a custom `message` alongside (or instead of) `data`
 * in the `{ success, message?, data }` envelope — e.g. legacy's "Time slot has been deleted"
 * responses that carry no payload. Returning any other value from a controller is wrapped as
 * `{ success: true, data: <value> }` by `ResponseInterceptor`.
 */
export class MessageEnvelope<T = undefined> {
  constructor(
    public readonly message: string,
    public readonly data?: T,
  ) {}
}

export function withMessage<T>(message: string, data?: T): MessageEnvelope<T> {
  return new MessageEnvelope(message, data);
}
