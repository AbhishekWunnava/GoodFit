// GoodFit extension popup: sign in, try the sample profile, or check the open page.
const $ = (id) => document.getElementById(id);
const ask = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError?.message || "No reply" })));
const show = (id) => ["loading", "consent", "signed-out", "signed-in"].forEach((x) => $(x).classList.toggle("hide", x !== id));
const TERMS_VERSION = 1; // keep in step with CONSENT_VERSION in content.js and EXT_TERMS_VERSION on extension.html
const say = (el, text, bad) => { el.textContent = text || ""; el.className = "msg" + (bad ? " err" : ""); };

function showProfile(p) {
  if (!p) return show("signed-out");
  const d = p.details || {}, b = d.background || {};
  const sample = p.mode === "sample";
  $("avatar").textContent = ((sample ? "S" : d.name || p.email || "?")[0] || "?").toUpperCase();
  $("name").textContent = sample ? "Sample profile" : d.name || p.email || "Your profile";
  $("meta").textContent = [d.currentRole, (b.pmYears ?? d.years) != null ? `${b.pmYears ?? d.years} yrs in product` : "", (p.prefs?.locations || []).slice(0, 2).join(", ")].filter(Boolean).join(" · ");
  $("sample-note").classList.toggle("hide", !sample);
  $("refresh").classList.toggle("hide", sample);
  $("sign-out").textContent = sample ? "Stop using the sample" : "Sign out";
  show("signed-in");
}

$("form").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || !password) return say($("msg"), "Enter your email and password.", true);
  $("sign-in").disabled = true;
  say($("msg"), "Signing in…");
  const r = await ask({ type: "sign-in", email, password });
  $("sign-in").disabled = false;
  $("password").value = "";
  if (!r.ok) return say($("msg"), r.error, true);
  say($("msg"), "");
  showProfile(r.data);
};

$("sample").onclick = async () => showProfile((await ask({ type: "use-sample" })).data);
$("sign-out").onclick = async () => { await ask({ type: "sign-out" }); show("signed-out"); };
$("refresh").onclick = async () => {
  say($("msg2"), "Updating…");
  const r = await ask({ type: "refresh" });
  if (!r.ok) return say($("msg2"), r.error, true);
  showProfile(r.data);
  say($("msg2"), "Profile updated.");
};
$("score").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) return say($("msg2"), "Open a job page first.", true);
  const r = await ask({ type: "score-tab", tabId: tab.id });
  if (!r.ok) return say($("msg2"), /cannot be scripted|cannot access/i.test(r.error) ? "GoodFit can't read this page." : r.error, true);
  window.close();
};

$("agree").onclick = async () => {
  await chrome.storage.local.set({ consent: { version: TERMS_VERSION, agreedAt: new Date().toISOString() } });
  start();
};
$("not-now").onclick = () => window.close();
// Withdraw: forget the agreement, the sign-in and the profile copy. The extension then reads nothing until asked again.
$("withdraw").onclick = async () => {
  await ask({ type: "sign-out" });
  await chrome.storage.local.remove("consent");
  show("consent");
};

async function start() {
  const { consent } = await chrome.storage.local.get("consent");
  if (!consent || consent.version < TERMS_VERSION) return show("consent");
  const r = await ask({ type: "get-profile" });
  showProfile(r.ok ? r.data : null);
}
start();
