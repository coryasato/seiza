// GCAT's Vague Dates (https://planet4589.org/space/gcat/web/intro/vague.html),
// as the sample's build reads them: a value, how precise it is, and whether
// GCAT marked it uncertain with a trailing `?`. Any form not listed here
// throws, so a new one fails the build instead of becoming a wrong date.
//
// Forms (each with an optional `?`):
//   2026                 year
//   2010s                decade (end dates only, so far)
//   2010 Q3              quarter (end dates only, so far)
//   2026 Jul             month
//   2026 Jul  4          day (a single-digit day is padded with two spaces;
//                        one space is taken too, since GCAT has a few)
//   2026 Jul  4 0048     minute
//   2026 Jul  4 0048:09  second
// A month's case is ignored (GCAT has one `nov`).

export type Precision = 'decade' | 'year' | 'quarter' | 'month' | 'day' | 'minute' | 'second';

export interface VagueDate {
  /** The start of the period it names, `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS` (UTC). */
  value: string;
  precision: Precision;
  uncertain: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const FORM = /^(\d{4})(s)?(?: Q([1-4])| ([A-Za-z]{3})(?: {1,2}(\d{1,2})(?: (\d{2})(\d{2})(?::(\d{2}))?)?)?)?(\?)?$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Parses one Vague Date, trimmed of the column's padding. Throws on any other form. */
export function parseVagueDate(text: string): VagueDate {
  const match = FORM.exec(text.trim());
  if (!match) throw new Error(`not a Vague Date GCAT's sample build knows: ${JSON.stringify(text)}`);
  const [, yearText, decade, quarter, monthText, dayText, hourText, minuteText, secondText, question] = match;
  const year = Number(yearText);
  const uncertain = question === '?';
  if (decade) {
    if (quarter || monthText) throw new Error(`a decade with a quarter or a month: ${JSON.stringify(text)}`);
    if (year % 10 !== 0) throw new Error(`a decade that doesn't start a decade: ${JSON.stringify(text)}`);
    return { value: `${year}-01-01`, precision: 'decade', uncertain };
  }
  if (quarter) return { value: `${year}-${pad((Number(quarter) - 1) * 3 + 1)}-01`, precision: 'quarter', uncertain };
  if (!monthText) return { value: `${year}-01-01`, precision: 'year', uncertain };
  const month = MONTHS.indexOf(monthText.toLowerCase()) + 1;
  if (month === 0) throw new Error(`no such month: ${JSON.stringify(text)}`);
  if (!dayText) return { value: `${year}-${pad(month)}-01`, precision: 'month', uncertain };
  const day = Number(dayText);
  // Date.UTC rolls Feb 30 over into March; a real day comes back unchanged.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error(`no such day: ${JSON.stringify(text)}`);
  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (!hourText) return { value: date, precision: 'day', uncertain };
  const [hour, minute, second] = [Number(hourText), Number(minuteText), Number(secondText ?? 0)];
  // 60 seconds is a leap second; GCAT is in UTC.
  if (hour > 23 || minute > 59 || second > 60) throw new Error(`no such time: ${JSON.stringify(text)}`);
  return {
    value: `${date} ${pad(hour)}:${pad(minute)}:${pad(Math.min(second, 59))}`,
    precision: secondText === undefined ? 'minute' : 'second',
    uncertain,
  };
}
