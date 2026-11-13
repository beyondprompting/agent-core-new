import { normalize } from "./normalize";

type DateParts = {
  day?: number;
  month?: number;
  year?: number;
  weekday?: string;
  relative?: "HOY";
};

const monthNames = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];
const monthNumber = (value: string) => {
  const index = monthNames.findIndex(
    (name) => name === value || name.slice(0, 3) === value,
  );
  return index < 0 ? undefined : index + 1;
};

// Match the entire expression: a range or qualification must go to semantic
// evaluation instead of silently comparing only its first date.
export function visibleDate(value: string): DateParts | undefined {
  const normalized = normalize(value);
  if (normalized === "HOY") return { relative: "HOY" };
  const weekday = normalized.match(
    /^(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)\b/,
  )?.[1];
  const text = weekday ? normalized.slice(weekday.length).trim() : normalized;
  const raw = value
    .trim()
    .replace(
      /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b[\s,]*/i,
      "",
    );
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso)
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      weekday,
    };
  // Numeric dates in this Spanish-language brief use day/month[/year].
  const numeric = raw.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{4}))?$/);
  if (numeric)
    return {
      day: Number(numeric[1]),
      month: Number(numeric[2]),
      year: numeric[3] ? Number(numeric[3]) : undefined,
      weekday,
    };
  const written = text.match(
    /^(\d{1,2}) (?:DE )?([A-Z]+)(?: (?:DE )?(\d{4}))?$/,
  );
  const reversed = text.match(/^([A-Z]+) (\d{1,2})(?: (\d{4}))?$/);
  if (written || reversed) {
    const month = monthNumber(written ? written[2] : reversed![1]);
    if (!month) return undefined;
    const year = (written ?? reversed)![3];
    return {
      day: Number(written ? written[1] : reversed![2]),
      month,
      year: year ? Number(year) : undefined,
      weekday,
    };
  }
  if (/^\d{1,2}$/.test(text)) return { day: Number(text), weekday };
  const month = monthNumber(text);
  return month ? { month, weekday } : undefined;
}

export function validDateParts(value: DateParts) {
  if (value.relative) return true;
  if (value.month !== undefined && (value.month < 1 || value.month > 12))
    return false;
  if (value.year !== undefined && value.year < 1) return false;
  const leap =
    value.year === undefined ||
    (value.year % 4 === 0 &&
      (value.year % 100 !== 0 || value.year % 400 === 0));
  const maxDay = value.month
    ? [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
        value.month - 1
      ]
    : 31;
  return value.day === undefined || (value.day >= 1 && value.day <= maxDay);
}
