// GoodFit extension, background part: signs in to your GoodFit account and keeps a copy of your profile
// (the resume details and preferences the website already has) in the extension's own storage.
// Scoring happens in content.js on the page you're viewing. Nothing about the page is sent anywhere.
importScripts("lib/config.js");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = self.GOODFIT;
const PROFILE_MAX_AGE = 6 * 3600e3; // re-read the profile from GoodFit at most every 6 hours

// A sample product manager, so people can try the extension before signing in.
const SAMPLE = {
  mode: "sample",
  email: null,
  details: {
    name: "Sample PM", currentRole: "Senior Product Manager", years: 7, seniority: "Senior",
    skills: ["SQL", "APIs", "A/B testing", "Roadmapping"],
    background: { archetype: "pm", pmYears: 5, models: ["B2B"], verticals: ["Fintech"], subVerticals: ["Fintech: Payments"], companyModels: ["Product"] },
  },
  prefs: { roles: ["Product Manager", "Senior Product Manager"], jobTypes: ["Full-time"], locations: ["Bengaluru"], seniority: "Senior" },
};

const store = {
  get: async (k) => (await chrome.storage.local.get(k))[k] ?? null,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  del: (k) => chrome.storage.local.remove(k),
};

async function auth(grant, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST", headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d.error_description || d.msg || d.message || `Sign-in failed (${r.status})`;
    throw new Error(/invalid login|invalid_credentials|invalid_grant/i.test(msg + (d.error_code || "")) ? "That email and password don't match a GoodFit account." : msg);
  }
  const session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), email: d.user?.email || body.email || null };
  await store.set("session", session);
  return session;
}

async function token() {
  let s = await store.get("session");
  if (!s) return null;
  if (s.expires_at * 1000 < Date.now() + 60e3) {
    try { s = await auth("refresh_token", { refresh_token: s.refresh_token }); }
    catch { await signOut(); return null; }
  }
  return s;
}

async function fetchProfile() {
  const s = await token();
  if (!s) throw new Error("Please sign in again.");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=details,preferences,step&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
  });
  if (r.status === 401) { await signOut(); throw new Error("Please sign in again."); }
  if (!r.ok) throw new Error(`Couldn't read your GoodFit profile (${r.status}).`);
  const [row] = await r.json();
  if (!row || row.step !== "review") throw new Error("Finish setting up your profile on goodfitjobsonly.com first, then come back.");
  const profile = { mode: "account", email: s.email, details: row.details || {}, prefs: row.preferences || {}, fetchedAt: Date.now() };
  await store.set("profile", profile);
  return profile;
}

async function getProfile() {
  const p = await store.get("profile");
  if (p && p.mode === "account" && Date.now() - (p.fetchedAt || 0) > PROFILE_MAX_AGE) {
    try { return await fetchProfile(); } catch { return p; } // offline or expired: keep scoring with the copy we have
  }
  return p;
}

async function signOut() {
  await store.del("session");
  await store.del("profile");
}

// Score the open tab on request (popup button or right-click menu). activeTab gives access to that tab only.
const FILES = ["lib/roles.js", "lib/signals.js", "lib/matching.js", "lib/jobtext.js", "content.js"];
async function scoreTab(tabId, selection) {
  await chrome.scripting.executeScript({ target: { tabId }, files: FILES });
  await chrome.tabs.sendMessage(tabId, { type: "score", selection: selection || "" });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handlers = {
    "get-profile": () => getProfile(),
    "sign-in": async () => { await auth("password", { email: msg.email, password: msg.password }); return fetchProfile(); },
    "refresh": () => fetchProfile(),
    "use-sample": async () => { await signOut(); await store.set("profile", { ...SAMPLE, fetchedAt: Date.now() }); return store.get("profile"); },
    "sign-out": async () => { await signOut(); return null; },
    "score-tab": () => scoreTab(msg.tabId, msg.selection),
  };
  const run = handlers[msg && msg.type];
  if (!run) return false;
  Promise.resolve().then(run).then((data) => reply({ ok: true, data: data ?? null }), (e) => reply({ ok: false, error: e.message || String(e) }));
  return true; // reply comes later
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "goodfit-score", title: "Check my fit with GoodFit", contexts: ["page", "selection"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "goodfit-score" && tab && tab.id != null) scoreTab(tab.id, info.selectionText).catch((e) => console.warn("GoodFit:", e.message));
});
