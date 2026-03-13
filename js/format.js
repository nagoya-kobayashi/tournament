function pad2(value) {
  return String(value).padStart(2, "0");
}

const TOKYO_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatClock(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "-";
  }
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw;
    }
    const parts = TOKYO_DATE_TIME_FORMATTER.formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${lookup.hour}:${lookup.minute}`;
  }
  return `${pad2(match[1])}:${match[2]}`;
}

export function formatDayLabel(dayNo, config = {}) {
  const raw = String(dayNo || "").trim();
  if (!raw) {
    return "-";
  }
  return `${raw}日目`;
}

export function formatDateTimeStamp(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "-";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  const parts = TOKYO_DATE_TIME_FORMATTER.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.month}/${lookup.day} ${lookup.hour}:${lookup.minute}`;
}

export function formatMatchTimeText(match, config = {}) {
  return [
    formatDayLabel(match.day_no, config),
    formatClock(match.start_time),
    match.court || "",
  ]
    .filter((item) => item && item !== "-")
    .join(" ");
}
