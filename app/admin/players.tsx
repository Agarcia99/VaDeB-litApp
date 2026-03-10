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
  Switch,
} from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, Stack } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../src/supabase";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";

type Championship = { id: number; name: string | null; year: number | null; is_active: boolean | null };
type Team = { id: number; name: string | null; short_name: string | null };
type Player = { id: number; name: string | null };

type TeamPlayer = {
  id: number;
  championship_id: number;
  team_id: number;
  player_id: number;
  player_number: number | null;
  is_captain: boolean | null;
};

export default function AdminPlayers() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [loading, setLoading] = useState(true);

  const [championships, setChampionships] = useState<Championship[]>([]);
  const [selectedChampionshipId, setSelectedChampionshipId] = useState<number | null>(null);
  const [champModalOpen, setChampModalOpen] = useState(false);
  const [champSearch, setChampSearch] = useState("");

  const filteredChampionships = useMemo(() => {
    const q = champSearch.trim().toLowerCase();
    if (!q) return championships;
    return championships.filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      const year = c.year ? String(c.year) : "";
      const loc = ((c as any).location ?? "").toString().toLowerCase();
      return name.includes(q) || year.includes(q) || loc.includes(q);
    });
  }, [championships, champSearch]);


  const [teams, setTeams] = useState<Team[]>([]);
  const [teamIdsInChamp, setTeamIdsInChamp] = useState<number[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  // team dropdown
  const [showTeamSection, setShowTeamSection] = useState(false);
  const [teamSearch, setTeamSearch] = useState("");

  const [players, setPlayers] = useState<Player[]>([]);
  const [rows, setRows] = useState<TeamPlayer[]>([]);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeamPlayer | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  // player selection + creation
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerId, setPlayerId] = useState<number | null>(null);

  const [showCreatePlayer, setShowCreatePlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");

  const [isCaptain, setIsCaptain] = useState(false);

  // auto-number (computed)
  const nextNumber = useMemo(() => {
    const nums = rows
      .map((r) => r.player_number)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const max = nums.length ? Math.max(...nums) : 0;
    return max + 1;
  }, [rows]);

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
    const [{ data: ch, error: chErr }, { data: t, error: tErr }, { data: p, error: pErr }] =
      await Promise.all([
        supabase
          .from("championship")
          .select("id,name,year,is_active")
          .order("is_active", { ascending: false })
          .order("year", { ascending: false })
          .order("id", { ascending: false }),
        supabase.from("team").select("id,name,short_name").order("name", { ascending: true }),
        supabase.from("player").select("id,name").order("name", { ascending: true }),
      ]);

    if (chErr) Alert.alert("Error", chErr.message);
    if (tErr) Alert.alert("Error", tErr.message);
    if (pErr) Alert.alert("Error", pErr.message);

    const chList = (ch ?? []) as Championship[];
    setChampionships(chList);
    setTeams((t ?? []) as Team[]);
    setPlayers((p ?? []) as Player[]);

    if (selectedChampionshipId == null) {
      const active = chList.find((x) => !!x.is_active);
      setSelectedChampionshipId(active?.id ?? (chList[0]?.id ?? null));
    }
  }, [selectedChampionshipId]);

  const loadTeamIdsForChampionship = useCallback(async () => {
    if (!selectedChampionshipId) {
      setTeamIdsInChamp([]);
      setSelectedTeamId(null);
      return;
    }

    const { data, error } = await supabase
      .from("championship_team")
      .select("team_id")
      .eq("championship_id", selectedChampionshipId);

    if (error) {
      Alert.alert("Error", error.message);
      setTeamIdsInChamp([]);
      setSelectedTeamId(null);
      return;
    }

    const ids = Array.from(
      new Set((data ?? []).map((r: any) => r.team_id).filter((x: any) => typeof x === "number"))
    ) as number[];

    setTeamIdsInChamp(ids);

    if (ids.length && (selectedTeamId == null || !ids.includes(selectedTeamId))) {
      setSelectedTeamId(ids[0]);
    }
    if (!ids.length) setSelectedTeamId(null);
  }, [selectedChampionshipId, selectedTeamId]);

  const loadRows = useCallback(async () => {
    if (!selectedChampionshipId || !selectedTeamId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("team_player")
      .select("id,championship_id,team_id,player_id,player_number,is_captain")
      .eq("championship_id", selectedChampionshipId)
      .eq("team_id", selectedTeamId)
      .order("is_captain", { ascending: false })
      .order("player_number", { ascending: true });

    if (error) {
      Alert.alert("Error", error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as TeamPlayer[]);
    setLoading(false);
  }, [selectedChampionshipId, selectedTeamId]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  useFocusEffect(
    useCallback(() => {
      checkAccess();
      loadLookups();
    }, [checkAccess, loadLookups])
  );

  useEffect(() => {
    loadTeamIdsForChampionship();
    setShowTeamSection(false);
    setTeamSearch("");
  }, [loadTeamIdsForChampionship]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!checking && !allowed) {
      Alert.alert("Accés denegat", "Aquesta secció és només per gestors.");
      router.back();
    }
  }, [checking, allowed, router]);

  const playerNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of players) m.set(p.id, p.name ?? `Jugador ${p.id}`);
    return m;
  }, [players]);

  const filteredPlayers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    // Collapse list when there's no search text
    if (!q) return [];
    return players.filter((p) => (p.name ?? "").toLowerCase().includes(q));
  }, [players, playerSearch]);

  const visibleTeams = useMemo(() => {
    const set = new Set(teamIdsInChamp);
    return teams.filter((t) => set.has(t.id));
  }, [teams, teamIdsInChamp]);

  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return visibleTeams;
    return visibleTeams.filter((t) =>
      ((t.name ?? "") + " " + (t.short_name ?? "")).toLowerCase().includes(q)
    );
  }, [visibleTeams, teamSearch]);

  const champLabel = useMemo(() => {
    const c = championships.find((x) => x.id === selectedChampionshipId);
    return c ? `${c.name ?? "Campionat"}${c.year ? ` · ${c.year}` : ""}` : "Campionat";
  }, [championships, selectedChampionshipId]);

  const teamLabel = useMemo(() => {
    const t = teams.find((x) => x.id === selectedTeamId);
    return t ? `${t.name ?? "Equip"}${t.short_name ? ` · ${t.short_name}` : ""}` : "Selecciona un equip";
  }, [teams, selectedTeamId]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setPlayerSearch("");
    setPlayerId(null);
    setIsCaptain(false);
    setShowCreatePlayer(false);
    setNewPlayerName("");
  }, []);

  const openCreate = useCallback(() => {
    if (!selectedChampionshipId || !selectedTeamId) {
      Alert.alert("Falta seleccionar", "Selecciona un campionat i un equip.");
      return;
    }
    resetForm();
    setModalOpen(true);
  }, [resetForm, selectedChampionshipId, selectedTeamId]);

  const openEdit = useCallback((row: TeamPlayer) => {
    setEditing(row);
    setPlayerId(row.player_id);
    setIsCaptain(!!row.is_captain);
    setPlayerSearch("");
    setShowCreatePlayer(false);
    setNewPlayerName("");
    setModalOpen(true);
  }, []);

  const createPlayer = useCallback(async () => {
    const nm = newPlayerName.trim();
    if (!nm) {
      Alert.alert("Falta el nom", "Escriu el nom del jugador.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.from("player").insert({ name: nm }).select("id,name").single();

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      const { data: p2, error: p2Err } = await supabase
        .from("player")
        .select("id,name")
        .order("name", { ascending: true });

      if (p2Err) {
        Alert.alert("Error", p2Err.message);
      } else {
        setPlayers((p2 ?? []) as Player[]);
      }

      setPlayerId(data.id);
      setShowCreatePlayer(false);
      setNewPlayerName("");
    } finally {
      setSaving(false);
    }
  }, [newPlayerName]);

  const ensurePlayerNotInOtherTeamSameChampionship = useCallback(async () => {
    if (!selectedChampionshipId || !selectedTeamId || !playerId) return null;

    const { data, error } = await supabase
      .from("team_player")
      .select("id,team_id")
      .eq("championship_id", selectedChampionshipId)
      .eq("player_id", playerId)
      .maybeSingle();

    if (error) return { kind: "error" as const, message: error.message };

    if (data && typeof (data as any).team_id === "number") {
      const existingTeamId = (data as any).team_id as number;
      const existingId = (data as any).id as number;
      if (!editing || editing.id !== existingId) {
        if (existingTeamId !== selectedTeamId) {
          return { kind: "conflict" as const, existingTeamId };
        }
      }
    }
    return null;
  }, [selectedChampionshipId, selectedTeamId, playerId, editing]);

  const save = useCallback(async () => {
    if (!selectedChampionshipId || !selectedTeamId) {
      Alert.alert("Falta seleccionar", "Selecciona un campionat i un equip.");
      return;
    }
    if (!playerId) {
      Alert.alert("Falta jugador", "Selecciona un jugador (o crea'n un de nou).");
      return;
    }

    const conflict = await ensurePlayerNotInOtherTeamSameChampionship();
    if (conflict?.kind === "error") {
      Alert.alert("Error", conflict.message);
      return;
    }
    if (conflict?.kind === "conflict") {
      const t = teams.find((x) => x.id === conflict.existingTeamId);
      Alert.alert(
        "Jugador ja assignat",
        `Aquest jugador ja està en un altre equip del mateix campionat (${t?.name ?? "equip"}).\n\nTreu-lo primer d'aquell equip si vols moure'l.`
      );
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("team_player")
          .update({
            player_id: playerId,
            is_captain: isCaptain,
          })
          .eq("id", editing.id);

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
      } else {
        const { error } = await supabase.from("team_player").insert({
          championship_id: selectedChampionshipId,
          team_id: selectedTeamId,
          player_id: playerId,
          player_number: nextNumber,
          is_captain: isCaptain,
        });

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
      }

      setModalOpen(false);
      resetForm();
      await loadRows();
    } finally {
      setSaving(false);
    }
  }, [
    selectedChampionshipId,
    selectedTeamId,
    playerId,
    isCaptain,
    editing,
    nextNumber,
    teams,
    ensurePlayerNotInOtherTeamSameChampionship,
    loadRows,
    resetForm,
  ]);

  const deleteRow = useCallback(
    (row: TeamPlayer) => {
      Alert.alert("Eliminar jugador de l'equip?", "Aquesta acció no es pot desfer.", [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            setDeleting(row.id);
            const { error } = await supabase.from("team_player").delete().eq("id", row.id);
            setDeleting(null);
            if (error) {
              Alert.alert(
              "No es pot treure el jugador",
              error.message || "Aquest jugador ja ha participat en el campionat (lineup/jugades) i no es pot eliminar."
            );
              return;
            }
            await loadRows();
          },
        },
      ]);
    },
    [loadRows]
  );

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!allowed) return null;

  
  const ListHeader = () => (
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
        <Text style={{ fontWeight: "900", fontSize: 18 }}>Jugadors per equip</Text>
        <Text style={{ marginTop: 6, color: "#666", fontWeight: "600" }}>
          Dorsal automàtic (següent número) i un jugador no pot estar en 2 equips del mateix campionat.
        </Text>

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
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontWeight: "900" }} numberOfLines={1}>
                {champLabel}
              </Text>
              <Text style={{ marginTop: 4, color: "#666", fontWeight: "600" }} numberOfLines={1}>
                Toca per canviar de campionat
              </Text>
            </View>
            <Text style={{ fontWeight: "900", fontSize: 16 }}>▾</Text>
          </Pressable>

          <Modal
            visible={champModalOpen}
            animationType="slide"
            transparent
            onRequestClose={() => {
              setChampModalOpen(false);
              setChampSearch("");
            }}
          >
            <Pressable
              onPress={() => {
                setChampModalOpen(false);
                setChampSearch("");
              }}
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", padding: 16, justifyContent: "center" }}
            >
              <Pressable
                onPress={() => null}
                style={{ backgroundColor: "white", borderRadius: 18, padding: 14, maxHeight: "80%" as any }}
              >
                <Text style={{ fontWeight: "900", fontSize: 16 }}>Selecciona campionat</Text>

                <TextInput
                  value={champSearch}
                  onChangeText={setChampSearch}
                  placeholder="Cercar campionat…"
                  autoCapitalize="none"
                  style={{
                    marginTop: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#ddd",
                    backgroundColor: "white",
                  }}
                />

                <FlatList
                  data={filteredChampionships}
                  keyExtractor={(it) => String(it.id)}
                  style={{ marginTop: 12 }}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => {
                    const selected = selectedChampionshipId === item.id;
                    const label = `${item.name ?? "Campionat"}${item.year ? ` · ${item.year}` : ""}${item.is_active ? " · actiu" : ""}`;
                    return (
                      <Pressable
                        onPress={() => {
                          setSelectedChampionshipId(item.id);
                          setChampModalOpen(false);
                          setChampSearch("");
                        }}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: selected ? "#000" : "#ddd",
                          backgroundColor: "white",
                          marginBottom: 8,
                        }}
                      >
                        <Text style={{ fontWeight: "800" }}>{label}</Text>
                      </Pressable>
                    );
                  }}
                  ListEmptyComponent={() => (
                    <View style={{ paddingVertical: 10, paddingHorizontal: 2 }}>
                      <Text style={{ color: "#666", fontWeight: "700" }}>No hi ha campionats.</Text>
                    </View>
                  )}
                />

                <Pressable
                  onPress={() => {
                    setChampModalOpen(false);
                    setChampSearch("");
                  }}
                  style={{
                    marginTop: 6,
                    paddingVertical: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#ddd",
                    backgroundColor: "#fff",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "900" }}>Tancar</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
        </View>

        <View style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: "800", color: "#666" }}>Equip</Text>

          <Pressable
            onPress={() => setShowTeamSection((s) => !s)}
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
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontWeight: "900" }} numberOfLines={1}>
                {teamLabel}
              </Text>
              <Text style={{ marginTop: 4, color: "#666", fontWeight: "600" }} numberOfLines={1}>
                {selectedTeamId ? "Toca per canviar d'equip" : "Selecciona un equip"}
              </Text>
            </View>
            <Text style={{ fontWeight: "900", fontSize: 16 }}>{showTeamSection ? "▴" : "▾"}</Text>
          </Pressable>

          {showTeamSection ? (
            <View
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#eee",
                backgroundColor: "#fafafa",
              }}
            >
              <TextInput
                value={teamSearch}
                onChangeText={setTeamSearch}
                placeholder="Cercar equip…"
                autoCapitalize="none"
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  backgroundColor: "white",
                }}
              />

              <ScrollView style={{ marginTop: 10, maxHeight: 220 }} showsVerticalScrollIndicator nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {filteredTeams.map((t) => {
                  const selected = selectedTeamId === t.id;
                  const label = `${t.name ?? "Equip"}${t.short_name ? ` · ${t.short_name}` : ""}`;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => {
                        setSelectedTeamId(t.id);
                        setShowTeamSection(false);
                        setTeamSearch("");
                      }}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: selected ? "#000" : "#ddd",
                        backgroundColor: "white",
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ fontWeight: "800" }}>{label}</Text>
                    </Pressable>
                  );
                })}

                {!filteredTeams.length ? (
                  <View style={{ paddingVertical: 10, paddingHorizontal: 2 }}>
                    <Text style={{ color: "#666", fontWeight: "700" }}>
                      No hi ha equips al campionat. Afegeix-los des de la pantalla d&apos;Equips.
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </View>

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
              opacity: selectedChampionshipId && selectedTeamId ? 1 : 0.6,
            }}
          >
            <Text style={{ fontWeight: "900" }}>＋ Afegir jugador</Text>
          </Pressable>

          <Pressable
            onPress={loadRows}
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

        <Text style={{ marginTop: 10, color: "#888", fontWeight: "600" }}>
          Següent dorsal automàtic: {nextNumber}
        </Text>
      </View>
  );

return (
    <View style={{ flex: 1, padding: 16 }}>
            <FlatList
                data={loading ? [] : rows}
                keyExtractor={(it) => String(it.id)}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                ListHeaderComponent={ListHeader}
                contentContainerStyle={{ paddingBottom: 24 }}
                ListFooterComponent={
                  loading ? <ActivityIndicator size="large" style={{ marginTop: 16 }} /> : null
                }

                ListEmptyComponent={() => (loading ? null : (
                  <View style={{ alignItems: "center", marginTop: 50 }}>
                    <Text style={{ color: "#666", fontWeight: "800" }}>Cap jugador assignat.</Text>
                    <Text style={{ color: "#888", marginTop: 6 }}>Afegeix-ne amb “Afegir jugador”.</Text>
                  </View>
                ))}
                renderItem={({ item }) => {
                  const nm = playerNameById.get(item.player_id) ?? `Jugador ${item.player_id}`;
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
                          <Text style={{ fontWeight: "900", fontSize: 16 }} numberOfLines={2}>
                            {item.is_captain ? "⭐ " : ""}
                            {nm}
                          </Text>
                          <Text style={{ marginTop: 6, color: "#666", fontWeight: "700" }}>
                            Dorsal: {item.player_number ?? "—"} · ID: {item.player_id}
                          </Text>
                        </View>

                        <Pressable
                          onPress={() => deleteRow(item)}
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

                      <Text style={{ marginTop: 10, color: "#777", fontWeight: "700" }}>Toca per editar</Text>
                    </Pressable>
                  );
                }}
              />

      <Modal transparent visible={modalOpen} animationType={Platform.OS === "ios" ? "slide" : "fade"}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 }}>
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: "#eee",
              height: Platform.OS === "android" ? ("85%" as any) : undefined,
              maxHeight: Platform.OS === "android" ? ("85%" as any) : ("90%" as any),
              alignSelf: "stretch",
            }}
          >
            <Text style={{ fontWeight: "900", fontSize: 18 }}>{editing ? "Editar jugador" : "Afegir jugador"}</Text>

            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingTop: 10, paddingBottom: 20 }}
            >
              {!editing ? (
                <View
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#eee",
                    backgroundColor: "#fafafa",
                  }}
                >
                  <Text style={{ fontWeight: "900" }}>Dorsal assignat automàticament</Text>
                  <Text style={{ marginTop: 6, color: "#666", fontWeight: "700" }}>
                    Aquest jugador rebrà el dorsal <Text style={{ fontWeight: "900" }}>{nextNumber}</Text>.
                  </Text>
                </View>
              ) : null}

              <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => setShowCreatePlayer((v) => !v)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: showCreatePlayer ? "#000" : "#ddd",
                    backgroundColor: "white",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "900" }}>{showCreatePlayer ? "Triar existent" : "＋ Nou jugador"}</Text>
                </Pressable>
              </View>

              {showCreatePlayer ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: "#666", fontWeight: "800" }}>Nom del jugador</Text>
                  <TextInput
                    value={newPlayerName}
                    onChangeText={setNewPlayerName}
                    placeholder="Ex: Arnau Garcia"
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
                  <Pressable
                    onPress={createPlayer}
                    disabled={saving}
                    style={{
                      marginTop: 10,
                      paddingVertical: 12,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: "#d7f2df",
                      backgroundColor: "#e6f7ed",
                      alignItems: "center",
                      opacity: saving ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ fontWeight: "900" }}>{saving ? "Creant…" : "Crear i seleccionar"}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: "#666", fontWeight: "800" }}>Jugador</Text>
                  <TextInput
                    value={playerSearch}
                    onChangeText={setPlayerSearch}
                    placeholder="Cercar jugador…"
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

                  <View style={{ marginTop: 10, borderWidth: 1, borderColor: "#eee", borderRadius: 14, padding: 10 }}>
                    {playerSearch.trim().length > 0 ? (
                      <ScrollView
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        style={{ maxHeight: 220 }}
                        showsVerticalScrollIndicator
                      >
                        {filteredPlayers.map((p) => {
                          const selected = playerId === p.id;
                          return (
                            <Pressable
                              key={p.id}
                              onPress={() => setPlayerId(p.id)}
                              style={{
                                paddingVertical: 10,
                                paddingHorizontal: 12,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: selected ? "#000" : "#ddd",
                                backgroundColor: "white",
                                marginBottom: 8,
                              }}
                            >
                              <Text style={{ fontWeight: "800" }}>{p.name ?? `Jugador ${p.id}`}</Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    ) : (
                      <Text style={{ paddingVertical: 8, color: "#888", fontWeight: "600" }}>
                        Escriu al cercador per veure jugadors.
                      </Text>
                    )}
                    <Text style={{ marginTop: 6, color: "#888", fontWeight: "600" }}>
                      Seleccionat: {playerId ? playerNameById.get(playerId) ?? `Jugador ${playerId}` : "—"}
                    </Text>
                  </View>
                </View>
              )}

              <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ fontWeight: "900" }}>Capità</Text>
                  <Text style={{ marginTop: 4, color: "#666", fontWeight: "600" }}>
                    Marca si aquest jugador és el capità de l&apos;equip.
                  </Text>
                </View>
                <Switch value={isCaptain} onValueChange={setIsCaptain} />
              </View>

              <Text style={{ marginTop: 12, color: "#888", fontWeight: "600" }}>
                Assignació: {champLabel} · {teamLabel}
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