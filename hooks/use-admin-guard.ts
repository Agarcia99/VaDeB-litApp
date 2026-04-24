import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../src/supabase";

/**
 * Validates that the current user is a championship admin.
 * - Redirects to /login if there is no active session.
 * - Shows an alert and calls router.back() if the user is not an admin.
 *
 * Returns { checking, isAdmin, recheck }.
 * Use `recheck` inside useFocusEffect to re-validate on every screen focus.
 */
export function useAdminGuard() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const check = useCallback(async () => {
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
      setIsAdmin(false);
    } else {
      setIsAdmin(!!data);
    }

    setChecking(false);
  }, [router]);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    if (!checking && !isAdmin) {
      Alert.alert("Accés denegat", "Aquesta secció és només per gestors del campionat.");
      router.back();
    }
  }, [checking, isAdmin, router]);

  return { checking, isAdmin, recheck: check };
}
