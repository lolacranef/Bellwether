import type { DateStr } from "../model/types";

const parse = (d: DateStr) => {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
};
const fmt = (y: number, m: number, day: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Calendar month arithmetic; the day is clamped to the target month's length. */
export function addMonths(d: DateStr, n: number): DateStr {
  const { y, m, day } = parse(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(day, daysIn(ny, nm)));
}

export const addYears = (d: DateStr, n: number) => addMonths(d, Math.round(n * 12));

export function addDays(d: DateStr, n: number): DateStr {
  const { y, m, day } = parse(d);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole months from a to b (negative if b is earlier). */
export function monthsBetween(a: DateStr, b: DateStr): number {
  const pa = parse(a), pb = parse(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m) + (pb.day >= pa.day ? 0 : -1);
}

/** First-of-month dates from start to end inclusive. */
export function monthRange(start: DateStr, end: DateStr, stepMonths = 1): DateStr[] {
  const out: DateStr[] = [];
  const s = parse(start);
  let cur = fmt(s.y, s.m, 1);
  while (cur <= end) { out.push(cur); cur = addMonths(cur, stepMonths); }
  return out;
}
