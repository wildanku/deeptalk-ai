/**
 * Whole years between a `YYYY-MM-DD` birth date and `now`; `null` for a missing, malformed,
 * or future date (treated as "ask again", never as an age).
 */
export function ageInYears(
  birthDate: string | null | undefined,
  now = new Date(),
): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  const born = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime()) || born.getTime() > now.getTime())
    return null;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() &&
      now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age > 120 ? null : age;
}
