import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";

// ✅ Ajusta aquest import si al teu projecte el supabase client està en una altra ruta
import { supabase } from "../../src/supabase";

type Championship = {
  id: number;
  name: string;
  year: number;
  is_active: boolean;
};

type MatchSlot = {
  id: number;
  starts_at: string;
  field_code: string;
  day_code: string;
  time_code: string;
  is_used: boolean;
  game_slot_id: number;
};

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pairKey(a: number, b: number) {
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  return `${x}-${y}`;
}

function chunkEvenly<T>(arr: T[], groups: number) {
  const out: T[][] = Array.from({ length: groups }, () => []);
  let gi = 0;
  for (const item of arr) {
    out[gi].push(item);
    gi = (gi + 1) % groups;
  }
  return out;
}


function roundRobinRounds(teams: number[]): Array<Array<[number, number]>> {
  // Circle method, supports even or odd number of teams (odd adds a bye).
  const list = [...teams];
  if (list.length < 2) return [];
  const hasBye = list.length % 2 === 1;
  if (hasBye) list.push(-1);

  const n = list.length;
  const rounds: Array<Array<[number, number]>> = [];
  const arr = [...list];

  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== -1 && b !== -1) pairs.push([a, b]);
    }
    rounds.push(pairs);

    // rotate all but first
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop() as number);
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return rounds;
}

function generateLeagueMatchesExact(teams: number[], gamesPerTeam: number) {
  // Generate an EXACT number of matches so every team plays exactly gamesPerTeam games,
  // even when the team count is odd. We select pairs from a full round-robin pool
  // (each pair appears once) using a greedy algorithm with retries.
  const n = teams.length;
  if (n < 2 || gamesPerTeam <= 0) return { matches: [] as Array<[number, number]> };

  // Full round-robin: every team plays (n-1) games.
  if (gamesPerTeam >= n - 1) {
    const rounds = roundRobinRounds(shuffle(teams));
    const matches: Array<[number, number]> = [];
    for (const r of rounds) for (const p of r) matches.push(p);
    return { matches };
  }

  // Needed total matches for an exact schedule.
  const totalPlays = n * gamesPerTeam;
  if (totalPlays % 2 !== 0) {
    // Impossible to satisfy exactly (would require half a match).
    return { matches: [] as Array<[number, number]> };
  }
  const targetMatches = totalPlays / 2;

  // Build the pool of unique pairs from a full round-robin (complete graph).
  const allRounds = roundRobinRounds(shuffle(teams));
  const pool: Array<[number, number]> = [];
  for (const r of allRounds) for (const p of r) pool.push(p);

  const MAX_TRIES = 80;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const counts = new Map<number, number>();
    for (const t of teams) counts.set(t, 0);

    const matches: Array<[number, number]> = [];
    const shuffled = shuffle(pool);

    for (const [a, b] of shuffled) {
      const ca = counts.get(a) ?? 0;
      const cb = counts.get(b) ?? 0;
      if (ca >= gamesPerTeam || cb >= gamesPerTeam) continue;

      matches.push([a, b]);
      counts.set(a, ca + 1);
      counts.set(b, cb + 1);

      if (matches.length === targetMatches) break;
    }

    // Verify exactness.
    if (matches.length === targetMatches) {
      let ok = true;
      for (const t of teams) {
        if ((counts.get(t) ?? 0) !== gamesPerTeam) {
          ok = false;
          break;
        }
      }
      if (ok) return { matches };
    }
  }

  // Best-effort fallback (caller already shows a warning).
  const counts = new Map<number, number>();
  for (const t of teams) counts.set(t, 0);
  const matches: Array<[number, number]> = [];
  for (const [a, b] of shuffle(pool)) {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca >= gamesPerTeam || cb >= gamesPerTeam) continue;
    matches.push([a, b]);
    counts.set(a, ca + 1);
    counts.set(b, cb + 1);
    if (matches.length === targetMatches) break;
  }
  return { matches };
}

function generateGroupMatchesFromGroups(groups: number[][]) {
  const sizes = groups.map((g) => g.length).filter((n) => n > 0);
  if (sizes.length === 0) return { matches: [] as Array<[number, number]> };
  const minSize = Math.min(...sizes);
  const perTeam = Math.max(0, minSize - 1);

  const matches: Array<[number, number]> = [];
  for (const g of groups) {
    if (g.length < 2) continue;
    const rounds = roundRobinRounds(shuffle(g));
    // IMPORTANT: If the group size is odd and we want a full round-robin
    // (perTeam === g.length - 1), we must take ALL rounds.
    // Otherwise, if we drop one round, some teams will have their BYE inside
    // the selected rounds and will only play (perTeam - 1) matches.
    const fullRoundRobin = perTeam === Math.max(0, g.length - 1);
    const take = fullRoundRobin ? rounds.length : Math.min(perTeam, rounds.length);
    for (let r = 0; r < take; r++) {
      for (const p of rounds[r]) matches.push(p);
    }
  }
  return { matches, perTeam };
}

type CalendarConfig = {
  excluded_dates?: string[];
  priority_match_order_hours?: string[];
};

function makeHourPriorityMap(hours: string[]) {
  const m = new Map<string, number>();
  for (let i = 0; i < hours.length; i++) {
    const h = String(hours[i] ?? "").trim();
    if (!h) continue;
    if (!m.has(h)) m.set(h, i);
  }
  return m;
}

function isoDateOnly(iso: string) {
  return String(iso).slice(0, 10);
}

function sortSlotsByPriority(slots: MatchSlot[], hourPriority: Map<string, number>) {
  const BIG = 1_000_000;
  return [...slots].sort((a, b) => {
    const ha = hourPriority.get(a.time_code) ?? BIG;
    const hb = hourPriority.get(b.time_code) ?? BIG;
    if (ha !== hb) return ha - hb;

    if (a.starts_at < b.starts_at) return -1;
    if (a.starts_at > b.starts_at) return 1;

    // Camp A abans que B
    return String(a.field_code ?? "").localeCompare(String(b.field_code ?? ""));
  });
}

// ------------------------
// Slot assignment (fair + preferences)
// ------------------------

function weekendKeyFromStartsAt(startsAtIso: string) {
  // Championship matches are on Saturday/Sunday. We treat a "weekend" as Sat+Sun.
  // Key = ISO date (YYYY-MM-DD) of that Saturday in UTC.
  const d = new Date(startsAtIso);
  const dow = d.getUTCDay(); // 0=Sun, 6=Sat
  const sat = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (dow === 0) {
    // Sunday -> Saturday
    sat.setUTCDate(sat.getUTCDate() - 1);
  } else if (dow !== 6) {
    // If ever used on other days, normalize to the previous Saturday.
    const diffToSat = (dow + 1) % 7; // Mon(1)->2, Tue(2)->3, ... Fri(5)->6
    sat.setUTCDate(sat.getUTCDate() - diffToSat);
  }
  return isoDateOnly(sat.toISOString());
}

function groupSlotsByWeekend(slots: MatchSlot[]) {
  const by = new Map<string, MatchSlot[]>();
  for (const s of slots) {
    const k = weekendKeyFromStartsAt(s.starts_at);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(s);
  }
  return by;
}


function teamAllows(prefs: Map<number, Set<number>>, teamId: number, gameSlotId: number) {
  // If a team has no preference rows (or an empty set), treat it as "can play any slot".
  const set = prefs.get(teamId);
  if (!set || set.size === 0) return true;
  return set.has(gameSlotId);
}

function assignPairsToSlotsFair(
  pairs: Array<[number, number]>,
  freeSlotsSorted: MatchSlot[],
  prefs: Map<number, Set<number>>,
  hourPriority: Map<string, number>,
  gamesPerTeam: number,
  opts?: {
    // Per a format "group": mapa teamId -> groupIndex (0=A,1=B,2=C...)
    teamToGroup?: Map<number, number>;
  }
) {
  /**
   * IMPORTANT: En aquest projecte "preference_conflict" hauria de ser 0.
   * Per tant, aquí tractem les preferències com a CONSTRAINT:
   *   - Un partit només pot anar a un slot si TOTS DOS equips prefereixen slot.game_slot_id.
   *
   * Objectius:
   *  - Repartir els partits al llarg de tots els caps de setmana disponibles
   *    (dissabte + diumenge), evitant acabar massa aviat.
   *  - Evitar que un equip estigui > 2 caps de setmana sense jugar (quan és possible).
   *  - Evitar (tant com es pugui) 3 caps de setmana seguits jugant.
   *  - Respectar l'ordre/prioritat d'hores (ja ve ordenat a freeSlotsSorted).
   *  - No permetre 2 partits a la mateixa hora exacta per al mateix equip (starts_at).
   */

  const remaining = shuffle([...pairs]);
  

// ------------------------
// Group mixing (for "group" format)
// ------------------------
const teamToGroup = opts?.teamToGroup;
const allGroupIds = teamToGroup
  ? Array.from(new Set(Array.from(teamToGroup.values()))).sort((a, b) => a - b)
  : [];
const groupsCount = allGroupIds.length;

const pairGroup = (a: number, b: number) => {
  if (!teamToGroup) return -1;
  const ga = teamToGroup.get(a);
  const gb = teamToGroup.get(b);
  if (ga === undefined || gb === undefined || ga !== gb) return -1;
  return ga;
};
const remainingSlots = [...freeSlotsSorted];

  const slotsByWeekend = groupSlotsByWeekend(remainingSlots);
  const weekendKeys = Array.from(slotsByWeekend.keys()).sort();

  // --- Pre-check: cada partit ha de tenir almenys 1 slot compatible (preferència comuna)
  const commonPrefSlotsCount = new Map<string, number>();
  for (const [a, b] of remaining) {
    const pa = prefs.get(a) ?? new Set<number>();
    const pb = prefs.get(b) ?? new Set<number>();
    let count = 0;
    for (const s of remainingSlots) {
      if (teamAllows(prefs, a, s.game_slot_id) && teamAllows(prefs, b, s.game_slot_id)) count++;
    }
    commonPrefSlotsCount.set(pairKey(a, b), count);
  }
  const impossible = remaining.filter(([a, b]) => (commonPrefSlotsCount.get(pairKey(a, b)) ?? 0) === 0);
  if (impossible.length > 0) {
    // Mostrem només alguns per no fer un missatge gegant.
    const sample = impossible.slice(0, 8).map(([a, b]) => `${a}-${b}`).join(", ");
    throw new Error(
      `No es poden assignar tots els partits respectant preferències (no hi ha cap slot compatible per alguns enfrontaments). Exemples: ${sample}. ` +
        `Revisa preferències dels equips o afegeix slots del game_slot_id corresponent.`
    );
  }

  // Estat per equitat
  const lastPlayedWeekend = new Map<number, number>(); // team -> weekendIndex
  const consecStreak = new Map<number, number>(); // team -> consecutive weekends played
  const playedCount = new Map<number, number>();

  const teamTimeUsed = new Map<number, Set<string>>();
  const assignments: Array<{ a: number; b: number; slot: MatchSlot }> = [];

  const getPlayed = (t: number) => playedCount.get(t) ?? 0;
  const getLast = (t: number) => lastPlayedWeekend.get(t);
  const getGap = (t: number, wIdx: number) => {
    const lp = getLast(t);
    if (lp === undefined) return 99;
    return wIdx - lp;
  };
  const getStreak = (t: number) => consecStreak.get(t) ?? 0;

  // Repartiment "base + remainder" perquè no s'acabin massa aviat.
  const totalWeekends = weekendKeys.length;
  const totalMatches = remaining.length;
  const base = Math.floor(totalMatches / Math.max(1, totalWeekends));
  const extra = totalMatches % Math.max(1, totalWeekends); // els primers "extra" caps de setmana tindran +1

  const BIG = 1_000_000;

  for (let wIdx = 0; wIdx < weekendKeys.length; wIdx++) {
    if (remaining.length === 0) break;

    const wKey = weekendKeys[wIdx];
    const wSlotsAll = slotsByWeekend.get(wKey) ?? [];
    if (wSlotsAll.length === 0) continue;

    // Cupo d'aquest cap de setmana
    const weekendTarget = base + (wIdx < extra ? 1 : 0);
    let quota = Math.min(wSlotsAll.length, weekendTarget, remaining.length);
    if (quota <= 0) continue;

    const playedThisWeekend = new Set<number>();

// Shuffled group order per weekend to avoid consuming a whole group first
const weekendGroupOrder = groupsCount > 0 ? shuffle([...allGroupIds]) : [];
let slotIdxInWeekend = 0;


    // IMPORTANT: preservem ordre d'hores/slots (ja ve prioritzat)
    const wSlots = wSlotsAll.slice(0, quota);

    for (const slot of wSlots) {
      if (remaining.length === 0) break;

// Preferred group for this slot (A/B/C alternating, but shuffled each weekend)
const preferredGroup =
  groupsCount > 0 ? weekendGroupOrder[slotIdxInWeekend % weekendGroupOrder.length] : -1;

// If there is at least one compatible match from preferredGroup for this slot,
// we restrict to that group to keep groups mixed across weekends.
let hasPreferredGroupCandidate = false;
if (preferredGroup !== -1) {
  for (let i = 0; i < remaining.length; i++) {
    const [a, b] = remaining[i];
    if (pairGroup(a, b) !== preferredGroup) continue;

    if (!(teamAllows(prefs, a, slot.game_slot_id) && teamAllows(prefs, b, slot.game_slot_id))) continue;

    const usedA = teamTimeUsed.get(a) ?? new Set<string>();
    const usedB = teamTimeUsed.get(b) ?? new Set<string>();
    if (usedA.has(slot.starts_at) || usedB.has(slot.starts_at)) continue;

    hasPreferredGroupCandidate = true;
    break;
  }
}


      

// Red-zone rule: if there exists any compatible match (respecting preferences + group restriction)
// where a team has been >=3 weekends without playing, only consider those matches.
let hasRedZoneCandidate = false;
for (let i = 0; i < remaining.length; i++) {
  const [a, b] = remaining[i];

  if (hasPreferredGroupCandidate) {
    const g = pairGroup(a, b);
    if (g !== preferredGroup) continue;
  }

  if (!(teamAllows(prefs, a, slot.game_slot_id) && teamAllows(prefs, b, slot.game_slot_id))) continue;

// ✅ Mix groups: if we have preferred-group candidates for this slot, ignore other groups
if (hasPreferredGroupCandidate) {
  const g = pairGroup(a, b);
  if (g !== preferredGroup) continue;
}


  const usedA = teamTimeUsed.get(a) ?? new Set<string>();
  const usedB = teamTimeUsed.get(b) ?? new Set<string>();
  if (usedA.has(slot.starts_at) || usedB.has(slot.starts_at)) continue;

  const gapA = getGap(a, wIdx);
  const gapB = getGap(b, wIdx);
  if (gapA >= 3 || gapB >= 3) {
    hasRedZoneCandidate = true;
    break;
  }
}
let bestIdx = -1;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const [a, b] = remaining[i];

        // ✅ Constraint de preferència (ha de ser compatible per tots dos)
        const prefASet = prefs.get(a) ?? new Set<number>();
        const prefBSet = prefs.get(b) ?? new Set<number>();
        if (!(teamAllows(prefs, a, slot.game_slot_id) && teamAllows(prefs, b, slot.game_slot_id))) continue;

        // ✅ No two matches at the same exact time for the same team.
        const usedA = teamTimeUsed.get(a) ?? new Set<string>();
        const usedB = teamTimeUsed.get(b) ?? new Set<string>();
        if (usedA.has(slot.starts_at) || usedB.has(slot.starts_at)) continue;

        const gapA = getGap(a, wIdx);
        const gapB = getGap(b, wIdx);

if (hasRedZoneCandidate && !(gapA >= 3 || gapB >= 3)) continue;


        // Urgència per evitar >2 caps sense jugar.
        const urgency =
          (gapA >= 2 ? 60_000 : gapA === 1 ? 4_000 : 0) +
          (gapB >= 2 ? 60_000 : gapB === 1 ? 4_000 : 0) +
          (gapA >= 3 ? 200_000 : 0) +
          (gapB >= 3 ? 200_000 : 0);

        // Penalitzar 3 caps de setmana seguits
        const lastA = getLast(a);
        const lastB = getLast(b);
        const playedLastA = lastA !== undefined && lastA === wIdx - 1;
        const playedLastB = lastB !== undefined && lastB === wIdx - 1;

        const streakA = playedLastA ? getStreak(a) : 0;
        const streakB = playedLastB ? getStreak(b) : 0;

        // If scheduling this match would create 3 consecutive weekends for a team,
        // we try to avoid it unless that team is urgent (risking >2 weekends without playing).
        const wouldMakeThreeConsecutiveA = playedLastA && streakA >= 2;
        const wouldMakeThreeConsecutiveB = playedLastB && streakB >= 2;
        const urgentA = gapA >= 2;
        const urgentB = gapB >= 2;
        const hardSkipThreeConsecutive = (wouldMakeThreeConsecutiveA && !urgentA) || (wouldMakeThreeConsecutiveB && !urgentB);
        if (hardSkipThreeConsecutive) continue;

        const streakPenalty =
          (playedLastA ? (streakA >= 2 ? 120_000 : 12_000) : 0) +
          (playedLastB ? (streakB >= 2 ? 120_000 : 12_000) : 0);

        // Permetre doble partit el mateix cap de setmana però penalitzar perquè no sigui el normal.
        const doubleWeekendPenalty =
          (playedThisWeekend.has(a) ? 25_000 : 0) + (playedThisWeekend.has(b) ? 25_000 : 0);

        // Balance: cada equip hauria d'anar aproximadament al ritme del calendari.
        const expectedNow = Math.round((gamesPerTeam * (wIdx + 1)) / Math.max(1, totalWeekends));
        const balancePenalty =
          Math.max(0, getPlayed(a) - expectedNow) * 6_000 + Math.max(0, getPlayed(b) - expectedNow) * 6_000;

        // Preferència: com que ja és constraint, donem un bonus petit per desempatar
        // (per exemple, algun slot_id pot ser més "fort" per la prioritat d'hores)
        const prefBonus = 5_000;

        // Tie-break d'hores (respectar priority list)
        const hourTie = -(hourPriority.get(slot.time_code) ?? BIG);

        const score = prefBonus + urgency - streakPenalty - doubleWeekendPenalty - balancePenalty + hourTie;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) {
        // No hi ha cap partit compatible per aquest slot (amb preferències comunes).
        // Passem al següent slot del mateix cap de setmana.
        slotIdxInWeekend++;
        continue;
      }

      const [a, b] = remaining.splice(bestIdx, 1)[0];
      assignments.push({ a, b, slot });

      if (!teamTimeUsed.has(a)) teamTimeUsed.set(a, new Set());
      if (!teamTimeUsed.has(b)) teamTimeUsed.set(b, new Set());
      teamTimeUsed.get(a)!.add(slot.starts_at);
      teamTimeUsed.get(b)!.add(slot.starts_at);
      slotIdxInWeekend++;

      playedCount.set(a, getPlayed(a) + 1);
      playedCount.set(b, getPlayed(b) + 1);

      const prevLastA = getLast(a);
      const prevLastB = getLast(b);
      if (prevLastA === wIdx - 1) consecStreak.set(a, getStreak(a) + 1);
      else consecStreak.set(a, 1);
      if (prevLastB === wIdx - 1) consecStreak.set(b, getStreak(b) + 1);
      else consecStreak.set(b, 1);

      lastPlayedWeekend.set(a, wIdx);
      lastPlayedWeekend.set(b, wIdx);
      playedThisWeekend.add(a);
      playedThisWeekend.add(b);
    }
  }

  // Si han quedat partits sense assignar, intentem omplir amb slots sobrants
  // sempre respectant preferència comuna. Si no es pot, ERROR (per evitar preference_conflict=true).
  if (remaining.length > 0) {
    const usedSlotIds = new Set(assignments.map((x) => x.slot.id));
    const leftoverSlots = remainingSlots.filter((s) => !usedSlotIds.has(s.id));

    for (const [a, b] of remaining) {
      // Filtrar slots compatibles amb preferència comuna
      const prefASet = prefs.get(a) ?? new Set<number>();
      const prefBSet = prefs.get(b) ?? new Set<number>();
      const compatible = leftoverSlots.filter((s) => teamAllows(prefs, a, s.game_slot_id) && teamAllows(prefs, b, s.game_slot_id));

      if (compatible.length === 0) {
        throw new Error(
          `No s'ha pogut assignar el partit ${a}-${b} sense trencar preferències. ` +
            `Afegeix slots compatibles o revisa preferències.`
        );
      }

      const { slot, index } = pickBestSlotStrictPrefs(compatible, hourPriority, teamTimeUsed, a, b);
      // eliminar el slot escollit de leftoverSlots (cal buscar l'index real)
      const realIdx = leftoverSlots.findIndex((s) => s.id === slot.id);
      if (realIdx >= 0) leftoverSlots.splice(realIdx, 1);

      assignments.push({ a, b, slot });
    }
  }

  return assignments;
}

function pickBestSlotStrictPrefs(
  slots: MatchSlot[],
  hourPriority: Map<string, number>,
  teamTimeUsed: Map<number, Set<string>>,
  teamA: number,
  teamB: number
): { slot: MatchSlot; index: number } {
  const usedA = teamTimeUsed.get(teamA) ?? new Set<string>();
  const usedB = teamTimeUsed.get(teamB) ?? new Set<string>();

  let bestIdx = -1;
  const BIG = 1_000_000;

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (usedA.has(s.starts_at) || usedB.has(s.starts_at)) continue;

    if (bestIdx === -1) {
      bestIdx = i;
      continue;
    }

    // tie-break: hour priority, then date, then field
    const cur = slots[bestIdx];
    const ps = hourPriority.get(s.time_code) ?? BIG;
    const pc = hourPriority.get(cur.time_code) ?? BIG;
    if (ps !== pc) {
      if (ps < pc) bestIdx = i;
      continue;
    }

    if (s.starts_at < cur.starts_at) {
      bestIdx = i;
      continue;
    }
    if (s.starts_at > cur.starts_at) continue;

    const fs = String(s.field_code ?? "");
    const fc = String(cur.field_code ?? "");
    if (fs.localeCompare(fc) < 0) bestIdx = i;
  }

  if (bestIdx === -1) {
    throw new Error("No hi ha cap slot compatible sense solapar horari (un equip ja juga a la mateixa hora).");
  }

  return { slot: slots[bestIdx], index: bestIdx };
}


function parseGamesPerTeam(configValue: any): number | null {
  // Esperat: {"games_per_team": 6}
  // Però a vegades pot venir com string JSON o amb camps diferents
  try {
    if (configValue == null) return null;
    const v = typeof configValue === "string" ? JSON.parse(configValue) : configValue;
    const g = v?.games_per_team;
    const n = typeof g === "string" ? parseInt(g, 10) : typeof g === "number" ? g : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export default function DrawMatchesScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [championships, setChampionships] = useState<Championship[]>([]);
  const [champModalOpen, setChampModalOpen] = useState(false);
  const [champSearch, setChampSearch] = useState("");
  const [selectedChampionshipId, setSelectedChampionshipId] = useState<number | null>(null);

  // format: "league" | "groups2" | "groups3"
  const [format, setFormat] = useState<"league" | "groups2" | "groups3">("league");

  const [groupSetupOpen, setGroupSetupOpen] = useState(false);
  const [groupSetupMode, setGroupSetupMode] = useState<"random" | "manual">("random");
  const [groupTeams, setGroupTeams] = useState<number[][]>([]);
  const [teamNameById, setTeamNameById] = useState<Record<number, string>>({});
  const [pendingContext, setPendingContext] = useState<null | {
    championshipId: number;
    prefs: Map<number, Set<number>>;
    freeSlots: MatchSlot[];
    hourPriority: Map<string, number>;
    refereeId: number;
    allTeams: number[];
    excludedDates: Set<string>;
    priorityHours: string[];
  }>(null);


  const [statusText, setStatusText] = useState<string>("");

  const filteredChampionships = useMemo(() => {
    const q = champSearch.trim().toLowerCase();
    if (!q) return championships;
    return championships.filter((c) =>
      `${c.name} ${c.year}`.toLowerCase().includes(q)
    );
  }, [championships, champSearch]);

  const selectedChampLabel = useMemo(() => {
    const c = championships.find((x) => x.id === selectedChampionshipId);
    if (!c) return "Selecciona campionat";
    return `${c.name} ${c.year}`;
  }, [championships, selectedChampionshipId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setStatusText("");
      const { data, error } = await supabase
        .from("championship")
        .select("id,name,year,is_active")
        .order("is_active", { ascending: false })
        .order("year", { ascending: false });

      if (cancelled) return;

      if (error) {
        Alert.alert("Error", error.message);
        setChampionships([]);
        setSelectedChampionshipId(null);
      } else {
        const list = (data ?? []) as Championship[];
        setChampionships(list);
        const active = list.find((c) => c.is_active);
        setSelectedChampionshipId(active?.id ?? list[0]?.id ?? null);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchRefereeId(): Promise<number> {
    const { data, error } = await supabase
      .from("referee")
      .select("id")
      .order("id", { ascending: true })
      .limit(1);

    if (error) throw new Error(`No es pot obtenir referee: ${error.message}`);
    const id = data?.[0]?.id;
    if (!id) throw new Error("No hi ha cap referee creat. Crea'n un abans de fer el sorteig.");
    return id as number;
  }

  async function ensureNoExistingMatches(championshipId: number) {
    const { count, error } = await supabase
      .from("match")
      .select("id", { count: "exact", head: true })
      .eq("championship_id", championshipId);

    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) throw new Error("Ja hi ha partits creats per aquest campionat. Usa 'Netejar' abans.");
  }

  async function loadTeams(championshipId: number): Promise<number[]> {
    const { data, error } = await supabase
      .from("championship_team")
      .select("team_id")
      .eq("championship_id", championshipId);

    if (error) throw new Error(error.message);
    const teams = (data ?? []).map((r: any) => Number(r.team_id)).filter((n) => Number.isFinite(n));
    if (teams.length < 2) throw new Error("Calen com a mínim 2 equips inscrits al campionat.");
    return teams;
  }

  async function loadFreeSlots(championshipId: number): Promise<MatchSlot[]> {
    const { data, error } = await supabase
      .from("match_slot")
      .select("id,starts_at,field_code,day_code,time_code,is_used,game_slot_id")
      .eq("championship_id", championshipId)
      .eq("is_used", false)
      .order("starts_at", { ascending: true });

    if (error) throw new Error(error.message);
    const slots = (data ?? []) as MatchSlot[];
    if (slots.length === 0) throw new Error("No hi ha slots creats per aquest campionat. Primer crea el calendari.");
    return slots;
  }

  async function loadPreferences(championshipId: number): Promise<Map<number, Set<number>>> {
    const { data, error } = await supabase
      .from("championship_team_game_preference")
      .select("team_id,game_slot_id")
      .eq("championship_id", championshipId);

    if (error) throw new Error(error.message);

    const map = new Map<number, Set<number>>();
    for (const row of data ?? []) {
      const teamId = Number((row as any).team_id);
      const gameSlotId = Number((row as any).game_slot_id);
      if (!Number.isFinite(teamId) || !Number.isFinite(gameSlotId)) continue;
      if (!map.has(teamId)) map.set(teamId, new Set<number>());
      map.get(teamId)!.add(gameSlotId);
    }
    return map;
  }

  async function loadLeagueGamesPerTeam(championshipId: number): Promise<number> {
    // Config: championship_config, phase_id=8, key="league", value={"games_per_team": 6}
    const { data, error } = await supabase
      .from("championship_config")
      .select("value")
      .eq("championship_id", championshipId)
      .eq("phase_id", 8)
      .eq("key", "league")
      .limit(1);

    if (error) throw new Error(error.message);
    const value = data?.[0]?.value;
    const gpt = parseGamesPerTeam(value);
    if (!gpt) throw new Error("No s'ha trobat games_per_team a championship_config (key='league', phase_id=8).");
    return gpt;
  }

  async function loadCalendarConfig(championshipId: number): Promise<CalendarConfig> {
    const { data, error } = await supabase
      .from("championship_config")
      .select("value")
      .eq("championship_id", championshipId)
      .eq("key", "calendar")
      .limit(1);

    if (error) throw new Error(error.message);
    const raw = data?.[0]?.value;
    try {
      const v = typeof raw === "string" ? JSON.parse(raw) : raw;
      return (v ?? {}) as CalendarConfig;
    } catch {
      return {};
    }
  }

  async function loadTeamNames(teamIds: number[]) {
    const { data, error } = await supabase
      .from("team")
      .select("id,name")
      .in("id", teamIds);

    if (error) throw new Error(error.message);
    const map: Record<number, string> = {};
    for (const row of data ?? []) {
      map[Number((row as any).id)] = String((row as any).name ?? "");
    }
    return map;
  }

  async function createDrawRun(championshipId: number, kind: string, params: any) {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const { data, error } = await supabase
      .from("draw_run")
      .insert([{ championship_id: championshipId, kind, seed, params }])
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    const id = Number((data as any)?.id);
    if (!id) throw new Error("No s'ha pogut crear draw_run.");
    return { id, seed };
  }


  function generateLeagueMatches(teams: number[], gamesPerTeam: number) {
    // Genera parelles aleatòries i assegura que cada equip jugui fins a gamesPerTeam.
    const allPairs: Array<[number, number]> = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        allPairs.push([teams[i], teams[j]]);
      }
    }
    const pairs = shuffle(allPairs);

    const counts = new Map<number, number>();
    for (const t of teams) counts.set(t, 0);

    const usedPairs = new Set<string>();
    const out: Array<[number, number]> = [];

    // Passades: intentem omplir fins que ningú pugui sumar més
    for (const [a, b] of pairs) {
      const ca = counts.get(a) ?? 0;
      const cb = counts.get(b) ?? 0;
      if (ca >= gamesPerTeam || cb >= gamesPerTeam) continue;

      const key = pairKey(a, b);
      if (usedPairs.has(key)) continue;

      usedPairs.add(key);
      out.push([a, b]);
      counts.set(a, ca + 1);
      counts.set(b, cb + 1);
    }

    // Validació bàsica: pot ser impossible si gamesPerTeam massa alt
    const minCount = Math.min(...teams.map((t) => counts.get(t) ?? 0));
    if (minCount === 0) {
      // no és necessàriament error (si teams=2 i gamesPerTeam>1, sí)
      // però fem un check més clar:
      const possiblePerTeam = teams.length - 1;
      if (gamesPerTeam > possiblePerTeam) {
        throw new Error(`games_per_team (${gamesPerTeam}) és massa alt per ${teams.length} equips (max ${possiblePerTeam}).`);
      }
    }

    // Si no hem pogut arribar a gamesPerTeam per a tots, no fem error dur (hi ha casos límit),
    // però avisa via status
    const notFull = teams.filter((t) => (counts.get(t) ?? 0) < gamesPerTeam);
    return { matches: out, counts, notFull };
  }

  function generateGroupMatches(teams: number[], groups: 2 | 3) {
    const shuffled = shuffle(teams);
    const grouped = chunkEvenly(shuffled, groups);

    const out: Array<[number, number]> = [];
    for (const g of grouped) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          out.push([g[i], g[j]]);
        }
      }
    }
    return { matches: out, groups: grouped };
  }

  function pickBestSlot(
    slots: MatchSlot[],
    prefs: Map<number, Set<number>>,
    hourPriority: Map<string, number>,
    teamTimeUsed: Map<number, Set<string>>,
    teamA: number,
    teamB: number
  ): { slot: MatchSlot; index: number } {
    const prefA = prefs.get(teamA) ?? new Set<number>();
    const prefB = prefs.get(teamB) ?? new Set<number>();

    const usedA = teamTimeUsed.get(teamA) ?? new Set<string>();
    const usedB = teamTimeUsed.get(teamB) ?? new Set<string>();

    const bothPreferSundayAfternoon = prefA.has(4) && prefB.has(4);

    let bestIdx = -1;
    let bestScore = -1;
    const BIG = 1_000_000;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];

      // Evitar que un equip tingui 2 partits al mateix moment (dos camps diferents)
      if (usedA.has(s.starts_at) || usedB.has(s.starts_at)) continue;

      let score =
        (prefA.has(s.game_slot_id) ? 1 : 0) + (prefB.has(s.game_slot_id) ? 1 : 0);

      // Si tots dos prefereixen diumenge tarda, posar primer 16:00
      if (bothPreferSundayAfternoon && s.game_slot_id === 4) {
        if (s.time_code === "16:00") score += 0.25;
        else if (s.time_code === "17:30") score += 0.1;
      }

      if (bestIdx === -1 || score > bestScore) {
        bestScore = score;
        bestIdx = i;
        continue;
      }
      if (score < bestScore) continue;

      // tie-break: hour priority, then date, then camp
      const cur = slots[bestIdx];
      const ps = hourPriority.get(s.time_code) ?? BIG;
      const pc = hourPriority.get(cur.time_code) ?? BIG;
      if (ps !== pc) {
        if (ps < pc) bestIdx = i;
        continue;
      }

      if (s.starts_at < cur.starts_at) {
        bestIdx = i;
        continue;
      }
      if (s.starts_at > cur.starts_at) continue;

      const fs = String(s.field_code ?? "");
      const fc = String(cur.field_code ?? "");
      if (fs.localeCompare(fc) < 0) bestIdx = i;
    }

    if (bestIdx === -1) {
      throw new Error(
        "No hi ha cap slot disponible sense solapar horari (un equip ja juga a la mateixa hora)."
      );
    }

    return { slot: slots[bestIdx], index: bestIdx };
  }

  async function createMatches() {
    if (!selectedChampionshipId) {
      Alert.alert("Error", "Selecciona un campionat.");
      return;
    }

    setBusy(true);
    setStatusText("");

    try {
      const championshipId = selectedChampionshipId;

      await ensureNoExistingMatches(championshipId);

      const teams = await loadTeams(championshipId);
      const prefs = await loadPreferences(championshipId);
      const freeSlotsRaw = await loadFreeSlots(championshipId);

      const calendarCfg = await loadCalendarConfig(championshipId);
      const excludedDates = new Set((calendarCfg.excluded_dates ?? []).map((d) => String(d)));
      const priorityHours =
        (calendarCfg.priority_match_order_hours && calendarCfg.priority_match_order_hours.length > 0
          ? calendarCfg.priority_match_order_hours
          : ["10:30", "12:00", "09:00", "16:00", "17:30"]) as string[];

      const hourPriority = makeHourPriorityMap(priorityHours);

      const freeSlots = sortSlotsByPriority(
        freeSlotsRaw.filter((s) => !excludedDates.has(isoDateOnly(s.starts_at))),
        hourPriority
      );

      const refereeId = await fetchRefereeId();

      let pairs: Array<[number, number]> = [];
      let phaseId = 8; // lliga per defecte
      let gamesPerTeamForFairness = 0;

      if (format === "league") {
        phaseId = 8;
        const gamesPerTeam = await loadLeagueGamesPerTeam(championshipId);
        gamesPerTeamForFairness = gamesPerTeam;
        const { matches } = generateLeagueMatchesExact(teams, gamesPerTeam);
        pairs = matches;

        // ✅ Només mostrem avís si realment algun equip NO té gamesPerTeam partits
        const counts = new Map<number, number>();
        for (const tid of teams) counts.set(tid, 0);
        for (const [a, b] of matches) {
          counts.set(a, (counts.get(a) ?? 0) + 1);
          counts.set(b, (counts.get(b) ?? 0) + 1);
        }
        const notReached = teams.filter((tid) => (counts.get(tid) ?? 0) !== gamesPerTeam);
        if (notReached.length > 0) {
          setStatusText(
            `Avís: no tots els equips han arribat a ${gamesPerTeam} partits (casos límit). S'han creat ${matches.length} partits.`
          );
        } else {
          setStatusText("");
        }
      } else {
        // Groups: admin must decide manual vs random before generating.
        const g = format === "groups2" ? 2 : 3;

        const nameMap = await loadTeamNames(teams);
        setTeamNameById(nameMap);

        const randomGroups = chunkEvenly(shuffle(teams), g);
        setGroupTeams(randomGroups);
        setGroupSetupMode("random");
        setPendingContext({
          championshipId,
          prefs,
          freeSlots,
          hourPriority,
          refereeId,
          allTeams: teams,
          excludedDates,
          priorityHours,
        });
        setGroupSetupOpen(true);
        setBusy(false);
        return;
      }

      if (pairs.length === 0) {
        throw new Error("No s'han generat enfrontaments.");
      }

      if (freeSlots.length < pairs.length) {
        throw new Error(`No hi ha slots suficients. Necessaris: ${pairs.length}, disponibles: ${freeSlots.length}.`);
      }

      // Crear draw_run (guardem params per standings/grups sense crear taules noves)
      const drawRun = await createDrawRun(championshipId, format, {
        format,
        phase_id: phaseId,
        // per lliga
        ...(format === "league" ? { games_per_team: await loadLeagueGamesPerTeam(championshipId) } : {}),
        priority_match_order_hours: priorityHours,
        excluded_dates: Array.from(excludedDates),
      });

      // Assignació a slots
      const usedSlotIds: number[] = [];

      // ✅ New: fair assignment that respects preferences + avoids >2 weekends without playing (when possible)
      const assignments = assignPairsToSlotsFair(
        pairs,
        freeSlots,
        prefs,
        hourPriority,
        gamesPerTeamForFairness > 0 ? gamesPerTeamForFairness : 6
      );

      const matchesToInsert = assignments.map(({ a, b, slot }) => {
        usedSlotIds.push(slot.id);

        // ✅ Preference conflict: true si algun (o tots) dels equips NO prefereix aquest game_slot_id
        const aPref = teamAllows(prefs, a, slot.game_slot_id);
        const bPref = teamAllows(prefs, b, slot.game_slot_id);
        const preferenceConflict = !(aPref && bPref);

        const preferenceNotes = preferenceConflict
          ? {
              slot_game_slot_id: slot.game_slot_id,
              slot_starts_at: slot.starts_at,
              team_a_id: a,
              team_b_id: b,
              team_a_prefers: aPref,
              team_b_prefers: bPref,
              reason: !aPref && !bPref ? "none_prefer" : !aPref ? "teamA_not_preferred" : "teamB_not_preferred",
            }
          : {};

        return {
          championship_id: championshipId,
          team_a_id: a,
          team_b_id: b,
          match_date: slot.starts_at,
          referee_id: refereeId,
          phase_id: phaseId,
          is_finished: false,
          slot_id: slot.id,
          // Camps NOT NULL al teu schema:
          preference_conflict: preferenceConflict,
          preference_notes: preferenceNotes,
          score_team_a: 0,
          score_team_b: 0,
          finished_at: null,
          draw_run_id: drawRun.id,
        };
      });

      // Inserir matches
      const { error: insErr } = await supabase.from("match").insert(matchesToInsert);
      if (insErr) throw new Error(insErr.message);

      // Marcar slots com usats
      const { error: slotErr } = await supabase
        .from("match_slot")
        .update({ is_used: true })
        .in("id", usedSlotIds);

      if (slotErr) throw new Error(slotErr.message);

      Alert.alert("OK", `Creats ${matchesToInsert.length} partits i assignats a slots.`);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error desconegut");
    } finally {
      setBusy(false);
    }
  }

  
  function cycleTeamGroup(teamId: number, groupsCount: number) {
    // Manual mode: tap cycles A -> B -> C (etc). This makes the change visible and predictable.
    setGroupTeams((prev) => {
      // Ensure we always have groupsCount arrays
      const cur: number[][] = Array.from({ length: groupsCount }, (_, i) => [...(prev[i] ?? [])]);

      // Find current group (if any)
      let currentIdx = -1;
      for (let i = 0; i < groupsCount; i++) {
        const idx = cur[i].indexOf(teamId);
        if (idx >= 0) {
          cur[i].splice(idx, 1);
          currentIdx = i;
          break;
        }
      }

      const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % groupsCount;
      cur[nextIdx].push(teamId);
      return cur;
    });
  }

  function getTeamGroupIndex(teamId: number, groupsCount: number) {
    for (let i = 0; i < groupsCount; i++) {
      if ((groupTeams[i] ?? []).includes(teamId)) return i;
    }
    return -1;
  }

  async function finalizeCreateMatchesWithGroups() {
    if (!pendingContext) {
      Alert.alert("Error", "No hi ha context de sorteig.");
      return;
    }

    const groupsCount = format === "groups2" ? 2 : 3;

    setBusy(true);
    setStatusText("");
    try {
      const { championshipId, prefs, freeSlots, hourPriority, refereeId, allTeams, excludedDates, priorityHours } = pendingContext;

      // Build final groups
      const finalGroups =
        groupSetupMode === "random" ? chunkEvenly(shuffle([...allTeams]), groupsCount) : groupTeams.slice(0, groupsCount).map((g) => [...g]);

      // Validate: all teams included exactly once
      const seen = new Set<number>();
      for (const g of finalGroups) for (const t of g) seen.add(t);
      if (seen.size !== allTeams.length) {
        throw new Error("Els grups han d'incloure tots els equips (ni més ni menys).");
      }

      const { matches, perTeam } = generateGroupMatchesFromGroups(finalGroups);
      const phaseId = 1;

      if (matches.length === 0) throw new Error("No s'han generat enfrontaments.");
      if (freeSlots.length < matches.length) {
        throw new Error(`No hi ha slots suficients. Necessaris: ${matches.length}, disponibles: ${freeSlots.length}.`);
      }

      const groupCodes = ["A", "B", "C"];

      const drawRun = await createDrawRun(championshipId, format, {
        format,
        phase_id: phaseId,
        mode: groupSetupMode,
        per_team: perTeam,
        groups: finalGroups.map((ids, i) => ({ code: groupCodes[i] ?? String(i + 1), team_ids: ids })),
        priority_match_order_hours: priorityHours,
        excluded_dates: Array.from(excludedDates),
      });

      const usedSlotIds: number[] = [];

      const assignments = assignPairsToSlotsFair(matches, freeSlots, prefs, hourPriority, perTeam, {
        teamToGroup: new Map(finalGroups.flatMap((g, gi) => g.map((t) => [t, gi] as const))),
      });

      const matchesToInsert = assignments.map(({ a, b, slot }) => {
        usedSlotIds.push(slot.id);

        // ✅ Preference conflict: true si algun (o tots) dels equips NO prefereix aquest game_slot_id
        const aPref = teamAllows(prefs, a, slot.game_slot_id);
        const bPref = teamAllows(prefs, b, slot.game_slot_id);
        const preferenceConflict = !(aPref && bPref);

        const preferenceNotes = preferenceConflict
          ? {
              slot_game_slot_id: slot.game_slot_id,
              slot_starts_at: slot.starts_at,
              team_a_id: a,
              team_b_id: b,
              team_a_prefers: aPref,
              team_b_prefers: bPref,
              reason: !aPref && !bPref ? "none_prefer" : !aPref ? "teamA_not_preferred" : "teamB_not_preferred",
            }
          : {};

        return {
          championship_id: championshipId,
          team_a_id: a,
          team_b_id: b,
          match_date: slot.starts_at,
          referee_id: refereeId,
          phase_id: phaseId,
          is_finished: false,
          slot_id: slot.id,
          preference_conflict: preferenceConflict,
          preference_notes: preferenceNotes,
          score_team_a: 0,
          score_team_b: 0,
          finished_at: null,
          draw_run_id: drawRun.id,
        };
      });

      const { error: insErr } = await supabase.from("match").insert(matchesToInsert);
      if (insErr) throw new Error(insErr.message);

      const { error: slotErr } = await supabase.from("match_slot").update({ is_used: true }).in("id", usedSlotIds);
      if (slotErr) throw new Error(slotErr.message);

      setGroupSetupOpen(false);
      setPendingContext(null);
      Alert.alert("OK", `Creats ${matchesToInsert.length} partits de grups.`);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error desconegut");
    } finally {
      setBusy(false);
    }
  }

async function cleanMatches() {
    if (!selectedChampionshipId) {
      Alert.alert("Error", "Selecciona un campionat.");
      return;
    }

    setBusy(true);
    setStatusText("");

    try {
      const championshipId = selectedChampionshipId;

      // Si hi ha algun match finalitzat → no permetre netejar
      const { data: finishedData, error: finishedErr } = await supabase
        .from("match")
        .select("id", { count: "exact" })
        .eq("championship_id", championshipId)
        .eq("is_finished", true);

      if (finishedErr) throw new Error(finishedErr.message);
      if ((finishedData?.length ?? 0) > 0) {
        throw new Error("El campionat ja ha començat (hi ha partits finalitzats). No es pot netejar.");
      }

      // Agafar slot_ids dels matches (per alliberar slots després)
      const { data: matches, error: matchesErr } = await supabase
        .from("match")
        .select("id,slot_id")
        .eq("championship_id", championshipId);

      if (matchesErr) throw new Error(matchesErr.message);

      const slotIds = (matches ?? [])
        .map((m: any) => Number(m.slot_id))
        .filter((n) => Number.isFinite(n));

      // Esborrar matches
      const { error: delErr } = await supabase.from("match").delete().eq("championship_id", championshipId);
      if (delErr) throw new Error(delErr.message);

      // Alliberar slots que estaven usats per aquests matches
      if (slotIds.length > 0) {
        const { error: freeErr } = await supabase
          .from("match_slot")
          .update({ is_used: false })
          .in("id", slotIds);

        if (freeErr) throw new Error(freeErr.message);
      }

      Alert.alert("OK", "Partits eliminats i slots alliberats.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error desconegut");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16 }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12 }}>Carregant...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left","right","bottom"]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <BackButton
          onPress={() => router.back()}
          style={{ marginBottom:15 }}
        />
          <Text style={{ fontSize: 20, fontWeight: "800" }}>Sorteig / Crear partits</Text>
        </View>

        {/* Championship selector */}
        <Pressable
          onPress={() => setChampModalOpen(true)}
          style={{
            backgroundColor: "white",
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 14,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Campionat</Text>
          <Text style={{ fontSize: 16, fontWeight: "700" }}>{selectedChampLabel}</Text>
        </Pressable>

        {/* Format */}
        <View
          style={{
            backgroundColor: "white",
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 14,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>Format</Text>

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {[
              { key: "league" as const, label: "Lliga" },
              { key: "groups2" as const, label: "2 grups" },
              { key: "groups3" as const, label: "3 grups" },
            ].map((opt) => {
              const active = format === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setFormat(opt.key)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor: active ? "#111827" : "#f3f4f6",
                  }}
                >
                  <Text style={{ color: active ? "white" : "#111827", fontWeight: "700" }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Actions */}
        <Pressable
          disabled={busy}
          onPress={createMatches}
          style={{
            backgroundColor: busy ? "#9ca3af" : "#16a34a",
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "800" }}>
            {busy ? "Treballant..." : "Crear partits"}
          </Text>
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={cleanMatches}
          style={{
            backgroundColor: busy ? "#9ca3af" : "#ef4444",
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "800" }}>
            {busy ? "Treballant..." : "Netejar"}
          </Text>
        </Pressable>

        {statusText ? (
          <View
            style={{
              backgroundColor: "#fff7ed",
              borderColor: "#fdba74",
              borderWidth: 1,
              padding: 12,
              borderRadius: 14,
            }}
          >
            <Text style={{ color: "#9a3412", fontWeight: "700" }}>{statusText}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Championship modal */}
      
      {/* Group setup modal */}
      <Modal visible={groupSetupOpen} animationType="slide" onRequestClose={() => setGroupSetupOpen(false)}>
        <SafeAreaView edges={["left","right","bottom"]} style={{ flex: 1, backgroundColor: "white" }}>
          <View style={{ paddingTop: 70,paddingLeft:16,paddingRight:16,paddingBottom:30, flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <Pressable onPress={() => setGroupSetupOpen(false)} style={{ padding: 10, marginRight: 10 }}>
                <Text style={{ fontSize: 18 }}>✕</Text>
              </Pressable>
              <Text style={{ fontSize: 18, fontWeight: "800" }}>
                {format === "groups2" ? "Configurar 2 grups" : "Configurar 3 grups"}
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {[
                { key: "random" as const, label: "Aleatori" },
                { key: "manual" as const, label: "Manual" },
              ].map((opt) => {
                const active = groupSetupMode === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setGroupSetupMode(opt.key)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderRadius: 999,
                      backgroundColor: active ? "#111827" : "#f3f4f6",
                    }}
                  >
                    <Text style={{ color: active ? "white" : "#111827", fontWeight: "800" }}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {groupSetupMode === "manual" ? (
              <>
                <Text style={{ color: "#6b7280", marginBottom: 8 }}>
                  Toca un equip per moure'l al següent grup (A → B → C...).
                </Text>
                <ScrollView style={{ flex: 1 }}>
                  {pendingContext?.allTeams?.map((id) => {
                    const groupsCount = format === "groups2" ? 2 : 3;
                    const gi = getTeamGroupIndex(id, groupsCount);
                    const label = gi >= 0 ? `Grup ${String.fromCharCode(65 + gi)}` : "Sense grup";
                    return (
                    <Pressable
                      key={id}
                      onPress={() => cycleTeamGroup(id, format === "groups2" ? 2 : 3)}
                      style={{
                        padding: 12,
                        borderWidth: 1,
                        borderColor: "#e5e7eb",
                        borderRadius: 12,
                        marginBottom: 8,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <Text style={{ fontWeight: "800", flexShrink: 1, paddingRight: 10 }}>
                        {teamNameById[id] ?? `Equip ${id}`}
                      </Text>
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "#f3f4f6",
                          borderWidth: 1,
                          borderColor: "#e5e7eb",
                        }}
                      >
                        <Text style={{ fontWeight: "800", color: "#111827" }}>{label}</Text>
                      </View>
                    </Pressable>
                    );
                  })}
                </ScrollView>

                <View style={{ marginTop: 10 }}>
                  <Text style={{ fontWeight: "800", marginBottom: 6 }}>Resum grups</Text>
                  {groupTeams.slice(0, format === "groups2" ? 2 : 3).map((g, idx) => (
                    <Text key={idx} style={{ color: "#374151", marginBottom: 4 }}>
                      Grup {String.fromCharCode(65 + idx)}: {g.length} equips
                    </Text>
                  ))}
                </View>
              </>
            ) : (
              <View style={{ flex: 1, justifyContent: "center" }}>
                <Text style={{ color: "#374151", textAlign: "center" }}>
                  Es farà aleatoriament en crear els partits.
                </Text>
              </View>
            )}

            <Pressable
              disabled={busy}
              onPress={finalizeCreateMatchesWithGroups}
              style={{
                backgroundColor: busy ? "#9ca3af" : "#16a34a",
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: "center",
                marginTop: 14,
              }}
            >
              <Text style={{ color: "white", fontSize: 16, fontWeight: "800" }}>
                {busy ? "Treballant..." : "Crear partits"}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
<Modal visible={champModalOpen} animationType="slide" onRequestClose={() => setChampModalOpen(false)}>
        <SafeAreaView edges={["left","right","bottom"]} style={{ flex: 1, backgroundColor: "white",marginTop:70 }}>
          <View style={{ padding: 16 ,flex: 1}}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <Pressable onPress={() => setChampModalOpen(false)} style={{ padding: 10, marginRight: 10 }}>
                <Text style={{ fontSize: 18 }}>✕</Text>
              </Pressable>
              <Text style={{ fontSize: 18, fontWeight: "800" }}>Selecciona campionat</Text>
            </View>

            <TextInput
              value={champSearch}
              onChangeText={setChampSearch}
              placeholder="Cerca..."
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 12,
              }}
            />

            <FlatList
              data={filteredChampionships}
              keyExtractor={(item) => String(item.id)}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              renderItem={({ item }) => {
                const active = item.id === selectedChampionshipId;
                return (
                  <Pressable
                    onPress={() => {
                      setSelectedChampionshipId(item.id);
                      setChampModalOpen(false);
                      setChampSearch("");
                    }}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: active ? "#111827" : "#e5e7eb",
                      backgroundColor: active ? "#111827" : "white",
                    }}
                  >
                    <Text style={{ fontWeight: "800", color: active ? "white" : "#111827" }}>
                      {item.name} {item.year}
                    </Text>
                    {item.is_active ? (
                      <Text style={{ marginTop: 6, color: active ? "#d1d5db" : "#6b7280" }}>Actiu</Text>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
