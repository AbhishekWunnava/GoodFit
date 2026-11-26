// Sends GoodFit's daily / weekly match emails. Run by .github/workflows/match-emails.yml every morning.
//
// It loads the same scoring files the website uses (roles.js, signals.js, matching.js, jobs-data.js,
// report.js), reads profiles and open jobs from Supabase, and emails each person whose report is due
// (Preferences -> "Email me my new matches") through Resend. Each send is logged in report_log.
//
// Environment:
//   SUPABASE_URL               your project URL (same as config.js)
//   SUPABASE_SERVICE_ROLE_KEY  service role / secret key (reads every profile; never put it in config.js)
//   RESEND_API_KEY             from resend.com
//   REPORT_FROM                sender, e.g. "GoodFit <onboarding@resend.dev>" (default) or an address on your verified domain
//   SITE_URL                   where GoodFit is hosted, for links in the email
//   DRY_RUN=1                  build everything and print a summary, but send nothing and log nothing
//   FORCE=1                    ignore the schedule (send to everyone who has emails on); handy for a test run
//   ONLY_EMAIL=you@x.com       limit the run to one person
// Self-test without any keys: node scripts/send-reports.mjs --self-test
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;

// Load the browser scripts into this process, exactly as a page would.
globalThis.window = globalThis;
for (const f of ["roles.js", "signals.js", "matching.js", "jobs-data.js", "report.js"]) {
  vm.runInThisContext(readFileSync(join(ROOT, f), "utf8"), { filename: f });
}
const { Matcher, Report, JobsData } = globalThis;

// ---------- Self-test: builds a report from jobs.json and a sample profile ----------
if (process.argv.includes("--self-test")) {
  const snap = JSON.parse(readFileSync(join(ROOT, "jobs.json"), "utf8"));
  const jobs = Matcher.prepare(snap.jobs);
  const details = { name: "Test User", currentRole: "Senior Product Manager", years: 7, seniority: "Senior", skills: ["SQL", "APIs"],
    background: { archetype: "pm", pmYears: 5, models: ["B2B"], verticals: ["Fintech"], subVerticals: ["Fintech: Payments"], companyModels: ["Product"] } };
  const prefs = { roles: ["Product Manager"], jobTypes: ["Full-time"], locations: ["Bengaluru"], report: "weekly" };
  const now = new Date(snap.updatedAt + "T12:00:00Z");
  const r = Report.build({ jobs, details, prefs, frequency: "weekly", now, since: new Date(now - 30 * 864e5), siteUrl: "https://example.com/goodfit" });
  const checks = [
    ["subject", !!r.subject], ["html has jobs", r.picks.length > 0 && r.html.includes(r.picks[0].job.title.replace(/&/g, "&amp;"))],
    ["text has link", r.text.includes("https://example.com/goodfit/jobs.html")], ["scores 50+", r.picks.every((p) => p.score >= 50)],
    ["product roles only", r.picks.every((p) => Matcher.isProductRole(p.job))],
    ["due: weekly on Monday", Report.due("weekly", null, new Date("2026-11-30T03:00:00Z")) === true],
    ["due: weekly not on Tuesday", Report.due("weekly", null, new Date("2026-12-01T03:00:00Z")) === false],
    ["due: daily after a day", Report.due("daily", "2026-11-29T02:30:00Z", new Date("2026-11-30T02:30:00Z")) === true],
    ["due: off", Report.due("off", null, new Date()) === false],
  ];
  writeFileSync(join(ROOT, "report-self-test.html"), r.html);
  console.log(`Subject: ${r.subject}\n${r.text.split("\n").slice(0, 12).join("\n")}\n`);
  checks.forEach(([name, ok]) => console.log(`${ok ? "PASS" : "FAIL"}  ${name}`));
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

// ---------- Real run ----------
const URL_ = (env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || "";
const DRY = env.DRY_RUN === "1" || env.DRY_RUN === "true";
const FORCE = env.FORCE === "1" || env.FORCE === "true";
const FROM = env.REPORT_FROM || "GoodFit <onboarding@resend.dev>";
const SITE = env.SITE_URL || "";
if (!URL_ || !KEY) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
if (!DRY && !env.RESEND_API_KEY) { console.error("RESEND_API_KEY is required (or set DRY_RUN=1)."); process.exit(1); }

// New-style secret keys (sb_secret_...) go in apikey only; older JWT keys also go in Authorization.
const headers = { apikey: KEY, "Content-Type": "application/json", ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}) };
async function sb(path, opts = {}) {
  const res = await fetch(`${URL_}${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path.split("?")[0]} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 || opts.method === "POST" ? null : res.json();
}

async function allJobs() {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await sb(`/rest/v1/jobs?select=*&closed_at=is.null&order=posted_at.desc&limit=1000&offset=${off}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return Matcher.prepare(JobsData.dedupe(rows.map(JobsData.fromRow)));
}

async function emails() {
  const out = new Map();
  for (let page = 1; ; page++) {
    const d = await sb(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const users = d.users || [];
    users.forEach((u) => u.email && out.set(u.id, u.email));
    if (users.length < 1000) break;
  }
  return out;
}

async function lastSent() {
  const rows = await sb(`/rest/v1/report_log?select=user_id,sent_at&status=eq.sent&order=sent_at.desc&limit=10000`);
  const m = new Map();
  rows.forEach((r) => { if (!m.has(r.user_id)) m.set(r.user_id, r.sent_at); });
  return m;
}

async function send(to, r) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: r.subject, html: r.html, text: r.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

const log = (row) => (DRY ? null : sb("/rest/v1/report_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }));

const now = new Date();
const [profiles, emailOf, sentAt, jobs] = await Promise.all([
  sb("/rest/v1/profiles?select=user_id,details,preferences,step&step=eq.review"), emails(), lastSent(), allJobs(),
]);
console.log(`${profiles.length} finished profiles, ${jobs.length} open jobs${DRY ? " (dry run: nothing is sent)" : ""}.`);

let sent = 0, skipped = 0, failed = 0;
for (const p of profiles) {
  const prefs = p.preferences || {};
  const frequency = prefs.report;
  const to = emailOf.get(p.user_id);
  if (!to || !frequency || frequency === "off") { skipped++; continue; }
  if (env.ONLY_EMAIL && to.toLowerCase() !== env.ONLY_EMAIL.toLowerCase()) { skipped++; continue; }
  const last = sentAt.get(p.user_id);
  if (!FORCE && !Report.due(frequency, last, now)) { skipped++; continue; }
  try {
    const r = Report.build({ jobs, details: p.details || {}, prefs, frequency, since: last ? new Date(last) : undefined, now, siteUrl: SITE });
    // Daily emails with nothing new are skipped; weekly ones still go out (a short "quiet week" note).
    if (frequency === "daily" && !r.matches) { skipped++; continue; }
    if (!DRY) await send(to, r);
    await log({ user_id: p.user_id, frequency, job_count: r.matches, status: "sent" });
    sent++;
    console.log(`${DRY ? "would send" : "sent"}: ${to.replace(/(.).*(@.*)/, "$1***$2")}  "${r.subject}"`);
  } catch (e) {
    failed++;
    console.error(`failed for ${to.replace(/(.).*(@.*)/, "$1***$2")}: ${e.message}`);
    await log({ user_id: p.user_id, frequency, job_count: 0, status: "failed", error: String(e.message).slice(0, 500) }).catch(() => {});
  }
}
console.log(`Done: ${sent} ${DRY ? "would be sent" : "sent"}, ${skipped} not due or emails off, ${failed} failed.`);
process.exit(failed ? 1 : 0);
