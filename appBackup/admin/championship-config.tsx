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
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../src/supabase";
import { BackButton } from "../../components/HeaderButtons";

type Championship = {
  id: number;
  name: string | null;
  year: number | null;
  is_active: boolean | null;
};

type Phase = {
  id: number;
  code: string | null;
  name: string | null;
  sort_order: number | null;
  description: string | null;
};

type ConfigRow = {
  id: number;
  championship_id: number | null;
  phase_id: number | null;
  key: string | null;
  value: any;
  created_at: string | null;
  updated_at: string | null;
};

type ChampionshipPickerProps = {
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  options: Championship[];
  includeAll?: boolean;
  allLabel?: string;
};

type PhasePickerProps = {
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  options: Phase[];
  includeNone?: boolean;
  noneLabel?: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}
function safeJsonStringify(v: any) {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function ChampionshipPicker({
  label,
  value,
  onChange,
  options,
  includeAll,
  allLabel,
}: ChampionshipPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = useMemo(() => options.find((c) => c.id === value) ?? null, [options, value]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((c) => {
      const a = (c.name ?? "").toLowerCase();
      const b = String(c.year ?? "").toLowerCase();
      return a.includes(q) || b.includes(q);
    });
  }, [options, search]);

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontWeight: "800", color: includeAll ? "#666" : "#111" }}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          marginTop: 8,
          paddingVertical: 12,
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
        <Text style={{ fontWeight: "800", color: value == null ? "#888" : "#111" }} numberOfLines={1}>
          {value == null
            ? includeAll
              ? allLabel ?? "Tots"
              : "Selecciona…"
            : `${selected?.name ?? "Campionat"}${selected?.year ? ` · ${selected.year}` : ""}`}
        </Text>
        <Text style={{ fontWeight: "900", fontSize: 16 }}>▾</Text>
      </Pressable>

      <Modal transparent visible={open} animationType={Platform.OS === "ios" ? "slide" : "fade"}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: "white", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#eee" }}>
            <Text style={{ fontWeight: "900", fontSize: 18 }}>{label}</Text>

            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Cercar…"
              autoCapitalize="none"
              style={{
                marginTop: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#ddd",
              }}
            />

            <ScrollView style={{ marginTop: 12, maxHeight: 360 }} showsVerticalScrollIndicator>
              {includeAll ? (
                <Pressable
                  onPress={() => {
                    onChange(null);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: value == null ? "#000" : "#ddd",
                    backgroundColor: "white",
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ fontWeight: "900" }}>{allLabel ?? "Tots"}</Text>
                </Pressable>
              ) : null}

              {filtered.map((c) => {
                const isSelected = value === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      onChange(c.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: isSelected ? "#000" : "#ddd",
                      backgroundColor: "white",
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "900" }} numberOfLines={1}>
                      {c.name} {c.year ? `· ${c.year}` : ""}
                    </Text>
                    {c.is_active ? (
                      <Text style={{ marginTop: 4, color: "#1a7f37", fontWeight: "800" }}>Actiu</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => {
                setOpen(false);
                setSearch("");
              }}
              style={{
                marginTop: 12,
                paddingVertical: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#ddd",
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "900" }}>Tancar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}


function PhasePicker({ label, value, onChange, options, includeNone, noneLabel }: PhasePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = useMemo(() => options.find((p) => p.id === value) ?? null, [options, value]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((p) => {
      const a = (p.code ?? "").toLowerCase();
      const b = (p.name ?? "").toLowerCase();
      const c = (p.description ?? "").toLowerCase();
      return a.includes(q) || b.includes(q) || c.includes(q);
    });
  }, [options, search]);

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontWeight: "800", color: "#111" }}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          marginTop: 8,
          paddingVertical: 12,
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
        <Text style={{ fontWeight: "800", color: value == null ? "#888" : "#111" }} numberOfLines={1}>
          {value == null
            ? includeNone
              ? noneLabel ?? "— Sense fase —"
              : "Selecciona…"
            : `${selected?.code ?? ""}${selected?.name ? ` — ${selected.name}` : ""}`}
        </Text>
        <Text style={{ fontWeight: "900", fontSize: 16 }}>▾</Text>
      </Pressable>

      <Modal transparent visible={open} animationType={Platform.OS === "ios" ? "slide" : "fade"}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: "white", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#eee" }}>
            <Text style={{ fontWeight: "900", fontSize: 18 }}>{label}</Text>

            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Cercar…"
              autoCapitalize="none"
              style={{
                marginTop: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#ddd",
              }}
            />

            <ScrollView style={{ marginTop: 12, maxHeight: 360 }} showsVerticalScrollIndicator>
              {includeNone ? (
                <Pressable
                  onPress={() => {
                    onChange(null);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: value == null ? "#000" : "#ddd",
                    backgroundColor: "white",
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ fontWeight: "900" }}>{noneLabel ?? "— Sense fase —"}</Text>
                </Pressable>
              ) : null}

              {filtered.map((p) => {
                const isSelected = value === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      onChange(p.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: isSelected ? "#000" : "#ddd",
                      backgroundColor: "white",
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "900" }} numberOfLines={1}>
                      {p.code} {p.name ? `— ${p.name}` : ""}
                    </Text>
                    {p.description ? (
                      <Text style={{ marginTop: 4, color: "#666", fontWeight: "700" }} numberOfLines={2}>
                        {p.description}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => {
                setOpen(false);
                setSearch("");
              }}
              style={{
                marginTop: 12,
                paddingVertical: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#ddd",
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "900" }}>Tancar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}


export default function AdminChampionshipConfig() {
  const router = useRouter();

  // access
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  // lookups
  const [championships, setChampionships] = useState<Championship[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);

  // data
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ConfigRow[]>([]);

  // ui
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConfigRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // filters
  const [filterChampionshipId, setFilterChampionshipId] = useState<number | null>(null);

  // form
  const [championshipId, setChampionshipId] = useState<number | null>(null);
  const [phaseId, setPhaseId] = useState<number | null>(null);
  const [cfgKey, setCfgKey] = useState("");
  const [valueText, setValueText] = useState("{}");

  // duplicate form (from an existing config)
  const [dupOpen, setDupOpen] = useState(false);
  const [pendingDupOpen, setPendingDupOpen] = useState(false);
  const [dupChampionshipId, setDupChampionshipId] = useState<number | null>(null);
  const [dupPhaseId, setDupPhaseId] = useState<number | null>(null);
  const [dupKey, setDupKey] = useState("");

  // collapsible phase section
  const [showPhaseSection, setShowPhaseSection] = useState(false);
  const [phaseSearch, setPhaseSearch] = useState("");

  const resetForm = useCallback(() => {
    setEditing(null);
    setChampionshipId(null);
    setPhaseId(null);
    setCfgKey("");
    setValueText("{}");
    setShowPhaseSection(false);
    setPhaseSearch("");
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    if (championships.length === 1) setChampionshipId(championships[0].id);
    setModalOpen(true);
  }, [resetForm, championships]);

  const openEdit = useCallback((row: ConfigRow) => {
    setEditing(row);
    setChampionshipId(row.championship_id);
    setPhaseId(row.phase_id);
    setCfgKey(row.key ?? "");
    setValueText(safeJsonStringify(row.value));
    setShowPhaseSection(false);
    setPhaseSearch("");
    setModalOpen(true);
  }, []);

  const openDuplicate = useCallback(() => {
    if (!editing) return;

    // IMPORTANT: Avoid having two RN <Modal/> open at the same time.
    // On some devices this can cause the UI to freeze/hang.
    setDupChampionshipId(null);
    setDupPhaseId(editing.phase_id ?? null);
    setDupKey(editing.key ?? "");

    // Close the edit modal first. We open the duplicate modal only after the edit modal is fully closed
    // to avoid having two RN <Modal/> open at the same time (which can freeze on some devices).
    setPendingDupOpen(true);
    setModalOpen(false);
  }, [editing]);

  useEffect(() => {
    if (!modalOpen && pendingDupOpen) {
      setPendingDupOpen(false);
      setDupOpen(true);
    }
  }, [modalOpen, pendingDupOpen]);

  const checkAccess = useCallback(async () => {
    setChecking(true);
    const { data: sessionRes } = await supabase.auth.getSession();
    const user = sessionRes.session?.user;
    if (!user) {
      router.replace("/login");
      return;
    }
    const { data } = await supabase
      .from("championship_admin_user")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    setAllowed(!!data);
    setChecking(false);
  }, [router]);

  const loadLookups = useCallback(async () => {
    const [{ data: ch, error: chErr }, { data: ph, error: phErr }] = await Promise.all([
      supabase
        .from("championship")
        .select("id,name,year,is_active")
        .order("is_active", { ascending: false })
        .order("year", { ascending: false }),
      supabase.from("phase").select("id,code,name,sort_order,description").order("sort_order", { ascending: true }),
    ]);

    if (chErr) Alert.alert("Error", chErr.message);
    if (phErr) Alert.alert("Error", phErr.message);

    setChampionships((ch ?? []) as Championship[]);
    setPhases((ph ?? []) as Phase[]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("championship_config")
      .select("id,championship_id,phase_id,key,value,created_at,updated_at")
      .order("updated_at", { ascending: false });

    if (filterChampionshipId) q = q.eq("championship_id", filterChampionshipId);

    const { data, error } = await q;
    if (error) {
      Alert.alert("Error", error.message);
      setItems([]);
      setLoading(false);
      return;
    }
    setItems((data ?? []) as ConfigRow[]);
    setLoading(false);
  }, [filterChampionshipId]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  useFocusEffect(
    useCallback(() => {
      checkAccess();
      loadLookups();
      load();
    }, [checkAccess, loadLookups, load])
  );

  useEffect(() => {
    if (!checking && !allowed) {
      Alert.alert("Accés denegat", "Aquesta secció és només per gestors.");
      router.back();
    }
  }, [checking, allowed, router]);

  const validate = useCallback(() => {
    if (!championshipId) return "Selecciona un campionat.";
    if (!cfgKey.trim()) return "Falta la clau (key).";
    try {
      JSON.parse(valueText || "{}");
    } catch {
      return "El value ha de ser un JSON vàlid.";
    }
    return null;
  }, [championshipId, cfgKey, valueText]);

  const validateDup = useCallback(() => {
    if (!editing) return "No hi ha cap configuració per duplicar.";
    if (!dupChampionshipId) return "Selecciona el campionat de destí.";
    if (!dupKey.trim()) return "Falta la clau (key) de la còpia.";
    if (
      dupChampionshipId === editing.championship_id &&
      dupPhaseId === (editing.phase_id ?? null) &&
      dupKey.trim() === (editing.key ?? "").trim()
    ) {
      return "No té sentit duplicar al mateix campionat, fase i clau.";
    }
    return null;
  }, [editing, dupChampionshipId, dupPhaseId, dupKey]);

  const save = useCallback(async () => {
    const err = validate();
    if (err) {
      Alert.alert("Revisa el formulari", err);
      return;
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(valueText || "{}");
    } catch {}

    setSaving(true);
    try {
      // prevent duplicates: same championship + same key
      const normalizedKey = cfgKey.trim();
      let existsQuery = supabase
        .from("championship_config")
        .select("id")
        .eq("championship_id", championshipId)
        .eq("key", normalizedKey);
      existsQuery = phaseId == null ? existsQuery.is("phase_id", null) : existsQuery.eq("phase_id", phaseId);
      const { data: exists, error: existsErr } = await existsQuery.limit(1);
      if (existsErr) {
        Alert.alert("Error", existsErr.message);
        return;
      }
      const foundId = (exists ?? [])[0]?.id as number | undefined;
      if (foundId && (!editing || foundId !== editing.id)) {
        Alert.alert(
          "Duplicat",
          "Ja existeix una configuració amb aquesta clau per aquest campionat i fase. Canvia la key, la fase o edita la existent."
        );
        return;
      }

      if (editing) {
        const { error } = await supabase
          .from("championship_config")
          .update({
            championship_id: championshipId,
            phase_id: phaseId,
            key: normalizedKey,
            value: parsed,
          })
          .eq("id", editing.id);
        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
      } else {
        const { error } = await supabase.from("championship_config").insert({
          championship_id: championshipId,
          phase_id: phaseId,
          key: normalizedKey,
          value: parsed,
        });
        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
      }
      setModalOpen(false);
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }, [validate, championshipId, phaseId, cfgKey, valueText, editing, load, resetForm]);

  const doDuplicate = useCallback(async () => {
    const err = validateDup();
    if (err) {
      Alert.alert("Revisa", err);
      return;
    }
    if (!editing) return;

    const keyToUse = dupKey.trim();
    setDuplicating(true);
    try {
      // prevent duplicates in target: same championship + same key
      let existsQuery = supabase
        .from("championship_config")
        .select("id")
        .eq("championship_id", dupChampionshipId)
        .eq("key", keyToUse);
      existsQuery = dupPhaseId == null ? existsQuery.is("phase_id", null) : existsQuery.eq("phase_id", dupPhaseId);
      const { data: exists, error: existsErr } = await existsQuery.limit(1);
      if (existsErr) {
        Alert.alert("Error", existsErr.message);
        return;
      }
      if ((exists ?? []).length > 0) {
        Alert.alert(
          "Duplicat",
          "Ja existeix una configuració amb aquesta clau al campionat i fase de destí. Tria una altra key, canvia la fase o edita la existent."
        );
        return;
      }

      const { error } = await supabase.from("championship_config").insert({
        championship_id: dupChampionshipId,
        phase_id: dupPhaseId,
        key: keyToUse,
        value: editing.value ?? {},
      });
      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      setDupOpen(false);
      setPendingDupOpen(false);
      setDupChampionshipId(null);
      setDupPhaseId(null);
      setDupKey("");
      await load();
      Alert.alert("Fet", "Configuració duplicada.");
    } finally {
      setDuplicating(false);
    }
  }, [validateDup, editing, dupChampionshipId, dupPhaseId, dupKey, load]);

  const selectedPhase = useMemo(
    () => phases.find((p) => p.id === phaseId) ?? null,
    [phases, phaseId]
  );

  const filteredPhases = useMemo(() => {
    const q = phaseSearch.trim().toLowerCase();
    if (!q) return phases;
    return phases.filter((p) => {
      const a = (p.code ?? "").toLowerCase();
      const b = (p.name ?? "").toLowerCase();
      const c = (p.description ?? "").toLowerCase();
      return a.includes(q) || b.includes(q) || c.includes(q);
    });
  }, [phases, phaseSearch]);

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!allowed) return null;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={loading ? [] : items}
        keyExtractor={(it) => String(it.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        ListHeaderComponent={
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
            <BackButton onPress={() => router.back()} style={{ marginBottom: 15 }} />
            <View style={{ flexDirection: "row", gap: 10 }}>
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
                <Text style={{ fontWeight: "900" }}>＋ Nova configuració</Text>
              </Pressable>

              <Pressable
                onPress={load}
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

            <ChampionshipPicker
              label="Filtrar per campionat"
              value={filterChampionshipId}
              onChange={setFilterChampionshipId}
              options={championships}
              includeAll
              allLabel="Tots"
            />
          </View>
        }
        ListEmptyComponent={loading ? <ActivityIndicator size="large" /> : null}
        renderItem={({ item }) => {
          const champ = championships.find((c) => c.id === item.championship_id);
          const phase = phases.find((p) => p.id === item.phase_id);
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
              <Text style={{ fontWeight: "900", fontSize: 16 }} numberOfLines={2}>
                {item.key} · {champ?.name ?? "Campionat"} {champ?.year ? `(${champ.year})` : ""}
              </Text>

              {phase ? (
                <Text style={{ marginTop: 6, color: "#666", fontWeight: "700" }} numberOfLines={2}>
                  Fase: {phase.code} — {phase.name}
                </Text>
              ) : (
                <Text style={{ marginTop: 6, color: "#888", fontWeight: "700" }} numberOfLines={1}>
                  Sense fase
                </Text>
              )}

              <Text style={{ marginTop: 6, color: "#888" }}>{formatDateTime(item.updated_at || item.created_at)}</Text>

              <Text
                style={{
                  marginTop: 8,
                  fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
                }}
                numberOfLines={6}
              >
                {safeJsonStringify(item.value)}
              </Text>
            </Pressable>
          );
        }}
      />

      {/* modal */}
      <Modal transparent visible={modalOpen} animationType={Platform.OS === "ios" ? "slide" : "fade"}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 }}>
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: "#eee",
              height: "80%",
            }}
          >
            <Text style={{ fontWeight: "900", fontSize: 18 }}>
              {editing ? "Editar configuració" : "Nova configuració"}
            </Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingTop: 10, paddingBottom: 20 }}
            >
              {/* Championship selector */}
              <ChampionshipPicker
                label="Campionat"
                value={championshipId}
                onChange={setChampionshipId}
                options={championships}
              />

              {/* Phase section (collapsible) */}
              <View style={{ marginTop: 14 }}>
                <Pressable
                  onPress={() => setShowPhaseSection((s) => !s)}
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
                    <Text style={{ fontWeight: "900" }}>Fase (opcional)</Text>
                    <Text style={{ marginTop: 4, color: "#666", fontWeight: "600" }} numberOfLines={1}>
                      {selectedPhase ? `${selectedPhase.code} — ${selectedPhase.name}` : "— Sense fase —"}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: "900", fontSize: 16 }}>{showPhaseSection ? "▴" : "▾"}</Text>
                </Pressable>

                {showPhaseSection ? (
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
                    <TextInput
                      value={phaseSearch}
                      onChangeText={setPhaseSearch}
                      placeholder="Cercar fase…"
                      autoCapitalize="none"
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: "#ddd",
                      }}
                    />

                    <Pressable
                      onPress={() => setPhaseId(null)}
                      style={{
                        marginTop: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: phaseId == null ? "#000" : "#ddd",
                        backgroundColor: "white",
                      }}
                    >
                      <Text style={{ fontWeight: "800" }}>— Sense fase —</Text>
                    </Pressable>

                    <ScrollView
                      style={{ marginTop: 10, maxHeight: 220 }}
                      showsVerticalScrollIndicator={true}
                    >
                      {filteredPhases.map((p) => {
                        const selected = phaseId === p.id;
                        return (
                          <Pressable
                            key={p.id}
                            onPress={() => setPhaseId(p.id)}
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
                            <Text style={{ fontWeight: "800" }}>
                              {p.code} — {p.name}
                            </Text>
                            {p.description ? (
                              <Text style={{ marginTop: 4, color: "#666", fontWeight: "600" }} numberOfLines={2}>
                                {p.description}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}
              </View>

              {/* Key */}
              <Text style={{ marginTop: 14, fontWeight: "800" }}>Key</Text>
              <TextInput
                value={cfgKey}
                onChangeText={setCfgKey}
                placeholder='Ex: "max_time_per_play"'
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

              {/* Value */}
              <Text style={{ marginTop: 12, fontWeight: "800" }}>Value (JSON)</Text>
              <TextInput
                value={valueText}
                onChangeText={setValueText}
                placeholder='Ex: { "seconds": 30 }'
                autoCapitalize="none"
                multiline
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  minHeight: 160,
                  textAlignVertical: "top",
                  fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
                }}
              />

              <Text style={{ marginTop: 10, color: "#888", fontWeight: "600" }}>
                Tip: enganxa un JSON i el validarem abans de desar.
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

              {editing ? (
                <Pressable
                  onPress={openDuplicate}
                  disabled={saving}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#dbeafe",
                    backgroundColor: "#eff6ff",
                    alignItems: "center",
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontWeight: "900" }}>Duplicar</Text>
                </Pressable>
              ) : null}

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

      {/* duplicate modal */}
      <Modal transparent visible={dupOpen} animationType={Platform.OS === "ios" ? "slide" : "fade"}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: "white", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#eee" }}>
            <Text style={{ fontWeight: "900", fontSize: 18 }}>Duplicar configuració</Text>
            <Text style={{ marginTop: 6, color: "#666", fontWeight: "700" }}>
              Copia aquesta configuració a un altre campionat. No eliminem configuracions des d’aquí.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 10, paddingBottom: 10 }}>
              <ChampionshipPicker
                label="Campionat de destí"
                value={dupChampionshipId}
                onChange={setDupChampionshipId}
                options={championships}
              />

              <PhasePicker
                label="Fase de destí"
                value={dupPhaseId}
                onChange={setDupPhaseId}
                options={phases}
                includeNone
                noneLabel="— Sense fase —"
              />

              <Text style={{ marginTop: 14, fontWeight: "800" }}>Key (de la còpia)</Text>
              <TextInput
                value={dupKey}
                onChangeText={setDupKey}
                autoCapitalize="none"
                placeholder='Ex: "max_time_per_play"'
                style={{
                  marginTop: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                }}
              />

              <Text style={{ marginTop: 10, color: "#888", fontWeight: "600" }}>
                Important: si ja existeix aquesta key al campionat de destí, no et deixarà duplicar.
              </Text>
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable
                onPress={() => {
                  setDupOpen(false);
      setPendingDupOpen(false);
                  setDupChampionshipId(null);
                  setDupPhaseId(null);
                  setDupKey("");
                }}
                disabled={duplicating}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  alignItems: "center",
                  opacity: duplicating ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "900" }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={doDuplicate}
                disabled={duplicating}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#d7f2df",
                  backgroundColor: "#e6f7ed",
                  alignItems: "center",
                  opacity: duplicating ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "900" }}>{duplicating ? "Duplicant…" : "Duplicar"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
