/** Returns the start/end of today in local device time. */
export function getTodayRangeLocal() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return { start, end };
}

/** Maps a field code to a sort order (A=0, B=1, rest=99). */
export function getFieldOrder(fieldCode?: string | null): number {
  const code = (fieldCode ?? "").trim().toUpperCase();
  if (code === "A") return 0;
  if (code === "B") return 1;
  return 99;
}

/** Sorts matches: pending first, then by date, then by field, then by referee/id. */
export function compareMatches(a: any, b: any): number {
  const finishedA = !!a.is_finished;
  const finishedB = !!b.is_finished;

  // Pendents primer, finalitzats després
  if (finishedA !== finishedB) {
    return finishedA ? 1 : -1;
  }

  const timeA = a.match_date ? new Date(a.match_date).getTime() : Number.MAX_SAFE_INTEGER;
  const timeB = b.match_date ? new Date(b.match_date).getTime() : Number.MAX_SAFE_INTEGER;

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  // Després camp A abans que B
  const fieldA = getFieldOrder(a.field_code);
  const fieldB = getFieldOrder(b.field_code);

  if (fieldA !== fieldB) {
    return fieldA - fieldB;
  }

  // Desempat estable extra
  const refA = typeof a.referee_id === "number" ? a.referee_id : Number.MAX_SAFE_INTEGER;
  const refB = typeof b.referee_id === "number" ? b.referee_id : Number.MAX_SAFE_INTEGER;

  if (refA !== refB) {
    return refB - refA;
  }

  const idA = typeof a.match_id === "number" ? a.match_id : Number.MAX_SAFE_INTEGER;
  const idB = typeof b.match_id === "number" ? b.match_id : Number.MAX_SAFE_INTEGER;

  return idA - idB;
}
