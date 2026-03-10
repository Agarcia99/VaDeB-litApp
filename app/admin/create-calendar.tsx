import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../src/supabase";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";

type ChampionshipRow = {
  id: number;
  name: string;
  year: number;
  is_active: boolean;
};

type CalendarConfig = {
  times: string[]; // ["09:00", ...]
  fields: string[]; // ["A", "B", ...]
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  excluded_dates?: string[]; // ["YYYY-MM-DD", ...]
};

function parseCalendarValue(value: any): CalendarConfig | null {
  try {
    if (!value) return null;
    if (typeof value === "string") return JSON.parse(value) as CalendarConfig;
    return value as CalendarConfig;
  } catch {
    return null;
  }
}

function formatChamp(c: ChampionshipRow) {
  return `${c.year} · ${c.name}${c.is_active ? " (actiu)" : ""}`;
}

function dateRangeInclusive(start: string, end: string): string[] {
  // start/end are YYYY-MM-DD
  const res: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);

  // Use UTC to avoid DST issues for date stepping
  let cur = new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0));
  const last = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0));

  while (cur.getTime() <= last.getTime()) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    res.push(`${y}-${m}-${d}`);
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return res;
}

export default function CreateCalendarScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [championships, setChampionships] = useState<ChampionshipRow[]>([]);
  const [selectedChampionshipId, setSelectedChampionshipId] = useState<number | null>(null);

  const [champModalOpen, setChampModalOpen] = useState(false);
  const [champSearch, setChampSearch] = useState("");

  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Admin gate (same as other admin screens)
      const { data: sessionRes } = await supabase.auth.getSession();
      const user = sessionRes.session?.user;
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: adminRow, error: adminErr } = await supabase
        .from("championship_admin_user")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminErr || !adminRow) {
        Alert.alert("Accés denegat", "Aquesta secció és només per administradors.");
        router.back();
        return;
      }

      const { data: champs, error } = await supabase
        .from("championship")
        .select("id,name,year,is_active")
        .order("is_active", { ascending: false })
        .order("year", { ascending: false })
        .order("name", { ascending: true });

      if (error) {
        Alert.alert("Error", error.message);
        setChampionships([]);
        setSelectedChampionshipId(null);
      } else {
        const list = (champs ?? []) as ChampionshipRow[];
        setChampionships(list);
        const active = list.find((c) => c.is_active);
        setSelectedChampionshipId(active?.id ?? list[0]?.id ?? null);
      }

      setLoading(false);
    })();
  }, []);

  const selectedChamp = useMemo(
    () => championships.find((c) => c.id === selectedChampionshipId) ?? null,
    [championships, selectedChampionshipId]
  );

  const filteredChampionships = useMemo(() => {
    const q = champSearch.trim().toLowerCase();
    if (!q) return championships;
    return championships.filter((c) => formatChamp(c).toLowerCase().includes(q));
  }, [championships, champSearch]);

  const createSlots = async () => {
    if (!selectedChampionshipId) {
      Alert.alert("Falta campionat", "Selecciona un campionat.");
      return;
    }

    setCreating(true);
    try {
      // 1) Ensure no existing slots
      const { data: existing, error: existErr } = await supabase
        .from("match_slot")
        .select("id")
        .eq("championship_id", selectedChampionshipId)
        .limit(1);

      if (existErr) throw existErr;
      if (existing && existing.length > 0) {
        Alert.alert("Ja existeix calendari", "Aquest campionat ja té slots creats. No es duplicarà.");
        return;
      }

      // 2) Load calendar config
      const { data: cfgRow, error: cfgErr } = await supabase
        .from("championship_config")
        .select("value")
        .eq("championship_id", selectedChampionshipId)
        .eq("key", "calendar")
        .maybeSingle();

      if (cfgErr) throw cfgErr;
      const cfg = parseCalendarValue(cfgRow?.value);
      if (!cfg) {
        Alert.alert("Config falta", 'No hi ha configuració "calendar" per aquest campionat.');
        return;
      }

      const { times, fields, start_date, end_date } = cfg;

      if (!times?.length || !fields?.length || !start_date || !end_date) {
        Alert.alert("Config incompleta", 'La key "calendar" ha de tenir times, fields, start_date i end_date.');
        return;
      }
      // 3) game_slot_id by day/time (Sat/Sun mapping)

      // 4) Build slot rows
      const days = dateRangeInclusive(start_date, end_date);

      const pickGameSlotId = (day: string, time: string): number => {
        // JS getDay(): 0=Sun, 6=Sat
        const dow = new Date(`${day}T00:00:00`).getDay();
        const hour = Number(String(time).split(":")[0] ?? "0");
        const isMorning = hour < 14;

        if (dow === 6) return isMorning ? 1 : 2; // Saturday
        if (dow === 0) return isMorning ? 3 : 4; // Sunday

        // Fallback for weekdays (if ever used)
        return isMorning ? 1 : 2;
      };

      const rows = [];
      for (const day of days) {
        // Create slots only on Saturday (6) and Sunday (0)
        const dow = new Date(`${day}T00:00:00`).getDay();
        if (dow !== 6 && dow !== 0) continue;

        for (const time of times) {
          for (const field of fields) {
            // Starts_at in local time (admin device). Stored as timestamptz.
            const startsAt = new Date(`${day}T${time}:00`);
            const day_code = dow === 6 ? "sat" : "sun";
            const time_code = time;
            const field_code = field;
            const preference_key = `${day_code}_${time_code}_${field_code}`;

            rows.push({
              championship_id: selectedChampionshipId,
              starts_at: startsAt.toISOString(),
              field_code,
              day_code,
              time_code,
              preference_key,
              is_used: false,
              game_slot_id: pickGameSlotId(day, time),
            });
          }
        }
      }

      if (rows.length === 0) {
        Alert.alert("Res a crear", "Amb la configuració actual no hi ha cap slot a crear.");
        return;
      }

      // 5) Insert in batches
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error: insErr } = await supabase.from("match_slot").insert(batch);
        if (insErr) throw insErr;
      }

      Alert.alert("Calendari creat", `S'han creat ${rows.length} slots per ${selectedChamp?.name ?? "el campionat"}.`);
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error inesperat creant el calendari.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <Text style={{ textAlign: "center" }}>Carregant…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      {/* Header with back (like the rest of admin) */}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <BackButton
          onPress={() => router.back()}
          style={{ marginBottom:15 }}
        />
        <Text style={{ fontSize: 22, fontWeight: "800", flex: 1, textAlign: "center", marginRight: 32 }}>
          🗓️ Crear calendari
        </Text>
</View>
      {/* Championship dropdown */}
      <Pressable
        onPress={() => setChampModalOpen(true)}
        style={{
          borderWidth: 1,
          borderColor: "#ddd",
          backgroundColor: "white",
          borderRadius: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          marginBottom: 12,
        }}
      >
        <Text style={{ fontWeight: "700" }}>{selectedChamp ? formatChamp(selectedChamp) : "Selecciona campionat"}</Text>
        <Text style={{ color: "#666", marginTop: 2 }}>Toca per canviar</Text>
      </Pressable>

      <View
        style={{
          padding: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#eee",
          backgroundColor: "#fafafa",
          marginBottom: 16,
        }}
      >
        <Text style={{ fontWeight: "800", marginBottom: 6 }}>Què farà</Text>
        <Text style={{ color: "#333", lineHeight: 20 }}>
          Crearà els slots a <Text style={{ fontWeight: "700" }}>match_slot</Text> segons la configuració{" "}
          <Text style={{ fontWeight: "700" }}>championship_config</Text> amb key{" "}
          <Text style={{ fontWeight: "700" }}>"calendar"</Text>. Si ja existeixen slots, no duplicarà.
        </Text>
      </View>

      <Pressable
        onPress={createSlots}
        disabled={creating}
        style={{
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: 12,
          backgroundColor: creating ? "#ddd" : "#111827",
        }}
      >
        <Text style={{ color: "white", fontWeight: "800", textAlign: "center" }}>
          {creating ? "Creant…" : "Crear slots del campionat"}
        </Text>
      </Pressable>

      {/* Championship modal */}
      <Modal visible={champModalOpen} transparent animationType="fade" onRequestClose={() => setChampModalOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={() => setChampModalOpen(false)}>
          <Pressable
            onPress={() => {}}
            style={{
              marginTop: 80,
              marginHorizontal: 16,
              backgroundColor: "white",
              borderRadius: 16,
              padding: 14,
              maxHeight: "75%",
            }}
          >
            <Text style={{ fontWeight: "900", fontSize: 16, marginBottom: 10 }}>Selecciona campionat</Text>

            <TextInput
              value={champSearch}
              onChangeText={setChampSearch}
              placeholder="Cerca..."
              autoCapitalize="none"
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 10,
              }}
            />

            <FlatList
              data={filteredChampionships}
              keyExtractor={(item) => String(item.id)}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setSelectedChampionshipId(item.id);
                    setChampModalOpen(false);
                    setChampSearch("");
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: item.id === selectedChampionshipId ? "#111827" : "#eee",
                    backgroundColor: item.id === selectedChampionshipId ? "#f3f4f6" : "white",
                  }}
                >
                  <Text style={{ fontWeight: "800" }}>{formatChamp(item)}</Text>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
