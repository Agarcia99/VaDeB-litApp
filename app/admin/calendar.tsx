import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Alert,
  FlatList,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../src/supabase";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";
import { useAdminGuard } from "../../hooks/use-admin-guard";
import { useAppTheme } from "@/src/theme";

type Championship = { id: number; name: string; year: number; is_active: boolean };
type MatchSlot = {
  id: number;
  championship_id: number;
  starts_at: string;
  field_code: string;
  day_code: string;
  time_code: string;
  is_used: boolean;
};
type MatchRow = {
  // Note: match_date exists in DB but we use slot.starts_at for display; we still update match_date when moving.

  id: number;
  championship_id: number | null;
  team_a_id: number | null;
  team_b_id: number | null;
  slot_id: number | null;
  is_finished: boolean;
};

type TeamRow = { id: number; name: string };


export default function AdminCalendar() {
  const router = useRouter();
  const { checking: loading, isAdmin: allowed } = useAdminGuard();
  const { colors, isDark } = useAppTheme();

  const [championship, setChampionship] = useState<Championship | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teamsById, setTeamsById] = useState<Record<number, string>>({});
  const [slotsById, setSlotsById] = useState<Record<number, MatchSlot>>({});

  const [busyMatchId, setBusyMatchId] = useState<number | null>(null);

  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [slotSearch, setSlotSearch] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<MatchRow | null>(null);
  const [availableSlots, setAvailableSlots] = useState<MatchSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const loadCalendar = async () => {
    // Pick active championship
    const { data: champs, error: champErr } = await supabase
      .from("championship")
      .select("id,name,year,is_active")
      .eq("is_active", true)
      .order("year", { ascending: false })
      .limit(1);

    if (champErr) throw champErr;
    const champ = champs?.[0] ?? null;
    setChampionship(champ);

    if (!champ) {
      setMatches([]);
      setSlotsById({});
      return;
    }

    // Matches not finished for this championship
    const { data: matchRows, error: matchErr } = await supabase
      .from("match")
      .select("id,championship_id,team_a_id,team_b_id,slot_id,is_finished")
      .eq("championship_id", champ.id)
      .eq("is_finished", false)
      .order("match_date", { ascending: true });

    if (matchErr) throw matchErr;
    const ms = (matchRows ?? []) as MatchRow[];
    setMatches(ms);

    // Load team names for display (single query)
    const teamIds = Array.from(
      new Set(
        ms
          .flatMap((r) => [r.team_a_id, r.team_b_id])
          .filter((v): v is number => typeof v === "number")
      )
    );

    if (teamIds.length) {
      const { data: teamRows, error: teamErr } = await supabase
        .from("team")
        .select("id,name")
        .in("id", teamIds);

      if (!teamErr) {
        const map: Record<number, string> = {};
        (teamRows as TeamRow[] | null | undefined)?.forEach((t) => {
          map[t.id] = t.name;
        });
        setTeamsById(map);
      }
    } else {
      setTeamsById({});
    }


    // Preload slot details for assigned slots (so UI shows time/field)
    const slotIds = Array.from(new Set(ms.map((m) => m.slot_id).filter((x): x is number => !!x)));
    if (slotIds.length === 0) {
      setSlotsById({});
      return;
    }

    const { data: slotRows, error: slotErr } = await supabase
      .from("match_slot")
      .select("id,championship_id,starts_at,field_code,day_code,time_code,is_used")
      .in("id", slotIds);

    if (slotErr) throw slotErr;
    const map: Record<number, MatchSlot> = {};
    (slotRows ?? []).forEach((s: any) => (map[s.id] = s));
    setSlotsById(map);
  };
// --- Display helpers (Catalan + nicer field label) ---
  function toCaDay(dayCode: string) {
    const k = (dayCode ?? "").trim().toLowerCase();
    const map: Record<string, string> = {
      mon: "Dilluns",
      tue: "Dimarts",
      wed: "Dimecres",
      thu: "Dijous",
      fri: "Divendres",
      sat: "Dissabte",
      sun: "Diumenge",
    };
    return map[k] ?? dayCode;
  }
function fmtField(fieldCode: string) {
    return `Camp ${fieldCode}`;
  }

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        await loadCalendar();
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "No s'ha pogut carregar el calendari.");
      }
    })();
  }, [allowed]);

  const openSlotPicker = async (matchRow: MatchRow) => {
    if (!championship) return;

    setSelectedMatch(matchRow);
    setSlotSearch("");
    setSlotModalOpen(true);
    setLoadingSlots(true);

    try {
      const { data: slotRows, error } = await supabase
        .from("match_slot")
        .select("id,championship_id,starts_at,field_code,day_code,time_code,is_used,game_slot_id")
        .eq("championship_id", championship.id)
        .eq("is_used", false)
        .order("starts_at", { ascending: true });

      if (error) throw error;
      setAvailableSlots((slotRows ?? []) as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'han pogut carregar els slots buits.");
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  const filteredSlots = useMemo(() => {
    const q = slotSearch.trim().toLowerCase();
    if (!q) return availableSlots;
    return availableSlots.filter((s) => {
      const hay = `${s.day_code} ${s.time_code} ${s.field_code} ${s.starts_at}`.toLowerCase();
      return hay.includes(q);
    });
  }, [availableSlots, slotSearch]);

  const teamName = (id: number | null | undefined) => {
    if (!id) return "?";
    return teamsById[id] ?? String(id);
  };

  const fmtSlot = (slot: MatchSlot | undefined) => {
    if (!slot) return "—";
    const dt = slot.starts_at ? new Date(slot.starts_at) : null;

    const pad2 = (n: number) => String(n).padStart(2, "0");

    const datePart = dt
      ? `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}`
      : "??/??/????";
    const timePart = dt ? `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}` : "--:--";

    // Example: Ds 17/05/2025, 10:30 Camp A
    return `${toCaDay(slot.day_code)} ${datePart}, ${timePart} - ${fmtField(slot.field_code)}`;
  };

const hasTeamConflictAtSlotTime = async (matchRow: MatchRow, newSlot: MatchSlot) => {
  if (!championship) return false;

  const teamIds = [matchRow.team_a_id, matchRow.team_b_id].filter(
    (v): v is number => typeof v === "number"
  );

  if (teamIds.length === 0) return false;

  const { data, error } = await supabase
    .from("match")
    .select("id, team_a_id, team_b_id, match_date")
    .eq("championship_id", championship.id)
    .neq("id", matchRow.id)
    .eq("match_date", newSlot.starts_at);

  if (error) throw error;

  const conflictingMatch = (data ?? []).find((m: any) => {
    const a = m.team_a_id;
    const b = m.team_b_id;
    return teamIds.includes(a) || teamIds.includes(b);
  });

  return !!conflictingMatch;
};

  const saveNewSlot = async (newSlot: MatchSlot) => {
    if (!selectedMatch || !championship) return;

// Safety: only not-finished matches can be moved
if (selectedMatch.is_finished) {
  Alert.alert("No es pot", "Aquest partit ja està finalitzat.");
  return;
}

// Safety: a cap dels dos equips pot jugar a la mateixa hora en un altre partit
const hasConflict = await hasTeamConflictAtSlotTime(selectedMatch, newSlot);

if (hasConflict) {
  Alert.alert(
    "Conflicte d'horari",
    "Un dels dos equips ja té un altre partit a aquesta mateixa hora. No es pot moure aquest partit a aquest slot."
  );
  return;
}

    setBusyMatchId(selectedMatch.id);
    try {
      const oldSlotId = selectedMatch.slot_id;

      // 1) Update match slot_id
      const { error: upMatchErr } = await supabase
  .from("match")
  .update({
    slot_id: newSlot.id,
    match_date: newSlot.starts_at, // ✅ actualitza la data del partit
    display_status: null,
  })
  .eq("id", selectedMatch.id)
  .eq("championship_id", championship.id)
  .eq("is_finished", false);


      if (upMatchErr) throw upMatchErr;

      // 2) Mark new slot used
      const { error: markNewErr } = await supabase
        .from("match_slot")
        .update({ is_used: true })
        .eq("id", newSlot.id)
        .eq("championship_id", championship.id);

      if (markNewErr) throw markNewErr;

      // 3) Free old slot if it existed
      if (oldSlotId) {
        await supabase
          .from("match_slot")
          .update({ is_used: false })
          .eq("id", oldSlotId)
          .eq("championship_id", championship.id);
      }

      // Refresh local state
      setMatches((prev) =>
        prev.map((m) => (m.id === selectedMatch.id ? { ...m, slot_id: newSlot.id } : m))
      );
      setSlotsById((prev) => ({ ...prev, [newSlot.id]: newSlot }));

      Alert.alert("Fet", "Partit mogut correctament.");
      setSlotModalOpen(false);
      setSelectedMatch(null);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut moure el partit.");
    } finally {
      setBusyMatchId(null);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <Text style={{ textAlign: "center" }}>Carregant…</Text>
      </View>
    );
  }
  if (!allowed) return null;

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <BackButton
          onPress={() => router.back()}
          style={{ marginBottom:15 }}
        />

        <Text style={{ fontSize: 20, fontWeight: "900", flex: 1, textAlign: "center", marginRight: 32 ,color:colors.text}}>
          🗓️ Modificar partits
        </Text>
      </View>

      {!championship ? (
        <View style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.bg }}>
          <Text style={{ fontWeight: "800", marginBottom: 6, color: colors.text }}>No hi ha cap campionat actiu</Text>
          <Text style={{ color: colors.muted }}>Activa un campionat per gestionar el calendari.</Text>
        </View>
      ) : (
        <>
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontWeight: "800", color: colors.text }}>
              {championship.name} ({championship.year})
            </Text>
            <Text style={{ color: colors.muted }}>Pots moure només partits no finalitzats a slots buits.</Text>
          </View>

          <FlatList
            data={matches}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={
              <Text style={{ color: colors.muted, paddingTop: 20 }}>No hi ha partits pendents.</Text>
            }
            renderItem={({ item }) => {
              const slot = item.slot_id ? slotsById[item.slot_id] : undefined;
              const title = `${teamName(item.team_a_id)} vs ${teamName(item.team_b_id)}`;
              const subtitle = fmtSlot(slot);

              return (
                <View
                  style={{
                    padding: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    backgroundColor: colors.bg,
                    marginBottom: 10,
                  }}
                >
                  <Text style={{ fontWeight: "900", marginBottom: 4, color: colors.text }}>{title}</Text>
                  <Text style={{ color: colors.muted, marginBottom: 10 }}>{subtitle}</Text>

                  <Pressable
                    disabled={busyMatchId === item.id}
                    onPress={() => openSlotPicker(item)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.bg,
                      opacity: busyMatchId === item.id ? 0.6 : 1,
                      alignSelf: "flex-start",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {busyMatchId === item.id ? (
                      <ActivityIndicator />
                    ) : (
                      <Text style={{ fontWeight: "900", color: colors.text }}>Canviar horari</Text>
                    )}
                  </Pressable>
                </View>
              );
            }}
          />
        </>
      )}

      <Modal visible={slotModalOpen} animationType="slide" transparent onRequestClose={() => setSlotModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", padding: 16, justifyContent: "center" }}>
          <View style={{ backgroundColor: colors.bg, borderRadius: 16, padding: 12, maxHeight: "80%" }}>
            <Text style={{ fontSize: 16, fontWeight: "900", marginBottom: 10, color: colors.text }}>Selecciona un slot buit</Text>

            {loadingSlots ? (
              <View style={{ paddingVertical: 20 }}>
                <Text style={{ textAlign: "center", color: colors.muted }}>Carregant slots…</Text>
              </View>
            ) : (
              <FlatList
                data={filteredSlots}
                keyExtractor={(s) => String(s.id)}
                style={{ marginBottom: 10 }}
                ListEmptyComponent={<Text style={{ color: colors.muted }}>No hi ha slots buits.</Text>}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => saveNewSlot(item)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: colors.border,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "500", color: colors.text }}>{toCaDay(item.day_code)} · {new Date(item.starts_at).toLocaleString()} - Camp {item.field_code}</Text>
                  </Pressable>
                )}
              />
            )}

            <Pressable
              onPress={() => setSlotModalOpen(false)}
              style={{ paddingVertical: 10, alignSelf: "flex-end" }}
            >
              <Text style={{ fontWeight: "900", color: colors.text }}>Tancar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
