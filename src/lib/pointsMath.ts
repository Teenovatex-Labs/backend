// Points are stored as whole numbers of HUNDREDTHS (150 = 1.5), so there is no floating-point drift
// anywhere in the economy. Only the edges of the system (API output, award calls) deal in plain points.

export const SCALE = 100;

/** 1.5 -> 150. Rounds, so 0.1 + 0.2 style inputs cannot leak error into storage. */
export const toScaled = (points: number): number => Math.round(Number((points * SCALE).toPrecision(12)));

/** 150 -> 1.5. Safe because a stored value has at most two decimals. */
export const fromScaled = (scaled: number): number => scaled / SCALE;

/** 150 -> "1.5", 500 -> "5", 30 -> "0.3". Trailing zeros are trimmed. */
export const formatPoints = (scaled: number): string => {
  const sign = scaled < 0 ? '-' : '';
  const abs = Math.abs(Math.round(scaled));
  const whole = Math.floor(abs / SCALE);
  const frac = String(abs % SCALE).padStart(2, '0').replace(/0+$/, '');
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
};

/** Parses "1.5" or 1.5 into 150. Returns null for anything that is not a number with at most two decimals. */
export const parseScaled = (input: string | number): number | null => {
  const s = String(input).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return toScaled(Number(s));
};

export const addScaled = (a: number, b: number): number => a + b;
