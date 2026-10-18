/** UTC instant of local midnight `y-m-d` in `timeZone`. */
export function zonedMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(guess);
  const offset =
    parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(offset);
  const minutes = match
    ? (match[1] === '-' ? -1 : 1) *
      (Number(match[2]) * 60 + Number(match[3] ?? 0))
    : 0;
  return new Date(guess.getTime() - minutes * 60_000);
}

/** Start of the month after `period` (`YYYY-MM`) in `timeZone` — when the quota resets. */
export function quotaResetsAt(period: string, timeZone: string): Date {
  const [year, month] = period.split('-').map(Number);
  return month === 12
    ? zonedMidnight(year + 1, 1, 1, timeZone)
    : zonedMidnight(year, month + 1, 1, timeZone);
}

/**
 * Active time added by one activity (02 §6.3): the gap since the previous activity, capped,
 * so typing slowly or pausing to think is never "punished" with lost minutes.
 */
export function activeIncrement(
  lastActivity: Date,
  now: Date,
  capSeconds: number,
): number {
  const gap = Math.floor((now.getTime() - lastActivity.getTime()) / 1000);
  return Math.max(0, Math.min(gap, capSeconds));
}
