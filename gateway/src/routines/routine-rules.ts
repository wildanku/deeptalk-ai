import { z } from 'zod';

/**
 * Topics that never get a routine; the user is pointed to a psikolog instead (Konsep §3.6):
 * alcohol and substance dependence, eating and weight, and anything related to self-harm.
 */
export const EXCLUDED_ROUTINE_TOPICS: ReadonlySet<string> = new Set([
  'alkohol',
  'zat',
  'narkoba',
  'makan',
  'berat_badan',
  'menyakiti_diri',
  'self_harm',
]);

/** Small on purpose: "mulai kecil, maksimal 2–3 kebiasaan" (Konsep §3.6). */
export const MAX_ROUTINE_ITEMS = 3;
export const MAX_ACTIVE_ROUTINES = 2;

export const routineProposalSchema = z.object({
  topic: z.string().regex(/^[a-z0-9_]{2,64}$/),
  // Optional fields may arrive as null from the agent (Pydantic); treat null as absent.
  title: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .nullish()
    .transform((v) => v ?? undefined),
  items: z
    .array(z.object({ library_item_id: z.string().min(1).max(128) }))
    .min(1)
    .max(MAX_ROUTINE_ITEMS),
  personalization_note: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v ?? undefined),
});
export type RoutineProposalInput = z.infer<typeof routineProposalSchema>;

export const reminderTimesSchema = z
  .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
  .max(3);

/** The routine as stored on a proposal or a user routine: a snapshot of the library items. */
export interface RoutineSnapshot {
  topic: string;
  title: string;
  personalization_note: string | null;
  items: {
    id: string;
    version: number;
    title: string;
    description: string;
    kind: 'checklist' | 'scale' | 'note';
    time_of_day: 'morning' | 'afternoon' | 'evening' | 'any';
    trigger: 'on_urge' | null;
    scale: { min: number; max: number; label: string } | null;
    missed_day_message: string | null;
  }[];
}

/** `YYYY-MM-DD` of `date` in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** `HH:mm` of `date` in `timeZone`. */
export function localTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
