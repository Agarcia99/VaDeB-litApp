import { supabase } from "../supabase";

export type PushNotificationType =
  | "match_started"
  | "match_finished"
  | "round_finished";

type SendPushNotificationParams = {
  championshipId: number | null | undefined;
  teamIds: Array<number | null | undefined>;
  type: PushNotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
};

export async function sendPushNotification({
  championshipId,
  teamIds,
  type,
  title,
  message,
  data,
  dedupeKey,
}: SendPushNotificationParams) {
  const cleanTeamIds = teamIds
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id));

  if (!championshipId || cleanTeamIds.length === 0) {
    console.log("Push skipped: missing championshipId/teamIds", {
      championshipId,
      teamIds,
      type,
    });
    return;
  }

  const { data: result, error } = await supabase.functions.invoke(
    "send-push-notification",
    {
      body: {
        championship_id: championshipId,
        team_ids: cleanTeamIds,
        type,
        title,
        message,
        data,
        dedupe_key: dedupeKey,
      },
    }
  );

  if (error) {
    console.log("Push function error:", error.message);
    return;
  }

  console.log("Push sent:", result);
}