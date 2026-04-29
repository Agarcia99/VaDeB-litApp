import { useCallback, useMemo, useState, useRef } from "react";
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
import { useRouter } from "expo-router";
import { supabase } from "../src/supabase";
import { BackButton } from "../components/HeaderButtons";
import { useAppTheme, AppColors } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";
import { formatDateDDMMYYYY_HHMM, pad2 } from "../src/utils/format";
import { getFieldOrder } from "../src/utils/matchUtils";

type TeamMini = {
  id: number;
  name: string | null;
  short_name: string | null;
};

type MatchRow = {
  id: number;
  match_date: string | null;
  started_at: string | null;
  display_status: string | null;
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

function trimCharField(s?: string | null) {
  return (s ?? "").trim();
}

function compareMatches(a: MatchRow, b: MatchRow) {
  const timeA = a.match_date ? new Date(a.match_date).getTime() : Number.MAX_SAFE_INTEGER;
  const timeB = b.match_date ? new Date(b.match_date).getTime() : Number.MAX_SAFE_INTEGER;

  if (timeA !== timeB) return timeA - timeB;

  const fieldA = getFieldOrder(a.slot?.field_code);
  const fieldB = getFieldOrder(b.slot?.field_code);

  if (fieldA !== fieldB) return fieldA - fieldB;

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

export default function PublicMatches() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teams, setTeams] = useState<TeamMini[]>([]);

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
  const [savedCalendarId, setSavedCalendarId] = useState<string | null>(null);
  const [savedCalendarTitle, setSavedCalendarTitle] = useState<string | null>(null);

  const displayStart = pickingCustom ? draftStart : customStart;
  const displayEnd = pickingCustom ? draftEnd : customEnd;

  const listRef = useRef<FlatList<MatchRow>>(null);
  const shouldRestoreScrollRef = useRef(false);
  const restoreMatchIdRef = useRef<number | null>(null);

  const [listVisible, setListVisible] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);

  function labelForPreset(p: DatePreset) {
    if (p === "today") return t("publicMatches.today");
    if (p === "yesterday") return t("publicMatches.yesterday");
    if (p === "week") return t("publicMatches.week");
    return t("publicMatches.allNeutral");
  }

  function labelForStatus(s: StatusFilter) {
    if (s === "finished") return t("publicMatches.finished");
    if (s === "pending") return t("publicMatches.pending");
    return t("publicMatches.all");
  }

  const teamChips = useMemo(() => {
    const base: Array<{ id: number | null; label: string }> = [
      { id: null, label: t("publicMatches.all") },
    ];

    const extra = teams
      .slice()
      .sort((a, b) =>
        (a.name || trimCharField(a.short_name) || "").localeCompare(
          b.name || trimCharField(b.short_name) || ""
        )
      )
      .map((team) => ({
        id: team.id,
        label: team.name || trimCharField(team.short_name) || `#${team.id}`,
      }));

    return [...base, ...extra];
  }, [teams, t]);

  const summary = useMemo(() => {
    const finished = matches.filter((m) => m.is_finished).length;
    const pending = matches.length - finished;
    return { total: matches.length, finished, pending };
  }, [matches]);

  function calcDateRange(): { start?: Date; end?: Date } {
    const now = new Date();

    if (preset === "all") return {};

    if (preset === "custom" && customStart) {
      const start = startOfDayLocal(customStart);
      const end = customEnd ? endOfDayLocal(customEnd) : endOfDayLocal(customStart);
      return { start, end };
    }

    if (preset === "today") {
      return { start: startOfDayLocal(now), end: endOfDayLocal(now) };
    }

    if (preset === "yesterday") {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { start: startOfDayLocal(d), end: endOfDayLocal(d) };
    }

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
      setDraftStart(picked);
      setDraftEnd(null);
      setShowApplySingleDay(true);
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

      setCustomStart(start);
      setCustomEnd(end);
      setPreset("custom");
      setShowApplySingleDay(false);
      setDraftStart(null);
      setDraftEnd(null);
      setPickingCustom(null);
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

    const { data: ch, error: chErr } = await supabase
      .from("championship")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (chErr) {
      Alert.alert(t("common.error"), chErr.message);
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

    const { data: tpData, error: tpErr } = await supabase
      .from("team_player")
      .select("team:team_id(id,name,short_name)")
      .eq("championship_id", ch.id);

    if (tpErr) {
      Alert.alert(t("common.error"), tpErr.message);
      setLoading(false);
      setRefreshing(false);
      setInitialLoaded(true);
      return [];
    }

    const tMap = new Map<number, TeamMini>();

    for (const row of tpData ?? []) {
      const team = (row as any).team as TeamMini | null;
      if (team?.id) tMap.set(team.id, team);
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

    if (status === "finished") q = q.eq("is_finished", true);
    if (status === "pending") q = q.eq("is_finished", false);

    if (start) q = q.gte("match_date", start.toISOString());
    if (end) q = q.lte("match_date", end.toISOString());

    if (teamId) q = q.or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`);

    const { data, error } = await q;

    if (error) {
      Alert.alert(t("common.error"), error.message);
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

  const onRefresh = useCallback(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, status, teamId, customStart, customEnd]);

  async function openCalendarPickerForMatch(item: MatchRow) {
    try {
      if (!item.match_date) {
        Alert.alert(t("publicMatches.noDateTitle"), t("publicMatches.noDateMessage"));
        return;
      }

      setCalendarLoading(true);
      setCalendarTargetMatch(item);

      const { status } = await Calendar.requestCalendarPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          t("publicMatches.permissionNeeded"),
          t("publicMatches.calendarPermissionMessage")
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
        Alert.alert(t("common.error"), t("publicMatches.noEditableCalendar"));
        return;
      }

      const options: CalendarOption[] = editableCalendars
        .map((cal) => ({
          id: cal.id,
          title: cal.title,
          subtitle: [cal.source?.name ?? null, cal.isPrimary ? t("publicMatches.primaryCalendar") : null]
            .filter(Boolean)
            .join(" · "),
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

      setCalendarOptions(options);
      setCalendarPickerOpen(true);
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? t("publicMatches.calendarLoadError"));
    } finally {
      await loadSavedCalendarPreference();
      setCalendarLoading(false);
    }
  }

  async function addMatchToCalendar(calendarId: string, calendarTitle: string, item: MatchRow) {
    try {
      if (!item.match_date) {
        Alert.alert(t("publicMatches.noDateTitle"), t("publicMatches.noDateMessage"));
        return;
      }

      const aName =
        trimCharField(item.team_a?.name) ||
        item.team_a?.short_name ||
        t("publicMatches.teamA");

      const bName =
        trimCharField(item.team_b?.name) ||
        item.team_b?.short_name ||
        t("publicMatches.teamB");

      const fieldCode = item.slot?.field_code
        ? t("publicMatches.field", { field: item.slot.field_code })
        : t("publicMatches.fieldPending");

      const startDate = new Date(item.match_date);
      const endDate = new Date(startDate.getTime() + 90 * 60 * 1000);

      await Calendar.createEventAsync(calendarId, {
        title: `${aName} ${t("publicMatches.vs")} ${bName}`,
        startDate,
        endDate,
        location: fieldCode,
        notes: t("publicMatches.eventNotes", {
          phase: item.phase?.name ? ` · ${item.phase.name}` : "",
        }),
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

      Alert.alert(
        t("publicMatches.calendarAddedTitle"),
        t("publicMatches.calendarAddedMessage", { calendar: calendarTitle })
      );
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? t("publicMatches.calendarAddError"));
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
            backgroundColor: colors.card,
            borderRadius: 18,
            padding: 16,
            borderWidth: 1,
            borderColor: colors.border,
            maxHeight: "75%",
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "900", color: colors.text, textAlign: "center" }}>
            {t("publicMatches.selectCalendar")}
          </Text>

          <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "700", textAlign: "center" }}>
            {t("publicMatches.selectCalendarSubtitle")}
          </Text>

          {savedCalendarId && savedCalendarTitle ? (
            <View
              style={{
                marginTop: 12,
                backgroundColor: colors.cardAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 10,
              }}
            >
              <Text style={{ color: colors.muted, fontWeight: "700", textAlign: "center" }}>
                {t("publicMatches.currentSavedCalendar")}
              </Text>
              <Text style={{ color: colors.text, fontWeight: "900", textAlign: "center", marginTop: 4 }}>
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
                    borderColor: colors.border,
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 10,
                    backgroundColor: colors.card,
                    opacity: pressed ? 0.92 : 1,
                  })}
                >
                  <Text style={{ fontWeight: "900", color: colors.text, fontSize: 16 }}>
                    {cal.title}
                  </Text>

                  {cal.subtitle ? (
                    <Text style={{ marginTop: 4, color: colors.muted, fontWeight: "700" }}>
                      {cal.subtitle}
                    </Text>
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
                  t("publicMatches.calendarResetTitle"),
                  t("publicMatches.calendarResetMessage")
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
                {t("publicMatches.resetSavedCalendar")}
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
            <Text style={{ color: colors.muted, fontWeight: "900" }}>
              {t("publicMatches.cancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (!initialLoaded || loading) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      {calendarPickerModal}

      <FlatList
        style={{ opacity: listVisible ? 1 : 0 }}
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

            shouldRestoreScrollRef.current = false;
            setListVisible(true);
          }, 150);
        }}
        ref={listRef}
        ListHeaderComponent={
          <View>
            <View style={{ paddingTop: 10, paddingBottom: 10 }}>
              <BackButton
                onPress={() => router.replace("/public-menu")}
                style={{ marginTop: 5 }}
              />
            </View>

            <View style={styles.filtersCard}>
              <Pressable
                onPress={() => {
                  setShowFilters((v) => !v);
                  setShowTeamPicker(false);
                }}
                style={styles.filtersHeader}
              >
                <Text style={styles.filtersTitle}>{t("publicMatches.filters")}</Text>
                <Text style={styles.filtersChevron}>{showFilters ? "▲" : "▼"}</Text>
              </Pressable>

              {showFilters && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.sectionLabel}>{t("publicMatches.status")}</Text>

                  <View style={styles.chipsWrap}>
                    {([
                      ["all", t("publicMatches.all")],
                      ["pending", t("publicMatches.pending")],
                      ["finished", t("publicMatches.finished")],
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
                          <Text
                            style={[
                              styles.chipText,
                              active ? styles.chipTextActive : styles.chipTextInactive,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.sectionLabel, { marginTop: 14 }]}>
                    {t("publicMatches.dates")}
                  </Text>

                  <View style={styles.chipsWrap}>
                    {([
                      ["all", t("publicMatches.allNeutral")],
                      ["today", t("publicMatches.today")],
                      ["yesterday", t("publicMatches.yesterday")],
                      ["week", t("publicMatches.week")],
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
                          <Text
                            style={[
                              styles.chipText,
                              active ? styles.chipTextActive : styles.chipTextInactive,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Pressable
                    onPress={() => {
                      setDraftStart(customStart);
                      setDraftEnd(customEnd);
                      setPickingCustom("start");
                    }}
                    style={[styles.pickerButton, { marginTop: 10 }]}
                  >
                    <Text style={styles.pickerButtonText} numberOfLines={1}>
                      {displayStart
                        ? t("publicMatches.calendarSelected", {
                          start: `${pad2(displayStart.getDate())}/${pad2(
                            displayStart.getMonth() + 1
                          )}/${displayStart.getFullYear()}`,
                          end: displayEnd
                            ? ` - ${pad2(displayEnd.getDate())}/${pad2(
                              displayEnd.getMonth() + 1
                            )}/${displayEnd.getFullYear()}`
                            : "",
                        })
                        : t("publicMatches.calendarChooseRange")}
                    </Text>
                    <Text style={styles.filtersChevron}>📅</Text>
                  </Pressable>

                  {showApplySingleDay && draftStart && (
                    <Pressable
                      onPress={() => {
                        setCustomStart(draftStart);
                        setCustomEnd(draftStart);
                        setPreset("custom");
                        setDraftStart(null);
                        setDraftEnd(null);
                        setPickingCustom(null);
                        setShowApplySingleDay(false);
                        setShowTeamPicker(false);
                        setShowFilters(false);
                      }}
                      style={[styles.chip, styles.chipActive, { alignSelf: "flex-start", marginTop: 10 }]}
                    >
                      <Text style={styles.chipTextActive}>
                        {t("publicMatches.applyOnlyThisDay")}
                      </Text>
                    </Pressable>
                  )}

                  {pickingCustom && (
                    <View style={{ marginTop: 10 }}>
                      <DateTimePicker
                        value={
                          pickingCustom === "start"
                            ? new Date()
                            : draftStart ?? customStart ?? new Date()
                        }
                        mode="date"
                        display="default"
                        onChange={handleCustomDateChange}
                      />
                    </View>
                  )}

                  <Text style={[styles.sectionLabel, { marginTop: 14 }]}>
                    {t("publicMatches.team")}
                  </Text>

                  <Pressable
                    onPress={() => setShowTeamPicker((v) => !v)}
                    style={styles.pickerButton}
                  >
                    <Text style={styles.pickerButtonText} numberOfLines={1}>
                      {teamId
                        ? t("publicMatches.teamFilter", {
                          team:
                            teamChips.find((x) => x.id === teamId)?.label ??
                            t("publicMatches.team"),
                        })
                        : t("publicMatches.teamFilterAll")}
                    </Text>
                    <Text style={styles.filtersChevron}>{showTeamPicker ? "▲" : "▼"}</Text>
                  </Pressable>

                  {showTeamPicker && (
                    <View style={[styles.pickerPanel, { maxHeight: 260 }]}>
                      <ScrollView
                        showsVerticalScrollIndicator={false}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                      >
                        <View style={styles.chipsWrap}>
                          {teamChips.map((team) => {
                            const active = teamId === team.id;

                            return (
                              <Pressable
                                key={String(team.id)}
                                onPress={() => {
                                  setTeamId(team.id);
                                  setShowTeamPicker(false);
                                  setShowFilters(false);
                                }}
                                style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                              >
                                <Text
                                  style={[
                                    styles.chipText,
                                    active ? styles.chipTextActive : styles.chipTextInactive,
                                  ]}
                                >
                                  {team.label}
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

            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryPill}>
                  <Text style={styles.summaryPillLabel}>{t("publicMatches.total")}</Text>
                  <Text style={styles.summaryPillValue}>{summary.total}</Text>
                </View>

                <View style={[styles.summaryPill, styles.pillPending]}>
                  <Text style={styles.summaryPillLabel}>{t("publicMatches.pending")}</Text>
                  <Text style={styles.summaryPillValue}>{summary.pending}</Text>
                </View>

                <View style={[styles.summaryPill, styles.pillFinished]}>
                  <Text style={styles.summaryPillLabel}>{t("publicMatches.finished")}</Text>
                  <Text style={styles.summaryPillValue}>{summary.finished}</Text>
                </View>
              </View>

              <Text style={styles.summarySub}>
                {labelForStatus(status)} ·{" "}
                {preset === "all" ? t("publicMatches.allDates") : labelForPreset(preset)}
                {teamId ? ` · ${teamChips.find((team) => team.id === teamId)?.label ?? ""}` : ""}
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
            <Text style={styles.emptyTitle}>{t("publicMatches.noMatches")}</Text>
            <Text style={styles.emptySub}>{t("publicMatches.noMatchesWithFilters")}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const aName =
            trimCharField(item.team_a?.name) ||
            item.team_a?.short_name ||
            t("publicMatches.teamA");

          const bName =
            trimCharField(item.team_b?.name) ||
            item.team_b?.short_name ||
            t("publicMatches.teamB");

          const isAjornat = item.display_status === "AJORNAT";
          const isLive = !!item.started_at && !item.is_finished && !isAjornat;
          const score = isLive ? "" : `${item.score_team_a ?? 0} - ${item.score_team_b ?? 0}`;
          const canOpenSummary = !isAjornat && (item.is_finished || !!item.started_at);

          return (
            <Pressable
              onPress={() => {
                if (isAjornat) {
                  Alert.alert(
                    t("publicMatches.postponedMatch"),
                    t("publicMatches.postponedMatchMessage")
                  );
                  return;
                }

                if (canOpenSummary) {
                  shouldRestoreScrollRef.current = true;
                  restoreMatchIdRef.current = item.id;
                  router.push({ pathname: "/match-summary", params: { id: item.id } });
                  return;
                }

                Alert.alert(
                  t("publicMatches.pendingMatch"),
                  t("publicMatches.pendingMatchCalendarQuestion"),
                  [
                    { text: t("publicMatches.cancel"), style: "cancel" },
                    ...(savedCalendarId
                      ? [
                        {
                          text: t("publicMatches.addToSavedCalendar", {
                            calendar:
                              savedCalendarTitle ??
                              t("publicMatches.savedCalendarFallback"),
                          }),
                          onPress: async () => {
                            const reused = await tryAddToSavedCalendar(item);
                            if (!reused) await openCalendarPickerForMatch(item);
                          },
                        },
                        {
                          text: t("publicMatches.changeCalendar"),
                          onPress: () => openCalendarPickerForMatch(item),
                        },
                      ]
                      : [
                        {
                          text: t("publicMatches.addToCalendar"),
                          onPress: () => openCalendarPickerForMatch(item),
                        },
                      ]),
                  ]
                );
              }}
              onLongPress={() => Alert.alert(t("publicMatches.matchIdTitle"), String(item.id))}
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
                  {aName} <Text style={styles.vs}>{t("publicMatches.vs")}</Text> {bName}
                </Text>

                <View style={styles.matchMetaRow}>
                  <View style={styles.metaRow}>
                    {item.match_date ? (
                      <Text style={styles.metaText}>
                        🗓️ {formatDateDDMMYYYY_HHMM(item.match_date, "·")}
                      </Text>
                    ) : (
                      <Text style={styles.metaMuted}>
                        🗓️ {t("publicMatches.pendingDate")}
                      </Text>
                    )}

                    {item.slot?.field_code ? (
                      <Text style={styles.metaText}> · 🏟️ {item.slot.field_code}</Text>
                    ) : null}
                  </View>

                  <View
                    style={[
                      styles.badge,
                      isAjornat
                        ? styles.pillAjornat
                        : isLive
                          ? styles.pillLive
                          : item.is_finished
                            ? styles.pillFinished
                            : styles.pillPending,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        isAjornat ? styles.badgeTextAjornat : null,
                        isLive ? styles.badgeTextLive : null,
                      ]}
                    >
                      {isAjornat
                        ? t("publicMatches.postponedStatus")
                        : item.is_finished
                          ? t("publicMatches.finalStatus")
                          : item.started_at
                            ? t("publicMatches.liveStatus")
                            : t("publicMatches.pendingStatus")}
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
                      ? t("publicMatches.postponedMatch")
                      : t("publicMatches.pendingCalendarHint")}
                  </Text>
                </View>
              )}

              {!item.is_finished && !!item.started_at && (
                <Text style={styles.pendingHint}>{t("publicMatches.liveHint")}</Text>
              )}

              {item.is_finished && (
                <Text style={styles.openHint}>
                  {Platform.OS === "ios"
                    ? t("publicMatches.tapSummaryIos")
                    : t("publicMatches.tapSummaryAndroid")}
                </Text>
              )}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

function getStyles(colors: AppColors, isDark = false) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.bg,
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    loadingWrap: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.bg,
    },
    summaryCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
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
      borderColor: colors.border,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: colors.cardAlt,
    },
    pillFinished: {
      backgroundColor: isDark ? "#122A1C" : "#F2FFF7",
      borderColor: isDark ? "#22543D" : "#D7F5E3",
    },
    pillPending: {
      backgroundColor: isDark ? "#2C1E03" : "#FFF9F2",
      borderColor: isDark ? "#7B4F01" : "#F4E3C9",
    },
    pillLive: {
      backgroundColor: isDark ? "#071529" : "#EFF6FF",
      borderColor: isDark ? "#1E3A8A" : "#3B82F6",
    },
    pillAjornat: {
      backgroundColor: isDark ? "#2C1E1E" : "#FEF2F2",
      borderColor: isDark ? "#7B4F4F" : "#FCA5A5",
    },
    summaryPillLabel: {
      color: isDark ? colors.text : colors.muted,
      fontSize: 12,
      fontWeight: "700",
    },
    summaryPillValue: {
      marginTop: 2,
      fontSize: 18,
      fontWeight: "900",
      color: colors.text,
    },
    summarySub: {
      marginTop: 10,
      color: colors.muted,
      fontWeight: "700",
    },
    bottomRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 8,
    },
    filtersCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
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
      color: colors.text,
    },
    filtersChevron: {
      color: colors.muted,
      fontWeight: "900",
      fontSize: 14,
    },
    sectionLabel: {
      fontWeight: "800",
      color: colors.text,
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
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipInactive: {
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
    chipText: {
      fontWeight: "800",
    },
    chipTextActive: {
      color: colors.primaryText,
    },
    chipTextInactive: {
      color: colors.text,
    },
    matchCardAjornat: {
      borderLeftWidth: 6,
      borderLeftColor: "#DC2626",
    },
    badgeTextAjornat: {
      color: "#B91C1C",
    },
    scoreAjornat: {
      color: "#B91C1C",
    },
    pickerButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: colors.cardAlt,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    pickerButtonText: {
      fontWeight: "800",
      color: colors.text,
      flex: 1,
      marginRight: 10,
    },
    pickerPanel: {
      marginTop: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.card,
      padding: 10,
      maxHeight: 220,
    },
    matchCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
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
      borderLeftColor: "#10B981",
    },
    matchCardLive: {
      borderLeftWidth: 6,
      borderLeftColor: "#3B82F6",
      backgroundColor: isDark ? "#071529" : "#EFF6FF",
    },
    matchCardPending: {
      borderLeftWidth: 6,
      borderLeftColor: "#F59E0B",
    },
    matchTopRow: {
      gap: 8,
    },
    matchTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
    },
    vs: {
      color: colors.muted,
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
      color: colors.muted,
      fontWeight: "700",
      fontSize: 12,
    },
    metaMuted: {
      color: colors.muted,
      fontWeight: "700",
      fontSize: 12,
    },
    phaseText: {
      flex: 1,
      color: colors.muted,
      fontWeight: "800",
    },
    badge: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      alignSelf: "flex-end",
    },
    badgeText: {
      fontWeight: "900",
      fontSize: 12,
      color: colors.text,
      letterSpacing: 0.3,
    },
    badgeTextLive: {
      color: colors.text,
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
      color: colors.muted,
      fontWeight: "700",
      fontSize: 13,
    },
    openHint: {
      marginTop: 10,
      color: colors.muted,
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
      color: colors.text,
    },
    emptySub: {
      marginTop: 8,
      textAlign: "center",
      fontSize: 14,
      color: colors.muted,
      fontWeight: "700",
    },
  });
}