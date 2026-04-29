import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../src/supabase";
import { BackButton } from "../../components/HeaderButtons";
import { Keyboard } from "react-native";
import { useAppTheme } from "../../src/theme";

type MatchTimeRow = {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  is_finished: boolean;
  team_a_id: number | null;
  team_b_id: number | null;
  team_a?: { name: string } | null;
  team_b?: { name: string } | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoToLocalParts(iso: string | null) {
  if (!iso) return { date: "", time: "" };

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };

  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

function buildUtcIsoFromLocalParts(date: string, time: string) {
  const cleanDate = date.trim();
  const cleanTime = time.trim();

  if (!cleanDate && !cleanTime) return null;
  if (!cleanDate || !cleanTime) {
    throw new Error("Has d'omplir tant la data com l'hora.");
  }

  const dateMatch = cleanDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = cleanTime.match(/^(\d{2}):(\d{2})$/);

  if (!dateMatch) throw new Error("La data ha de tenir format YYYY-MM-DD.");
  if (!timeMatch) throw new Error("L'hora ha de tenir format HH:mm.");

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (month < 1 || month > 12) throw new Error("Mes invàlid.");
  if (day < 1 || day > 31) throw new Error("Dia invàlid.");
  if (hour < 0 || hour > 23) throw new Error("Hora invàlida.");
  if (minute < 0 || minute > 59) throw new Error("Minuts invàlids.");

  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (Number.isNaN(localDate.getTime())) {
    throw new Error("Data/hora invàlida.");
  }

  if (
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day ||
    localDate.getHours() !== hour ||
    localDate.getMinutes() !== minute
  ) {
    throw new Error("Data/hora invàlida.");
  }

  return localDate.toISOString();
}

export default function EditMatchTimesScreenV2() {
  const router = useRouter();
  const { colors } = useAppTheme();

  const [matchIdInput, setMatchIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [matchRow, setMatchRow] = useState<MatchTimeRow | null>(null);

  const [startedDate, setStartedDate] = useState("");
  const [startedTime, setStartedTime] = useState("");
  const [finishedDate, setFinishedDate] = useState("");
  const [finishedTime, setFinishedTime] = useState("");
  const [reason, setReason] = useState("");

  const parsedMatchId = useMemo(() => Number(matchIdInput.trim()), [matchIdInput]);

  async function loadMatch() {
    Keyboard.dismiss();

    if (!Number.isFinite(parsedMatchId) || parsedMatchId <= 0) {
      Alert.alert("ID invàlid", "Introdueix un match_id vàlid.");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("match")
        .select(`
          id,
          started_at,
          finished_at,
          is_finished,
          team_a_id,
          team_b_id,
          team_a:team_a_id(name),
          team_b:team_b_id(name)
        `)
        .eq("id", parsedMatchId)
        .single();

      if (error) throw error;

      const raw = data as any;
      const row: MatchTimeRow = {
        id: raw.id,
        started_at: raw.started_at ?? null,
        finished_at: raw.finished_at ?? null,
        is_finished: !!raw.is_finished,
        team_a_id: raw.team_a_id ?? null,
        team_b_id: raw.team_b_id ?? null,
        team_a: Array.isArray(raw.team_a) ? raw.team_a[0] ?? null : raw.team_a ?? null,
        team_b: Array.isArray(raw.team_b) ? raw.team_b[0] ?? null : raw.team_b ?? null,
      };

      setMatchRow(row);

      const started = isoToLocalParts(row.started_at);
      const finished = isoToLocalParts(row.finished_at);

      setStartedDate(started.date);
      setStartedTime(started.time);
      setFinishedDate(finished.date);
      setFinishedTime(finished.time);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut carregar el partit.");
    } finally {
      setLoading(false);
    }
  }

  async function saveTimes() {
    if (!matchRow) return;

    let startedIso: string | null = null;
    let finishedIso: string | null = null;

    try {
      startedIso = buildUtcIsoFromLocalParts(startedDate, startedTime);
      finishedIso = buildUtcIsoFromLocalParts(finishedDate, finishedTime);
    } catch (e: any) {
      Alert.alert("Format invàlid", e?.message ?? "Revisa les dates i hores.");
      return;
    }

    if (startedIso && finishedIso) {
      const startedMs = new Date(startedIso).getTime();
      const finishedMs = new Date(finishedIso).getTime();

      if (finishedMs < startedMs) {
        Alert.alert("Ordre invàlid", "La data/hora de final no pot ser anterior a la d'inici.");
        return;
      }
    }

    Alert.alert(
      "Confirmació final",
      `Segur que vols actualitzar les hores del partit ${matchRow.id}?\n\nEs guardaran en UTC automàticament.`,
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Guardar",
          onPress: async () => {
            try {
              setSaving(true);

              const { error } = await supabase.rpc("admin_update_match_times", {
                p_match_id: matchRow.id,
                p_started_at: startedIso,
                p_finished_at: finishedIso,
                p_reason: reason.trim() || null,
              });

              if (error) throw error;

              Alert.alert("Fet ✅", "Hores del partit actualitzades correctament.");
              await loadMatch();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'han pogut actualitzar les hores.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
        <BackButton onPress={() => router.back()} />
      </View>

      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 6, color: colors.text }}>
        🕒 Canviar hores partit
      </Text>
      <Text style={{ color: colors.muted, fontWeight: "700", marginBottom: 16 }}>
        Entra data i hora en local. La pantalla les guardarà en UTC automàticament.
      </Text>

      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 14,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: 14,
        }}
      >
        <Text style={{ fontWeight: "800", marginBottom: 8, color: colors.text }}>ID del partit</Text>
        <TextInput
          value={matchIdInput}
          onChangeText={setMatchIdInput}
          keyboardType="number-pad"
          placeholder="Ex: 123"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 12,
            color: colors.text,
          }}
        />

        <Pressable
          onPress={loadMatch}
          disabled={loading}
          style={{
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: colors.primary,
            alignItems: "center",
            opacity: loading ? 0.45 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={{ color: colors.primaryText, fontWeight: "900" }}>Carregar partit</Text>
          )}
        </Pressable>
      </View>

      {matchRow ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 14,
            padding: 14,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontWeight: "900", fontSize: 16, color: colors.text }}>
            {matchRow.team_a?.name ?? `Equip ${matchRow.team_a_id}`} vs {matchRow.team_b?.name ?? `Equip ${matchRow.team_b_id}`}
          </Text>
          <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "700" }}>
            Estat: {matchRow.is_finished ? "Finalitzat" : "Obert"}
          </Text>

          <Text style={{ fontWeight: "900", marginTop: 16, marginBottom: 10, color: colors.text }}>Hora inici</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", marginBottom: 6, color: colors.text }}>Data</Text>
              <TextInput
                value={startedDate}
                onChangeText={setStartedDate}
                placeholder="2026-04-12"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginBottom: 12,
                  color: colors.text,
                }}
                />
            </View>

            <View style={{ width: 120 }}>
              <Text style={{ fontWeight: "800", marginBottom: 6, color: colors.text }}>Hora</Text>
              <TextInput
                value={finishedTime}
                onChangeText={setStartedTime}
                placeholder="09:35"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginBottom: 12,
                  color: colors.text,
                }}
              />
            </View>
          </View>

          <Text style={{ fontWeight: "900", marginBottom: 10, color: colors.text }}>Hora fi</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", marginBottom: 6, color: colors.text }}>Data</Text>
              <TextInput
                value={finishedDate}
                onChangeText={setFinishedDate}
                placeholder="2026-04-12"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginBottom: 12,
                  color: colors.text,
                }}
              />
            </View>

            <View style={{ width: 120 }}>
              <Text style={{ fontWeight: "800", marginBottom: 6, color: colors.text }}>Hora</Text>
              <TextInput
                value={finishedTime}
                onChangeText={setFinishedTime}
                placeholder="10:48"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginBottom: 12,
                  color: colors.text,
                }}
              />
            </View>
          </View>

          <Text style={{ fontWeight: "800", marginBottom: 8, color: colors.text }}>Motiu (opcional)</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Ex: correcció hora inici real"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              marginBottom: 12,
              color: colors.text,
            }}
          />

          <Pressable
            onPress={saveTimes}
            disabled={saving}
            style={{
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: colors.primary,
              alignItems: "center",
              opacity: saving ? 0.45 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={{ color: colors.primaryText, fontWeight: "900" }}>Guardar hores</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
