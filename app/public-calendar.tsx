import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
  StyleSheet,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { BackButton } from "../components/HeaderButtons";
import { useAppTheme, AppColors } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";
import { supabase } from "../src/supabase";

type Championship = {
  id: number;
  name: string;
};

type MatchSlotRow = {
  id: number;
  starts_at: string;
  field_code: string;
};

type MatchRow = {
  id: number;
  slot_id: number | null;
  team_a?: { name: string } | null;
  team_b?: { name: string } | null;
  phase?: { name: string | null } | null;
};

type WeekendOption = {
  key: string;
  label: string;
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toLocalDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfDayLocal(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`);
}

function endOfDayLocal(dateKey: string) {
  return new Date(`${dateKey}T23:59:59.999`);
}

function saturdayOfWeekend(d: Date) {
  const day = d.getDay();
  const diffToSaturday = (day + 1) % 7;
  const sat = new Date(d);
  sat.setHours(12, 0, 0, 0);
  sat.setDate(sat.getDate() - diffToSaturday);
  sat.setHours(12, 0, 0, 0);
  return sat;
}

function weekendKeyFromDate(d: Date) {
  const sat = saturdayOfWeekend(d);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return `${toLocalDateKey(sat)}_${toLocalDateKey(sun)}`;
}

function weekendLabelFromKey(key: string) {
  const [from, to] = key.split("_");

  const fmt = (dateKey: string) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    return `${pad2(day)}-${pad2(month)}-${year}`;
  };

  return `${fmt(from)} - ${fmt(to)}`;
}

function formatDayLabel(dayKey: string, language: "ca" | "es") {
  const d = new Date(`${dayKey}T12:00:00`);

  const weekdays =
    language === "es"
      ? ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
      : ["Diumenge", "Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres", "Dissabte"];

  const weekday = weekdays[d.getDay()];
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${weekday} ${day}-${month}-${year}`;
}

function formatTimeLocal(ts: string) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function PublicCalendar() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t, language } = useLanguage();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { width: windowWidth } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [championship, setChampionship] = useState<Championship | null>(null);
  const [slots, setSlots] = useState<MatchSlotRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);

  const [selectedWeekend, setSelectedWeekend] = useState<string | null>(null);
  const [weekendModalOpen, setWeekendModalOpen] = useState(false);

  async function loadData(isManualRefresh = false) {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    const { data: champ, error: champErr } = await supabase
      .from("championship")
      .select("id,name")
      .eq("is_active", true)
      .single();

    if (champErr || !champ) {
      console.warn("No s'ha pogut carregar el campionat actiu:", champErr?.message);
      setChampionship(null);
      setSlots([]);
      setMatches([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setChampionship(champ);

    const [{ data: slotRows, error: slotErr }, { data: matchRows, error: matchErr }] =
      await Promise.all([
        supabase
          .from("match_slot")
          .select("id,starts_at,field_code")
          .eq("championship_id", champ.id)
          .order("starts_at", { ascending: true }),
        supabase
          .from("match")
          .select(
            `
          id,
          slot_id,
          team_a:team_a_id(name),
          team_b:team_b_id(name),
          phase:phase_id(name)
        `
          )
          .eq("championship_id", champ.id),
      ]);

    if (slotErr) console.warn("Error carregant slots:", slotErr.message);
    if (matchErr) console.warn("Error carregant partits:", matchErr.message);

    setSlots((slotRows ?? []) as any);
    setMatches((matchRows ?? []) as any);

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!mounted) return;
      await loadData(false);
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weekendOptions: WeekendOption[] = useMemo(() => {
    const map = new Map<string, true>();

    for (const slot of slots) {
      const d = new Date(slot.starts_at);
      const key = weekendKeyFromDate(d);
      map.set(key, true);
    }

    const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    return keys.map((key) => ({ key, label: weekendLabelFromKey(key) }));
  }, [slots]);

  const matchesBySlotId = useMemo(() => {
    const map = new Map<number, MatchRow>();

    for (const match of matches) {
      if (match.slot_id != null) map.set(match.slot_id, match);
    }

    return map;
  }, [matches]);

  const filteredSlots = useMemo(() => {
    if (!selectedWeekend) return slots;

    const [fromKey, toKey] = selectedWeekend.split("_");
    const from = startOfDayLocal(fromKey);
    const to = endOfDayLocal(toKey);

    return slots.filter((slot) => {
      const d = new Date(slot.starts_at);
      return d >= from && d <= to;
    });
  }, [slots, selectedWeekend]);

  const groupedByDayAndHour = useMemo(() => {
    const dayMap = new Map<string, MatchSlotRow[]>();

    for (const slot of filteredSlots) {
      const d = new Date(slot.starts_at);
      const dayKey = toLocalDateKey(d);
      const arr = dayMap.get(dayKey) ?? [];
      arr.push(slot);
      dayMap.set(dayKey, arr);
    }

    const dayKeys = Array.from(dayMap.keys()).sort((a, b) => a.localeCompare(b));

    return dayKeys.map((dayKey) => {
      const daySlots = dayMap.get(dayKey)!;
      daySlots.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

      const hourMap = new Map<string, MatchSlotRow[]>();

      for (const slot of daySlots) {
        const d = new Date(slot.starts_at);
        const hourLabel = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        const arr = hourMap.get(hourLabel) ?? [];
        arr.push(slot);
        hourMap.set(hourLabel, arr);
      }

      const hours = Array.from(hourMap.keys()).sort((a, b) => a.localeCompare(b));

      return {
        dayKey,
        hours: hours.map((hourLabel) => ({
          hourLabel,
          slots: hourMap.get(hourLabel)!,
        })),
      };
    });
  }, [filteredSlots]);

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <BackButton onPress={() => router.replace("/public-menu")} />
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.title}>{t("calendar.title")}</Text>
          <Text style={styles.subtitle}>{championship?.name ?? ""}</Text>

          <Text style={styles.sectionLabel}>{t("calendar.selectWeekend")}</Text>

          <Pressable onPress={() => setWeekendModalOpen(true)} style={styles.select}>
            <Text style={styles.selectText}>
              {selectedWeekend
                ? weekendOptions.find((weekend) => weekend.key === selectedWeekend)?.label
                : t("calendar.all")}
            </Text>
            <Text style={styles.selectChevron}>▾</Text>
          </Pressable>
        </View>

        <Modal
          visible={weekendModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setWeekendModalOpen(false)}
        >
          <Pressable onPress={() => setWeekendModalOpen(false)} style={styles.modalOverlay}>
            <Pressable
              onPress={() => {}}
              style={[
                styles.modalCard,
                { width: Math.min(520, Math.max(300, windowWidth - 40)) },
              ]}
            >
              <Text style={styles.modalTitle}>{t("calendar.weekend")}</Text>
              <Text style={styles.modalHint}>{t("calendar.weekendHint")}</Text>

              <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                <Pressable
                  onPress={() => {
                    setSelectedWeekend(null);
                    setWeekendModalOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.modalOption,
                    pressed && { opacity: 0.7 },
                    selectedWeekend === null && styles.modalOptionSelected,
                  ]}
                >
                  <Text style={styles.modalOptionText}>{t("calendar.all")}</Text>
                  {selectedWeekend === null ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>

                {weekendOptions.map((weekend) => (
                  <Pressable
                    key={weekend.key}
                    onPress={() => {
                      setSelectedWeekend(weekend.key);
                      setWeekendModalOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.modalOption,
                      pressed && { opacity: 0.7 },
                      selectedWeekend === weekend.key && styles.modalOptionSelected,
                    ]}
                  >
                    <Text style={styles.modalOptionText}>{weekend.label}</Text>
                    {selectedWeekend === weekend.key ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>

              <Pressable onPress={() => setWeekendModalOpen(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>{t("calendar.close")}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        {groupedByDayAndHour.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("publicMatches.noMatches")}</Text>
            <Text style={styles.emptyText}>{t("calendar.noSlotsForFilter")}</Text>
          </View>
        ) : (
          groupedByDayAndHour.map((day) => (
            <View key={day.dayKey} style={styles.dayCard}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayTitle}>{formatDayLabel(day.dayKey, language)}</Text>
              </View>

              {day.hours.map((hour) => (
                <View key={`${day.dayKey}_${hour.hourLabel}`} style={styles.hourBlock}>
                  <View style={styles.hourPill}>
                    <Text style={styles.hourText}>{hour.hourLabel}</Text>
                  </View>

                  <View style={{ marginTop: 10 }}>
                    {hour.slots.map((slot) => {
                      const match = matchesBySlotId.get(slot.id);
                      const teamA = match?.team_a?.name ?? t("publicMatches.teamA");
                      const teamB = match?.team_b?.name ?? t("publicMatches.teamB");
                      const phaseName = match?.phase?.name ?? null;

                      return (
                        <View key={slot.id} style={[styles.matchCard, !match && styles.matchCardEmpty]}>
                          <View style={styles.matchTopRow}>
                            <View style={styles.fieldPill}>
                              <Text style={styles.fieldPillText}>
                                {t("publicMatches.field", { field: slot.field_code })}
                              </Text>
                            </View>

                            {!!phaseName && (
                              <Text style={styles.phaseInline} numberOfLines={1}>
                                {phaseName}
                              </Text>
                            )}

                            <Text style={styles.matchTime}>{formatTimeLocal(slot.starts_at)}</Text>
                          </View>

                          {match ? (
                            <Text style={styles.matchTeams} numberOfLines={2}>
                              {teamA} <Text style={styles.vs}>{t("publicMatches.vs")}</Text> {teamB}
                            </Text>
                          ) : (
                            <Text style={styles.matchEmptyText}>{t("calendar.emptyField")}</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ))
        )}

        <View style={{ height: 18 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function getStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    content: {
      padding: 16,
    },
    loadingWrap: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.bg,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    heroCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
      ...(Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 2 },
        default: {},
      }) as any),
    },
    title: {
      fontSize: 26,
      fontWeight: "900",
      color: colors.text,
      textAlign: "center",
    },
    subtitle: {
      color: colors.muted,
      textAlign: "center",
      marginTop: 4,
      marginBottom: 10,
      fontWeight: "600",
    },
    pillsRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 12,
    },
    pill: {
      flex: 1,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: colors.cardAlt,
    },
    pillLabel: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "700",
    },
    pillValue: {
      marginTop: 2,
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
    },
    sectionLabel: {
      fontSize: 14,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 8,
    },
    select: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    selectText: {
      fontWeight: "800",
      color: colors.text,
    },
    selectChevron: {
      fontWeight: "900",
      color: colors.text,
      opacity: 0.7,
      fontSize: 16,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.35)",
      justifyContent: "center",
      padding: 20,
    },
    modalCard: {
      alignSelf: "center",
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      ...(Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        },
        android: { elevation: 5 },
        default: {},
      }) as any),
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "900",
      color: colors.text,
    },
    modalHint: {
      color: colors.muted,
      marginTop: 4,
      marginBottom: 10,
      fontWeight: "600",
    },
    modalOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardAlt,
      marginBottom: 8,
    },
    modalOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.card,
    },
    modalOptionText: {
      fontWeight: "800",
      color: colors.text,
    },
    check: {
      fontWeight: "900",
      color: "#16a34a",
      fontSize: 16,
    },
    modalClose: {
      marginTop: 6,
      alignSelf: "flex-end",
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    modalCloseText: {
      fontWeight: "900",
      color: colors.text,
    },
    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      ...(Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 2 },
        default: {},
      }) as any),
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "900",
      color: colors.text,
      marginBottom: 4,
    },
    emptyText: {
      color: colors.muted,
      fontWeight: "600",
    },
    dayCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
      ...(Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 2 },
        default: {},
      }) as any),
    },
    dayHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 10,
    },
    dayTitle: {
      fontSize: 16,
      fontWeight: "900",
      color: colors.text,
    },
    dayMeta: {
      color: colors.muted,
      fontWeight: "700",
    },
    hourBlock: {
      marginTop: 6,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    hourPill: {
      alignSelf: "flex-start",
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    hourText: {
      color: colors.primaryText,
      fontWeight: "900",
    },
    matchCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    matchCardEmpty: {
      backgroundColor: colors.cardAlt,
    },
    matchTopRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
    },
    fieldPill: {
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardAlt,
    },
    fieldPillText: {
      fontWeight: "900",
      color: colors.text,
      fontSize: 12,
    },
    phaseInline: {
      flex: 1,
      textAlign: "center",
      color: colors.muted,
      fontWeight: "900",
      fontSize: 12,
      paddingHorizontal: 8,
    },
    matchTime: {
      color: colors.muted,
      fontWeight: "800",
      marginLeft: "auto",
    },
    matchTeams: {
      fontSize: 15,
      fontWeight: "900",
      color: colors.text,
    },
    vs: {
      color: colors.muted,
      fontWeight: "900",
    },
    matchEmptyText: {
      fontStyle: "italic",
      color: colors.muted,
      fontWeight: "700",
    },
  });
}