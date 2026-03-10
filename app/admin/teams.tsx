import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  TextInput,
  Platform,
  ScrollView,
} from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, Stack } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../src/supabase";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";

type Championship = { id: number; name: string | null; year: number | null; is_active: boolean | null };
type Team = {
  id: number;
  name: string | null;
  short_name: string | null;
  shirt_color: string | null;
  created_at: string | null;
  // Some schemas use one of these flags to soft-disable teams.
  is_historic?: boolean | null;
  historic?: boolean | null;
};
type GameSlot = { id: number; name: string | null; description: string | null };

type ChampionshipTeam = { team_id: number };
type ChampTeamPref = { team_id: number; game_slot_id: number };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

export default function AdminTeams() {
  const router = useRouter();

  // access
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  // lookups
  const [championships, setChampionships] = useState<Championship[]>([]);
  const [selectedChampionshipId, setSelectedChampionshipId] = useState<number | null>(null);

  const [champModalOpen, setChampModalOpen] = useState(false);
  const [champSearch, setChampSearch] = useState("");

  const [teams, setTeams] = useState<Team[]>([]);
  const [gameSlots, setGameSlots] = useState<GameSlot[]>([]);

  // per-championship relations
  const [memberships, setMemberships] = useState<Set<number>>(new Set()); // team_id in selected championship
  const [prefs, setPrefs] = useState<ChampTeamPref[]>([]); // prefs for selected championship

  // UI
  const [loading, setLoading] = useState(true);
  const [onlyInChampionship, setOnlyInChampionship] = useState(true);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  // form
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [shirtColor, setShirtColor] = useState("");

  // prefs UI
  const [showPrefs, setShowPrefs] = useState(false);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<number>>(new Set());

  const checkAccess = useCallback(async () => {
    setChecking(true);
    const { data: sessionRes } = await supabase.auth.getSession();
    const user = sessionRes.session?.user;
    if (!user) {
      router.replace("/login");
      return;
    }
    const { data, error } = await supabase
      .from("championship_admin_user")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      Alert.alert("Error", error.message);
      setAllowed(false);
    } else {
      setAllowed(!!data);
    }
    setChecking(false);
  }, [router]);

  const loadLookups = useCallback(async () => {
    const [{ data: ch, error: chErr }, { data: gs, error: gsErr }] = await Promise.all([
      supabase
        .from("championship")
        .select("id,name,year,is_active")
        .order("is_active", { ascending: false })
        .order("year", { ascending: false })
        .order("id", { ascending: false }),
      supabase.from("game_slot").select("id,name,description").order("id", { ascending: true }),
    ]);

    if (chErr) Alert.alert("Error", chErr.message);
    if (gsErr) Alert.alert("Error", gsErr.message);

    const chList = (ch ?? []) as Championship[];
    setChampionships(chList);
    setGameSlots((gs ?? []) as GameSlot[]);

    if (selectedChampionshipId == null) {
      const active = chList.find((x) => !!x.is_active);
      setSelectedChampionshipId(active?.id ?? (chList[0]?.id ?? null));
    }
  }, [selectedChampionshipId]);

  const loadTeams = useCallback(async () => {
    const { data, error } = await supabase
      .from("team")
      .select("id,name,short_name,shirt_color,created_at")
      .order("name", { ascending: true });
    if (error) {
      Alert.alert("Error", error.message);
      setTeams([]);
      return;
    }
    setTeams((data ?? []) as Team[]);
  }, []);

  const loadChampionshipRelations = useCallback(async () => {
    if (!selectedChampionshipId) {
      setMemberships(new Set());
      setPrefs([]);
      return;
    }

    const [{ data: ct, error: ctErr }, { data: cp, error: cpErr }] = await Promise.all([
      supabase.from("championship_team").select("team_id").eq("championship_id", selectedChampionshipId),
      supabase
        .from("championship_team_game_preference")
        .select("team_id,game_slot_id")
        .eq("championship_id", selectedChampionshipId),
    ]);

    if (ctErr) Alert.alert("Error", ctErr.message);
    if (cpErr) Alert.alert("Error", cpErr.message);

    const mem = new Set<number>();
    (ct ?? []).forEach((r: any) => {
      if (typeof r.team_id === "number") mem.add(r.team_id);
    });
    setMemberships(mem);

    setPrefs((cp ?? []) as ChampTeamPref[]);
  }, [selectedChampionshipId]);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadLookups(), loadTeams()]);
    await loadChampionshipRelations();
    setLoading(false);
  }, [loadLookups, loadTeams, loadChampionshipRelations]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  useFocusEffect(
    useCallback(() => {
      checkAccess();
      reloadAll();
    }, [checkAccess, reloadAll])
  );

  useEffect(() => {
    // When championship changes, reload relations for it
    loadChampionshipRelations();
  }, [loadChampionshipRelations]);

  useEffect(() => {
    if (!checking && !allowed) {
      Alert.alert("Accés denegat", "Aquesta secció és només per gestors.");
      router.back();
    }
  }, [checking, allowed, router]);

  // Championship search (keep outside other hooks to avoid changing hook order)
  const filteredChampionships = useMemo(() => {
    const q = champSearch.trim().toLowerCase();
    if (!q) return championships;
    return championships.filter((c) => `${c.name ?? ""} ${c.year ?? ""}`.toLowerCase().includes(q));
  }, [championships, champSearch]);

  const champLabel = useMemo(() => {
    const c = championships.find((x) => x.id === selectedChampionshipId);
    if (!c) return "Campionat";
    return `${c.name ?? "Campionat"}${c.year ? ` · ${c.year}` : ""}`;
  }, [championships, selectedChampionshipId]);

  const prefsByTeam = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const r of prefs) {
      if (!m.has(r.team_id)) m.set(r.team_id, []);
      m.get(r.team_id)!.push(r.game_slot_id);
    }
    return m;
  }, [prefs]);

  const slotNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of gameSlots) {
      const label = (s.description ?? "").trim() || (s.name ?? "").trim() || `Slot ${s.id}`;
      m.set(s.id, label);
    }
    return m;
  }, [gameSlots]);

  const visibleTeams = useMemo(() => {
    if (!onlyInChampionship) return teams;
    if (!selectedChampionshipId) return teams;
    return teams.filter((t) => memberships.has(t.id));
  }, [teams, onlyInChampionship, selectedChampionshipId, memberships]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setName("");
    setShortName("");
    setShirtColor("");
    setShowPrefs(false);
    setSelectedSlotIds(new Set());
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEdit = useCallback(
    (row: Team) => {
      setEditing(row);
      setName(row.name ?? "");
      setShortName(row.short_name ?? "");
      setShirtColor(row.shirt_color ?? "");
      const current = prefsByTeam.get(row.id) ?? [];
      setSelectedSlotIds(new Set(current));
      setShowPrefs(false);
      setModalOpen(true);
    },
    [prefsByTeam]
  );

  const toggleSlot = useCallback((slotId: number) => {
    setSelectedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  }, []);

  const toggleMembership = useCallback(
    async (teamId: number) => {
      if (!selectedChampionshipId) {
        Alert.alert("Falta campionat", "Selecciona un campionat.");
        return;
      }

      const isIn = memberships.has(teamId);

      if (!isIn) {
        const { error } = await supabase.from("championship_team").insert({
          championship_id: selectedChampionshipId,
          team_id: teamId,
        });
        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
        await loadChampionshipRelations();
        return;
      }

            // Before removing, ensure there are no matches in this championship for this team
      const { data: anyMatchInChamp, error: matchInChampErr } = await supabase
        .from("match")
        .select("id")
        .eq("championship_id", selectedChampionshipId)
        .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
        .limit(1);

      if (matchInChampErr) {
        Alert.alert("Error comprovant partits", matchInChampErr.message);
        return;
      }

      if ((anyMatchInChamp ?? []).length > 0) {
        Alert.alert(
          "No es pot treure",
          "Aquest equip té partits dins d'aquest campionat. No es pot treure perquè quedaria inconsistent."
        );
        return;
      }

// remove: also delete preferences for that team in this championship
      const { error: prefErr } = await supabase
        .from("championship_team_game_preference")
        .delete()
        .eq("championship_id", selectedChampionshipId)
        .eq("team_id", teamId);

      if (prefErr) {
        Alert.alert("Error", prefErr.message);
        return;
      }

      const { error } = await supabase
        .from("championship_team")
        .delete()
        .eq("championship_id", selectedChampionshipId)
        .eq("team_id", teamId);

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      await loadChampionshipRelations();
    },
    [selectedChampionshipId, memberships, loadChampionshipRelations]
  );

  const save = useCallback(async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      Alert.alert("Falta el nom", "Posa el nom de l'equip.");
      return;
    }

    setSaving(true);
    try {
      let teamId: number;

      if (editing) {
        const { error } = await supabase
          .from("team")
          .update({
            name: cleanName,
            short_name: shortName.trim() || null,
            shirt_color: shirtColor.trim() || null,
          })
          .eq("id", editing.id);

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
        teamId = editing.id;
      } else {
        const { data, error } = await supabase
          .from("team")
          .insert({
            name: cleanName,
            short_name: shortName.trim() || null,
            shirt_color: shirtColor.trim() || null,
          })
          .select("id")
          .single();

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
        teamId = data.id;
      }

      // Preferences are per championship. Only save if we have a selected championship.
      if (selectedChampionshipId) {
        // If user selected prefs, ensure team is in championship (so UX feels "smart")
        if (selectedSlotIds.size && !memberships.has(teamId)) {
          const { error: addErr } = await supabase.from("championship_team").insert({
            championship_id: selectedChampionshipId,
            team_id: teamId,
          });
          if (addErr) {
            Alert.alert("Error", addErr.message);
            return;
          }
        }

        // Replace prefs for this team in this championship
        await supabase
          .from("championship_team_game_preference")
          .delete()
          .eq("championship_id", selectedChampionshipId)
          .eq("team_id", teamId);

        const selected = Array.from(selectedSlotIds.values());
        if (selected.length) {
          const rows = selected.map((slot) => ({
            championship_id: selectedChampionshipId,
            team_id: teamId,
            game_slot_id: slot,
          }));
          const { error: insErr } = await supabase.from("championship_team_game_preference").insert(rows);
          if (insErr) Alert.alert("Error", insErr.message);
        }
      }

      setModalOpen(false);
      resetForm();
      await loadTeams();
      await loadChampionshipRelations();
    } finally {
      setSaving(false);
    }
  }, [
    name,
    shortName,
    shirtColor,
    editing,
    selectedChampionshipId,
    selectedSlotIds,
    memberships,
    loadTeams,
    loadChampionshipRelations,
    resetForm,
  ]);

  const deleteTeam = useCallback(
    (row: Team) => {
      Alert.alert(
        "Eliminar equip?",
        "Si aquest equip té partits associats a qualsevol campionat, NO es podrà eliminar per no perdre dades.",
        [
          { text: "Cancel·lar", style: "cancel" },
          {
            text: "Eliminar",
            style: "destructive",
            onPress: async () => {
              setDeleting(row.id);
              try {
                // 1) If the team has any matches, don't delete it — mark it as historic.
                // We check a handful of common column names used across schemas.
                const orFilter = [
                  `team_a_id.eq.${row.id}`,
                  `team_b_id.eq.${row.id}`
                ].join(",");

                const { data: anyMatch, error: matchErr } = await supabase
                  .from("match")
                  .select("id")
                  .or(orFilter)
                  .limit(1);

                if (matchErr) {
                  // If your DB uses a different table name, this will tell you.
                  Alert.alert("Error", matchErr.message);
                  return;
                }

                const hasMatches = (anyMatch ?? []).length > 0;

                if (hasMatches) {
                  Alert.alert(
                    "No es pot eliminar",
                    "Aquest equip té partits associats en algun campionat. Per no perdre dades, no es pot eliminar."
                  );
                  return;
                }


                // 2) Safe to delete.
                const { error } = await supabase.from("team").delete().eq("id", row.id);
                if (error) {
                  Alert.alert("No s'ha pogut eliminar", error.message);
                  return;
                }
                await loadTeams();
                await loadChampionshipRelations();
              } finally {
                setDeleting(null);
              }
            },
          },
        ]
      );
    },
    [loadTeams, loadChampionshipRelations]
  );

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!allowed) return null;

  // Keep the "top menu" (back button + filters) inside the same scroll container
  // as the teams list, so on small Android screens everything scrolls together.
  const Hero = () => (
    <View
      style={{
        padding: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "#eee",
        backgroundColor: "#fafafa",
        marginBottom: 14,
      }}
    >
      <BackButton
          onPress={() => router.back()}
          style={{ marginBottom:15 }}
        />
      <Text style={{ fontWeight: "900", fontSize: 18 }}>Gestió d'equips</Text>
      <Text style={{ marginTop: 6, color: "#666", fontWeight: "600" }}>
        Mantén el catàleg d&apos;equips i afegeix/treu equips del campionat. Les preferències de pista són per campionat.
      </Text>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Pressable
          onPress={openCreate}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#d7f2df",
            backgroundColor: "#e6f7ed",
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "900" }}>＋ Nou equip</Text>
        </Pressable>

        <Pressable
          onPress={reloadAll}
          style={{
            width: 120,
            paddingVertical: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#ddd",
            backgroundColor: "white",
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "900" }}>↻ Refrescar</Text>
        </Pressable>
      </View>

      {/* Championship filter chips */}
      <View style={{ marginTop: 12 }}>
        <Text style={{ fontWeight: "800", color: "#666" }}>Campionat</Text>
        <Pressable
          onPress={() => setChampModalOpen(true)}
          style={{
            marginTop: 8,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#ddd",
            backgroundColor: "white",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontWeight: "800" }}>{champLabel}</Text>
          <Text style={{ color: "#666", fontWeight: "800" }}>▾</Text>
        </Pressable>

        <Modal visible={champModalOpen} animationType="slide" transparent>
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.35)",
              padding: 16,
              justifyContent: "center",
            }}
          >
            <View
              style={{
                backgroundColor: "white",
                borderRadius: 18,
                padding: 14,
                maxHeight: "80%",
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontWeight: "900", fontSize: 16 }}>Selecciona campionat</Text>
                <Pressable
                  onPress={() => {
                    setChampModalOpen(false);
                    setChampSearch("");
                  }}
                  style={{ paddingVertical: 6, paddingHorizontal: 10 }}
                >
                  <Text style={{ fontWeight: "900" }}>Tancar</Text>
                </Pressable>
              </View>

              <TextInput
                value={champSearch}
                onChangeText={setChampSearch}
                placeholder="Cerca..."
                autoCapitalize="none"
                style={{
                  marginTop: 10,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: Platform.OS === "ios" ? 12 : 10,
                }}
              />

              <FlatList
                style={{ marginTop: 10 }}
                data={filteredChampionships}
                keyExtractor={(c) => String(c.id)}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: c }) => {
                  const selected = selectedChampionshipId === c.id;
                  const label = `${c.name ?? "Campionat"}${c.year ? ` · ${c.year}` : ""}${c.is_active ? " · actiu" : ""}`;
                  return (
                    <Pressable
                      onPress={() => {
                        setSelectedChampionshipId(c.id);
                        setChampModalOpen(false);
                        setChampSearch("");
                      }}
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 10,
                        borderRadius: 12,
                        backgroundColor: selected ? "#eef6ff" : "transparent",
                      }}
                    >
                      <Text style={{ fontWeight: selected ? "900" : "800" }}>{label}</Text>
                    </Pressable>
                  );
                }}
              />
            </View>
          </View>
        </Modal>

        <Pressable
          onPress={() => setOnlyInChampionship((v) => !v)}
          style={{
            marginTop: 10,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#ddd",
            backgroundColor: "white",
            alignSelf: "flex-start",
          }}
        >
          <Text style={{ fontWeight: "900" }}>
            {onlyInChampionship ? "Mostrant: equips del campionat" : "Mostrant: tots els equips"}
          </Text>
        </Pressable>

        <Text style={{ marginTop: 10, color: "#888", fontWeight: "600" }}>Campionat seleccionat: {champLabel}</Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {loading ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          <Hero />
          <ActivityIndicator size="large" />
        </ScrollView>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          data={visibleTeams}
          keyExtractor={(it) => String(it.id)}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={Hero}
          ListEmptyComponent={() => (
            <View style={{ alignItems: "center", marginTop: 50 }}>
              <Text style={{ color: "#666", fontWeight: "800" }}>No hi ha equips per mostrar.</Text>
              <Text style={{ color: "#888", marginTop: 6 }}>
                {onlyInChampionship ? "Afegeix equips al campionat o canvia el filtre." : "Crea'n un amb “Nou equip”."}
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            const isIn = memberships.has(item.id);
            const slotIds = prefsByTeam.get(item.id) ?? [];
            const slotLabels = slotIds.map((id) => slotNameById.get(id) ?? `Slot ${id}`).join(" · ");

            return (
              <Pressable
                onPress={() => openEdit(item)}
                style={{
                  padding: 14,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#e6e6e6",
                  backgroundColor: "white",
                  marginBottom: 12,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Text style={{ fontWeight: "900", fontSize: 16, flex: 1 }} numberOfLines={2}>
                        {item.name ?? `Equip #${item.id}`}
                        {item.short_name ? ` · ${item.short_name}` : ""}
                      </Text>

                      <View
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: isIn ? "#d7f2df" : "#eee",
                          backgroundColor: isIn ? "#e6f7ed" : "#fafafa",
                        }}
                      >
                        <Text style={{ fontWeight: "900" }}>{isIn ? "AL CAMPIONAT" : "FORA"}</Text>
                      </View>
                    </View>

                    {item.shirt_color ? (
                      <Text style={{ marginTop: 6, color: "#666", fontWeight: "700" }}>
                        Color samarreta: {item.shirt_color}
                      </Text>
                    ) : null}

                    <Text style={{ marginTop: 6, color: "#888" }}>
                      Creat: {formatDateTime(item.created_at) || "—"}
                    </Text>

                    {isIn ? (
                      slotIds.length ? (
                        <Text style={{ marginTop: 8, color: "#666", fontWeight: "700" }} numberOfLines={2}>
                          Preferències ({champLabel}): {slotLabels}
                        </Text>
                      ) : (
                        <Text style={{ marginTop: 8, color: "#888", fontWeight: "700" }}>
                          Sense preferències per aquest campionat
                        </Text>
                      )
                    ) : (
                      <Text style={{ marginTop: 8, color: "#888", fontWeight: "700" }}>
                        Afegeix l&apos;equip al campionat per posar preferències
                      </Text>
                    )}
                  </View>

                  <View style={{ alignItems: "flex-end", gap: 10 }}>
                    <Pressable
                      onPress={() => toggleMembership(item.id)}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: isIn ? "#f3d0d0" : "#d7f2df",
                        backgroundColor: isIn ? "#ffecec" : "#e6f7ed",
                        height: 44,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontWeight: "900" }}>{isIn ? "— Treure" : "＋ Afegir"}</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => deleteTeam(item)}
                      disabled={deleting === item.id}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: "#f3d0d0",
                        backgroundColor: "#ffecec",
                        height: 44,
                        opacity: deleting === item.id ? 0.6 : 1,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontWeight: "900" }}>{deleting === item.id ? "…" : "🗑️"}</Text>
                    </Pressable>
                  </View>
                </View>

                <Text style={{ marginTop: 10, color: "#777", fontWeight: "700" }}>
                  Toca per editar (nom/curt/color + preferències per campionat)
                </Text>
              </Pressable>
            );
          }}
        />
      )}

      {/* Modal */}
      <Modal transparent visible={modalOpen} animationType={Platform.OS === "ios" ? "slide" : "fade"}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: "white", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#eee" }}>
            <Text style={{ fontWeight: "900", fontSize: 18 }}>{editing ? "Editar equip" : "Nou equip"}</Text>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 10, paddingBottom: 20 }}>
              <Text style={{ marginTop: 12, color: "#666", fontWeight: "800" }}>Nom</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Ex: Belit Girona"
                autoCapitalize="words"
                style={{
                  marginTop: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                }}
              />

              <Text style={{ marginTop: 12, color: "#666", fontWeight: "800" }}>Nom curt</Text>
              <TextInput
                value={shortName}
                onChangeText={setShortName}
                placeholder="Ex: GIR"
                autoCapitalize="characters"
                style={{
                  marginTop: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                }}
              />

              <Text style={{ marginTop: 12, color: "#666", fontWeight: "800" }}>Color samarreta</Text>
              <TextInput
                value={shirtColor}
                onChangeText={setShirtColor}
                placeholder="Ex: #FF0000 o vermell"
                autoCapitalize="none"
                style={{
                  marginTop: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                }}
              />

              {/* Preferences collapsible */}
              <View style={{ marginTop: 14 }}>
                <Pressable
                  onPress={() => setShowPrefs((s) => !s)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#ddd",
                    backgroundColor: "#fafafa",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ fontWeight: "900" }}>Preferències de pista</Text>
                    <Text style={{ marginTop: 4, color: "#666", fontWeight: "600" }} numberOfLines={1}>
                      {selectedSlotIds.size ? `${selectedSlotIds.size} seleccionades` : "Cap seleccionada"} · {champLabel}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: "900", fontSize: 16 }}>{showPrefs ? "▴" : "▾"}</Text>
                </Pressable>

                {showPrefs ? (
                  <View
                    style={{
                      marginTop: 10,
                      padding: 12,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: "#eee",
                      backgroundColor: "white",
                    }}
                  >
                    <Text style={{ color: "#666", fontWeight: "700" }}>
                      Aquestes preferències són per {champLabel}.
                    </Text>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                      {gameSlots.map((s) => {
                        const selected = selectedSlotIds.has(s.id);
                        return (
                          <Pressable
                            key={s.id}
                            onPress={() => toggleSlot(s.id)}
                            style={{
                              paddingVertical: 8,
                              paddingHorizontal: 12,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: selected ? "#000" : "#ddd",
                              marginRight: 8,
                              backgroundColor: "white",
                            }}
                          >
                            <Text style={{ fontWeight: "800" }}>{s.description ?? `Slot ${s.id}`}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    <Text style={{ marginTop: 10, color: "#888", fontWeight: "600" }}>
                      Si marques preferències i l&apos;equip encara no és al campionat, l&apos;afegirem automàticament.
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={{ marginTop: 12, color: "#888", fontWeight: "600" }}>
                Consell: també pots afegir/treure equips del campionat des de la llista principal.
              </Text>
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => {
                  setModalOpen(false);
                  resetForm();
                }}
                disabled={saving}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  alignItems: "center",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "900" }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={save}
                disabled={saving}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#d7f2df",
                  backgroundColor: "#e6f7ed",
                  alignItems: "center",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "900" }}>{saving ? "Desant…" : "Desar"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
