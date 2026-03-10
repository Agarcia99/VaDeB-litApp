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


function weekendKeyFromISO(iso: string) {
  const d = new Date(iso);
  // Normalize to local date at noon to avoid DST issues
  const x = new Date(`${isoDateOnly(iso)}T12:00:00`);
  // JS: 0=Sun ... 6=Sat
  const dow = x.getDay();
  // We want Saturday as weekend key. If Sunday -> go back 1 day. If weekday -> go forward to next Saturday.
  const sat = new Date(x);
  if (dow === 0) sat.setDate(x.getDate() - 1);
  else if (dow !== 6) sat.setDate(x.getDate() + (6 - dow));
  return isoDateOnly(sat.toISOString());
}

function computeWeeksWithoutPlaying(assignments: Array<{ a: number; b: number; slot: MatchSlot }>) {
  const teams = new Set<number>();
  const weekendSet = new Set<string>();
  for (const it of assignments) {
    teams.add(it.a);
    teams.add(it.b);
    weekendSet.add(weekendKeyFromISO(it.slot.starts_at));
  }
  const weekends = Array.from(weekendSet).sort();
  const weekendIndex = new Map<string, number>();
  weekends.forEach((w, i) => weekendIndex.set(w, i));

  const playsByTeam = new Map<number, number[]>();
  for (const t of teams) playsByTeam.set(t, []);
  for (const it of assignments) {
    const wi = weekendIndex.get(weekendKeyFromISO(it.slot.starts_at));
    if (wi === undefined) continue;
    playsByTeam.get(it.a)!.push(wi);
    playsByTeam.get(it.b)!.push(wi);
  }
  // dedupe + sort
  for (const [t, arr] of playsByTeam.entries()) {
    const uniq = Array.from(new Set(arr)).sort((a, b) => a - b);
    playsByTeam.set(t, uniq);
  }

  const maxGapByTeam = new Map<number, number>();
  let globalMax = 0;

  for (const [t, arr] of playsByTeam.entries()) {
    if (arr.length === 0) {
      maxGapByTeam.set(t, weekends.length > 0 ? weekends.length : 0);
      globalMax = Math.max(globalMax, weekends.length);
      continue;
    }
    let maxGap = 0;
    for (let i = 1; i < arr.length; i++) {
      const gap = arr[i] - arr[i - 1] - 1; // weekends in between
      if (gap > maxGap) maxGap = gap;
    }
    maxGapByTeam.set(t, maxGap);
    if (maxGap > globalMax) globalMax = maxGap;
  }

  const worstTeams = Array.from(maxGapByTeam.entries())
    .filter(([, g]) => g >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([teamId, gap]) => ({ teamId, gap }));

  return { weekends, maxGapByTeam, globalMax, worstTeams };
}

function computeSlotBalance(assignments: Array<{ a: number; b: number; slot: MatchSlot }>) {
  // Count by game_slot_id per team
  const counts = new Map<number, Map<number, number>>();
  const slots = new Set<number>();
  const teams = new Set<number>();
  for (const it of assignments) {
    teams.add(it.a);
    teams.add(it.b);
    slots.add(it.slot.game_slot_id);
  }
  for (const t of teams) counts.set(t, new Map());
  for (const it of assignments) {
    const slotId = it.slot.game_slot_id;
    counts.get(it.a)!.set(slotId, (counts.get(it.a)!.get(slotId) ?? 0) + 1);
    counts.get(it.b)!.set(slotId, (counts.get(it.b)!.get(slotId) ?? 0) + 1);
  }
  const slotIds = Array.from(slots).sort((a, b) => a - b);

  // For each team, compute range (max-min) across slotIds (missing=0)
  const rangeByTeam = new Map<number, number>();
  let globalRange = 0;
  for (const t of teams) {
    const m = counts.get(t)!;
    let mn = Number.POSITIVE_INFINITY;
    let mx = 0;
    for (const sid of slotIds) {
      const v = m.get(sid) ?? 0;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const r = slotIds.length ? mx - mn : 0;
    rangeByTeam.set(t, r);
    globalRange = Math.max(globalRange, r);
  }
  return { slotIds, rangeByTeam, globalRange };
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
// If there are pairs with 0 common preferred slots, we still generate a draft.
// Those matches may land in non-preferred slots and should be marked as warnings (preference_conflict=true).

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

// Repartiment "base + extra" però ESCAMPANT els extres al llarg de la temporada
// (no tots al principi), per evitar 10 partits al primer cap de setmana i 4 als últims.
const totalWeekends = weekendKeys.length;
const totalMatches = remaining.length;
const base = Math.floor(totalMatches / Math.max(1, totalWeekends));
const extra = totalMatches % Math.max(1, totalWeekends);

const extraWeekends = new Set<number>();
if (extra > 0 && totalWeekends > 0) {
  // Distribute indices as evenly as possible across [0..totalWeekends-1]
  for (let i = 0; i < extra; i++) {
    let idx = Math.floor(((i + 0.5) * totalWeekends) / extra);
    // ensure uniqueness
    while (extraWeekends.has(idx) && idx < totalWeekends - 1) idx++;
    extraWeekends.add(Math.min(idx, totalWeekends - 1));
  }
}

  const BIG = 1_000_000;

  for (let wIdx = 0; wIdx < weekendKeys.length; wIdx++) {
    if (remaining.length === 0) break;

    const wKey = weekendKeys[wIdx];
    const wSlotsAll = slotsByWeekend.get(wKey) ?? [];
    if (wSlotsAll.length === 0) continue;

    // Cupo d'aquest cap de setmana
    const weekendTarget = base + (extraWeekends.has(wIdx) ? 1 : 0);
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

    const allowConflictForPair = (commonPrefSlotsCount.get(pairKey(a, b)) ?? 0) === 0;
    if (!(teamAllows(prefs, a, slot.game_slot_id) && teamAllows(prefs, b, slot.game_slot_id)) && !allowConflictForPair) continue;

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

  
// --- Rebalance pass: move matches from overloaded weekends to underloaded weekends (if empty slots exist)
// This helps avoid front-loading lots of matches early and leaving the end too empty.
{
  const wkFromISO = (iso: string) => weekendKeyFromISO(iso);

  const loadByWeekend = new Map<string, number>();
  for (const a of assignments) {
    const k = wkFromISO(a.slot.starts_at);
    loadByWeekend.set(k, (loadByWeekend.get(k) ?? 0) + 1);
  }

  const usedSlotIds = new Set(assignments.map((x) => x.slot.id));
  const emptySlotsByWeekend = new Map<string, MatchSlot[]>();
  for (const s of remainingSlots) {
    if (usedSlotIds.has(s.id)) continue;
    const k = wkFromISO(s.starts_at);
    if (!emptySlotsByWeekend.has(k)) emptySlotsByWeekend.set(k, []);
    emptySlotsByWeekend.get(k)!.push(s);
  }
  for (const [k, arr] of emptySlotsByWeekend.entries()) {
    arr.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  const targetBase = Math.floor(totalMatches / Math.max(1, totalWeekends));
  const targetHi = targetBase + (totalMatches % Math.max(1, totalWeekends) > 0 ? 1 : 0);

  // Team time usage for overlap checks
  const timeUsed = new Map<number, Set<string>>();
  for (const it of assignments) {
    if (!timeUsed.has(it.a)) timeUsed.set(it.a, new Set());
    if (!timeUsed.has(it.b)) timeUsed.set(it.b, new Set());
    timeUsed.get(it.a)!.add(it.slot.starts_at);
    timeUsed.get(it.b)!.add(it.slot.starts_at);
  }

  const canMoveToSlot = (matchIdx: number, toSlot: MatchSlot) => {
    const it = assignments[matchIdx];
    const a = it.a, b = it.b;

    const allowConflictForPair = (commonPrefSlotsCount.get(pairKey(a, b)) ?? 0) === 0;
    const prefOk = teamAllows(prefs, a, toSlot.game_slot_id) && teamAllows(prefs, b, toSlot.game_slot_id);
    if (!prefOk && !allowConflictForPair) return false;

    const usedA = timeUsed.get(a) ?? new Set<string>();
    const usedB = timeUsed.get(b) ?? new Set<string>();
    // remove current slot time from temporary check
    const curTime = it.slot.starts_at;
    if ((toSlot.starts_at !== curTime && usedA.has(toSlot.starts_at)) || (toSlot.starts_at !== curTime && usedB.has(toSlot.starts_at))) {
      return false;
    }
    return true;
  };

  // Try to fill underloaded weekends up to ~targetBase/targetHi, by pulling from overloaded ones
  const weekendKeysSorted = [...weekendKeys];
  for (const underKey of weekendKeysSorted) {
    const emptySlots = emptySlotsByWeekend.get(underKey) ?? [];
    if (emptySlots.length === 0) continue;

    while (emptySlots.length > 0) {
      const currentUnder = loadByWeekend.get(underKey) ?? 0;
      if (currentUnder >= targetBase) break; // good enough (keeps end from being too empty)

      // Find an overfull weekend
      let overKey: string | null = null;
      let overLoad = -1;
      for (const k of weekendKeysSorted) {
        const l = loadByWeekend.get(k) ?? 0;
        if (l > overLoad && l > targetHi) {
          overLoad = l;
          overKey = k;
        }
      }
      if (!overKey) break;

      // Pick an empty slot in underKey
      const toSlot = emptySlots.shift()!;
      // Find a movable match from overKey
      const candidatesIdx: number[] = [];
      for (let mi = 0; mi < assignments.length; mi++) {
        if (wkFromISO(assignments[mi].slot.starts_at) !== overKey) continue;
        if (canMoveToSlot(mi, toSlot)) candidatesIdx.push(mi);
      }
      if (candidatesIdx.length === 0) continue;

      // Heuristic: move the match whose current weekend is most overloaded first
      const pickIdx = candidatesIdx[Math.floor(Math.random() * candidatesIdx.length)];
      const moving = assignments[pickIdx];

      // Update timeUsed sets
      timeUsed.get(moving.a)!.delete(moving.slot.starts_at);
      timeUsed.get(moving.b)!.delete(moving.slot.starts_at);
      timeUsed.get(moving.a)!.add(toSlot.starts_at);
      timeUsed.get(moving.b)!.add(toSlot.starts_at);

      // Apply move
      assignments[pickIdx] = { ...moving, slot: toSlot };

      // Update loads
      loadByWeekend.set(overKey, (loadByWeekend.get(overKey) ?? 0) - 1);
      loadByWeekend.set(underKey, (loadByWeekend.get(underKey) ?? 0) + 1);

      // Update usedSlotIds / empties bookkeeping
      usedSlotIds.delete(moving.slot.id);
      usedSlotIds.add(toSlot.id);
    }
  }
}

// Si han quedat partits sense assignar, intentem omplir amb slots sobrants
  // sempre respectant preferència comuna. Si no es pot, ERROR (per evitar preference_conflict=true).
  if (remaining.length > 0) {
    const usedSlotIds = new Set(assignments.map((x) => x.slot.id));
    const leftoverSlots = remainingSlots.filter((s) => !usedSlotIds.has(s.id));

    // Build current load by weekend so we can place leftovers in underloaded weekends (avoid front-loading).
    const loadByWeekend = new Map<string, number>();
    for (const it of assignments) {
      const wk = weekendKeyFromISO(it.slot.starts_at);
      loadByWeekend.set(wk, (loadByWeekend.get(wk) ?? 0) + 1);
    }

    const slotWeekend = (s: MatchSlot) => weekendKeyFromISO(s.starts_at);

    const pickBestSlotBalanced = (candidates: MatchSlot[], teamA: number, teamB: number) => {
      const usedA = teamTimeUsed.get(teamA) ?? new Set<string>();
      const usedB = teamTimeUsed.get(teamB) ?? new Set<string>();

      let best: MatchSlot | null = null;
      let bestScore = Infinity;

      const BIG = 1_000_000;
      for (const s of candidates) {
        // no two matches at same exact time for same team
        if (usedA.has(s.starts_at) || usedB.has(s.starts_at)) continue;

        const wk = slotWeekend(s);
        const load = loadByWeekend.get(wk) ?? 0;

        // Primary: put it where weekend load is lowest.
        // Secondary: keep hour priority and earlier time ordering (so UX remains consistent).
        const hp = hourPriority.get(s.time_code) ?? BIG;

        // score: weekend load dominates, then hour priority, then date.
        const score = load * 1_000_000 + hp * 10 + (s.starts_at ? 1 : 0);

        if (score < bestScore) {
          bestScore = score;
          best = s;
        } else if (score == bestScore && best && s.starts_at < best.starts_at) {
          best = s;
        }
      }

      return best;
    };

    for (const [a, b] of remaining) {
      // Prefer slots compatible with both preferences. If none exist for this pair, fallback to any slot (will be marked as conflict later).
      let candidates = leftoverSlots.filter(
        (s) => teamAllows(prefs, a, s.game_slot_id) && teamAllows(prefs, b, s.game_slot_id)
      );
      if (candidates.length === 0) candidates = leftoverSlots;

      if (candidates.length === 0) {
        throw new Error(`No hi ha prou slots lliures per assignar el partit ${a}-${b}.`);
      }

      const chosen = pickBestSlotBalanced(candidates, a, b) ?? candidates[0];

      // remove chosen from leftoverSlots
      const realIdx = leftoverSlots.findIndex((s) => s.id === chosen.id);
      if (realIdx >= 0) leftoverSlots.splice(realIdx, 1);

      // update time used
      if (!teamTimeUsed.has(a)) teamTimeUsed.set(a, new Set());
      if (!teamTimeUsed.has(b)) teamTimeUsed.set(b, new Set());
      teamTimeUsed.get(a)!.add(chosen.starts_at);
      teamTimeUsed.get(b)!.add(chosen.starts_at);

      // update weekend load
      const wk = slotWeekend(chosen);
      loadByWeekend.set(wk, (loadByWeekend.get(wk) ?? 0) + 1);

      assignments.push({ a, b, slot: chosen });
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


// ------------------------
// Preview + editable draft (no DB write until user accepts)
// ------------------------
type DraftAssignment = { a: number; b: number; slot: MatchSlot; prefConflict: boolean };
const [previewOpen, setPreviewOpen] = useState(false);
const [draftAssignments, setDraftAssignments] = useState<DraftAssignment[]>([]);
const [previewMeta, setPreviewMeta] = useState<null | {
  championshipId: number;
  phaseId: number;
  refereeId: number;
  format: "league" | "groups2" | "groups3";
  drawParams: any;
  prefs: Map<number, Set<number>>;
  hourPriority: Map<string, number>;
    allSlots: MatchSlot[];
}>(null);

const [moveModalOpen, setMoveModalOpen] = useState(false);
const [moveFromSlotId, setMoveFromSlotId] = useState<number | null>(null);
const [moveAllowAnyWeekend, setMoveAllowAnyWeekend] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);



  const [statusText, setStatusText] = useState<string>("");

  // ------------------------
  // Safety: destructive "Netejar" confirmation
  // ------------------------
  const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false);
  const [cleanConfirmText, setCleanConfirmText] = useState("");
  const [cleanPendingCount, setCleanPendingCount] = useState<number | null>(null);
  const [cleanBlockedBecauseFinished, setCleanBlockedBecauseFinished] = useState(false);
  const CLEAN_PHRASE = "NETEJAR";

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
      const nameMapAll = await loadTeamNames(teams);
      setTeamNameById(nameMapAll);
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
      

// ✅ Assignació a slots (no DB write yet)
const assignments = assignPairsToSlotsFair(
  pairs,
  freeSlots,
  prefs,
  hourPriority,
  gamesPerTeamForFairness > 0 ? gamesPerTeamForFairness : 6
);

// Preferences: we try to reach 0 conflicts, but if impossible we continue with warnings.
const draft: DraftAssignment[] = assignments.map(({ a, b, slot }: any) => {
  const okA = teamAllows(prefs, a, slot.game_slot_id);
  const okB = teamAllows(prefs, b, slot.game_slot_id);
  return { a, b, slot, prefConflict: !(okA && okB) };
});

setDraftAssignments(draft);

const prefConflicts = draft.filter((x) => x.prefConflict).length;
if (prefConflicts > 0) {
  setStatusText(`Avís: ${prefConflicts} partit(s) no poden complir totes les preferències. Es mostraran marcats ⚠️.`);
} else {
  setStatusText("");
}

setPreviewMeta({
  championshipId,
  phaseId,
  refereeId,
  format,
  drawParams: {
    format,
    phase_id: phaseId,
    ...(format === "league" ? { games_per_team: await loadLeagueGamesPerTeam(championshipId) } : {}),
    priority_match_order_hours: priorityHours,
    excluded_dates: Array.from(excludedDates),
  },
  prefs,
  hourPriority,
        allSlots: freeSlots,
});
setPreviewOpen(true);
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

  

function recomputePreviewMetrics(assignments: DraftAssignment[]) {
  const w = computeWeeksWithoutPlaying(assignments);
  const sb = computeSlotBalance(assignments);
  const gapsSorted = Array.from(w.maxGapByTeam.entries())
  .map(([teamId, gap]) => ({ teamId, gap }))
  .sort((a, b) => b.gap - a.gap);

return { weeks: w, slotBalance: sb, gapsSorted };
}

const previewMetrics = useMemo(() => {
  return recomputePreviewMetrics(draftAssignments);
}, [draftAssignments]);


const prefConflictCount = useMemo(() => {
  return draftAssignments.filter((x) => x.prefConflict).length;
}, [draftAssignments]);

// Keep the "conflict preferences" warning in sync when user edits / auto-fix updates the draft
useEffect(() => {
  if (!previewOpen) return;

  const prefMsg =
    prefConflictCount > 0
      ? `Avís: ${prefConflictCount} partit(s) no poden complir totes les preferències. Es mostraran marcats ⚠️.`
      : "";

  setStatusText((prev) => {
    // Remove any previous preference warning line (we re-add the updated one)
    const cleaned = (prev ?? "")
      .replace(
        /\n?Avís: \d+ partit\(s\) no poden complir totes les preferències\.[^\n]*\n?/g,
        ""
      )
      .trim();

    if (prefMsg) return cleaned ? `${cleaned}\n${prefMsg}` : prefMsg;
    return cleaned;
  });
}, [prefConflictCount, previewOpen]);


function slotLabel(slot: MatchSlot) {
  const date = isoDateOnly(slot.starts_at);
  return `${date} · ${slot.time_code} · ${slot.field_code} · gs:${slot.game_slot_id}`;
}

function openMoveModal(fromSlotId: number) {
  setMoveFromSlotId(fromSlotId);
  setMoveModalOpen(true);
}

function canPlaceTeamsAtTime(assignments: DraftAssignment[], slot: MatchSlot, a: number, b: number, ignoreSlotId?: number) {
  const t = slot.starts_at;
  for (const it of assignments) {
    if (ignoreSlotId && it.slot.id === ignoreSlotId) continue;
    if (it.slot.starts_at !== t) continue;
    if (it.a === a || it.b === a || it.a === b || it.b === b) return false;
  }
  return true;
}

function tryMoveOrSwap(toSlotId: number) {
  if (moveFromSlotId == null) return;
  const fromIdx = draftAssignments.findIndex((x) => x.slot.id === moveFromSlotId);
  if (fromIdx === -1) return;

  const toIdx = draftAssignments.findIndex((x) => x.slot.id === toSlotId);
  const from = draftAssignments[fromIdx];

  const toSlot = (() => {
  if (toIdx !== -1) return draftAssignments[toIdx].slot;

  // destination is empty: take it from the full slots list used in the simulation
  const allSlots = previewMeta?.allSlots ?? [];
  const found = allSlots.find((s) => s.id === toSlotId);
  return found ?? null;
})();

  if (!toSlot) return;

  const prefs = previewMeta?.prefs;
  if (!prefs) return;

  // destination empty (no match currently)
  if (toIdx === -1) {
    // preferences for moved match
    const okA = teamAllows(prefs, from.a, toSlot.game_slot_id);
    const okB = teamAllows(prefs, from.b, toSlot.game_slot_id);
    if (!(okA && okB)) {
      Alert.alert("No permès", "Aquest slot no compleix preferències.");
      return;
    }
    if (!canPlaceTeamsAtTime(draftAssignments, toSlot, from.a, from.b, moveFromSlotId)) {
      Alert.alert("No permès", "Un equip ja juga a la mateixa hora.");
      return;
    }

    const next = [...draftAssignments];
    next[fromIdx] = { ...from, slot: toSlot };
    setDraftAssignments(next);
    setMoveModalOpen(false);
    return;
  }

  // swap
  const other = draftAssignments[toIdx];
  const okA1 = teamAllows(prefs, from.a, other.slot.game_slot_id);
  const okB1 = teamAllows(prefs, from.b, other.slot.game_slot_id);
  const okA2 = teamAllows(prefs, other.a, from.slot.game_slot_id);
  const okB2 = teamAllows(prefs, other.b, from.slot.game_slot_id);
  if (!(okA1 && okB1 && okA2 && okB2)) {
    Alert.alert("No permès", "El swap trenca preferències.");
    return;
  }
  if (!canPlaceTeamsAtTime(draftAssignments, other.slot, from.a, from.b, moveFromSlotId) ||
      !canPlaceTeamsAtTime(draftAssignments, from.slot, other.a, other.b, other.slot.id)) {
    Alert.alert("No permès", "El swap crea solapament horari.");
    return;
  }

  const next = [...draftAssignments];
  next[fromIdx] = { ...from, slot: other.slot };
  next[toIdx] = { ...other, slot: from.slot };
  setDraftAssignments(next);
  setMoveModalOpen(false);
}



function scoreEquity(assignments: DraftAssignment[]) {
  const w = computeWeeksWithoutPlaying(assignments);

  // 1) Hard/primary: minimize maximum gap (weeks without playing)
  const globalMax = w.globalMax;

  // 2) Secondary: minimize number of teams with gap >= 3 (your hard rule)
  const redCount = w.worstTeams.length;

  // 3) Tertiary: make gaps as close as possible to TARGET=2
  //    and heavily penalize teams with gap=0 (playing every weekend).
  const TARGET = 2;
  let devSum = 0;
  let zeroCount = 0;
  for (const g of w.maxGapByTeam.values()) {
    devSum += Math.abs(g - TARGET);
    if (g === 0) zeroCount += 1;
  }

  // 4) Tie breaker: sum gaps (overall "idle weeks" amount)
  const sumGaps = Array.from(w.maxGapByTeam.values()).reduce((acc, g) => acc + g, 0);

  return { globalMax, redCount, devSum, zeroCount, sumGaps };
}

function canSwapAssignments(assignments: DraftAssignment[], i: number, j: number) {
  const prefs = previewMeta?.prefs;
  if (!prefs) return false;

  const A = assignments[i];
  const B = assignments[j];
  if (!A || !B) return false;

  // preference check
  const okA1 = teamAllows(prefs, A.a, B.slot.game_slot_id) && teamAllows(prefs, A.b, B.slot.game_slot_id);
  const okA2 = teamAllows(prefs, B.a, A.slot.game_slot_id) && teamAllows(prefs, B.b, A.slot.game_slot_id);
  if (!(okA1 && okA2)) return false;

  // time overlap check: place A teams into B slot time; B teams into A slot time
  if (
    !canPlaceTeamsAtTime(assignments, B.slot, A.a, A.b, A.slot.id) ||
    !canPlaceTeamsAtTime(assignments, A.slot, B.a, B.b, B.slot.id)
  ) {
    return false;
  }

  return true;
}

async function autoFixEquity() {
  if (autoFixing) return;
  if (!previewMeta) return;
  if (draftAssignments.length < 2) return;

  setAutoFixing(true);
  try {
    let best = [...draftAssignments];
    let bestScore = scoreEquity(best);

    // Heuristic: randomized hill-climb swaps
    const ITER = 800;
    for (let k = 0; k < ITER; k++) {
      const i = Math.floor(Math.random() * best.length);
      let j = Math.floor(Math.random() * best.length);
      if (j === i) j = (j + 1) % best.length;

      if (!canSwapAssignments(best, i, j)) continue;

      const candidate = [...best];
      const Ai = candidate[i];
      const Bj = candidate[j];
      candidate[i] = { ...Ai, slot: Bj.slot };
      candidate[j] = { ...Bj, slot: Ai.slot };

      const s = scoreEquity(candidate);

      const better =
  s.globalMax < bestScore.globalMax ||
  (s.globalMax === bestScore.globalMax && s.redCount < bestScore.redCount) ||
  (s.globalMax === bestScore.globalMax &&
    s.redCount === bestScore.redCount &&
    s.zeroCount < bestScore.zeroCount) ||
  (s.globalMax === bestScore.globalMax &&
    s.redCount === bestScore.redCount &&
    s.zeroCount === bestScore.zeroCount &&
    s.devSum < bestScore.devSum) ||
  (s.globalMax === bestScore.globalMax &&
    s.redCount === bestScore.redCount &&
    s.zeroCount === bestScore.zeroCount &&
    s.devSum === bestScore.devSum &&
    s.sumGaps < bestScore.sumGaps);

      if (better) {
        best = candidate;
        bestScore = s;
      }
    }

    setDraftAssignments(best);
  } finally {
    setAutoFixing(false);
  }
}

async function confirmCreateFromPreview() {
  if (!previewMeta) {
    Alert.alert("Error", "No hi ha simulació.");
    return;
  }
  if (!selectedChampionshipId) {
    Alert.alert("Error", "Selecciona un campionat.");
    return;
  }
  if (draftAssignments.length === 0) {
    Alert.alert("Error", "No hi ha simulació per confirmar.");
    return;
  }

  setBusy(true);
  try {
    const { championshipId, phaseId, refereeId, format, drawParams } = previewMeta;

    // create draw_run with params (groups/league)
    const drawRun = await createDrawRun(championshipId, format, drawParams);

    const usedSlotIds: number[] = [];
    const matchesToInsert = draftAssignments.map(({ a, b, slot, prefConflict }) => {
      usedSlotIds.push(slot.id);
      return {
        championship_id: championshipId,
        team_a_id: a,
        team_b_id: b,
        match_date: slot.starts_at,
        referee_id: refereeId,
        phase_id: phaseId,
        is_finished: false,
        slot_id: slot.id,
        preference_conflict: prefConflict,
        preference_notes: prefConflict ? { kind: "preference_conflict" } : {},
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

    setPreviewOpen(false);


    setDraftAssignments([]);
    setPreviewMeta(null);
    setGroupSetupOpen(false);
    setPendingContext(null);

    Alert.alert("OK", `Creats ${matchesToInsert.length} partits.`);
  } catch (e: any) {
    Alert.alert("Error", e?.message ?? "Error desconegut");
  } finally {
    setBusy(false);
  }
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

      

const assignments = assignPairsToSlotsFair(matches, freeSlots, prefs, hourPriority, perTeam, {
  teamToGroup: new Map(finalGroups.flatMap((g, gi) => g.map((t) => [t, gi] as const))),
});

// Preferences: we try to reach 0 conflicts, but if impossible we continue with warnings.
const draft: DraftAssignment[] = assignments.map(({ a, b, slot }: any) => {
  const okA = teamAllows(prefs, a, slot.game_slot_id);
  const okB = teamAllows(prefs, b, slot.game_slot_id);
  return { a, b, slot, prefConflict: !(okA && okB) };
});

setDraftAssignments(draft);

const prefConflicts = draft.filter((x) => x.prefConflict).length;
if (prefConflicts > 0) {
  setStatusText(`Avís: ${prefConflicts} partit(s) no poden complir totes les preferències. Es mostraran marcats ⚠️.`);
} else {
  setStatusText("");
}

setPreviewMeta({
  championshipId,
  phaseId,
  refereeId,
  format,
  prefs,
  hourPriority,
        allSlots: freeSlots,
  drawParams: {
    format,
    phase_id: phaseId,
    mode: groupSetupMode,
    per_team: perTeam,
    groups: finalGroups.map((ids, i) => ({ code: groupCodes[i] ?? String(i + 1), team_ids: ids })),
    priority_match_order_hours: priorityHours,
    excluded_dates: Array.from(excludedDates),
  },
});

setGroupSetupOpen(false);
setPreviewOpen(true);

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

  // Open a safer confirmation modal before allowing the destructive action.
  async function requestCleanMatches() {
    if (!selectedChampionshipId) {
      Alert.alert("Error", "Selecciona un campionat.");
      return;
    }
    if (busy) return;

    setCleanConfirmText("");
    setCleanPendingCount(null);
    setCleanBlockedBecauseFinished(false);

    try {
      const championshipId = selectedChampionshipId;

      const [{ count: totalCount, error: totalErr }, { count: finishedCount, error: finishedErr }] = await Promise.all([
        supabase
          .from("match")
          .select("id", { count: "exact", head: true })
          .eq("championship_id", championshipId),
        supabase
          .from("match")
          .select("id", { count: "exact", head: true })
          .eq("championship_id", championshipId)
          .eq("is_finished", true),
      ]);

      if (totalErr) throw new Error(totalErr.message);
      if (finishedErr) throw new Error(finishedErr.message);

      const t = typeof totalCount === "number" ? totalCount : 0;
      const f = typeof finishedCount === "number" ? finishedCount : 0;
      setCleanPendingCount(t);
      setCleanBlockedBecauseFinished(f > 0);
      setCleanConfirmOpen(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error desconegut");
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
            {busy ? "Treballant..." : "Simular calendari"}
          </Text>
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={requestCleanMatches}
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

      {/* Safety modal: confirm "Netejar" */}
      <Modal
        visible={cleanConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCleanConfirmOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 520,
              backgroundColor: "white",
              borderRadius: 18,
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 8 }}>
              Confirmar neteja
            </Text>

            <Text style={{ color: "#374151", marginBottom: 10 }}>
              Aquesta acció és irreversible. Eliminarà els partits del campionat seleccionat i alliberarà els slots.
            </Text>

            <View
              style={{
                backgroundColor: "#fff7ed",
                borderColor: "#fdba74",
                borderWidth: 1,
                padding: 10,
                borderRadius: 14,
                marginBottom: 12,
              }}
            >
              <Text style={{ color: "#9a3412", fontWeight: "800" }}>
                Partits a eliminar: {cleanPendingCount == null ? "..." : cleanPendingCount}
              </Text>
              {cleanBlockedBecauseFinished ? (
                <Text style={{ color: "#9a3412", marginTop: 6, fontWeight: "700" }}>
                  Hi ha partits finalitzats. No es pot netejar un campionat que ja ha començat.
                </Text>
              ) : null}
            </View>

            <Text style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
              Escriu "{CLEAN_PHRASE}" per habilitar la neteja
            </Text>
            <TextInput
              value={cleanConfirmText}
              onChangeText={setCleanConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={CLEAN_PHRASE}
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 14,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 14,
                fontWeight: "800",
              }}
            />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setCleanConfirmOpen(false)}
                style={{
                  flex: 1,
                  backgroundColor: "#f3f4f6",
                  paddingVertical: 12,
                  borderRadius: 14,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "900", color: "#111827" }}>Cancel·lar</Text>
              </Pressable>

              {(() => {
                const enabled =
                  !busy &&
                  !cleanBlockedBecauseFinished &&
                  (cleanPendingCount ?? 0) > 0 &&
                  cleanConfirmText.trim().toUpperCase() === CLEAN_PHRASE;

                return (
                  <Pressable
                    disabled={!enabled}
                    onLongPress={async () => {
                      // Extra safety: require long press
                      setCleanConfirmOpen(false);
                      setCleanConfirmText("");
                      await cleanMatches();
                    }}
                    delayLongPress={650}
                    style={{
                      flex: 1,
                      backgroundColor: enabled ? "#ef4444" : "#9ca3af",
                      paddingVertical: 12,
                      borderRadius: 14,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "900", color: "white" }}>
                      Prem per netejar
                    </Text>
                  </Pressable>
                );
              })()}
            </View>

            {(cleanPendingCount ?? 0) === 0 ? (
              <Text style={{ marginTop: 10, color: "#6b7280" }}>
                No hi ha partits per netejar.
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>

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
                {busy ? "Treballant..." : "Simular calendari"}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>


{/* Preview modal */}
<Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
  <SafeAreaView edges={["left","right","bottom"]} style={{ flex: 1, backgroundColor: "white" }}>
    <View style={{ paddingTop: 70, paddingLeft: 16, paddingRight: 16, paddingBottom: 16, flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <Pressable onPress={() => {
                  setPreviewOpen(false);
                  if (previewMeta?.format !== "league") {
                    // Go back to group setup (keeps previous manual/auto selections)
                    setGroupSetupOpen(true);
                  }
                }} style={{ padding: 10, marginRight: 10 }}>
          <Text style={{ fontSize: 18 }}>✕</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: "800" }}>Simulació del calendari</Text>
          <Text style={{ color: "#6b7280", marginTop: 2 }}>
            Toca un partit per moure'l (swap) i millorar l'equitat.
          </Text>
        </View>
      </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 18 }} showsVerticalScrollIndicator={false}>

      {/* Metrics */}
      <View style={{ backgroundColor: "#f9fafb", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 14, padding: 12, marginBottom: 12 }}>
        <Text style={{ fontWeight: "900", marginBottom: 6 }}>Equitat</Text>
        <Text style={{ color: "#374151", marginBottom: 4 }}>
          Màxim caps de setmana seguits sense jugar:{" "}
          <Text style={{ fontWeight: "900" }}>{previewMetrics.weeks.globalMax}</Text>
        </Text>
        {previewMetrics.weeks.worstTeams.length > 0 ? (
          <Text style={{ color: "#b91c1c", fontWeight: "800" }}>
            ALERTA: equips amb ≥3 caps de setmana sense jugar:{" "}
            {previewMetrics.weeks.worstTeams
              .slice(0, 6)
              .map((x) => `${teamNameById[x.teamId] ?? `Equip ${x.teamId}`} (${x.gap})`)
              .join(", ")}
            {previewMetrics.weeks.worstTeams.length > 6 ? "..." : ""}
          </Text>
        ) : (
          <Text style={{ color: "#065f46", fontWeight: "800" }}>OK: cap equip supera 2 caps de setmana sense jugar</Text>
        )}{/* Preference conflicts */}
{draftAssignments.some((x) => x.prefConflict) ? (
  <Text style={{ color: "#b45309", fontWeight: "900", marginTop: 6 }}>
    ⚠ {draftAssignments.filter((x) => x.prefConflict).length} partit(s) amb conflicte de preferència (minimitzat però inevitable).
  </Text>
) : (
  <Text style={{ color: "#065f46", fontWeight: "900", marginTop: 6 }}>
    OK: 0 conflictes de preferència
  </Text>
)}


        <Text style={{ color: "#374151", marginTop: 6 }}>
          Desbalanceig de slots (rang per equip): <Text style={{ fontWeight: "900" }}>{previewMetrics.slotBalance.globalRange}</Text>

{/* Auto-fix */}
<View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 }}>
  <Pressable
    disabled={autoFixing}
    onPress={autoFixEquity}
    style={{
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: autoFixing ? "#9ca3af" : "#111827",
    }}
  >
    <Text style={{ color: "white", fontWeight: "900" }}>
      {autoFixing ? "Ajustant..." : "Auto-fix equitat"}
    </Text>
  </Pressable>
  <Text style={{ color: "#6b7280", flex: 1 }}>
    Fa swaps automàtics per fer el calendari més equitatiu (objectiu: gaps ~2) i evitar equips amb gap 0, sense trencar preferències.
  </Text>
</View>

{/* Per-team gaps table */}
<View style={{ marginTop: 10 }}>
  <Text style={{ fontWeight: "900", marginBottom: 6 }}>Setmanes sense jugar (per equip)</Text>
  <View style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, overflow: "hidden" }}>
    {previewMetrics.gapsSorted.slice(0, 20).map((row) => {
      const name = teamNameById[row.teamId] ?? `Equip ${row.teamId}`;
      const isBad = row.gap >= 3;
      return (
        <View
          key={row.teamId}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: isBad ? "#fef2f2" : "white",
            borderBottomWidth: 1,
            borderBottomColor: "#f3f4f6",
          }}
        >
          <Text style={{ fontWeight: "800", color: "#111827" }} numberOfLines={1}>
            {name}
          </Text>
          <Text style={{ fontWeight: "900", color: isBad ? "#b91c1c" : "#111827" }}>
            {row.gap}
          </Text>
        </View>
      );
    })}
  </View>
  {previewMetrics.gapsSorted.length > 20 ? (
    <Text style={{ marginTop: 6, color: "#6b7280" }}>
      Mostrant 20/{previewMetrics.gapsSorted.length}. (Si vols, et faig un “veure tot” amb scroll dins.)
    </Text>
  ) : null}
</View>
        </Text>
      </View>

      {/* Toggle move scope */}
      <Pressable
        onPress={() => setMoveAllowAnyWeekend((v) => !v)}
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: moveAllowAnyWeekend ? "#111827" : "#f3f4f6",
          marginBottom: 10,
        }}
      >
        <Text style={{ color: moveAllowAnyWeekend ? "white" : "#111827", fontWeight: "900" }}>
          {moveAllowAnyWeekend ? "Moure: qualsevol cap de setmana" : "Moure: mateix cap de setmana"}
        </Text>
      </Pressable>
            {/* List per weekend */}
            <View>
        {(() => {
          const byWeekend = new Map<string, DraftAssignment[]>();
          for (const it of draftAssignments) {
            const wk = weekendKeyFromISO(it.slot.starts_at);
            const arr = byWeekend.get(wk) ?? [];
            arr.push(it);
            byWeekend.set(wk, arr);
          }
          const weekends = Array.from(byWeekend.keys()).sort();
          return weekends.map((wk) => {
            const list = (byWeekend.get(wk) ?? []).slice().sort((a, b) => a.slot.starts_at.localeCompare(b.slot.starts_at));
            return (
              <View key={wk} style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={{ fontWeight: "900", fontSize: 16 }}>
                    Cap de setmana · {wk}
                  </Text>
                  <Text style={{ color: "#6b7280", fontWeight: "800" }}>{list.length} partits</Text>
                </View>
                {list.map((it) => (
                  <Pressable
                    key={it.slot.id}
                    onPress={() => openMoveModal(it.slot.id)}
                    style={{
                      backgroundColor: "white",
                      borderWidth: 1,
                      borderColor: "#e5e7eb",
                      borderRadius: 14,
                      padding: 12,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "900" }}>
                      {teamNameById[it.a] ?? `Equip ${it.a}`}{" "}
                      <Text style={{ color: "#6b7280" }}>vs</Text>{" "}
                      {teamNameById[it.b] ?? `Equip ${it.b}`}
                    </Text>
{it.prefConflict ? (
  <View
    style={{
      alignSelf: "flex-start",
      marginTop: 6,
      backgroundColor: "#fff7ed",
      borderColor: "#fdba74",
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    }}
  >
    <Text style={{ color: "#9a3412", fontWeight: "900", fontSize: 12 }}>⚠ Preferència</Text>
  </View>
) : null}
                    <Text style={{ color: "#6b7280", marginTop: 4 }}>
                      {slotLabel(it.slot)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            );
          });
        })()}
            </View>

            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Pressable
          onPress={() => setPreviewOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "#f3f4f6",
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "900", color: "#111827" }}>Tancar</Text>
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={confirmCreateFromPreview}
          style={{
            flex: 1,
            backgroundColor: busy ? "#9ca3af" : "#16a34a",
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "900", color: "white" }}>{busy ? "Creant..." : "Acceptar i crear"}</Text>
        </Pressable>
      </View>
    </View>

    {/* Move modal */}
    <Modal visible={moveModalOpen} transparent animationType="fade" onRequestClose={() => setMoveModalOpen(false)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 }}>
        <View style={{ backgroundColor: "white", borderRadius: 18, padding: 14, maxHeight: "80%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={{ fontWeight: "900", fontSize: 16 }}>Moure partit</Text>
            <Pressable onPress={() => setMoveModalOpen(false)} style={{ padding: 8 }}>
              <Text style={{ fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>

          {(() => {
            const from = draftAssignments.find((x) => x.slot.id === moveFromSlotId);
            if (!from) return <Text style={{ color: "#6b7280" }}>No trobat.</Text>;

            const fromWk = weekendKeyFromISO(from.slot.starts_at);
            const candidateSlots = (previewMeta?.allSlots ?? [])
  .filter((s) => (moveAllowAnyWeekend ? true : weekendKeyFromISO(s.starts_at) === fromWk))
  .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

            return (
              <>
                <Text style={{ color: "#374151", marginBottom: 10 }}>
                  {teamNameById[from.a] ?? `Equip ${from.a}`} vs {teamNameById[from.b] ?? `Equip ${from.b}`}
                </Text>

                <ScrollView>
                  {candidateSlots.map((slot) => {
                    const occupied = draftAssignments.find((x) => x.slot.id === slot.id);
                    const same = slot.id === from.slot.id;
                    return (
                      <Pressable
                        key={slot.id}
                        disabled={same}
                        onPress={() => tryMoveOrSwap(slot.id)}
                        style={{
                          padding: 12,
                          borderRadius: 14,
                          borderWidth: 1,
                          borderColor: same ? "#d1d5db" : "#e5e7eb",
                          backgroundColor: same ? "#f3f4f6" : "white",
                          marginBottom: 8,
                        }}
                      >
                        <Text style={{ fontWeight: "900" }}>{slotLabel(slot)}</Text>
                        {occupied && !same ? (
                          <Text style={{ color: "#6b7280", marginTop: 4 }}>
                            Swap amb: {teamNameById[occupied.a] ?? `Equip ${occupied.a}`} vs {teamNameById[occupied.b] ?? `Equip ${occupied.b}`}
                          </Text>
                        ) : (
                          <Text style={{ color: "#6b7280", marginTop: 4 }}>{same ? "Slot actual" : occupied ? "Swap" : "Buit · Mou aquí"}</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <Text style={{ color: "#6b7280", marginTop: 8 }}>
                  Nota: només permet moviments que mantenen 0 conflictes de preferència i sense solapar equips a la mateixa hora.
                </Text>
              </>
            );
          })()}
        </View>
      </View>
    </Modal>
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
