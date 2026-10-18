export interface ErrorSummary {
  name: string;
  /** Library error code, e.g. Prisma `P2010`. */
  code?: string;
  /** What the database itself said, e.g. SQLSTATE `42P01` (table missing) or `28000` (auth). */
  db_code?: string;
  /** Driver-level failure kind, e.g. `DatabaseNotReachable`. */
  db_kind?: string;
  /** HTTP status from an upstream service (e.g. the agent answered 403). */
  status?: number;
  /** First stack frame in our own code, e.g. `memory.service.js:95 MemoryService.summarize`. */
  where?: string;
}

const FRAME = /^\s+at (?:(?:async )?([\w$.<>]+) \()?(\/[^():]+):(\d+):\d+\)?$/;

// Only the frame lines, matched strictly: the first stack line is the message, which can carry
// conversation content.
function ownFrame(stack: string | undefined): string | undefined {
  for (const line of stack?.split('\n').slice(1) ?? []) {
    const match = FRAME.exec(line);
    if (!match || match[2].includes('/node_modules/')) continue;
    const file = match[2].slice(match[2].lastIndexOf('/') + 1);
    return match[1] ? `${file}:${match[3]} ${match[1]}` : `${file}:${match[3]}`;
  }
  return undefined;
}

/**
 * Safe-to-log summary of an unexpected error (AGENT.md rule 4): names and codes only. Error
 * messages and query text can echo conversation content, so they are never included.
 *
 * Prisma raw queries wrap every database failure in the same `P2010`; the cause (missing
 * table, wrong password, unreachable host) is only in `meta.driverAdapterError.cause`.
 */
export function describeError(error: unknown): ErrorSummary {
  if (!(error instanceof Error)) return { name: typeof error };
  const summary: ErrorSummary = { name: error.name };
  const record = error as unknown as {
    code?: unknown;
    status?: unknown;
    meta?: {
      driverAdapterError?: {
        cause?: { originalCode?: unknown; kind?: unknown };
      };
    };
  };
  if (typeof record.code === 'string') summary.code = record.code;
  if (typeof record.status === 'number') summary.status = record.status;
  const cause = record.meta?.driverAdapterError?.cause;
  if (typeof cause?.originalCode === 'string')
    summary.db_code = cause.originalCode;
  if (typeof cause?.kind === 'string') summary.db_kind = cause.kind;
  const where = ownFrame(error.stack);
  if (where) summary.where = where;
  return summary;
}
