import { useCallback, useMemo, useState,useRef } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import * as Calendar from "expo-calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, Stack } from "expo-router";
import { supabase } from "../src/supabase";
import { BackButton, RefreshButton } from "../components/HeaderButtons";

type TeamMini = {
  id: number;
  name: string | null;
  short_name: string | null;
};

type MatchRow = {
  id: number;
  match_date: string | null;
  started_at: string | null;
  display_status: string| null;
  is_finished: boolean;
  score_team_a: number;
  score_team_b: number;
  team_a_id: number | null;
  team_b_id: number | null;
  team_a?: TeamMini | null;
  team_b?: TeamMini | null;
  slot?: { field_code: string | null } | null;
  phase?: { name: string | null } | null;
};

type CalendarOption = {
  id: string;
  title: string;
  subtitle: string;
};

const CALENDAR_PREF_KEY = "preferred_calendar_id_v1";
const CALENDAR_PREF_TITLE_KEY = "preferred_calendar_title_v1";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateDDMMYYYY_HHMM(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const day = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();
  const hour = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${day}/${month}/${year} · ${hour}:${min}`;
}

function trimCharField(s?: string | null) {
  return (s ?? "").trim();
}
function getFieldOrder(fieldCode?: string | null) {
  const code = (fieldCode ?? "").trim().toUpperCase();

  if (code === "A") return 0;
  if (code === "B") return 1;
  return 99;
}

function compareMatches(a: MatchRow, b: MatchRow) {
  const timeA = a.match_date ? new Date(a.match_date).getTime() : Number.MAX_SAFE_INTEGER;
  const timeB = b.match_date ? new Date(b.match_date).getTime() : Number.MAX_SAFE_INTEGER;

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  const fieldA = getFieldOrder(a.slot?.field_code);
  const fieldB = getFieldOrder(b.slot?.field_code);

  if (fieldA !== fieldB) {
    return fieldA - fieldB;
  }

  return a.id - b.id;
}
type DatePreset = "all" | "today" | "yesterday" | "week" | "custom";
type StatusFilter = "all" | "finished" | "pending";

function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function labelForPreset(p: DatePreset) {
  if (p === "today") return "Avui";
  if (p === "yesterday") return "Ahir";
  if (p === "week") return "7 dies";
  return "Tot";
}

function labelForStatus(s: StatusFilter) {
  if (s === "finished") return "Finalitzats";
  if (s === "pending") return "Pendents";
  return "Tots";
}

export default function PublicMatches() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teams, setTeams] = useState<TeamMini[]>([]);

  // Filters (collapsed by default)
  const [showFilters, setShowFilters] = useState(false);

  const [preset, setPreset] = useState<DatePreset>("all");
const [draftStart, setDraftStart] = useState<Date | null>(null);
const [draftEnd, setDraftEnd] = useState<Date | null>(null);
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);
  const [pickingCustom, setPickingCustom] = useState<"start" | "end" | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
const [showApplySingleDay, setShowApplySingleDay] = useState(false);

  const [teamId, setTeamId] = useState<number | null>(null);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [calendarOptions, setCalendarOptions] = useState<CalendarOption[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarTargetMatch, setCalendarTargetMatch] = useState<MatchRow | null>(null);
const displayStart = pickingCustom ? draftStart : customStart;
const displayEnd = pickingCustom ? draftEnd : customEnd;
const [savedCalendarId, setSavedCalendarId] = useState<string | null>(null);
const [savedCalendarTitle, setSavedCalendarTitle] = useState<string | null>(null);
const listRef = useRef<FlatList<MatchRow>>(null);
const scrollOffsetRef = useRef(0);
const shouldRestoreScrollRef = useRef(false);
const restoreMatchIdRef = useRef<number | null>(null);
const [listVisible, setListVisible] = useState(true);
const [initialLoaded, setInitialLoaded] = useState(false);

  useFocusEffect(
  useCallback(() => {
    const run = async () => {
      const mustRestore = shouldRestoreScrollRef.current;

      if (mustRestore) {
        setListVisible(false);
      }

      const loadedMatches = await load();

      if (mustRestore && restoreMatchIdRef.current != null) {
        const idx = (loadedMatches ?? []).findIndex(
          (m) => m.id === restoreMatchIdRef.current
        );

        setTimeout(() => {
          if (idx >= 0) {
            listRef.current?.scrollToIndex({
              index: idx,
              animated: false,
              viewPosition: 0.5,
            });
          }

          shouldRestoreScrollRef.current = false;
          setListVisible(true);
        }, 120);
      } else {
        setListVisible(true);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, status, teamId, customStart, customEnd])
);

  const teamChips = useMemo(() => {
    const base: Array<{ id: number | null; label: string }> = [{ id: null, label: "Tots" }];
    const extra = teams
      .slice()
      .sort((a, b) =>
        (a.name || trimCharField(a.short_name) || "").localeCompare(
          b.name || trimCharField(b.short_name) || ""
        )
      )
      .map((t) => ({
        id: t.id,
        label: t.name || trimCharField(t.short_name) || `#${t.id}`,
      }));
    return [...base, ...extra];
  }, [teams]);

  const summary = useMemo(() => {
    const finished = matches.filter((m) => m.is_finished).length;
    const pending = matches.length - finished;
    return { total: matches.length, finished, pending };
  }, [matches]);

  function calcDateRange(): { start?: Date; end?: Date } {
    const now = new Date();

    if (preset === "all") return {};
    if (preset === "custom" && customStart) {
      const s = startOfDayLocal(customStart);
      const e = customEnd ? endOfDayLocal(customEnd) : endOfDayLocal(customStart);
      return { start: s, end: e };
    }
    if (preset === "today") return { start: startOfDayLocal(now), end: endOfDayLocal(now) };

    if (preset === "yesterday") {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { start: startOfDayLocal(d), end: endOfDayLocal(d) };
    }

    // last 7 days (including today)
    const d0 = startOfDayLocal(now);
    const start = new Date(d0);
    start.setDate(d0.getDate() - 6);
    return { start, end: endOfDayLocal(now) };
  }

  function handleCustomDateChange(e: DateTimePickerEvent, selected?: Date) {
  if (e.type === "dismissed") {
    setPickingCustom(null);
    setShowApplySingleDay(false);
    return;
  }

  const picked = selected ?? new Date();

  if (pickingCustom === "start") {
    // 1) Guardem start al draft, però NO apliquem filtre encara
    setDraftStart(picked);
    setDraftEnd(null);

setShowApplySingleDay(true);   // ✅ AFEGEIX AQUESTA LÍNIA

    // 2) Passem directament a triar la data final
    setPickingCustom("end");
    return;
  }

  if (pickingCustom === "end") {
    const s0 = draftStart ?? customStart ?? picked;

    let start = s0;
    let end = picked;

    if (end.getTime() < start.getTime()) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    // ✅ Ara sí: apliquem el filtre definitiu
    setCustomStart(start);
    setCustomEnd(end);
    setPreset("custom");
    setShowApplySingleDay(false);
    // reset draft + tanquem el picker
    setDraftStart(null);
    setDraftEnd(null);
    setPickingCustom(null);

    // i tanquem filtres com ja feies
    setShowTeamPicker(false);
    setShowFilters(false);
  }
}

async function loadSavedCalendarPreference() {
  const [[, id], [, title]] = await AsyncStorage.multiGet([
    CALENDAR_PREF_KEY,
    CALENDAR_PREF_TITLE_KEY,
  ]);

  setSavedCalendarId(id ?? null);
  setSavedCalendarTitle(title ?? null);
}

async function clearSavedCalendarPreference() {
  await AsyncStorage.multiRemove([CALENDAR_PREF_KEY, CALENDAR_PREF_TITLE_KEY]);
  setSavedCalendarId(null);
  setSavedCalendarTitle(null);
}

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    // Active championship
    const { data: ch, error: chErr } = await supabase
      .from("championship")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (chErr) {
      Alert.alert("Error", chErr.message);
      setLoading(false);
      setRefreshing(false);
      setInitialLoaded(true);
      return [];
    }

    if (!ch?.id) {
      setMatches([]);
      setTeams([]);
      setLoading(false);
      setRefreshing(false);
      setInitialLoaded(true);
      return [];
    }

    // Teams for this championship (from team_player)
    const { data: tpData, error: tpErr } = await supabase
      .from("team_player")
      .select("team:team_id(id,name,short_name)")
      .eq("championship_id", ch.id);

    if (tpErr) {
      Alert.alert("Error", tpErr.message);
      setLoading(false);
      setRefreshing(false);
      setInitialLoaded(true);
      return [];
    }

    const tMap = new Map<number, TeamMini>();
    for (const row of tpData ?? []) {
      const t = (row as any).team as TeamMini | null;
      if (t?.id) tMap.set(t.id, t);
    }
    setTeams(Array.from(tMap.values()));

    const { start, end } = calcDateRange();

    let q = supabase
      .from("match")
      .select(
        "id, match_date, started_at, display_status, is_finished, score_team_a, score_team_b, team_a_id, team_b_id, team_a:team_a_id(id,name,short_name), team_b:team_b_id(id,name,short_name), slot:slot_id(field_code), phase:phase_id(name)"
      )
      .eq("championship_id", ch.id)
      .order("match_date", { ascending: true });

    // Status filter
    if (status === "finished") q = q.eq("is_finished", true);
    if (status === "pending") q = q.eq("is_finished", false);

    // Date filter (applies to match_date; pending with null date won't match)
    if (start) q = q.gte("match_date", start.toISOString());
    if (end) q = q.lte("match_date", end.toISOString());

    // Team filter
    if (teamId) q = q.or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`);

    const { data, error } = await q;

    if (error) {
      Alert.alert("Error", error.message);
      setLoading(false);
      setRefreshing(false);
      setInitialLoaded(true);
      return [];
    }

    const sortedMatches = ((data ?? []) as unknown as MatchRow[]).slice().sort(compareMatches);
    setMatches(sortedMatches);
    setLoading(false);
    setRefreshing(false);
    setInitialLoaded(true);
    return sortedMatches;
  }

  const onRefresh = useCallback(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, status, teamId, customStart, customEnd]);

  async function openCalendarPickerForMatch(item: MatchRow) {
    try {
      if (!item.match_date) {
        Alert.alert("Sense data", "Aquest partit encara no té data assignada.");
        return;
      }

      setCalendarLoading(true);
      setCalendarTargetMatch(item);

      const { status } = await Calendar.requestCalendarPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Permís necessari",
          "Cal donar permís al calendari per afegir aquest partit."
        );
        return;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

      const editableCalendars = calendars.filter(
        (cal) =>
          cal.allowsModifications &&
          !!cal.id &&
          !!cal.title &&
          (Platform.OS !== "ios" || cal.source?.name !== "Subscribed Calendars")
      );

      if (!editableCalendars.length) {
        Alert.alert("Error", "No s'ha trobat cap calendari editable al dispositiu.");
        return;
      }

      const options: CalendarOption[] = editableCalendars
        .map((cal) => ({
          id: cal.id,
          title: cal.title,
          subtitle: [cal.source?.name ?? null, cal.isPrimary ? "Principal" : null]
            .filter(Boolean)
            .join(" · "),
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

      setCalendarOptions(options);
      setCalendarPickerOpen(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut carregar la llista de calendaris.");
    } finally {
      await loadSavedCalendarPreference();
      setCalendarLoading(false);
    }
  }

  async function addMatchToCalendar(calendarId: string, calendarTitle: string, item: MatchRow) {
    try {
      if (!item.match_date) {
        Alert.alert("Sense data", "Aquest partit encara no té data assignada.");
        return;
      }

      const aName = trimCharField(item.team_a?.name) || item.team_a?.short_name || "Equip A";
      const bName = trimCharField(item.team_b?.name) || item.team_b?.short_name || "Equip B";
      const fieldCode = item.slot?.field_code ? `Camp ${item.slot.field_code}` : "Camp pendent";

      const startDate = new Date(item.match_date);
      const endDate = new Date(startDate.getTime() + 90 * 60 * 1000);

      await Calendar.createEventAsync(calendarId, {
        title: `${aName} vs ${bName}`,
        startDate,
        endDate,
        location: fieldCode,
        notes: `Partit del campionat${item.phase?.name ? ` · ${item.phase.name}` : ""}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      await AsyncStorage.multiSet([
        [CALENDAR_PREF_KEY, calendarId],
        [CALENDAR_PREF_TITLE_KEY, calendarTitle],
      ]);
      setSavedCalendarId(calendarId);
      setSavedCalendarTitle(calendarTitle);
      setCalendarPickerOpen(false);
      setCalendarOptions([]);
      setCalendarTargetMatch(null);
      Alert.alert("Afegit ✅", `El partit s'ha afegit al calendari: ${calendarTitle}`);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut afegir el partit al calendari.");
    }
  }

  async function tryAddToSavedCalendar(item: MatchRow) {
  const [[, savedCalendarId], [, savedCalendarTitle]] = await AsyncStorage.multiGet([
    CALENDAR_PREF_KEY,
    CALENDAR_PREF_TITLE_KEY,
  ]);

  if (!savedCalendarId) return false;

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

  const stillValid = calendars.find(
    (cal) =>
      cal.id === savedCalendarId &&
      cal.allowsModifications &&
      (Platform.OS !== "ios" || cal.source?.name !== "Subscribed Calendars")
  );

  if (!stillValid) {
    await AsyncStorage.multiRemove([CALENDAR_PREF_KEY, CALENDAR_PREF_TITLE_KEY]);
    return false;
  }

  await addMatchToCalendar(savedCalendarId, savedCalendarTitle ?? stillValid.title, item);
  return true;
}

  const calendarPickerModal = (
    <Modal
      visible={calendarPickerOpen}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (calendarLoading) return;
        setCalendarPickerOpen(false);
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          justifyContent: "center",
          padding: 18,
        }}
      >
        <View
          style={{
            backgroundColor: "white",
            borderRadius: 18,
            padding: 16,
            borderWidth: 1,
            borderColor: "#E5E7EB",
            maxHeight: "75%",
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "900", color: "#111827", textAlign: "center" }}>
            Selecciona calendari
          </Text>
          <Text style={{ marginTop: 6, color: "#6B7280", fontWeight: "700", textAlign: "center" }}>
            Tria on vols afegir aquest partit pendent.
          </Text>
          {savedCalendarId && savedCalendarTitle ? (
            <View
              style={{
                marginTop: 12,
                backgroundColor: "#F9FAFB",
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 12,
                padding: 10,
              }}
            >
              <Text style={{ color: "#374151", fontWeight: "700", textAlign: "center" }}>
                Calendari guardat actual
              </Text>
              <Text style={{ color: "#111827", fontWeight: "900", textAlign: "center", marginTop: 4 }}>
                {savedCalendarTitle}
              </Text>
            </View>
          ) : null}
          <ScrollView style={{ marginTop: 14 }} showsVerticalScrollIndicator={false}>
            {calendarLoading ? (
              <View style={{ paddingVertical: 24, alignItems: "center" }}>
                <ActivityIndicator />
              </View>
            ) : (
              calendarOptions.map((cal) => (
                <Pressable
                  key={cal.id}
                  onPress={() => {
                    if (!calendarTargetMatch) return;
                    addMatchToCalendar(cal.id, cal.title, calendarTargetMatch);
                  }}
                  style={({ pressed }) => ({
                    borderWidth: 1,
                    borderColor: "#E5E7EB",
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 10,
                    backgroundColor: "white",
                    opacity: pressed ? 0.92 : 1,
                  })}
                >
                  <Text style={{ fontWeight: "900", color: "#111827", fontSize: 16 }}>{cal.title}</Text>
                  {cal.subtitle ? (
                    <Text style={{ marginTop: 4, color: "#6B7280", fontWeight: "700" }}>{cal.subtitle}</Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </ScrollView>

          {savedCalendarId ? (
            <Pressable
              onPress={async () => {
                await clearSavedCalendarPreference();
                Alert.alert(
                  "Calendari restablert",
                  "La propera vegada podràs escollir un calendari de nou."
                );
                setCalendarPickerOpen(false);
                setCalendarTargetMatch(null);
              }}
              style={{
                marginTop: 12,
                paddingVertical: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#DC2626", fontWeight: "900" }}>
                Restablir calendari guardat
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => {
              setCalendarPickerOpen(false);
              setCalendarTargetMatch(null);
            }}
            style={{
              marginTop: 8,
              paddingVertical: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#6B7280", fontWeight: "900" }}>Cancel·lar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
  if (!initialLoaded || loading) {
    return (
      <SafeAreaView edges={["left","right","bottom"]} style={styles.loadingWrap}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left","right","bottom"]} style={styles.screen}>
      {calendarPickerModal}
<FlatList
        ref={listRef}
        style={{ opacity: listVisible ? 1 : 0 }}
  onScroll={(e) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  }}
  scrollEventThrottle={16}
  onScrollToIndexFailed={() => {
    setTimeout(() => {
      const targetId = restoreMatchIdRef.current;
      const idx = matches.findIndex((m) => m.id === targetId);
      if (idx >= 0) {
        listRef.current?.scrollToIndex({
          index: idx,
          animated: false,
          viewPosition: 0.5,
        });
      }
    }, 150);
  }}
        ListHeaderComponent={
          <View>
      	      {/* Back (same style as Rankings) */}
	      <View style={{ paddingTop: 10,paddingBottom: 10 }}>
<BackButton
          onPress={() => router.replace("/public-menu")}
          style={{ marginTop:5 }}
        />
	      </View>
      {/* Filters dropdown */}
      <View style={styles.filtersCard}>
        <Pressable
          onPress={() => {
            setShowFilters((v) => !v);
            setShowTeamPicker(false);
          }}
          style={styles.filtersHeader}
        >
          <Text style={styles.filtersTitle}>Filtres</Text>
          <Text style={styles.filtersChevron}>{showFilters ? "▲" : "▼"}</Text>
        </Pressable>

        {showFilters && (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.sectionLabel}>Estat</Text>
            <View style={styles.chipsWrap}>
              {([
                ["all", "Tots"],
                ["pending", "Pendents"],
                ["finished", "Finalitzats"],
              ] as Array<[StatusFilter, string]>).map(([key, label]) => {
                const active = status === key;
                return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        setStatus(key);
                        setShowTeamPicker(false);
                        setShowFilters(false);
                      }}
                    style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                  >
                    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Dates</Text>
            <View style={styles.chipsWrap}>
              {([
                ["all", "Tot"],
                ["today", "Avui"],
                ["yesterday", "Ahir"],
                ["week", "7 dies"],
              ] as Array<[DatePreset, string]>).map(([key, label]) => {
                const active = preset === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      setPreset(key);
                      if (key !== "custom") {
                        setCustomStart(null);
                        setCustomEnd(null);
                      }
                      setShowTeamPicker(false);
                      setShowFilters(false);
                    }}
                    style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                  >
                    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Calendar / custom date range */}
            <Pressable
              onPress={() => {
  // inicialitza el draft amb el filtre actual (si n’hi havia)
  setDraftStart(customStart);
  setDraftEnd(customEnd);
  setPickingCustom("start");
}}
              style={[styles.pickerButton, { marginTop: 10 }]}
            >
              <Text style={styles.pickerButtonText} numberOfLines={1}>
                {displayStart
  ? `Calendari: ${pad2(displayStart.getDate())}/${pad2(displayStart.getMonth() + 1)}/${displayStart.getFullYear()}` +
    (displayEnd
      ? ` - ${pad2(displayEnd.getDate())}/${pad2(displayEnd.getMonth() + 1)}/${displayEnd.getFullYear()}`
      : "")
  : "Calendari: escull data/rang"}

              </Text>
              <Text style={styles.filtersChevron}>📅</Text>
            </Pressable>
{showApplySingleDay && draftStart && (
  <Pressable
    onPress={() => {
      // aplica només aquell dia
      setCustomStart(draftStart);
      setCustomEnd(draftStart);
      setPreset("custom");

      // neteja estat de selecció
      setDraftStart(null);
      setDraftEnd(null);
      setPickingCustom(null);
      setShowApplySingleDay(false);

      // tanca filtres com ja fas
      setShowTeamPicker(false);
      setShowFilters(false);
    }}
    style={[styles.chip, styles.chipActive, { alignSelf: "flex-start", marginTop: 10 }]}
  >
    <Text style={styles.chipTextActive}>Aplicar només aquest dia</Text>
  </Pressable>
)}

            {pickingCustom && (
              <View style={{ marginTop: 10 }}>
                <DateTimePicker
                  value={
                    pickingCustom === "start"
    ? new Date() // ✅ força que el picker no “vingui” amb la data ja aplicada
    : (draftStart ?? customStart ?? new Date())
                  }
                  mode="date"
                  display="default"
                  onChange={handleCustomDateChange}
                />
              </View>
            )}

            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Equip</Text>

            <Pressable onPress={() => setShowTeamPicker((v) => !v)} style={styles.pickerButton}>
              <Text style={styles.pickerButtonText} numberOfLines={1}>
                {teamId
                  ? `Filtre: ${teamChips.find((x) => x.id === teamId)?.label ?? "Equip"}`
                  : "Filtre: Tots els equips"}
              </Text>
              <Text style={styles.filtersChevron}>{showTeamPicker ? "▲" : "▼"}</Text>
            </Pressable>

            {showTeamPicker && (
              <View style={[styles.pickerPanel, { maxHeight: 260 }]}>
                <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  <View style={styles.chipsWrap}>
                    {teamChips.map((t) => {
                      const active = teamId === t.id;
                      return (
                        <Pressable
                          key={String(t.id)}
                          onPress={() => {
                            setTeamId(t.id);
                            setShowTeamPicker(false);
                              setShowFilters(false);
                          }}
                          style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                        >
                          <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
                            {t.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            )}
          </View>
        )}
      </View>
{/* Top summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryPillLabel}>Total</Text>
            <Text style={styles.summaryPillValue}>{summary.total}</Text>
          </View>
<View style={[styles.summaryPill, styles.pillPending]}>
            <Text style={styles.summaryPillLabel}>Pendents</Text>
            <Text style={styles.summaryPillValue}>{summary.pending}</Text>
          </View>
          <View style={[styles.summaryPill, styles.pillFinished]}>
            <Text style={styles.summaryPillLabel}>Finalitzats</Text>
            <Text style={styles.summaryPillValue}>{summary.finished}</Text>
          </View>
        </View>

        <Text style={styles.summarySub}>
          {labelForStatus(status)} · {preset === "all" ? "Totes les dates" : labelForPreset(preset)}
          {teamId ? ` · ${teamChips.find((t) => t.id === teamId)?.label ?? ""}` : ""}
        </Text>
      </View>

      
          </View>
        }

        contentContainerStyle={{ paddingBottom: 18 }}
        data={matches}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>Sense partits</Text>
            <Text style={styles.emptySub}>No hi ha partits amb aquests filtres.</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const aName = trimCharField(item.team_a?.name) || item.team_a?.short_name || "Equip A";
          const bName = trimCharField(item.team_b?.name) || item.team_b?.short_name || "Equip B";

          const isAjornat = item.display_status === "AJORNAT";
          const isLive = !!item.started_at && !item.is_finished;
          const score = isLive ? "" : `${item.score_team_a ?? 0} - ${item.score_team_b ?? 0}`;
          const canOpenSummary = !isAjornat && item.is_finished || !!item.started_at;

          return (
            <Pressable
              onPress={() => {
                if (isAjornat) {
                  Alert.alert("Partit ajornat", "Aquest partit està ajornat temporalment.");
                  return;
                }

                if (canOpenSummary) {
                  shouldRestoreScrollRef.current = true;
                  restoreMatchIdRef.current = item.id;
                  router.push({ pathname: "/match-summary", params: { id: item.id } });
                  return;
                }

                Alert.alert(
                "Partit pendent",
                "Vols afegir aquest partit al calendari del telèfon?",
                [
                  { text: "Cancel·lar", style: "cancel" },

                  ...(savedCalendarId
                    ? [
                        {
                          text: `Afegir a ${savedCalendarTitle ?? "calendari guardat"}`,
                          onPress: async () => {
                            const reused = await tryAddToSavedCalendar(item);
                            if (!reused) {
                              await openCalendarPickerForMatch(item);
                            }
                          },
                        },
                        {
                          text: "Canviar calendari",
                          onPress: () => openCalendarPickerForMatch(item),
                        },
                      ]
                    : [
                        {
                          text: "Afegir al calendari",
                          onPress: () => openCalendarPickerForMatch(item),
                        },
                      ]),
                ]
              );
              }}
              onLongPress={() => Alert.alert("ID del partit", String(item.id))}
              delayLongPress={350}
              style={({ pressed }) => [
              styles.matchCard,
              isAjornat
                ? styles.matchCardAjornat
                : isLive
                ? styles.matchCardLive
                : item.is_finished
                ? styles.matchCardFinished
                : styles.matchCardPending,
                pressed && canOpenSummary ? { transform: [{ scale: 0.99 }], opacity: 0.95 } : null,
              ]}
            >
              <View style={styles.matchTopRow}>
  <Text style={styles.matchTitle} numberOfLines={1}>
    {aName} <Text style={styles.vs}>vs</Text> {bName}
  </Text>

  <View style={styles.matchMetaRow}>
    <View style={styles.metaRow}>
      {item.match_date ? (
        <Text style={styles.metaText}>🗓️ {formatDateDDMMYYYY_HHMM(item.match_date)}</Text>
      ) : (
        <Text style={styles.metaMuted}>🗓️ Data pendent</Text>
      )}
      {item.slot?.field_code ? (
        <Text style={styles.metaText}> · 🏟️ {item.slot.field_code}</Text>
      ) : null}
    </View>

    <View
  style={[
    styles.badge,
    isAjornat
      ? styles.badgeAjornat
      : isLive
      ? styles.badgeLive
      : item.is_finished
      ? styles.badgeFinished
      : styles.badgePending,
  ]}
>
  <Text
    style={[
      styles.badgeText,
      isAjornat ? styles.badgeTextAjornat : null,
      isLive ? styles.badgeTextLive : null,
    ]}
  >
    {isAjornat ? "AJORNAT" : item.is_finished ? "FINAL" : item.started_at ? "EN JOC" : "PENDENT"}
  </Text>
</View>
  </View>

  <View style={styles.matchBottomRow}>
    {!!item.phase?.name ? (
      <Text style={styles.phaseText} numberOfLines={1}>
        {item.phase.name}
      </Text>
    ) : (
      <View style={{ flex: 1 }} />
    )}

    <Text
  style={[
    styles.scoreText,
    isAjornat
      ? styles.scoreAjornat
      : isLive
      ? styles.scoreLive
      : item.is_finished
      ? styles.scoreFinished
      : styles.scorePending,
  ]}
>
  {score}
</Text>
  </View>
</View>

{(isAjornat || (!item.is_finished && !item.started_at)) && (
  <View style={styles.bottomRow}>
    <Text style={styles.pendingHint}>
      {isAjornat
        ? "Partit ajornat"
        : "Partit pendent · Toca per afegir-lo al calendari"}
    </Text>

    {/*<Text style={styles.matchIdBottom}>#{item.id}</Text>*/}
  </View>
)}

{!item.is_finished && !!item.started_at && (
  <Text style={styles.pendingHint}>Partit en joc: resum en directe (marcador provisional)</Text>
)}

              {item.is_finished && (
                <Text style={styles.openHint}>{Platform.OS === "ios" ? "Toca per veure el resum" : "Prem per veure el resum"}</Text>
              )}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F7FB",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  summaryCard: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E9EAF0",
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 2 },
    }),
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  summaryPill: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EEE",
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: "#FAFAFF",
  },
  pillFinished: {
    backgroundColor: "#F2FFF7",
    borderColor: "#D7F5E3",
  },
  pillPending: {
    backgroundColor: "#FFF9F2",
    borderColor: "#F4E3C9",
  },
  summaryPillLabel: {
    color: "#666",
    fontSize: 12,
    fontWeight: "700",
  },
  summaryPillValue: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: "900",
    color: "#111",
  },
  summarySub: {
    marginTop: 10,
    color: "#666",
    fontWeight: "700",
  },
bottomRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 8,
},

matchIdBottom: {
  fontSize: 11,
  fontWeight: "700",
  color: "#9CA3AF",
},
  filtersCard: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E9EAF0",
    marginBottom: 12,
  },
  filtersHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filtersTitle: {
    fontWeight: "900",
    fontSize: 16,
    color: "#111",
  },
  filtersChevron: {
    color: "#666",
    fontWeight: "900",
    fontSize: 14,
  },
  sectionLabel: {
    fontWeight: "800",
    color: "#111",
    marginBottom: 8,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: "#111",
    borderColor: "#111",
  },
  chipInactive: {
    backgroundColor: "white",
    borderColor: "#DDD",
  },
  chipText: {
    fontWeight: "800",
  },
  chipTextActive: {
    color: "white",
  },
  chipTextInactive: {
    color: "#111",
  },
matchCardAjornat: {
  borderLeftWidth: 6,
  borderLeftColor: "#DC2626",
  //backgroundColor: "#FEF2F2",
},
badgeAjornat: {
  backgroundColor: "#FEE2E2",
  borderColor: "#FCA5A5",
},
badgeTextAjornat: {
  color: "#B91C1C",
},
scoreAjornat: {
  color: "#B91C1C",
},
  pickerButton: {
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "#FAFAFF",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pickerButtonText: {
    fontWeight: "800",
    color: "#111",
    flex: 1,
    marginRight: 10,
  },
  pickerPanel: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E9EAF0",
    borderRadius: 14,
    backgroundColor: "white",
    padding: 10,
    maxHeight: 220,
  },

  matchCard: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E9EAF0",
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 2 },
    }),
  },
  matchCardFinished: {
    borderLeftWidth: 6,
    borderLeftColor: "#10B981", // emerald
  },
  matchCardLive: {
    borderLeftWidth: 6,
    borderLeftColor: "#3B82F6", // blue
    backgroundColor: "#EFF6FF",
  },
  matchCardPending: {
    borderLeftWidth: 6,
    borderLeftColor: "#F59E0B", // amber
  },
  matchTopRow: {
  gap: 8,
},
  matchTitle: {
  fontSize: 14,
  fontWeight: "900",
  color: "#111",
},
  vs: {
    color: "#666",
    fontWeight: "800",
  },
  metaRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  flex: 1,
  marginTop: 0,
},
matchMetaRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
},
matchBottomRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
},
  metaText: {
    color: "#444",
    fontWeight: "700",
  },
  metaMuted: {
    color: "#777",
    fontWeight: "700",
  },
  phaseText: {
  flex: 1,
  color: "#6B7280",
  fontWeight: "800",
},
  badge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-end",
  },
  badgeFinished: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  badgePending: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },

  badgeLive: {
    backgroundColor: "#DBEAFE",
    borderColor: "#3B82F6",
  },
  badgeText: {
    fontWeight: "900",
    fontSize: 12,
    color: "#111",
    letterSpacing: 0.3,
  },

  badgeTextLive: {
    color: "#2563EB",
  },
  scoreText: {
  fontWeight: "900",
  fontSize: 20,
  textAlign: "right",
},
  scoreFinished: {
    color: "#10B981",
  },
  scorePending: {
    color: "#F59E0B",
  },

  scoreLive: {
    color: "#2563EB",
  },
  pendingHint: {
    marginTop: 10,
    color: "#666",
    fontWeight: "700",
    fontSize:13,
  },
  openHint: {
    marginTop: 10,
    color: "#444",
    fontWeight: "800",
  },

  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 70,
    paddingHorizontal: 22,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111",
  },
  emptySub: {
    marginTop: 8,
    textAlign: "center",
    fontSize: 14,
    color: "#666",
    fontWeight: "700",
  },
});