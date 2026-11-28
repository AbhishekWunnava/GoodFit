// "Your data" page: download everything GoodFit holds about you, download your resume, delete your account.
// Deleting goes through the `account` Supabase function (it needs the service role to remove the login
// and the resume files). In demo mode everything lives in this browser and is deleted here.
const ACC = { user: null };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const listKey = (id) => `jobpilot_jobs_${id}`;

// Rows from a table, or [] when the table isn't set up yet (its SQL file not run).
async function rows(table, select = "*") {
  const { data, error } = await db.from(table).select(select);
  if (error) { console.warn(`${table}:`, error.message); return []; }
  return Array.isArray(data) ? data : data ? [data] : [];
}

async function init() {
  const { data } = await db.auth.getSession();
  if (!data.session) { location.href = "auth.html"; return; }
  ACC.user = data.session.user;
  $("avatar").textContent = (ACC.user.email || "?")[0].toUpperCase();
  const [resume] = await rows("resumes", "file_name, created_at");
  $("account-kv").innerHTML = [
    ["Email", esc(ACC.user.email)],
    ["Member since", esc(fmtDate(ACC.user.created_at))],
    ["Last signed in", esc(fmtDate(ACC.user.last_sign_in_at))],
    ["Resume", resume ? esc(resume.file_name) : "None uploaded"],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  $("download-resume").classList.toggle("hide", !resume);
  await showExtension();
  $("loading").classList.add("hide");
  $("content").classList.remove("hide");
}

// ---------- Browser extension agreement (set on extension.html, kept in preferences.extension) ----------
async function showExtension() {
  const [profile] = await rows("profiles");
  const ext = profile && profile.preferences && profile.preferences.extension;
  $("ext-status").textContent = ext && ext.agreedAt
    ? `You agreed to how the GoodFit extension works on ${fmtDate(ext.agreedAt)}. It reads the job you open to score it on your computer, and keeps a copy of your profile in the extension until you sign out of it.`
    : "You haven't set up the GoodFit extension. It shows your fit score on LinkedIn, Naukri and other job pages.";
  $("ext-withdraw").classList.toggle("hide", !(ext && ext.agreedAt));
  $("ext-withdraw").onclick = async () => {
    const preferences = { ...(profile.preferences || {}) };
    delete preferences.extension;
    const { error } = await db.from("profiles").upsert({ user_id: ACC.user.id, details: profile.details || {}, preferences, step: profile.step, updated_at: new Date().toISOString() });
    if (error) return showMsg($("ext-msg"), "Couldn't save: " + error.message, "err");
    showMsg($("ext-msg"), "Agreement withdrawn. Also remove the extension from chrome://extensions (or click its icon and Sign out).", "ok");
    await showExtension();
  };
}

// ---------- Download my data ----------
async function downloadData() {
  $("download").disabled = true;
  try {
    const [profile] = await rows("profiles");
    const resumes = await rows("resumes", "file_name, file_path, created_at");
    const emails = await rows("report_log", "sent_at, frequency, job_count, status");
    const assistant = await rows("agent_usage", "created_at, kind, input_tokens, output_tokens");
    let lists = { saved: [], hidden: [] };
    try { lists = JSON.parse(localStorage.getItem(listKey(ACC.user.id)) || "{}"); } catch {}
    // Name the saved and hidden jobs, so the file makes sense on its own.
    let byId = new Map();
    try { byId = new Map((await JobsData.loadJobs()).jobs.map((j) => [j.id, j])); } catch {}
    const named = (ids) => (ids || []).map((id) => { const j = byId.get(id); return j ? { id, title: j.title, company: j.company, url: j.url } : { id }; });
    const out = {
      exported_at: new Date().toISOString(),
      about: "Everything GoodFit holds about you. See https://goodfitjobsonly.com/privacy.html",
      account: { email: ACC.user.email, id: ACC.user.id, created_at: ACC.user.created_at || null, last_sign_in_at: ACC.user.last_sign_in_at || null },
      profile: profile ? { details: profile.details, preferences: profile.preferences, setup_step: profile.step, updated_at: profile.updated_at } : null,
      resumes: resumes.map((r) => ({ file_name: r.file_name, uploaded_at: r.created_at })),
      saved_jobs: named(lists.saved),
      hidden_jobs: named(lists.hidden),
      match_emails_sent: emails,
      assistant_usage: assistant,
      note: "Saved and hidden jobs are stored in this browser only. Assistant conversations are not stored; only usage counts are.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `goodfit-my-data-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showMsg($("download-msg"), "Downloaded. The file is in your Downloads folder.", "ok");
  } catch (e) {
    showMsg($("download-msg"), `Couldn't build the file: ${e.message}`, "err");
  } finally {
    $("download").disabled = false;
  }
}

async function downloadResume() {
  const [r] = await rows("resumes", "file_name, file_path");
  if (!r) return showMsg($("download-msg"), "No resume uploaded.", "err");
  const { data } = await db.storage.from("resumes").createSignedUrl(r.file_path, 120, { download: r.file_name });
  if (!data) return showMsg($("download-msg"), "Couldn't open your resume. Try again.", "err");
  const a = Object.assign(document.createElement("a"), { href: data.signedUrl, download: r.file_name, rel: "noopener" });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- Delete my account ----------
async function deleteDemo() {
  const uid = ACC.user.id;
  const paths = (await rows("resumes", "file_path")).map((r) => r.file_path);
  if (paths.length) await db.storage.from("resumes").remove(paths);
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith("jobpilot_demo_") || k === "jobpilot_demo_session") continue;
    try {
      const all = JSON.parse(localStorage.getItem(k));
      if (Array.isArray(all)) localStorage.setItem(k, JSON.stringify(all.filter((r) => r.user_id !== uid)));
    } catch {}
  }
}

async function deleteAccount(e) {
  e.preventDefault();
  const ok = $("confirm-text").value.trim() === "DELETE";
  $("f-confirm").classList.toggle("invalid", !ok);
  if (!ok) return $("confirm-text").focus();
  $("delete").disabled = true;
  showMsg($("delete-msg"), "Deleting your account…", "info");
  try {
    if (demo) await deleteDemo();
    else {
      const { data } = await db.auth.getSession();
      const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ action: "delete" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `The server answered ${res.status}.`);
    }
    // Clear what this browser holds for the account, then sign out.
    try {
      localStorage.removeItem(listKey(ACC.user.id));
      ["goodfit_list_prefs", "goodfit_highlights", "goodfit_practised"].forEach((k) => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch {}
    await db.auth.signOut();
    location.replace("index.html?deleted=1");
  } catch (err) {
    showMsg($("delete-msg"), `${err.message} If it keeps failing, email hello@goodfitjobsonly.com from your account's email address.`, "err");
    $("delete").disabled = false;
  }
}

$("download").onclick = downloadData;
$("download-resume").onclick = downloadResume;
$("delete-form").onsubmit = deleteAccount;
$("confirm-text").addEventListener("input", () => { if ($("confirm-text").value.trim() === "DELETE") $("f-confirm").classList.remove("invalid"); });
$("logout").onclick = async () => { await db.auth.signOut(); location.href = "index.html"; };
init().catch((e) => { console.error(e); $("loading").innerHTML = `<p class="msg err" style="display:block">Couldn't load your account: ${esc(e.message)}</p>`; });
