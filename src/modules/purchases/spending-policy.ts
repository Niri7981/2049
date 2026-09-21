export { hash } from '../authority/authority-policy';
export function spendingDay(now: number, timeZone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  const day = `${value('year')}-${value('month')}-${value('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Could not determine the local spending day');
  return day;
}
export function nextSpendingDayBoundary(now: number, timeZone: string): number {
  const current = spendingDay(now, timeZone);
  let high = now + 60 * 60 * 1000;
  while (spendingDay(high, timeZone) === current && high - now <= 36 * 60 * 60 * 1000) high += 60 * 60 * 1000;
  if (spendingDay(high, timeZone) === current) throw new Error('Could not determine the next local spending day');
  let low = now;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (spendingDay(middle, timeZone) === current) low = middle;
    else high = middle;
  }
  return high;
}
