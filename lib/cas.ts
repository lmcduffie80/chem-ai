const CAS_PATTERN = /^(\d{2,7})-(\d{2})-(\d)$/;

/** Normalizes "50000", "50-00-0", " 0050-00-0 " to "50-00-0". Returns null when the input can't be a CAS RN. */
export function normalizeCas(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).replace(/\s/g, "");
  let digits: string;
  if (/^\d+-\d{2}-\d$/.test(raw)) digits = raw.replace(/-/g, "");
  else if (/^\d+$/.test(raw)) digits = raw;
  else return null;
  digits = digits.replace(/^0+/, "");
  if (digits.length < 5 || digits.length > 10) return null;
  return `${digits.slice(0, -3)}-${digits.slice(-3, -1)}-${digits.slice(-1)}`;
}

export function isValidCasChecksum(cas: string): boolean {
  const match = CAS_PATTERN.exec(cas);
  if (!match) return false;
  const digits = (match[1] + match[2]).split("").reverse();
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * (i + 1), 0);
  return sum % 10 === Number(match[3]);
}

export function looksLikeCas(query: string): boolean {
  return CAS_PATTERN.test(query.trim());
}
