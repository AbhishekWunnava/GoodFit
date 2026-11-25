// Supabase Edge Function: refreshes the jobs table from company careers feeds.
//
// Called once a day by pg_cron (supabase-jobs-schedule.sql). Two kinds of sources:
//  1. job_sources: for every active company it downloads the public Greenhouse / Lever / Ashby feed,
//     keeps the jobs based in India and saves them.
//  2. job_searches: for every active search (e.g. "product manager" in "Pune") it asks the Adzuna job
//     search engine for the newest matching jobs in India, from any employer. Needs the ADZUNA_APP_ID and
//     ADZUNA_APP_KEY secrets; without them this part is skipped. Employers we already read directly are skipped.
// Jobs that stop appearing get closed_at set, so the Matches page stops showing them.
//
// Security: this function writes with the service role, so it only runs when the request carries
// the x-fetch-secret header matching the FETCH_JOBS_SECRET secret. Deploy it with "Verify JWT" OFF
// (the cron job has no user login); the secret check replaces it.
//
// Optional request body: { "company": "Razorpay" } refreshes one company only (and skips the searches);
// { "searchesOnly": true } runs only the searches.
// Response: { ok, results: [{ company, count, closed, error }], searches: [{ search, count, closed, error }] }

import { createClient } from "npm:@supabase/supabase-js@2";
import { FEEDS, normalize, adzunaUrl, fromAdzuna, sameCompany } from "./normalize.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Source = { company: string; ats: "greenhouse" | "lever" | "ashby"; board: string; industry: string; company_size: string };

async function fetchFeed(src: Source) {
  const res = await fetch(FEEDS[src.ats](src.board), {
    headers: { Accept: "application/json", "User-Agent": "GoodFit job refresher" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${src.ats} feed answered ${res.status}`);
  return normalize(src, await res.json());
}

// GoodFit job shape -> jobs table row.
const toRow = (j: Record<string, any>, seenAt: string, searchId: number | null = null) => ({
  id: j.id, company: j.company, industry: j.industry, company_size: j.companySize, title: j.title,
  location: j.location, cities: j.cities, work_mode: j.workMode, job_type: j.jobType, department: j.department,
  posted_at: j.postedAt, url: j.url, exp_min: j.expMin, exp_max: j.expMax, description: j.description,
  source: j.source || "feed", search_id: searchId, salary_min: j.salaryMin ?? null, salary_max: j.salaryMax ?? null,
  last_seen_at: seenAt, closed_at: null,
});

type Search = { id: number; what: string; where: string; max_pages: number; max_days_old: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upsertRows(db: any, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("jobs").upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

// Runs every active search against Adzuna, one page at a time (politely, one request after another).
async function runSearches(db: any, companies: string[]) {
  const appId = Deno.env.get("ADZUNA_APP_ID"), appKey = Deno.env.get("ADZUNA_APP_KEY");
  const { data: searches, error } = await db.from("job_searches")
    .select("id, what, where, max_pages, max_days_old").eq("active", true).eq("provider", "adzuna").order("id");
  if (error) return [{ search: "job_searches", count: 0, closed: 0, error: error.message }];
  const seen = new Set<string>();
  const out = [];
  for (const s of searches as Search[]) {
    const label = `${s.what}${s.where ? " in " + s.where : ""}`;
    const runAt = new Date().toISOString();
    try {
      if (!appId || !appKey) throw new Error("ADZUNA_APP_ID / ADZUNA_APP_KEY secrets are not set.");
      const rows = [];
      for (let page = 1; page <= s.max_pages; page++) {
        const res = await fetch(adzunaUrl(s, page, appId, appKey), { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`Adzuna answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json();
        const results = data.results || [];
        for (const r of results) {
          const job = fromAdzuna(r);
          if (!job || seen.has(job.id) || companies.some((c) => sameCompany(c, job.company))) continue;
          seen.add(job.id);
          rows.push(toRow(job, runAt, s.id));
        }
        if (results.length < 50) break;
        await sleep(400);
      }
      await upsertRows(db, rows);
      const { data: closed, error: closeErr } = await db.from("jobs").update({ closed_at: runAt })
        .eq("search_id", s.id).is("closed_at", null).lt("last_seen_at", runAt).select("id");
      if (closeErr) throw new Error(closeErr.message);
      await db.from("job_searches").update({ last_fetched_at: runAt, last_count: rows.length, last_error: null }).eq("id", s.id);
      out.push({ search: label, count: rows.length, closed: closed?.length ?? 0, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("job_searches").update({ last_error: msg.slice(0, 500) }).eq("id", s.id);
      out.push({ search: label, count: 0, closed: 0, error: msg });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("FETCH_JOBS_SECRET");
  if (!secret) return json({ error: "FETCH_JOBS_SECRET is not set for this function." }, 500);
  if (req.headers.get("x-fetch-secret") !== secret) return json({ error: "Not allowed." }, 401);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!,
    { auth: { persistSession: false } },
  );
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const only = body.company || null;

  let q = db.from("job_sources").select("company, ats, board, industry, company_size").eq("active", true);
  if (only) q = q.eq("company", only);
  if (body.searchesOnly) q = q.eq("company", "__none__"); // no companies
  const { data: sources, error } = await q;
  if (error) return json({ error: error.message }, 500);

  // Feeds are fetched in parallel; each company succeeds or fails on its own.
  const results = await Promise.all((sources as Source[]).map(async (src) => {
    const runAt = new Date().toISOString();
    try {
      const jobs = await fetchFeed(src);
      const rows = jobs.map((j) => toRow(j, runAt));
      await upsertRows(db, rows);
      // Anything from this company not in today's feed has closed.
      const { data: closed, error: closeErr } = await db.from("jobs")
        .update({ closed_at: runAt })
        .eq("company", src.company).eq("source", "feed").is("closed_at", null).lt("last_seen_at", runAt)
        .select("id");
      if (closeErr) throw new Error(closeErr.message);
      await db.from("job_sources").update({ last_fetched_at: runAt, last_count: rows.length, last_error: null }).eq("company", src.company);
      return { company: src.company, count: rows.length, closed: closed?.length ?? 0, error: null };
    } catch (e) {
      // Keep the company's existing jobs open when its feed fails; just record why.
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("job_sources").update({ last_error: msg.slice(0, 500) }).eq("company", src.company);
      return { company: src.company, count: 0, closed: 0, error: msg };
    }
  }));

  // Then the job-search engine, skipping employers we already read directly.
  let searches: { error: string | null }[] = [];
  if (!only) {
    const { data: all } = await db.from("job_sources").select("company");
    searches = await runSearches(db, (all || []).map((r: { company: string }) => r.company));
  }

  return json({ ok: [...results, ...searches].every((r) => !r.error), results, searches });
});
