export const MIN_AGE = 13;

/** Whole years between a birth date (YYYY-MM-DD, treated as a calendar date) and today. */
export const ageOn = (birthDate: string | Date, today: Date = new Date()): number => {
  const [y, m, d] =
    typeof birthDate === 'string'
      ? birthDate.split('-').map(Number)
      : [birthDate.getUTCFullYear(), birthDate.getUTCMonth() + 1, birthDate.getUTCDate()];
  let age = today.getUTCFullYear() - y!;
  const hadBirthday = today.getUTCMonth() + 1 > m! || (today.getUTCMonth() + 1 === m! && today.getUTCDate() >= d!);
  if (!hadBirthday) age -= 1;
  return age;
};

/** True only for a real calendar date such as 2011-02-28 (rejects 2011-02-30 and the future). */
export const isValidBirthDate = (value: string, today: Date = new Date()): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
  return real && y! >= 1900 && date.getTime() <= today.getTime();
};

/** A stored birth date as a Date at midnight UTC, ready for a Prisma @db.Date column. */
export const toDbDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

export const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
