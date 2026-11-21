function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Format decimal feet as feet-inches with fractions, e.g. 50.6875 -> 50'-8 3/4". */
export function formatFeetInches(feet: number, denominator = 8): string {
  const sign = feet < 0 ? '-' : '';
  const total = Math.round(Math.abs(feet) * 12 * denominator);
  const wholeInches = Math.floor(total / denominator);
  let num = total % denominator;
  let den = denominator;
  if (num > 0) {
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  const ft = Math.floor(wholeInches / 12);
  const inch = wholeInches % 12;
  const frac = num > 0 ? ` ${num}/${den}` : '';
  return `${sign}${ft}'-${inch}${frac}"`;
}

/** Parse 50'-8 1/4", 4'-0", 9', or a plain number of feet. Returns decimal feet. */
export function parseFeetInches(input: string | number): number {
  if (typeof input === 'number') return input;
  const m = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*'\s*(?:-?\s*(\d+(?:\.\d+)?))?\s*(?:(\d+)\s*\/\s*(\d+))?\s*"?$/);
  if (!m) {
    const n = Number(input);
    if (Number.isFinite(n)) return n;
    throw new Error(`Cannot parse length: ${input}`);
  }
  const feet = Number(m[1]);
  const inches = m[2] ? Number(m[2]) : 0;
  const frac = m[3] && m[4] ? Number(m[3]) / Number(m[4]) : 0;
  const sign = m[1].startsWith('-') ? -1 : 1;
  return feet + (sign * (inches + frac)) / 12;
}
