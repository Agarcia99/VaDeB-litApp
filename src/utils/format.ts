/** Left-pads a number to 2 digits. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** DD/MM/YYYY — returns "" for null/invalid dates. */
export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** DD/MM/YYYY HH:MM — returns "" for null/invalid dates. */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * DD/MM/YYYY {separator} HH:MM — returns "" for null/undefined.
 * Default separator is "-". Use "·" for dot-separated displays.
 */
export function formatDateDDMMYYYY_HHMM(iso?: string | null, separator = "-"): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${separator} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
