// "GoodFit for Chrome" page (the Extension tab, logged-in only): explains the extension, and records that you agreed to how it works before
// showing how to install it. The agreement is kept with your profile (preferences.extension = { version, agreedAt })
// so it shows on Your data and can be withdrawn. The extension also asks once itself, before it reads any page.
const EXT_TERMS_VERSION = 1; // bump when what the extension reads or does changes, so people agree again
const X = { user: null, profile: null };
const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const storeUrl = () => (window.APP_CONFIG && APP_CONFIG.EXTENSION_URL) || "";

function agreed() {
  const e = X.profile && X.profile.preferences && X.profile.preferences.extension;
  return e && e.agreedAt && e.version >= EXT_TERMS_VERSION ? e : null;
}

async function saveAgreement(value) {
  const p = X.profile;
  const preferences = { ...(p.preferences || {}) };
  if (value) preferences.extension = value; else delete preferences.extension;
  const { error } = await db.from("profiles").upsert({
    user_id: X.user.id, details: p.details || {}, preferences, step: p.step, updated_at: new Date().toISOString(),
  });
  if (!error) p.preferences = preferences;
  return error;
}

function render() {
  const card = $("setup-card");
  if (!X.profile || X.profile.step !== "review") {
    card.innerHTML = `<h3>Finish your profile first</h3>
      <p>The extension compares jobs with your resume details and preferences. Finish setting them up, then come back.</p>
      <a class="btn" href="dashboard.html">Finish my profile</a>`;
    return;
  }
  const a = agreed();
  if (!a) {
    card.innerHTML = `<h3>Before you install</h3>
      <ul class="ext-list yes compact">
        <li>It reads the job you open on LinkedIn and Naukri, and on other pages only when you ask.</li>
        <li>It scores that job on your computer and sends it nowhere.</li>
        <li>It reads your GoodFit profile to compare, and keeps a copy in the extension until you sign out.</li>
        <li>It never applies, clicks, messages or posts for you.</li>
      </ul>
      <label class="ext-agree"><input type="checkbox" id="agree"><span>I've read what the extension can see and do, and I agree to the extension section of the <a href="privacy.html#extension" target="_blank" rel="noopener">privacy notice</a>.</span></label>
      <button class="btn" id="agree-btn" type="button" disabled>Agree and continue</button>
      <div class="msg" id="setup-msg" role="status"></div>`;
    $("agree").onchange = () => { $("agree-btn").disabled = !$("agree").checked; };
    $("agree-btn").onclick = async () => {
      $("agree-btn").disabled = true;
      const err = await saveAgreement({ version: EXT_TERMS_VERSION, agreedAt: new Date().toISOString() });
      if (err) { $("agree-btn").disabled = false; return showMsg($("setup-msg"), "Couldn't save: " + err.message, "err"); }
      render();
      $("setup-card").focus();
    };
    return;
  }
  const url = storeUrl();
  card.innerHTML = `<p class="ext-ok"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>You agreed on ${esc(fmtDay(a.agreedAt))}.</p>
    ${url
      ? `<h3>Add GoodFit to Chrome</h3><p>Opens the Chrome Web Store. Click <b>Add to Chrome</b>, then pin GoodFit from the puzzle-piece menu.</p>
         <a class="btn lg" href="${esc(url)}" target="_blank" rel="noopener">Add to Chrome</a>`
      : `<h3>Coming soon to the Chrome Web Store</h3><p>We're getting the extension listed. We'll show the install button here as soon as it's live.</p>
         <details class="ext-dev"><summary>Developer preview: install it from the code</summary>
           <ol><li>Get the <code>extension</code> folder from the GoodFit code.</li><li>Open <code>chrome://extensions</code> and turn on <b>Developer mode</b>.</li>
           <li>Click <b>Load unpacked</b> and choose the <code>extension</code> folder.</li><li>Pin GoodFit, click it, agree and sign in.</li></ol></details>`}
    <p class="small ext-withdraw">Changed your mind? <button class="btn text sm" id="withdraw" type="button">Withdraw my agreement</button> and remove the extension from chrome://extensions.</p>
    <div class="msg" id="setup-msg" role="status"></div>`;
  $("withdraw").onclick = async () => {
    const err = await saveAgreement(null);
    if (err) return showMsg($("setup-msg"), "Couldn't save: " + err.message, "err");
    toast("Agreement withdrawn. Remove the extension from chrome://extensions too.");
    render();
  };
}

async function init() {
  // Part of the logged-in app: signed out, log in first and come back here.
  const { data } = await db.auth.getSession();
  if (!data.session) {
    location.href = "auth.html?next=" + encodeURIComponent("extension.html" + location.search.replace(/[^?a-z0-9=&]/gi, ""));
    return;
  }
  X.user = data.session.user;
  $("avatar").textContent = (X.user.email || "?")[0].toUpperCase();
  $("logout").onclick = async () => { await db.auth.signOut(); location.href = "index.html"; };
  const { data: profile } = await db.from("profiles").select("*").maybeSingle();
  X.profile = profile || null;
  if (new URLSearchParams(location.search).has("installed")) $("welcome").classList.remove("hide");
  $("setup-card").tabIndex = -1;
  render();
  $("loading").classList.add("hide");
  $("main").classList.remove("hide");
  // Coming from the Matches banner or Your data to #setup: the card has only just been filled in, so scroll now.
  if (location.hash === "#setup") $("setup").scrollIntoView();
}

init().catch((e) => { console.error(e); $("loading").classList.add("hide"); $("main").classList.remove("hide"); $("setup-card").innerHTML = `<p class="msg err">Something went wrong: ${esc(e.message)}</p>`; });
