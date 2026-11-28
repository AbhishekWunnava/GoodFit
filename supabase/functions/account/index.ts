// Supabase Edge Function: account deletion and the 12-month retention rule (see privacy.html).
//
//   POST {"action":"delete"}       with the person's login token (Authorization: Bearer ...)
//        Deletes their resume files, profile, resume records, email and assistant logs, then the login itself.
//   POST {"action":"retention"}    with header x-fetch-secret (same secret as fetch-jobs), run daily by pg_cron
//        Deletes every account not signed in for 12 months (as above), and log rows older than 12 months.
//        Add "dry_run": true to see what would be deleted without deleting anything.
//
// Deploy with "Verify JWT" OFF: the daily job has no login. Each action checks its own credential instead.

import { createClient } from "npm:@supabase/supabase-js@2";

const MONTHS = 12;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-fetch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!, { auth: { persistSession: false } });

// Tables holding a person's rows. A table that doesn't exist yet (its SQL file not run) is skipped.
const USER_TABLES = ["agent_usage", "report_log", "resumes", "profiles"];
const LOG_TABLES: [string, string][] = [["report_log", "sent_at"], ["agent_usage", "created_at"]];
const missing = (msg = "") => /does not exist|schema cache|Could not find the table/i.test(msg);

async function deleteUserData(userId: string) {
  // 1. Resume files (in the private "resumes" bucket, under a folder named after the user).
  const { data: files, error: listErr } = await admin.storage.from("resumes").list(userId, { limit: 1000 });
  if (listErr) throw new Error(`listing resume files: ${listErr.message}`);
  if (files && files.length) {
    const { error } = await admin.storage.from("resumes").remove(files.map((f) => `${userId}/${f.name}`));
    if (error) throw new Error(`removing resume files: ${error.message}`);
  }
  // 2. Rows in GoodFit's tables.
  for (const t of USER_TABLES) {
    const { error } = await admin.from(t).delete().eq("user_id", userId);
    if (error && !missing(error.message)) throw new Error(`deleting from ${t}: ${error.message}`);
  }
  // 3. The login itself.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleting the login: ${error.message}`);
}

async function retention(dryRun: boolean) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS);
  const result = { cutoff: cutoff.toISOString(), dry_run: dryRun, accounts: 0, failed: [] as string[], logs: {} as Record<string, number> };

  // Inactive accounts: last sign-in (or sign-up, if they never signed in) before the cutoff.
  const stale: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing accounts: ${error.message}`);
    for (const u of data.users) {
      const last = Date.parse(u.last_sign_in_at || u.created_at);
      if (last < cutoff.getTime()) stale.push(u.id);
    }
    if (data.users.length < 1000) break;
  }
  result.accounts = stale.length;
  if (!dryRun) {
    for (const id of stale) {
      try { await deleteUserData(id); } catch (e) { result.failed.push(`${id.slice(0, 8)}…: ${e instanceof Error ? e.message : e}`); }
    }
  }

  // Old log rows.
  for (const [table, col] of LOG_TABLES) {
    const q = admin.from(table).select("id", { count: "exact", head: true }).lt(col, cutoff.toISOString());
    const { count, error } = await q;
    if (error) { if (!missing(error.message)) result.failed.push(`${table}: ${error.message}`); continue; }
    result.logs[table] = count ?? 0;
    if (!dryRun && count) {
      const { error: delErr } = await admin.from(table).delete().lt(col, cutoff.toISOString());
      if (delErr) result.failed.push(`${table}: ${delErr.message}`);
    }
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const body = await req.json().catch(() => ({}));

  if (body.action === "delete") {
    const asUser = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data } = await asUser.auth.getUser();
    if (!data?.user) return json({ error: "Please log in again." }, 401);
    try {
      await deleteUserData(data.user.id);
      return json({ ok: true });
    } catch (e) {
      console.error("account delete failed:", e);
      return json({ error: "Your account couldn't be deleted. Please try again, or email hello@goodfitjobsonly.com." }, 500);
    }
  }

  if (body.action === "retention") {
    const secret = Deno.env.get("FETCH_JOBS_SECRET");
    if (!secret || req.headers.get("x-fetch-secret") !== secret) return json({ error: "Not allowed." }, 401);
    try {
      const result = await retention(!!body.dry_run);
      return json({ ok: !result.failed.length, ...result });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  return json({ error: "Unknown action." }, 400);
});
