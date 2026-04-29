import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type NotificationType =
  | "match_started"
  | "match_finished"
  | "round_finished";

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await req.json();

    const {
  championship_id,
  team_ids,
  type,
  title,
  message,
  data,
  dedupeKey,
}: {
  championship_id: number;
  team_ids: number[];
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
} = body;

    if (!championship_id || !team_ids?.length || !type || !title || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (dedupeKey) {
  const { error: dedupeError } = await supabase
    .from("notification_events")
    .insert({
      dedupe_key: dedupeKey,
    });

  if (dedupeError) {
    // 23505 = duplicate key
    if (dedupeError.code === "23505") {
      return new Response(
        JSON.stringify({
          ok: true,
          duplicated: true,
          sent: 0,
          message: "Notification already sent",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: dedupeError.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

    const notificationColumn =
      type === "match_started"
        ? "match_started"
        : type === "match_finished"
        ? "match_finished"
        : "round_finished";

    const { data: preferences, error } = await supabase
      .from("notification_team_preferences")
      .select(`
        device_id,
        team_id,
        match_started,
        match_finished,
        round_finished,
        notification_devices!inner (
          expo_push_token,
          notifications_enabled
        )
      `)
      .eq("championship_id", championship_id)
      .in("team_id", team_ids)
      .eq(notificationColumn, true)
      .eq("notification_devices.notifications_enabled", true)
      .not("notification_devices.expo_push_token", "is", null);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
      });
    }

    const tokens = [
      ...new Set(
        (preferences ?? [])
          .map((pref: any) => pref.notification_devices?.expo_push_token)
          .filter(Boolean)
      ),
    ];

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          sent: 0,
          message: "No matching devices",
        }),
        { status: 200 }
      );
    }

    const pushMessages = tokens.map((token) => ({
      to: token,
      sound: "default",
      title,
      body: message,
      data: {
        type,
        championship_id,
        team_ids,
        ...(data ?? {}),
      },
    }));

    const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pushMessages),
    });

    const expoResult = await expoResponse.json();

    return new Response(
      JSON.stringify({
        ok: true,
        sent: tokens.length,
        expoResult,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (e) {
  console.log("EDGE FUNCTION ERROR:", e);

  return new Response(
    JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : null,
    }),
    {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }
  );
}
});