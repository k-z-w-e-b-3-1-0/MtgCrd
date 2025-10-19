export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  return formatter.format(date);
}

export function escapeHtml(value) {
  const text = value == null ? "" : String(value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseMemberNames(text) {
  if (!text) {
    return [];
  }

  const rawNames = text
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  const seen = new Set();
  const uniqueNames = [];
  rawNames.forEach((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    uniqueNames.push(name);
  });

  return uniqueNames;
}

export function sortEventsInPlace(events) {
  events.sort((a, b) => {
    const keyA = `${a.date}T${a.startTime}`;
    const keyB = `${b.date}T${b.startTime}`;
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return a.projectName.localeCompare(b.projectName, "ja");
  });
}
