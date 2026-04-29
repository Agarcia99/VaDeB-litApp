import { useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { supabase } from "../src/supabase";
import { Stack, useRouter } from "expo-router";
import { BackButton } from "../components/HeaderButtons";
import { useAppTheme } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";

export default function Login() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t } = useLanguage();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      Alert.alert(t("common.error"), error.message);
      return;
    }

    const userId = data.user?.id;

    if (!userId) {
      setLoading(false);
      Alert.alert(t("common.error"), t("login.userValidationError"));
      return;
    }

    const { data: refereeUser, error: ruError } = await supabase
      .from("referee_user")
      .select("referee_id, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    setLoading(false);

    if (ruError) {
      await supabase.auth.signOut();
      Alert.alert(t("common.error"), t("login.accessCheckError"));
      return;
    }

    if (!refereeUser) {
      await supabase.auth.signOut();
      Alert.alert(t("login.accessDeniedTitle"), t("login.noRefereeLinked"));
      return;
    }

    if (!refereeUser.is_active) {
      await supabase.auth.signOut();
      Alert.alert(t("login.userDisabledTitle"), t("login.userDisabledMessage"));
      return;
    }

    router.replace("/matches");
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerTitle: "" }} />

      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <BackButton
          onPress={() => router.replace("/public-menu")}
          style={{ marginTop: 5 }}
        />
      </View>

      <View style={{ flex: 1, padding: 24 }}>
        <Text
          style={{
            fontSize: 28,
            fontWeight: "bold",
            marginBottom: 24,
            textAlign: "center",
            color: colors.text,
          }}
        >
          {t("login.title")}
        </Text>

        <Text style={{ color: colors.text }}>{t("login.email")}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder={t("login.emailPlaceholder")}
          placeholderTextColor={colors.muted}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
            backgroundColor: colors.card,
            color: colors.text,
          }}
        />

        <Text style={{ color: colors.text }}>{t("login.password")}</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder={t("login.passwordPlaceholder")}
          placeholderTextColor={colors.muted}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            padding: 12,
            marginBottom: 20,
            backgroundColor: colors.card,
            color: colors.text,
          }}
        />

        <Pressable
          onPress={handleLogin}
          style={{
            backgroundColor: colors.primary,
            padding: 14,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.primaryText, fontWeight: "bold" }}>
            {loading ? t("login.loading") : t("login.loginButton")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}