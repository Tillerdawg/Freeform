/**
 * Exact `date-time` acceptance behavior of the documented validator:
 * Ajv 8.20.0 with ajv-formats 3.0.1. Keep this independent of Date.parse,
 * which normalizes invalid calendar values and accepts a different grammar.
 */
export function isAjvRfc3339DateTime(value: string): boolean {
  const [datePart, timePart, ...rest] = value.split(/[t\s]/i);
  return rest.length === 0
    && datePart !== undefined
    && timePart !== undefined
    && isRfc3339Date(datePart)
    && isAjvDateTime(timePart);
}

function isRfc3339Date(value: string): boolean {
  const match = /^(\d\d\d\d)-(\d\d)-(\d\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]!;
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

function isAjvDateTime(value: string): boolean {
  const match = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  const zone = match[4];
  const zoneSign = match[5] === '-' ? -1 : 1;
  const zoneHour = Number(match[6] ?? 0);
  const zoneMinute = Number(match[7] ?? 0);
  if (!zone || zoneHour > 23 || zoneMinute > 59) return false;
  if (hour <= 23 && minute <= 59 && second < 60) return true;

  // ajv-formats evaluates leap seconds after converting only the clock portion
  // to UTC. Its -1 branches preserve valid day-boundary conversions.
  const utcMinute = minute - zoneMinute * zoneSign;
  const utcHour = hour - zoneHour * zoneSign - (utcMinute < 0 ? 1 : 0);
  return (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1) && second < 61;
}
