// All dates in the app are local-time calendar dates serialized as 'YYYY-MM-DD'.
// Weeks start on Monday (weekday 0 = Monday ... 6 = Sunday).

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today(): string {
  return toISODate(new Date())
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayOf(iso: string): number {
  return (parseISODate(iso).getDay() + 6) % 7
}

/** Monday of the week containing the given date. */
export function weekStartOf(iso: string): string {
  return addDays(iso, -weekdayOf(iso))
}

export function currentWeekStart(): string {
  return weekStartOf(today())
}

/** ['YYYY-MM-DD' x7] Monday..Sunday for a given week start. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

export function currentMonthKey(): string {
  return today().slice(0, 7)
}

/** First and last date of a 'YYYY-MM' month. */
export function monthRange(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split('-').map(Number)
  const start = `${monthKey}-01`
  const end = toISODate(new Date(y, m, 0))
  return { start, end }
}

export function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function fmtMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** e.g. "Mon 15 Sep" */
export function fmtDate(iso: string): string {
  const d = parseISODate(iso)
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  return `${wd} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}

/** e.g. "15–21 Sep" for a week starting Monday. */
export function fmtWeek(weekStart: string): string {
  const a = parseISODate(weekStart)
  const b = parseISODate(addDays(weekStart, 6))
  const ma = MONTHS[a.getMonth()].slice(0, 3)
  const mb = MONTHS[b.getMonth()].slice(0, 3)
  return ma === mb ? `${a.getDate()}–${b.getDate()} ${ma}` : `${a.getDate()} ${ma} – ${b.getDate()} ${mb}`
}

export function isPastWeek(weekStart: string): boolean {
  return weekStart < currentWeekStart()
}

/** Relative label for a date: Today / Yesterday / formatted. */
export function fmtRelative(iso: string): string {
  if (iso === today()) return 'Today'
  if (iso === addDays(today(), -1)) return 'Yesterday'
  return fmtDate(iso)
}
