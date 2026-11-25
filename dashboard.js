// Onboarding: 1. resume -> 2. details read from it -> 3. job preferences -> 4. review.

const MAX = 5 * 1024 * 1024;
const OK_EXT = ["pdf", "docx"];

const STEPS = [
  { id: "resume", t: "Resume", s: "Upload your CV" },
  { id: "details", t: "Your details", s: "Check what we found" },
  { id: "preferences", t: "Preferences", s: "What you want next" },
  { id: "review", t: "Review", s: "You're all set" },
];
const idx = (id) => STEPS.findIndex((s) => s.id === id);

// ---------- State ----------
const S = { user: null, resume: null, details: {}, prefs: {}, step: "resume", furthest: "resume", busy: false };

function firstName() {
  const n = (S.details.name || "").trim();
  return n ? n.split(/\s+/)[0] : "";
}
function fmtPay(amount) {
  if (amount === "" || amount == null) return null;
  const cur = S.prefs.currency || "INR";
  const sym = OPTIONS.currencies[cur] || "";
  return cur === "INR" ? `${sym}${amount} LPA` : `${sym}${amount}K / year`;
}

// ---------- Data ----------
async function loadResume() {
  const { data } = await db.from("resumes").select("*").order("created_at", { ascending: false }).limit(1);
  S.resume = data && data.length ? data[0] : null;
}

async function loadProfile() {
  const { data, error } = await db.from("profiles").select("*").maybeSingle();
  if (error) console.warn("profiles:", error.message);
  if (data) {
    S.details = data.details || {};
    S.prefs = data.preferences || {};
    S.furthest = idx(data.step) >= 0 ? data.step : "resume";
  }
}

async function saveProfile() {
  const { error } = await db.from("profiles").upsert({
    user_id: S.user.id,
    details: S.details,
    preferences: S.prefs,
    step: S.furthest,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    toast("Couldn't save: " + error.message, true);
    return false;
  }
  return true;
}

function reach(step) {
  if (idx(step) > idx(S.furthest)) S.furthest = step;
}

async function resumeFile() {
  const { data } = await db.storage.from("resumes").createSignedUrl(S.resume.file_path, 300);
  if (!data) throw new Error("Couldn't open your saved resume.");
  const blob = await fetch(data.signedUrl).then((r) => r.blob());
  return new File([blob], S.resume.file_name, { type: blob.type });
}

const foundKeys = (d) => Object.keys(d).filter((k) => d[k] !== null && d[k] !== undefined && d[k] !== "" && !(Array.isArray(d[k]) && !d[k].length));

// Adds the standard role, its family and a seniority level, using the role list in roles.js.
function withRoleInfo(d, aiStandardRole) {
  const m = window.ROLES && d.currentRole ? ROLES.match(d.currentRole) : null;
  const standard = aiStandardRole && aiStandardRole !== "Other" ? aiStandardRole : m ? m.role : null;
  return {
    ...d,
    standardRole: standard,
    roleFamily: standard && window.ROLES ? ROLES.familyOf(standard) : null,
    seniority: (m && m.seniority) || ResumeParser.seniorityFor(d.years),
  };
}

// 1. With Supabase set up: Claude reads the resume (supabase/functions/parse-resume).
async function readWithAI(file, path) {
  const isPdf = /\.pdf$/i.test(file.name);
  const body = isPdf ? { path } : { text: await ResumeParser.extractText(file) };
  body.roleOptions = window.ROLES ? ROLES.names() : [];
  const { data, error } = await db.functions.invoke("parse-resume", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const a = data.details;
  const d = {
    name: a.name, email: a.email, phone: a.phone, linkedin: a.linkedin, location: a.location,
    currentRole: a.currentTitle, currentCompany: a.currentCompany,
    years: ResumeParser.yearsFromPositions(a.positions), yearsSource: "dates",
    positions: a.positions, education: a.highestEducation, skills: a.skills || [], industries: a.industries || [],
    stillWorking: !!a.currentlyEmployed,
  };
  if (d.years === null) delete d.yearsSource;
  return withRoleInfo(d, a.standardRole);
}

// 2. Fallback (demo mode, or the AI isn't available): rules + the role list, in the browser.
async function readWithRules(file) {
  const text = await ResumeParser.extractText(file);
  if (!text || text.replace(/\s/g, "").length < 40) return null;
  return { ...withRoleInfo(ResumeParser.parse(text)), ...resumeSignals(text) };
}

// What the match score needs from a resume beyond the basics: B2B/B2C, verticals, years in product, etc.
function resumeSignals(text) {
  const out = {};
  if (window.Signals) out.signals = Signals.fromResume(text);
  const py = ResumeParser.pmYears(text);
  if (py != null) out.pmYears = py;
  return out;
}

// Profiles read before these signals existed: read the saved resume again, once, in the background.
async function backfillSignals() {
  if (S.details.signals || !S.resume || S.backfilling) return;
  S.backfilling = true;
  try {
    const text = await ResumeParser.extractText(await resumeFile());
    if (!text) return;
    Object.assign(S.details, resumeSignals(text));
    await saveProfile();
    if (S.step === "details") render();
  } catch (e) {
    console.warn("Couldn't re-read the resume for background signals:", e.message);
  } finally { S.backfilling = false; }
}

async function readDetails(file, path) {
  let d = null, problem = null, method = "rules";
  if (configured && cfg.USE_AI_READER) {
    try {
      d = await readWithAI(file, path);
      method = "ai";
    } catch (e) {
      console.warn("AI resume reading failed, using rules instead:", e.message);
      problem = "ai:" + e.message;
    }
  }
  if (!d) {
    try {
      d = await readWithRules(file);
      if (!d) return { details: {}, problem: "scanned" };
    } catch (e) {
      console.warn(e);
      return { details: {}, problem: e.message };
    }
  }
  return { details: { ...d, employed: d.stillWorking, method, found: foundKeys(d) }, problem: method === "ai" ? null : problem };
}

// ---------- Shell: welcome banner, stepper, side panel ----------
function renderWelcome() {
  const name = firstName();
  const hasName = !!name;
  const copy = {
    resume: S.resume
      ? [`Welcome back${hasName ? ", " + esc(name) : ""}!`, "Your resume is saved. Continue where you left off, or upload a newer version."]
      : ["Let's set up your job search.", "In about 3 minutes we'll read your resume, confirm your details and learn what you're looking for. Then GoodFit gets to work finding roles that truly fit you."],
    details: [`Nice to meet you${hasName ? ", " + esc(name) : ""}!`, "We've read your resume. Check the details below and fix anything we got wrong. Accurate details mean better matches."],
    preferences: [`Almost there${hasName ? ", " + esc(name) : ""}.`, "Tell us what your next job looks like: roles, places, pay and the kind of company. We'll only show you jobs that fit."],
    review: [`You're all set${hasName ? ", " + esc(name) : ""}!`, "Your job search profile is ready. Here's what GoodFit will look for. You can change anything at any time."],
  }[S.step];
  const facts = S.step === "review"
    ? [["checkCircle", "Profile complete"], ["shield", "Nothing sent without your OK"]]
    : [["clock", `Step ${idx(S.step) + 1} of 4, about ${[3, 2, 1, 1][idx(S.step)]} min left`], ["lock", "Only you can see your resume"], ["shield", "Nothing sent without your OK"]];
  $("welcome").innerHTML = `<h1>${copy[0]}</h1><p>${copy[1]}</p>
    <div class="facts">${facts.map(([i, t]) => `<span>${icon(i)}${t}</span>`).join("")}</div>`;
}

function renderStepper() {
  const fi = idx(S.furthest), ci = idx(S.step);
  $("stepper").innerHTML = STEPS.map((s, i) => {
    const reachable = i <= fi;
    const complete = i < fi || (S.furthest === "review" && i < 3);
    const cls = i === ci ? "on" : reachable ? "done" : "";
    return `<li class="${cls}"><button type="button" data-go="${s.id}" ${reachable && i !== ci ? "" : "disabled"} ${i === ci ? 'aria-current="step"' : ""}>
      <span class="n">${complete && i !== ci ? "✓" : i + 1}</span><span class="t">${s.t}<small>${s.s}</small></span></button></li>`;
  }).join("");
  $("stepper").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
}

function renderSide() {
  const side = $("side");
  const show = S.step === "details" || S.step === "preferences";
  $("layout").classList.toggle("single", !show);
  side.classList.toggle("hide", !show);
  if (!show) return;
  const d = S.details;
  const tips = {
    details: "We read your resume right here in your browser. Fields marked “Please add” are ones we couldn't find.",
    preferences: "Be honest about what you want. A tight, accurate list means fewer, better matches and less time spent each day.",
  };
  side.innerHTML = `
    <div class="card">
      <h4>Your profile</h4>
      <div class="kv">
        <div><span>Role</span><b>${esc(d.currentRole || "—")}</b></div>
        <div><span>Company</span><b>${esc(d.currentCompany || "—")}</b></div>
        <div><span>Experience</span><b>${esc(fmtYears(d.years))}</b></div>
        <div><span>Based in</span><b>${esc(d.location || "—")}</b></div>
      </div>
    </div>
    <div class="card"><div class="tip">${icon("info")}<span>${tips[S.step]}</span></div></div>
    ${S.resume ? `<div class="card"><h4>Resume</h4><div class="small" style="overflow-wrap:anywhere">${esc(S.resume.file_name)}</div><button class="btn text sm" style="margin-top:8px;padding-left:0" data-go-side="resume">Replace resume</button></div>` : ""}`;
  side.querySelectorAll("[data-go-side]").forEach((b) => (b.onclick = () => go(b.dataset.goSide)));
}

function render() {
  renderWelcome();
  renderStepper();
  renderSide();
  ({ resume: renderResume, details: renderDetails, preferences: renderPreferences, review: renderReview })[S.step]();
}

function go(step) {
  S.step = step;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Step 1: resume ----------
function renderResume() {
  const r = S.resume;
  const ext = r ? r.file_name.split(".").pop().toLowerCase() : "";
  $("panel").innerHTML = `
    <div class="card panel">
      <header>
        <h2>${r ? "Your resume" : "Upload your resume"}</h2>
        <p>${r ? "This is the resume GoodFit uses. Upload a new one any time it changes." : "We'll read it to fill in your profile, so you don't have to type everything out."}</p>
      </header>
      ${r ? `<div class="file-card">
          <div class="ficon ${ext === "docx" ? "docx" : ""}">${ext.toUpperCase()}</div>
          <div class="meta"><b>${esc(r.file_name)}</b><span class="small">Uploaded ${new Date(r.created_at).toLocaleString()}</span></div>
          <a href="#" id="view" class="btn ghost sm">View</a>
        </div>` : ""}
      <label class="dropzone" id="drop" for="file">
        <div class="icon-tile">${icon("upload")}</div>
        <b>${r ? "Upload a newer version" : "Drop your resume here"}</b>
        <span class="small">or <span class="link">browse your files</span>. PDF or Word (.docx), up to 5 MB.</span>
      </label>
      <input type="file" id="file" class="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
      <div id="status" class="status hide"><div class="spinner"></div><span id="status-text"></span></div>
      <div id="msg" class="msg"></div>
      <div class="privacy">${icon("lock")}<span>Your resume is stored privately and only you can see it. We read it in your browser to fill in your details.</span></div>
      ${r ? `<div class="actions"><span class="small">Happy with this one?</span><div class="right"><button class="btn" id="continue">Continue ${icon("arrowR")}</button></div></div>` : ""}
    </div>`;

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  $("file").onchange = () => { const f = $("file").files[0]; if (f) handleFile(f); };

  if (r) {
    db.storage.from("resumes").createSignedUrl(r.file_path, 300).then(({ data }) => {
      if (data && $("view")) { $("view").href = data.signedUrl; $("view").target = "_blank"; $("view").rel = "noopener"; }
    });
    $("continue").onclick = async () => {
      if (S.details.found || S.details.years !== undefined) { reach("details"); await saveProfile(); return go("details"); }
      // Resume saved earlier but never read: read it now.
      setBusy(true, "Reading your resume…");
      try {
        const file = await resumeFile();
        await afterRead(await readDetails(file, S.resume.file_path));
      } catch (e) {
        setBusy(false);
        showMsg($("msg"), e.message, "err");
      }
    };
  }
}

function setBusy(on, text) {
  S.busy = on;
  $("status").classList.toggle("hide", !on);
  if (text) $("status-text").textContent = text;
  $("drop").style.pointerEvents = on ? "none" : "";
  $("drop").style.opacity = on ? ".6" : "";
  if ($("continue")) $("continue").disabled = on;
}

async function handleFile(file) {
  if (S.busy) return;
  $("msg").className = "msg";
  const ext = file.name.split(".").pop().toLowerCase();
  if (!OK_EXT.includes(ext)) return showMsg($("msg"), "Please upload a PDF or .docx file.", "err");
  if (file.size > MAX) return showMsg($("msg"), "That file is over 5 MB. Please use a smaller one.", "err");

  setBusy(true, `Uploading ${file.name}…`);
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${S.user.id}/${Date.now()}-${safe}`;

  // Remember old resumes so we can remove them after the new one succeeds.
  const { data: old } = await db.from("resumes").select("id,file_path");
  const up = await db.storage.from("resumes").upload(path, file, { contentType: file.type });
  if (up.error) { setBusy(false); return showMsg($("msg"), up.error.message, "err"); }
  const ins = await db.from("resumes").insert({ file_path: path, file_name: file.name });
  if (ins.error) { setBusy(false); return showMsg($("msg"), ins.error.message, "err"); }
  if (old && old.length) {
    await db.storage.from("resumes").remove(old.map((r) => r.file_path));
    await db.from("resumes").delete().in("id", old.map((r) => r.id));
  }
  await loadResume();

  setBusy(true, "Reading your resume to find your role, company and experience…");
  await afterRead(await readDetails(file, path));
}

async function afterRead({ details, problem }) {
  // A new resume replaces the details, but keeps the preferences already chosen.
  S.details = details;
  S.readProblem = problem || null;
  reach("details");
  await saveProfile();
  toast(problem ? "Resume saved" : "Resume uploaded and read");
  go("details");
}

// ---------- Step 2: details ----------
const ARCHETYPES = [["pm", "Product Manager"], ["po", "Product Owner"], ["program", "Program / project manager"], ["ba", "Business analyst"]];
const COMPANY_TYPES = [["Product", "Product company"], ["GCC", "Global company's India centre (GCC)"], ["Services", "IT services / consulting"]];

// The background shown in the form: what the person confirmed, else what the resume suggests.
function backgroundOf(d) {
  const b = d.background || {}, g = d.signals || {};
  const pick = (x, y) => (x && x.length ? x : y || []);
  return {
    archetype: b.archetype || (/product owner/i.test(d.currentRole || "") ? "po" : "pm"),
    pmYears: b.pmYears ?? d.pmYears ?? null,
    models: pick(b.models, g.models),
    verticals: pick(b.verticals, g.verticals),
    subVerticals: pick(b.subVerticals, g.subVerticals),
    companyModels: pick(b.companyModels, g.companyModels && g.companyModels.length ? g.companyModels : ["Product"]),
    managedPMs: b.managedPMs ?? !!g.managedPMs,
    fromResume: !d.background && !!d.signals,
  };
}

function renderDetails() {
  const d = S.details;
  const bg = backgroundOf(d);
  const found = d.found || [];
  const has = (k) => found.includes(k);
  const keys = ["currentRole", "currentCompany", "years"];
  const nFound = keys.filter(has).length;
  let note;
  const aiFailed = S.readProblem && S.readProblem.startsWith("ai:");
  const by = d.method === "ai" ? "Our AI read your resume" : "We read your resume";
  if (S.readProblem === "scanned") note = ["partial", "alert", "We couldn't read any text in this file. It may be a scanned image. Please fill in your details below."];
  else if (S.readProblem && !aiFailed) note = ["partial", "alert", `We couldn't read your resume (${esc(S.readProblem)}). Please fill in your details below.`];
  else if (!d.found) note = null;
  else if (aiFailed) note = ["partial", "alert", `Our AI reader wasn't available (${esc(S.readProblem.slice(3).replace(/\.$/, ""))}), so we used basic reading, which can miss things. Please check every field.`];
  else if (nFound === 3) note = ["", "sparkles", `${by} and found your current role, company and experience. Please check they're right.`];
  else note = ["partial", "info", `${by} and found ${nFound} of 3 key details. Please fill in anything marked “Please add”.`];

  $("panel").innerHTML = `
    <form class="card panel" id="details-form" novalidate>
      <header><h2>Check your details</h2><p>This is what we read from your resume. Edit anything that's off.</p></header>
      ${note ? `<div class="found-note ${note[0]}">${icon(note[1])}<span>${note[2]}</span></div>` : ""}

      <div class="group">
        <h3><span class="icon-tile">${icon("user")}</span>Current position</h3>
        <div class="grid2">
          ${field("Current role", `<input type="text" id="currentRole" value="${esc(d.currentRole)}" placeholder="e.g. Product Manager" list="role-list" autocomplete="off"><div class="small" id="std-role" style="margin-top:6px"></div>`, { for: "currentRole", badge: d.found ? has("currentRole") : undefined })}
          ${field("Company", `<input type="text" id="currentCompany" value="${esc(d.currentCompany)}" placeholder="e.g. Acme Technologies">`, { for: "currentCompany", badge: d.found ? has("currentCompany") : undefined })}
          ${field("Total experience", `<div class="input-affix"><input type="number" id="years" min="0" max="50" step="0.5" value="${esc(d.years ?? "")}" placeholder="e.g. 4.5" style="border-radius:12px 0 0 12px"><span class="suffix">years</span></div>`,
            { for: "years", id: "years", badge: d.found ? has("years") : undefined, hint: d.yearsSource === "dates" ? "(worked out from your job dates)" : "", err: "Please enter your years of experience (0 if you're a fresher)." })}
          ${field("Where you're based", `<input type="text" id="location" value="${esc(d.location)}" placeholder="e.g. Bengaluru">`, { for: "location", badge: d.found ? has("location") : undefined })}
        </div>
        <label class="switch" style="margin-bottom:18px"><input type="checkbox" id="employed" ${d.employed !== false ? "checked" : ""}>I'm currently working in this role</label>
      </div>

      <div class="group">
        <h3><span class="icon-tile">${icon("sparkles")}</span>About you</h3>
        <div class="grid2">
          ${field("Full name", `<input type="text" id="name" value="${esc(d.name)}" placeholder="Your name">`, { for: "name", badge: d.found ? has("name") : undefined })}
          ${field("Highest education", `<input type="text" id="education" value="${esc(d.education)}" placeholder="e.g. B.Tech, Computer Science">`, { for: "education", badge: d.found ? has("education") : undefined })}
        </div>
        ${field("Key skills", chipsHTML("skills", "Type a skill and press Enter"), { for: "chips-skills", badge: d.found ? has("skills") : undefined, hint: "(helps us match you)" })}
      </div>

      <div class="group">
        <h3><span class="icon-tile">${icon("briefcase")}</span>Your background</h3>
        <p class="small" style="margin:-8px 0 18px">${bg.fromResume ? "Filled in from your resume where we could. " : ""}Matching compares these with what each job asks for.</p>
        ${field("What your product role is closest to", optsHTML("archetype", ARCHETYPES.map((a) => a[1]), (ARCHETYPES.find((a) => a[0] === bg.archetype) || ARCHETYPES[0])[1], "radio"))}
        <div class="grid2">
          ${field("Years in product roles", `<div class="input-affix"><input type="number" id="pmYears" min="0" max="40" step="0.5" value="${esc(bg.pmYears ?? "")}" placeholder="e.g. 4" style="border-radius:var(--r-sm) 0 0 var(--r-sm)"><span class="suffix">years</span></div>`, { for: "pmYears", hint: d.pmYears != null && bg.pmYears === d.pmYears ? "(from your job dates)" : "(PM, PO, product lead)" })}
        </div>
        ${field("Business models you've worked on", optsHTML("bmodels", Signals.MODELS, bg.models || []), { hint: "(pick all that apply)" })}
        ${field("Industries", chipsHTML("verticals", "Type an industry and press Enter"), { for: "chips-verticals", hint: "(e.g. Fintech, HRtech)" })}
        ${field("Specific spaces", chipsHTML("subverticals", "e.g. Fintech: Payments"), { for: "chips-subverticals", hint: "(optional, sharpens fintech matches)" })}
        ${field("Company types you've worked at", optsHTML("cmodels", COMPANY_TYPES.map((x) => x[1]), (bg.companyModels || []).map((v) => (COMPANY_TYPES.find((x) => x[0] === v) || [])[1]).filter(Boolean)))}
        <label class="switch" style="margin-bottom:18px"><input type="checkbox" id="managedPMs" ${bg.managedPMs ? "checked" : ""}>I've managed other product managers</label>
      </div>

      <div class="actions">
        <button type="button" class="btn ghost" id="back">${icon("arrowL")}Back</button>
        <div class="right"><button class="btn" id="next">Looks good, continue ${icon("arrowR")}</button></div>
      </div>
    </form>`;

  const skills = mountChips("skills", d.skills, () => []);
  const verticals = mountChips("verticals", bg.verticals, () => Signals.VERTICAL_NAMES, () => sync());
  const subverticals = mountChips("subverticals", bg.subVerticals,
    () => Signals.SUB_VERTICALS.filter((x) => !verticals.length || verticals.includes(x.split(":")[0])), () => sync());
  $("panel").insertAdjacentHTML("beforeend", roleDatalist());
  const showStd = () => {
    const x = S.details;
    $("std-role").innerHTML = !x.currentRole ? ""
      : x.standardRole ? `We match this as <b>${esc(x.standardRole)}</b>${x.roleFamily ? `, in ${esc(x.roleFamily)}` : ""}.`
      : "We don't recognise this title yet. That's fine, but a common title gets better matches.";
  };
  showStd();
  const sync = () => {
    const prevRole = S.details.currentRole;
    S.details = {
      ...S.details,
      name: $("name").value.trim() || null,
      currentRole: $("currentRole").value.trim() || null,
      currentCompany: $("currentCompany").value.trim() || null,
      years: $("years").value === "" ? null : Math.max(0, Number($("years").value)),
      location: $("location").value.trim() || null,
      education: $("education").value.trim() || null,
      employed: $("employed").checked,
      skills: [...skills],
      background: {
        archetype: (ARCHETYPES.find((a) => a[1] === checked("archetype")[0]) || ARCHETYPES[0])[0],
        pmYears: $("pmYears").value === "" ? null : Math.max(0, Number($("pmYears").value)),
        models: checked("bmodels"),
        verticals: [...verticals],
        subVerticals: [...subverticals],
        companyModels: checked("cmodels").map((l) => (COMPANY_TYPES.find((x) => x[1] === l) || [])[0]).filter(Boolean),
        managedPMs: $("managedPMs").checked,
      },
    };
    // Keep the AI's standard role unless the title was edited; then look it up again.
    Object.assign(S.details, withRoleInfo(S.details, S.details.currentRole === prevRole ? S.details.standardRole : null));
    showStd();
    renderSide();
  };
  $("details-form").addEventListener("change", () => sync());
  $("details-form").addEventListener("input", () => { sync(); if ($("years").value !== "") $("f-years").classList.remove("invalid"); });
  $("back").onclick = () => { sync(); go("resume"); };
  $("details-form").onsubmit = async (e) => {
    e.preventDefault();
    sync();
    const bad = S.details.years === null || isNaN(S.details.years);
    $("f-years").classList.toggle("invalid", bad);
    if (bad) return $("years").focus();
    reach("preferences");
    if (await saveProfile()) { toast("Details saved"); go("preferences"); }
  };
  backfillSignals();
}

// ---------- Step 3: preferences ----------
function defaultPrefs() {
  const d = S.details;
  return {
    roles: d.currentRole ? [d.currentRole] : [],
    seniority: d.seniority || "",
    jobTypes: ["Full-time"],
    workModes: [],
    locations: d.location ? [d.location] : [],
    relocate: false,
    exactTitles: false,
    openToServices: false,
    openToDomainSwitch: false,
    currency: "INR",
    currentPay: "",
    expectedMin: "",
    notice: "",
    companySizes: [],
    industries: d.industries || [],
    mustHaves: [],
    avoid: [],
    notes: "",
  };
}

// Real titles only: the standard role, its senior/lead versions, then neighbours in the same family.
function roleSuggestions() {
  const d = S.details;
  const std = d.standardRole || (window.ROLES && d.currentRole && ROLES.match(d.currentRole) || {}).role;
  if (!std || !window.ROLES) return ["Product Manager", "Software Engineer", "Data Analyst", "Business Analyst", "UX Designer", "Marketing Manager"];
  const family = Object.keys(ROLES.families[ROLES.familyOf(std)] || {});
  const ladder = /manager$/i.test(std) ? [std, `Senior ${std}`] : [std, `Senior ${std}`, `Lead ${std}`, `Staff ${std}`];
  return uniq([...ladder, ...family.filter((r) => r !== std)]).slice(0, 8);
}

function renderPreferences() {
  if (!S.prefs.roles) S.prefs = { ...defaultPrefs(), ...S.prefs };
  const p = S.prefs;
  const cur = p.currency || "INR";
  const unit = cur === "INR" ? "LPA" : "K / year";

  $("panel").innerHTML = `
    <form class="card panel" id="prefs-form" novalidate>
      <header><h2>What are you looking for?</h2><p>We'll use this to find and score jobs for you. You can change it any time.</p></header>

      <div class="group">
        <h3><span class="icon-tile">${icon("target")}</span>The role</h3>
        ${field("Roles you want", chipsHTML("roles", "Type a job title and press Enter", "role-list"), { for: "chips-roles", id: "roles", hint: "(add a few close variations)", err: "Add at least one role." })}
        <label class="switch" style="margin:-6px 0 20px"><input type="checkbox" id="exactTitles" ${p.exactTitles ? "checked" : ""}><span>Only show these exact titles <span class="hint">(e.g. "Product Manager II" leaves out PM I, Group and Staff PM)</span></span></label>
        ${field("Seniority", optsHTML("seniority", OPTIONS.seniority, p.seniority, "radio"))}
        ${field("Job type", optsHTML("jobTypes", OPTIONS.jobTypes, p.jobTypes))}
      </div>

      <div class="group">
        <h3><span class="icon-tile">${icon("pin")}</span>Where</h3>
        ${field("How you want to work", optsHTML("workModes", OPTIONS.workModes, p.workModes), { id: "workModes", err: "Pick at least one." })}
        ${field("Preferred cities", chipsHTML("locations", "Type a city and press Enter"), { for: "chips-locations", id: "locations", err: "Add at least one city, or choose Remote only." })}
        <label class="switch" style="margin-bottom:18px"><input type="checkbox" id="relocate" ${p.relocate ? "checked" : ""}>I'm open to relocating for the right job</label>
      </div>

      <div class="group">
        <h3><span class="icon-tile">${icon("money")}</span>Pay and timing</h3>
        <div class="grid2">
          ${field("Current pay", `<div class="input-affix"><select id="currency" aria-label="Currency">${Object.keys(OPTIONS.currencies).map((c) => `<option ${c === cur ? "selected" : ""}>${c}</option>`).join("")}</select><input type="number" id="currentPay" min="0" step="0.5" value="${esc(p.currentPay)}" placeholder="e.g. 18"><span class="suffix unit">${unit}</span></div>`, { for: "currentPay", hint: "(optional)" })}
          ${field("Minimum you'd accept", `<div class="input-affix"><span class="suffix cur-sym" style="border-left:1px solid var(--line-2);border-right:0;border-radius:12px 0 0 12px">${cur}</span><input type="number" id="expectedMin" min="0" step="0.5" value="${esc(p.expectedMin)}" placeholder="e.g. 25"><span class="suffix unit">${unit}</span></div>`, { for: "expectedMin", hint: "(blank if flexible)" })}
        </div>
        <div id="pay-hint" class="small" style="margin:-6px 0 16px"></div>
        <div class="grid2">
          ${field("Notice period", `<select id="notice"><option value="">Choose one</option>${OPTIONS.notice.map((n) => `<option ${n === p.notice ? "selected" : ""}>${n}</option>`).join("")}</select>`, { for: "notice" })}
        </div>
      </div>

      <div class="group">
        <h3><span class="icon-tile">${icon("building")}</span>Company and culture</h3>
        ${field("Company size", optsHTML("companySizes", OPTIONS.companySizes, p.companySizes), { hint: "(pick any)" })}
        <label class="switch" style="margin-bottom:12px"><input type="checkbox" id="openToServices" ${p.openToServices ? "checked" : ""}><span>Open to IT services / consulting companies <span class="hint">(their PM roles are often delivery-focused)</span></span></label>
        <label class="switch" style="margin-bottom:20px"><input type="checkbox" id="openToDomainSwitch" ${p.openToDomainSwitch ? "checked" : ""}><span>Open to switching industry <span class="hint">(jobs in other industries rank a little higher)</span></span></label>
        ${field("Industries", chipsHTML("industries", "Type an industry and press Enter"), { for: "chips-industries", hint: "(empty means any)" })}
        ${field("Must-haves", optsHTML("mustHaves", OPTIONS.mustHaves, p.mustHaves))}
        ${field("Companies or keywords to avoid", chipsHTML("avoid", "e.g. a current employer, “night shift”"), { for: "chips-avoid", hint: "(optional)" })}
        ${field("Anything else we should know?", `<textarea id="notes" rows="3" placeholder="e.g. I want to move from B2B to consumer products">${esc(p.notes)}</textarea>`, { for: "notes", hint: "(optional)" })}
      </div>

      <div class="actions">
        <button type="button" class="btn ghost" id="back">${icon("arrowL")}Back</button>
        <div class="right"><button class="btn" id="next">Save preferences ${icon("arrowR")}</button></div>
      </div>
    </form>`;

  $("panel").insertAdjacentHTML("beforeend", roleDatalist());
  const roles = mountChips("roles", p.roles, roleSuggestions, () => sync());
  const locations = mountChips("locations", p.locations, () => CITY_SUGGESTIONS, () => sync());
  const industries = mountChips("industries", p.industries, () => INDUSTRY_SUGGESTIONS, () => sync());
  const avoid = mountChips("avoid", p.avoid, () => [], () => sync());

  function payHint() {
    const c = Number($("currentPay").value), m = Number($("expectedMin").value);
    const el = $("pay-hint");
    if (c > 0 && m > 0) {
      const pct = Math.round(((m - c) / c) * 100);
      el.textContent = pct >= 0 ? `That's a ${pct}% hike on your current pay.` : `That's ${Math.abs(pct)}% below your current pay.`;
    } else el.textContent = "";
  }

  function sync() {
    const currency = $("currency").value;
    S.prefs = {
      roles: [...roles], seniority: checked("seniority")[0] || "", jobTypes: checked("jobTypes"),
      workModes: checked("workModes"), locations: [...locations], relocate: $("relocate").checked, exactTitles: $("exactTitles").checked,
      currency, currentPay: $("currentPay").value, expectedMin: $("expectedMin").value, notice: $("notice").value,
      companySizes: checked("companySizes"), industries: [...industries], mustHaves: checked("mustHaves"),
      avoid: [...avoid], notes: $("notes").value.trim(),
      openToServices: $("openToServices").checked, openToDomainSwitch: $("openToDomainSwitch").checked,
    };
    const unit = currency === "INR" ? "LPA" : "K / year";
    document.querySelectorAll("#prefs-form .unit").forEach((u) => (u.textContent = unit));
    document.querySelector("#prefs-form .cur-sym").textContent = currency;
    payHint();
    // Clear an error as soon as it's fixed.
    const errs = prefErrors(S.prefs);
    Object.keys(errs).forEach((k) => { if (!errs[k]) $("f-" + k).classList.remove("invalid"); });
  }
  function prefErrors(p) {
    const remoteOnly = p.workModes.length === 1 && p.workModes[0] === "Remote";
    return { roles: !p.roles.length, workModes: !p.workModes.length, locations: !remoteOnly && !p.locations.length };
  }
  payHint();
  $("prefs-form").addEventListener("input", sync);
  $("prefs-form").addEventListener("change", sync);
  $("back").onclick = () => { sync(); go("details"); };
  $("prefs-form").onsubmit = async (e) => {
    e.preventDefault();
    sync();
    const errors = prefErrors(S.prefs);
    Object.entries(errors).forEach(([k, bad]) => $("f-" + k).classList.toggle("invalid", bad));
    const firstBad = Object.keys(errors).find((k) => errors[k]);
    if (firstBad) {
      $("f-" + firstBad).scrollIntoView({ behavior: "smooth", block: "center" });
      return toast("Please fill in the highlighted fields", true);
    }
    reach("review");
    if (await saveProfile()) { toast("Preferences saved"); go("review"); }
  };
}

// ---------- Step 4: review ----------
function renderReview() {
  const d = S.details, p = S.prefs;
  const tags = (arr) => (arr && arr.length ? `<div class="tags">${arr.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : "—");
  const row = (k, v) => `<div><span>${k}</span><b>${v || "—"}</b></div>`;
  const pay = [fmtPay(p.currentPay) && `now ${fmtPay(p.currentPay)}`, fmtPay(p.expectedMin) && `min ${fmtPay(p.expectedMin)}`].filter(Boolean).join(", ");
  $("panel").innerHTML = `
    <div class="card panel">
      <div class="done-hero">
        <div class="big">${icon("checkCircle")}</div>
        <h2>Check it over, then find your jobs</h2>
        <p style="color:var(--ink-2)">Here's everything GoodFit will use to find and score roles for you.</p>
      </div>
      <div class="summary-grid">
        <div class="card">
          <h3>Your profile <button class="btn text sm" data-go="details">${icon("edit", "width:15px;height:15px")}Edit</button></h3>
          <div class="kv">
            ${row("Name", esc(d.name))}
            ${row("Role", esc(d.currentRole))}
            ${row("Company", esc(d.currentCompany))}
            ${row("Experience", esc(fmtYears(d.years)))}
            ${row("Based in", esc(d.location))}
            ${row("Education", esc(d.education))}
          </div>
          ${(() => { const b = backgroundOf(d); return `
            <div class="kv" style="margin-top:9px">
              ${row("Role type", esc((ARCHETYPES.find((a) => a[0] === b.archetype) || ARCHETYPES[0])[1]))}
              ${row("In product", esc(b.pmYears != null ? fmtYears(b.pmYears) : ""))}
              ${row("Business", esc(b.models.join(", ")))}
              ${row("Industries", esc([...b.verticals, ...b.subVerticals.map((x) => x.split(": ")[1])].join(", ")))}
              ${row("Managed PMs", b.managedPMs ? "Yes" : "No")}
            </div>`; })()}
          <div style="margin-top:14px"><span class="lbl">Skills</span><div style="margin-top:6px">${tags(d.skills)}</div></div>
        </div>
        <div class="card">
          <h3>What you want <button class="btn text sm" data-go="preferences">${icon("edit", "width:15px;height:15px")}Edit</button></h3>
          <div class="kv">
            ${row("Seniority", esc(p.seniority))}
            ${row("Job type", esc((p.jobTypes || []).join(", ")))}
            ${row("Work mode", esc((p.workModes || []).join(", ")))}
            ${row("Pay", esc(pay))}
            ${row("Notice", esc(p.notice))}
            ${row("Relocation", p.relocate ? "Open to it" : "No")}
            ${row("Titles", p.exactTitles ? "Exact titles only" : "Similar titles too")}
            ${row("Services firms", p.openToServices ? "Open to them" : "No")}
            ${row("Industry switch", p.openToDomainSwitch ? "Open to it" : "Prefer my industries")}
          </div>
          <div style="margin-top:14px;display:grid;gap:10px">
            <div><span class="lbl">Roles</span><div style="margin-top:6px">${tags(p.roles)}</div></div>
            <div><span class="lbl">Cities</span><div style="margin-top:6px">${tags(p.locations)}</div></div>
            ${p.industries && p.industries.length ? `<div><span class="lbl">Industries</span><div style="margin-top:6px">${tags(p.industries)}</div></div>` : ""}
            ${p.companySizes && p.companySizes.length ? `<div><span class="lbl">Company size</span><div style="margin-top:6px">${tags(p.companySizes)}</div></div>` : ""}
            ${p.mustHaves && p.mustHaves.length ? `<div><span class="lbl">Must-haves</span><div style="margin-top:6px">${tags(p.mustHaves)}</div></div>` : ""}
            ${p.avoid && p.avoid.length ? `<div><span class="lbl">Avoid</span><div style="margin-top:6px">${tags(p.avoid)}</div></div>` : ""}
            ${p.notes ? `<div><span class="lbl">Notes</span><div style="margin-top:4px">${esc(p.notes)}</div></div>` : ""}
          </div>
        </div>
      </div>
      <div class="next">${icon("sparkles")}<div style="flex:1"><b>What happens next</b><br><span class="small">GoodFit scans company career sites, scores every opening against this profile, and shows you the ones that fit.</span></div></div>
      <div class="actions"><span class="small">You can change any of this later.</span><div class="right"><a class="btn lg marigold" href="jobs.html?fresh=1">Find my jobs ${icon("arrowR")}</a></div></div>
    </div>`;
  $("panel").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
}

// ---------- Start ----------
async function init() {
  if (needConfig(document.createElement("div"))) return;
  const { data } = await db.auth.getSession();
  if (!data.session) { location.href = "auth.html"; return; }
  S.user = data.session.user;
  $("who").textContent = S.user.email;
  $("avatar").textContent = (S.user.email || "?")[0].toUpperCase();

  await Promise.all([loadResume(), loadProfile()]);
  if (!S.resume) S.furthest = idx(S.furthest) > 0 && S.details.found ? S.furthest : "resume";
  S.step = S.resume ? S.furthest : "resume";

  // Finished onboarding? Home is the jobs page, unless you came here to edit (?edit=<step>).
  const edit = new URLSearchParams(location.search).get("edit");
  if (S.furthest === "review" && S.resume && !edit) { location.replace("jobs.html"); return; }
  if (edit && idx(edit) >= 0 && idx(edit) <= idx(S.furthest) && (S.resume || edit === "resume")) S.step = edit;
  if (S.furthest === "review") $("logout").insertAdjacentHTML("beforebegin", `<a class="btn sm" href="jobs.html">Your matches</a>`);

  $("loading").classList.add("hide");
  $("app").classList.remove("hide");
  render();
}

$("logout").onclick = async () => { await db.auth.signOut(); location.href = "index.html"; };
init();
