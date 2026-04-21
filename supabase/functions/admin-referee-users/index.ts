import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function normalizeEmail(email: string) {
  return String(email ?? "").trim().toLowerCase();
}

async function listAllAuthUsers(supabaseAdmin: ReturnType<typeof createClient>) {
  const users: any[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const batch = data?.users ?? [];
    users.push(...batch);

    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

async function requireAdmin(req: Request, supabaseAdmin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    throw new Error("Falta la sessió d'usuari.");
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    throw new Error("No s'ha pogut validar la sessió.");
  }

  const userId = userData.user.id;

  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from("championship_admin_user")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminError) throw adminError;
  if (!adminRow) throw new Error("Accés denegat.");

  return { userId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    await requireAdmin(req, supabaseAdmin);

    const body = await req.json();
    const action = String(body?.action ?? "");

    if (!action) {
      return json({ error: "Falta action" }, 400);
    }

    if (action === "list") {
      const [{ data: referees, error: refErr }, { data: links, error: linkErr }, { data: matches, error: matchErr }] =
        await Promise.all([
          supabaseAdmin.from("referee").select("id,name,created_at").order("id", { ascending: true }),
          supabaseAdmin.from("referee_user").select("user_id,referee_id,is_active,created_at"),
          supabaseAdmin.from("match").select("referee_id"),
        ]);

      if (refErr) throw refErr;
      if (linkErr) throw linkErr;
      if (matchErr) throw matchErr;

      const authUsers = await listAllAuthUsers(supabaseAdmin);
      const authById = new Map(authUsers.map((u: any) => [u.id, u]));

      const matchCountByRef = new Map<number, number>();
      for (const m of matches ?? []) {
        const refereeId = Number((m as any).referee_id);
        if (!Number.isFinite(refereeId)) continue;
        matchCountByRef.set(refereeId, (matchCountByRef.get(refereeId) ?? 0) + 1);
      }

      const linkByRef = new Map<number, any>();
      for (const link of links ?? []) {
        linkByRef.set(Number((link as any).referee_id), link);
      }

      const rows = ((referees as any[]) ?? []).map((r) => {
        const link = linkByRef.get(Number(r.id)) ?? null;
        const authUser = link?.user_id ? authById.get(link.user_id) : null;

        return {
          referee_id: r.id,
          referee_name: r.name,
          referee_created_at: r.created_at ?? null,
          assigned_matches: matchCountByRef.get(Number(r.id)) ?? 0,
          is_protected: r.id === 1 || r.id === 2,
          has_user: !!link,
          user_id: link?.user_id ?? null,
          is_active: link?.is_active ?? false,
          link_created_at: link?.created_at ?? null,
          email: authUser?.email ?? null,
          user_created_at: authUser?.created_at ?? null,
          last_sign_in_at: authUser?.last_sign_in_at ?? null,
        };
      });

      return json({ success: true, rows });
    }

    if (action === "create") {
      const email = normalizeEmail(body?.email ?? "");
      const password = String(body?.password ?? "");
      const refereeId = Number(body?.referee_id);

      if (!email || !password || !Number.isFinite(refereeId) || refereeId <= 0) {
        return json({ error: "Falten dades per crear l'usuari" }, 400);
      }

      const { data: refereeRow, error: refereeErr } = await supabaseAdmin
        .from("referee")
        .select("id,name")
        .eq("id", refereeId)
        .maybeSingle();

      if (refereeErr) throw refereeErr;
      if (!refereeRow) return json({ error: "L'àrbitre no existeix" }, 400);

      const { data: existingLink, error: existingLinkErr } = await supabaseAdmin
        .from("referee_user")
        .select("user_id")
        .eq("referee_id", refereeId)
        .maybeSingle();

      if (existingLinkErr) throw existingLinkErr;
      if (existingLink) return json({ error: "Aquest àrbitre ja té usuari assignat" }, 400);

      const authUsers = await listAllAuthUsers(supabaseAdmin);
      const existingEmail = authUsers.find((u: any) => normalizeEmail(u.email ?? "") == email);
      if (existingEmail) {
        return json({ error: "Ja existeix un usuari amb aquest correu" }, 400);
      }

      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (userError) throw userError;

      const newUserId = userData.user.id;

      const { error: insertErr } = await supabaseAdmin
        .from("referee_user")
        .insert({
          user_id: newUserId,
          referee_id: refereeId,
          is_active: true,
        });

      if (insertErr) {
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        throw insertErr;
      }

      return json({
        success: true,
        user_id: newUserId,
        email,
        referee_id: refereeId,
      });
    }

    if (action === "set_active") {
      const refereeId = Number(body?.referee_id);
      const isActive = !!body?.is_active;

      if (!Number.isFinite(refereeId) || refereeId <= 0) {
        return json({ error: "referee_id invàlid" }, 400);
      }

      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("referee_user")
        .select("user_id")
        .eq("referee_id", refereeId)
        .maybeSingle();

      if (existingErr) throw existingErr;
      if (!existing) return json({ error: "Aquest àrbitre no té usuari vinculat" }, 400);

      const { error: updateErr } = await supabaseAdmin
        .from("referee_user")
        .update({ is_active: isActive })
        .eq("referee_id", refereeId);

      if (updateErr) throw updateErr;

      return json({ success: true });
    }

    if (action === "reset_password") {
      const refereeId = Number(body?.referee_id);
      const newPassword = String(body?.new_password ?? "").trim();

      if (!Number.isFinite(refereeId) || refereeId <= 0) {
        return json({ error: "referee_id invàlid" }, 400);
      }

      if (newPassword.length < 6) {
        return json({ error: "La nova contrasenya ha de tenir almenys 6 caràcters" }, 400);
      }

      const { data: link, error: linkErr } = await supabaseAdmin
        .from("referee_user")
        .select("user_id")
        .eq("referee_id", refereeId)
        .maybeSingle();

      if (linkErr) throw linkErr;
      if (!link?.user_id) return json({ error: "Aquest àrbitre no té usuari vinculat" }, 400);

      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(link.user_id, {
        password: newPassword,
      });

      if (updateErr) throw updateErr;

      return json({ success: true });
    }

    if (action === "reassign") {
      const fromRefereeId = Number(body?.from_referee_id);
      const toRefereeId = Number(body?.to_referee_id);

      if (![fromRefereeId, toRefereeId].every((n) => Number.isFinite(n) && n > 0)) {
        return json({ error: "IDs d'àrbitre invàlids" }, 400);
      }

      if (fromRefereeId === toRefereeId) {
        return json({ error: "L'usuari ja està assignat a aquest àrbitre" }, 400);
      }

      const { data: fromLink, error: fromErr } = await supabaseAdmin
        .from("referee_user")
        .select("user_id")
        .eq("referee_id", fromRefereeId)
        .maybeSingle();

      if (fromErr) throw fromErr;
      if (!fromLink?.user_id) return json({ error: "L'àrbitre origen no té usuari vinculat" }, 400);

      const { data: toLink, error: toErr } = await supabaseAdmin
        .from("referee_user")
        .select("user_id")
        .eq("referee_id", toRefereeId)
        .maybeSingle();

      if (toErr) throw toErr;
      if (toLink?.user_id) return json({ error: "L'àrbitre destí ja té usuari" }, 400);

      const { error: updateErr } = await supabaseAdmin
        .from("referee_user")
        .update({ referee_id: toRefereeId })
        .eq("referee_id", fromRefereeId);

      if (updateErr) throw updateErr;

      return json({ success: true });
    }

    return json({ error: "Acció no suportada" }, 400);
  } catch (e: any) {
    console.log("EDGE ERROR", e);

    return json(
      {
        error: e?.message ?? String(e) ?? "Error intern",
      },
      500,
    );
  }
});
