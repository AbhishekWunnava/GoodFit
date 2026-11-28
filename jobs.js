// Jobs page: "We're finding jobs" loader, then filters (seeded from preferences) + ranked list + detail drawer.
const J = {
  user: null, details: {}, prefs: {}, jobs: [], meta: {}, filters: {},
  sort: "best", view: "matches", showLow: false, page: 1, perPage: 20, current: null,
  saved: new Set(), hidden: new Set(),
};

// ---------- Small helpers ----------
const PALETTE = ["#0E5A57", "#1A2233", "#7A4E12", "#8A3220", "#2F4F6B", "#4D5A24", "#5B3F6B", "#245C3D"];
const coColor = (name) => PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
function ago(date) {
  if (!date) return null;
  const d = Math.floor((Date.now() - Date.parse(date)) / 864e5);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return "Over a year ago";
}
const expText = (j) => (j.expMin == null ? null : j.expMax != null ? `${j.expMin}–${j.expMax} yrs` : `${j.expMin}+ yrs`);
// Pay on a card, when the posting states it: "₹25–35 LPA" or "Up to ₹30 LPA".
const lpaOf = (n) => (n / 1e5).toFixed(n % 1e5 ? 1 : 0);
const payText = (j) => (j.salaryMin ? `₹${lpaOf(j.salaryMin)}${j.salaryMax && j.salaryMax !== j.salaryMin ? `–${lpaOf(j.salaryMax)}` : ""} LPA` : j.salaryMax ? `Up to ₹${lpaOf(j.salaryMax)} LPA` : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Saved / not-interested lists live in this browser for now (per user).
const listKey = () => `jobpilot_jobs_${J.user.id}`;
function loadLists() {
  try {
    const v = JSON.parse(localStorage.getItem(listKey()) || "{}");
    J.saved = new Set(v.saved || []);
    J.hidden = new Set(v.hidden || []);
  } catch {}
}
function storeLists() {
  try { localStorage.setItem(listKey(), JSON.stringify({ saved: [...J.saved], hidden: [...J.hidden] })); } catch {}
}

function toastUndo(text, undo) {
  const t = $("toast");
  t.innerHTML = `${icon("check", "width:16px;height:16px")}${esc(text)} <button class="btn text sm" type="button">Undo</button>`;
  t.style.background = "var(--ink)";
  t.style.pointerEvents = "auto";
  t.querySelector("button").onclick = () => { undo(); t.classList.remove("show"); };
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.classList.remove("show"); t.style.pointerEvents = ""; }, 4500);
}

// ---------- Loader ----------
async function runFinder(loadPromise, long) {
  const name = (J.details.name || "").trim().split(/\s+/)[0];
  $("finder-title").textContent = name ? `We're finding jobs for you, ${name}` : "We're finding jobs for you";
  const steps = [
    "Reading your profile and preferences",
    "Scanning openings from company career sites",
    "Scoring each job against your experience",
    "Hiding roles that don't fit",
  ];
  $("finder-steps").innerHTML = steps.map((s) => `<li><span class="dot"></span><span>${s}</span></li>`).join("");
  const items = [...$("finder-steps").children];
  // The fit bar fills part by part as each step finishes.
  const fills = [{ role: 23 }, { must: 19, experience: 15 }, { domain: 28, company: 8 }, { practical: 7 }];
  const filled = {};
  $("finder-fit").innerHTML = fitBar({}, { cls: "lg" });
  const pace = long ? 750 : 120;
  for (let i = 0; i < items.length; i++) {
    items[i].classList.add("active");
    if (i === 1) {
      await Promise.all([loadPromise, sleep(pace)]);
      items[1].lastChild.textContent = `Scanned ${J.jobs.length} openings from ${J.meta.sources.length} companies`;
    } else await sleep(pace);
    items[i].classList.replace("active", "done");
    items[i].firstChild.innerHTML = icon("check");
    Object.assign(filled, fills[i]);
    $("finder-fit").innerHTML = fitBar(filled, { cls: "lg" });
  }
  await sleep(long ? 400 : 0);
  $("finder").classList.add("out");
  setTimeout(() => $("finder").classList.add("hide"), 450);
}

// ---------- Filters ----------
function filtersFromPrefs(p) {
  return {
    productOnly: true, search: "", roles: [...(p.roles || [])], seniority: p.seniority || "", jobTypes: [...(p.jobTypes || [])],
    workModes: [...(p.workModes || [])], locations: [...(p.locations || [])], relocate: !!p.relocate, exactTitles: !!p.exactTitles,
    companySizes: [...(p.companySizes || [])], industries: [...(p.industries || [])], avoid: [...(p.avoid || [])], postedWithin: Matcher.DEFAULT_MAX_AGE,
  };
}

function roleSuggestionsFor() {
  const std = J.details.standardRole || ((window.ROLES && J.details.currentRole && ROLES.match(J.details.currentRole)) || {}).role;
  if (!std || !window.ROLES) return [];
  return Object.keys(ROLES.families[ROLES.familyOf(std)] || {});
}

function activeCount() {
  const f = J.filters;
  return [f.search, f.roles.length, f.seniority, f.jobTypes.length, f.workModes.length, f.locations.length,
    f.companySizes.length, f.industries.length, f.avoid.length, f.postedWithin !== Matcher.DEFAULT_MAX_AGE].filter(Boolean).length;
}

function renderFilters() {
  const f = J.filters;
  const industries = [...new Set(J.jobs.map((j) => j.industry))].sort();
  $("filters").innerHTML = `
    <div class="fhead"><h2>${icon("filter", "width:17px;height:17px")}Filters</h2>
      <span><button class="btn text sm" id="reset" type="button">Reset</button><button class="btn ghost sm filters-close" id="close-filters" type="button" aria-label="Close filters">${icon("x", "width:16px;height:16px")}</button></span></div>
    <div class="field"><label class="sr-only" for="search">Search</label>
      <div class="search-box">${icon("search")}<input type="text" id="search" placeholder="Search title or company" value="${esc(f.search)}"></div></div>
    ${field("Roles", chipsHTML("roles", "Add a job title", "role-list"), { for: "chips-roles" })}
    <label class="switch" style="margin:-4px 0 16px;font-size:.9rem"><input type="checkbox" id="exactTitles" ${f.exactTitles ? "checked" : ""}>Only these exact titles</label>
    ${field("Cities", chipsHTML("locations", "Add a city"), { for: "chips-locations" })}
    <label class="switch" style="margin:-4px 0 16px;font-size:.9rem"><input type="checkbox" id="relocate" ${f.relocate ? "checked" : ""}>Open to relocating</label>
    ${field("Work mode", optsHTML("workModes", OPTIONS.workModes, f.workModes))}
    ${field("Seniority", optsHTML("seniority", ["Any", ...OPTIONS.seniority], f.seniority || "Any", "radio"))}
    ${field("Job type", optsHTML("jobTypes", ["Full-time", "Contract", "Part-time", "Internship"], f.jobTypes))}
    ${field("Company size", optsHTML("companySizes", OPTIONS.companySizes, f.companySizes))}
    ${field("Industry", optsHTML("industries", industries, f.industries))}
    ${field("Posted", `<select id="posted"><option value="0">Any time</option><option value="7">Past week</option><option value="30">Past month</option><option value="90">Past 3 months</option><option value="180">Past 6 months</option></select>`, { for: "posted" })}
    ${field("Hide jobs mentioning", chipsHTML("avoid", "e.g. night shift"), { for: "chips-avoid" })}
    <div class="actions">
      <button class="btn" id="save-prefs" type="button">Save as my preferences</button>
      <a class="btn text sm" href="dashboard.html?edit=preferences">Pay, notice period and more</a>
    </div>`;
  $("filters").insertAdjacentHTML("beforeend", roleDatalist());
  $("posted").value = String(f.postedWithin ?? Matcher.DEFAULT_MAX_AGE);

  const roles = mountChips("roles", f.roles, roleSuggestionsFor, () => changed());
  const locations = mountChips("locations", f.locations, () => CITY_SUGGESTIONS, () => changed());
  const avoid = mountChips("avoid", f.avoid, () => [], () => changed());
  let timer;
  function changed() {
    Object.assign(J.filters, {
      roles: [...roles], locations: [...locations], avoid: [...avoid], relocate: $("relocate").checked, exactTitles: $("exactTitles").checked,
      workModes: checked("workModes"), seniority: checked("seniority")[0] === "Any" ? "" : checked("seniority")[0] || "",
      jobTypes: checked("jobTypes"), companySizes: checked("companySizes"), industries: checked("industries"),
      postedWithin: Number($("posted").value), search: $("search").value.trim(),
    });
    J.page = 1;
    clearTimeout(timer);
    timer = setTimeout(renderList, 120);
  }
  $("filters").addEventListener("change", changed);
  $("search").addEventListener("input", changed);
  $("reset").onclick = () => { J.filters = filtersFromPrefs(J.prefs); renderFilters(); renderList(); };
  $("save-prefs").onclick = savePrefs;
  $("close-filters").onclick = () => { closeDrawer(); $("open-filters").focus(); };
}

async function savePrefs() {
  const f = J.filters;
  J.prefs = { ...J.prefs, roles: f.roles, seniority: f.seniority, jobTypes: f.jobTypes, workModes: f.workModes, locations: f.locations,
    relocate: f.relocate, exactTitles: f.exactTitles, companySizes: f.companySizes, industries: f.industries, avoid: f.avoid };
  J.cand = null;
  const { error } = await db.from("profiles").upsert({
    user_id: J.user.id, details: J.details, preferences: J.prefs, step: "review", updated_at: new Date().toISOString(),
  });
  toast(error ? "Couldn't save: " + error.message : "Saved as your preferences", !!error);
}

// ---------- List ----------
function cardHTML(r) {
  const j = r.job;
  const pills = [payText(j), expText(j), j.workMode, j.jobType !== "Full-time" ? j.jobType : null, ago(j.postedAt)].filter(Boolean);
  // One line on why it fits and one on the main thing against it (see Matcher.summary).
  const s = Matcher.summary(r);
  return `<button class="job-card ${J.current === j.id ? "active" : ""}" data-id="${esc(j.id)}" type="button">
      <div class="co" style="background:${coColor(j.company)}" aria-hidden="true">${esc(j.company[0])}</div>
      <div class="body">
        <h3>${esc(j.title)}</h3>
        <div class="meta">${esc(j.company)}, ${esc(j.cities.join(", ") || j.location)}</div>
        <div class="pills">${J.saved.has(j.id) ? `<span class="pill saved">Saved</span>` : ""}${r.confidence === "low" ? `<span class="pill">Limited info</span>` : ""}${pills.map((p) => `<span class="pill">${esc(p)}</span>`).join("")}</div>
        ${s.fit.length ? `<div class="why">${icon("checkCircle")}<span>${esc(s.fit.join("; "))}</span></div>` : ""}
        ${s.gap ? `<div class="why bad">${icon("alert")}<span>${esc(s.gap)}</span></div>` : ""}
      </div>
      <div class="side"><div class="scoreline"><b>${r.score}</b><span>/100 match</span></div>${fitBar(r.parts)}</div>
    </button>`;
}

// You, in the same terms as a job (archetype, B2B/B2C, verticals, years in product…). See matching.js.
function profileForScoring() {
  if (!J.cand) J.cand = Matcher.candidate(J.details, J.prefs);
  return J.cand;
}

function renderList() {
  const profile = profileForScoring();
  let rows, low = [];
  // Saved and hidden lists ignore the filters: they show everything you put there.
  const loose = { ...J.filters, productOnly: false, exactTitles: false, jobTypes: [], workModes: [], locations: [], companySizes: [], industries: [], avoid: [], search: "", postedWithin: 0 };
  if (J.view === "saved") {
    rows = Matcher.run(J.jobs.filter((j) => J.saved.has(j.id)), loose, profile, { sort: J.sort, minScore: -1 }).shown;
    $("headline").textContent = rows.length ? `${Matcher.plural(rows.length, "saved job")}` : "No saved jobs yet";
    $("subline").textContent = "Jobs you've saved to look at later. They stay here until you remove them.";
  } else if (J.view === "hidden") {
    rows = Matcher.run(J.jobs.filter((j) => J.hidden.has(j.id)), loose, profile, { sort: J.sort, minScore: -1 }).shown;
    $("headline").textContent = rows.length ? `${Matcher.plural(rows.length, "hidden job")}` : "No hidden jobs";
    $("subline").innerHTML = `Jobs you marked "Not interested". Open one and choose "Show this job again" to bring it back. <a href="#">Back to matches</a>`;
  } else {
    // Sorted once as a whole, so "include lower-fit" mixes them in by the chosen order.
    const all = Matcher.run(J.jobs, J.filters, profile, { hidden: J.hidden, sort: J.sort, minScore: -1 }).shown;
    const good = all.filter((r) => r.score >= 50);
    low = all.filter((r) => r.score < 50);
    rows = J.showLow ? all : good;
    $("headline").textContent = good.length ? `${Matcher.plural(good.length, "good match")} for you` : "No strong matches yet";
    const date = new Date(J.meta.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const viaSearch = J.jobs.some((j) => j.source === "adzuna");
    const nProduct = J.jobs.filter(Matcher.isProductRole).length;
    $("subline").innerHTML = esc(`${nProduct} product roles out of ${J.jobs.length} openings at ${J.meta.sources.length} companies, updated ${date}.`) +
      (J.hidden.size ? ` <a href="#hidden">${J.hidden.size} hidden</a>.` : "") +
      (viaSearch ? ` Includes <a href="https://www.adzuna.in" target="_blank" rel="noopener">jobs by Adzuna</a>.` : "");
  }
  $("open-filters").innerHTML = `${icon("filter", "width:16px;height:16px")}Filters${activeCount() ? ` (${activeCount()})` : ""}`;

  // Pages
  const pages = Math.max(1, Math.ceil(rows.length / J.perPage));
  J.page = Math.min(Math.max(1, J.page), pages);
  const from = (J.page - 1) * J.perPage;
  const pageRows = rows.slice(from, from + J.perPage);

  $("list-bar").innerHTML = rows.length ? `
    <span class="small" aria-live="polite">Showing ${from + 1}–${from + pageRows.length} of ${rows.length}${J.view === "matches" && J.showLow ? " (including lower-fit)" : ""}</span>
    <span class="bar-right">
      ${J.view === "saved" ? `<button class="btn text sm" id="download" type="button">${icon("download", "width:15px;height:15px")}Download list</button>` : ""}
      <label class="small" for="per-page">Per page</label>
      <select id="per-page">${[10, 20, 50, 100].map((n) => `<option ${n === J.perPage ? "selected" : ""}>${n}</option>`).join("")}</select>
    </span>` : "";
  if ($("per-page")) $("per-page").onchange = () => { J.perPage = Number($("per-page").value); J.page = 1; remember(); renderList(); };
  if ($("download")) $("download").onclick = () => downloadCSV(rows);

  if (!rows.length) {
    $("list").innerHTML = J.view === "saved"
      ? `<div class="card empty"><div class="icon-tile">${icon("bookmark")}</div><h3>Nothing saved yet</h3><p class="muted">Open a job and click Save to keep it here.</p></div>`
      : J.view === "hidden"
        ? `<div class="card empty"><div class="icon-tile">${icon("eyeOff")}</div><h3>No hidden jobs</h3><p class="muted">Jobs you mark "Not interested" show up here, so you can bring them back.</p></div>`
        : low.length
          ? `<div class="card empty"><div class="icon-tile">${icon("search")}</div><h3>No strong matches with these filters</h3>
             <p class="muted">${Matcher.plural(low.length, "job")} partly fit${low.length === 1 ? "s" : ""}. You can see them below, or try a related role or another city.</p></div>`
          : `<div class="card empty"><div class="icon-tile">${icon("search")}</div><h3>No jobs match these filters</h3>
             <p class="muted">Try adding a related role, another city, or turning on "Open to relocating".</p></div>`;
  } else {
    $("list").innerHTML = pageRows.map(cardHTML).join("");
    $("list").querySelectorAll(".job-card").forEach((c) => (c.onclick = () => openJob(c.dataset.id)));
  }

  const more = [pagerHTML(J.page, pages)];
  if (J.view === "matches" && low.length) more.push(J.showLow
    ? `<button class="btn text sm" id="toggle-low" type="button">Hide the ${Matcher.plural(low.length, "lower-fit job")}</button>`
    : `<button class="btn ghost" id="toggle-low" type="button">Show ${Matcher.plural(low.length, "lower-fit job")}</button>`);
  $("more").innerHTML = more.join("");
  $("more").querySelectorAll("[data-page]").forEach((b) => (b.onclick = () => {
    J.page = Number(b.dataset.page);
    renderList();
    $("list-bar").scrollIntoView({ behavior: "smooth", block: "start" });
    const first = $("list").querySelector(".job-card");
    if (first) first.focus({ preventScroll: true });
  }));
  if ($("toggle-low")) $("toggle-low").onclick = () => { J.showLow = !J.showLow; renderList(); };
  J.lastRows = rows;
}

// Page numbers with gaps: 1 … 4 5 6 … 12
function pagerHTML(page, pages) {
  if (pages <= 1) return "";
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const items = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) items.push(`<span class="gap" aria-hidden="true">…</span>`);
    items.push(`<button type="button" class="pg ${n === page ? "on" : ""}" data-page="${n}" ${n === page ? 'aria-current="page"' : ""} aria-label="Page ${n}">${n}</button>`);
  });
  return `<nav class="pager" aria-label="Pages">
    <button type="button" class="pg nav" data-page="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="Previous page">${icon("arrowL", "width:16px;height:16px")}<span>Previous</span></button>
    ${items.join("")}
    <button type="button" class="pg nav" data-page="${page + 1}" ${page === pages ? "disabled" : ""} aria-label="Next page"><span>Next</span>${icon("arrowR", "width:16px;height:16px")}</button>
  </nav>`;
}

// Saved jobs as a spreadsheet file (opens in Excel / Google Sheets).
function downloadCSV(rows) {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Title", "Company", "Location", "Match", "Experience asked", "Posted", "Link"].map(cell).join(",")];
  for (const r of rows) {
    const j = r.job;
    lines.push([j.title, j.company, j.cities.join(" / ") || j.location, r.score, expText(j) || "", j.postedAt || "", j.url].map(cell).join(","));
  }
  const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `goodfit-saved-jobs-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloaded ${Matcher.plural(rows.length, "saved job")}`);
}

// Sort and page size are remembered in this browser.
function remember() {
  try { localStorage.setItem("goodfit_list_prefs", JSON.stringify({ sort: J.sort, perPage: J.perPage })); } catch {}
}
function recall() {
  try {
    const v = JSON.parse(localStorage.getItem("goodfit_list_prefs") || "{}");
    if (v.sort && [...$("sort").options].some((o) => o.value === v.sort)) J.sort = v.sort;
    if ([10, 20, 50, 100].includes(v.perPage)) J.perPage = v.perPage;
  } catch {}
  $("sort").value = J.sort;
}

// ---------- Detail drawer ----------
// ---------- Description with highlights ----------
// Marks, inside the job description, the words that match the person (green) and the must-haves they may
// lack (amber), and tags each must-have / preferred line. ev comes from Matcher.evidence().
const BULLET = /^[•●▪◦‣·–\-*]\s?/;
let markCache = null;
function marker(ev, inReq) {
  // One regex per line type, built from all terms; longer words first so "b2b saas" wins over "saas".
  const entries = [];
  for (const t of ev.terms) {
    if (t.scope === "req" && !inReq) continue;
    for (const w of t.words) if (w && w.length > 1) entries.push([w.toLowerCase(), t]);
  }
  for (const w of ev.places) entries.push([w, { key: "city", cls: "hit" }]);
  const seen = new Map();
  for (const [w, t] of entries.sort((a, b) => b[0].length - a[0].length)) {
    if (!seen.has(w) || (seen.get(w).cls === "gap" && t.cls === "hit")) seen.set(w, t);
  }
  const words = [...seen.keys()].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const years = "\\d{1,2}\\s*\\+?\\s*(?:(?:-|–|to)\\s*\\d{1,2}\\s*\\+?\\s*)?(?:years?|yrs?)";
  const re = new RegExp(`(^|[^a-z0-9])(${years}${words.length ? "|" + words.join("|") : ""})(?=[^a-z0-9]|$)`, "gi");
  return { re, seen };
}

function markText(raw, ev, inReq, counts) {
  const key = inReq ? "req" : "all";
  markCache = markCache && markCache.ev === ev ? markCache : { ev };
  const m = markCache[key] || (markCache[key] = marker(ev, inReq));
  let out = "", last = 0, hit;
  m.re.lastIndex = 0;
  while ((hit = m.re.exec(raw))) {
    const start = hit.index + hit[1].length, word = hit[2];
    let cls, k;
    const y = /^(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*(\d{1,2}))?/.exec(word);
    if (y && /years?|yrs?/i.test(word)) { cls = ev.years(+y[1], y[2] ? +y[2] : null); k = "years"; }
    else { const t = m.seen.get(word.toLowerCase()); cls = t && t.cls; k = t && t.key; }
    if (!cls) continue;
    out += esc(raw.slice(last, start)) + `<mark class="hl ${cls}" data-k="${esc(k)}">${esc(word)}</mark>`;
    last = start + word.length;
    counts[cls] = (counts[cls] || 0) + 1;
  }
  return out + esc(raw.slice(last));
}

function reqTag(info) {
  if (!info) return "";
  const what = info.kind === "must" ? "Must-have" : "Preferred";
  // Only say "shown in your resume" when everything the line asks for is there; never "you have this".
  const [cls, ic, text] = info.met === "yes" ? ["ok", "check", "shown in your resume"]
    : info.met === "partly" ? ["part", "alert", "partly shown in your resume"] : ["miss", "alert", "not shown in your resume"];
  return `<span class="req-tag ${cls}">${icon(ic)}${what}: ${text}</span>`;
}

function descriptionHTML(text, ev, counts = {}) {
  const line = (l) => {
    const body = l.replace(BULLET, "");
    const info = ev ? ev.lines.get(ev.norm(body)) : null;
    return { info, html: ev ? markText(body, ev, !!info, counts) : esc(body) };
  };
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return "";
    if (lines.length === 1 && lines[0].length < 70 && !/[.!?]$/.test(lines[0]) && !BULLET.test(lines[0])) return `<h4>${esc(lines[0].replace(/:$/, ""))}</h4>`;
    const items = lines.map((l) => ({ bullet: BULLET.test(l), ...line(l) }));
    if (items.every((x) => x.bullet)) {
      return `<ul>${items.map((x) => `<li class="${x.info ? `req ${x.info.kind} ${x.info.met === "yes" ? "met" : x.info.met === "partly" ? "part" : "miss"}` : ""}">${reqTag(x.info)}${x.html}</li>`).join("")}</ul>`;
    }
    return items.map((x) => (x.bullet ? `<ul><li class="${x.info ? `req ${x.info.kind} ${x.info.met === "yes" ? "met" : x.info.met === "partly" ? "part" : "miss"}` : ""}">${reqTag(x.info)}${x.html}</li></ul>`
      : `<p class="${x.info ? `req ${x.info.kind} ${x.info.met === "yes" ? "met" : x.info.met === "partly" ? "part" : "miss"}` : ""}">${reqTag(x.info)}${x.html}</p>`)).join("");
  }).join("");
}

// Jump from a reason to its evidence in the description, and flash it.
function showEvidence(k) {
  const jd = $("drawer").querySelector(".jd");
  const sel = k === "must" ? ".req.must" : k === "pref" ? ".req.pref" : `mark[data-k="${CSS.escape(k)}"]`;
  const el = jd.querySelector(sel);
  if (!el) return;
  jd.classList.remove("plain");
  // Scroll the drawer's own scroll area (scrollIntoView doesn't move it reliably on phones).
  const sc = $("drawer").querySelector(".scroll");
  const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - sc.clientHeight / 3;
  const far = Math.abs(top - sc.scrollTop) > 1500; // long jumps go straight there; the flash shows where
  sc.scrollTo({ top: Math.max(0, top), behavior: far || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

const highlightsOn = () => { try { return localStorage.getItem("goodfit_highlights") !== "off"; } catch { return true; } };

function openJob(id) {
  const j = J.jobs.find((x) => x.id === id);
  if (!j) return;
  J.current = id;
  const t = Matcher.run([j], { ...J.filters, jobTypes: [], workModes: [], locations: J.filters.locations, companySizes: [], industries: [], avoid: [], search: "", postedWithin: 0, exactTitles: false, productOnly: false }, profileForScoring(), { minScore: -1 }).shown[0]
    || { score: 0, good: [], bad: [], parts: {}, caps: [], confidence: "medium" };
  const saved = J.saved.has(id);
  const ev = Matcher.evidence(j, J.filters, profileForScoring());
  const counts = {};
  const jdHTML = descriptionHTML(j.description, ev, counts);
  const findable = (k) => k && (k === "must" || k === "pref" ? jdHTML.includes(`req ${k}`) : jdHTML.includes(`data-k="${k}"`));
  const reason = (text, cls) => {
    const k = t.links && t.links[text];
    return `<li class="${cls}">${icon(cls === "good" ? "checkCircle" : "alert")}<span>${esc(text)}${findable(k) ? ` <button type="button" class="show-ev" data-k="${esc(k)}">Show</button>` : ""}</span></li>`;
  };
  const facts = [["Experience", expText(j) || "Not stated"], ["Work mode", j.workMode || "Not stated"], ["Job type", j.jobType],
    ["Posted", ago(j.postedAt) || "—"], ["Team", j.department || "—"], ["Company", [j.industry, j.companySize.replace(/\s*\(.*\)/, "")].filter(Boolean).join(", ") || "—"]];
  const lpa = (n) => (n / 1e5).toFixed(n % 1e5 ? 1 : 0);
  if (j.salaryMin) facts.push(["Pay", `₹${lpa(j.salaryMin)}${j.salaryMax && j.salaryMax !== j.salaryMin ? `–${lpa(j.salaryMax)}` : ""} LPA`]);
  const viaSearch = j.source === "adzuna";
  $("drawer").innerHTML = `
    <header>
      <div class="top-row">
        <div class="co" style="background:${coColor(j.company)}" aria-hidden="true">${esc(j.company[0])}</div>
        <div style="min-width:0"><h2 id="drawer-title">${esc(j.title)}</h2><div class="muted">${esc(j.company)}, ${esc(j.location)}</div></div>
        <button class="close" id="close-drawer" aria-label="Close">${icon("x")}</button>
      </div>
      <div class="btns">
        <a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener">${viaSearch ? "See the full job" : `Apply on ${esc(j.company)}'s site`} ${icon("external", "width:16px;height:16px")}</a>
        <button class="btn ghost ${saved ? "on" : ""}" id="save-job" type="button" aria-pressed="${saved}">${icon("bookmark", "width:16px;height:16px")}${saved ? "Saved" : "Save"}</button>
        ${J.hidden.has(id)
          ? `<button class="btn ghost" id="unhide-job" type="button">${icon("eye", "width:16px;height:16px")}Show this job again</button>`
          : `<button class="btn ghost" id="hide-job" type="button">${icon("eyeOff", "width:16px;height:16px")}Not interested</button>`}
      </div>
    </header>
    <div class="scroll">
      <section class="match-box" aria-label="How this job matches you">
        <div class="mb-head"><b>How it fits you</b><div class="scoreline"><b>${t.score}</b><span>/100</span></div></div>
        ${fitBar(t.parts, { cls: "lg" })}
        ${fitList(t.parts)}
        ${t.caps.length ? `<div class="caps">${t.caps.map((c) => `<p>${icon("alert")}<span><b>Ranked low:</b> ${esc(c)}</span></p>`).join("")}</div>` : ""}
        ${t.confidence === "low" ? `<p class="conf">${icon("info")}<span>Limited info: ${j.source === "adzuna" ? "this is a short preview" : "the description is short"}, so parts of this score are estimates.</span></p>` : ""}
        ${t.good.length || t.bad.length ? `<ul class="reasons">${t.good.map((g) => reason(g, "good")).join("")}${t.bad.map((b) => reason(b, "bad")).join("")}</ul>` : ""}
      </section>
      <div class="facts-grid">${facts.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
      ${counts.hit || counts.gap ? `<div class="hl-bar">
        <p><span class="hl-key hit">${counts.hit || 0} ${counts.hit === 1 ? "match" : "matches"} with your profile</span>
          ${counts.gap ? `<span class="hl-key gap">${counts.gap} possible ${counts.gap === 1 ? "gap" : "gaps"}</span>` : ""}</p>
        <label class="switch"><input type="checkbox" id="hl-toggle" ${highlightsOn() ? "checked" : ""}>Highlight</label>
      </div>` : ""}
      <div class="jd ${highlightsOn() ? "" : "plain"}">${jdHTML}</div>
      <p class="source-note">${viaSearch
        ? `Found through <a href="https://www.adzuna.in" target="_blank" rel="noopener">Adzuna</a>, a job search engine, so this is a short preview. “See the full job” opens the full posting, where you can apply. GoodFit never applies on your behalf without your OK.`
        : `From ${esc(j.company)}'s public careers page. “Apply” opens the company's own page; GoodFit never applies on your behalf without your OK.`}</p>
    </div>`;
  $("drawer").classList.add("open");
  $("drawer").setAttribute("aria-hidden", "false");
  $("drawer-bg").classList.add("open");
  $("drawer").querySelector(".scroll").scrollTop = 0;
  $("close-drawer").onclick = closeDrawer;
  $("drawer").querySelectorAll(".show-ev").forEach((b) => (b.onclick = () => { showEvidence(b.dataset.k); if ($("hl-toggle")) $("hl-toggle").checked = true; }));
  if ($("hl-toggle")) $("hl-toggle").onchange = () => {
    const on = $("hl-toggle").checked;
    $("drawer").querySelector(".jd").classList.toggle("plain", !on);
    try { localStorage.setItem("goodfit_highlights", on ? "on" : "off"); } catch {}
  };
  $("close-drawer").focus();
  $("save-job").onclick = () => {
    if (J.saved.has(id)) J.saved.delete(id); else J.saved.add(id);
    storeLists();
    toast(J.saved.has(id) ? "Saved" : "Removed from saved");
    openJob(id);
    renderList();
  };
  if ($("unhide-job")) $("unhide-job").onclick = () => {
    J.hidden.delete(id);
    storeLists();
    closeDrawer();
    renderList();
    toast("Back in your matches");
  };
  if ($("hide-job")) $("hide-job").onclick = () => {
    J.hidden.add(id);
    J.saved.delete(id);
    storeLists();
    closeDrawer();
    renderList();
    toastUndo("Hidden. We won't show this job again.", () => { J.hidden.delete(id); storeLists(); renderList(); });
  };
  document.querySelectorAll(".job-card").forEach((c) => c.classList.toggle("active", c.dataset.id === id));
}

function closeDrawer() {
  const was = J.current;
  J.current = null;
  $("drawer").classList.remove("open");
  $("drawer").setAttribute("aria-hidden", "true");
  $("drawer-bg").classList.remove("open");
  $("filters").classList.remove("open");
  document.querySelectorAll(".job-card.active").forEach((c) => c.classList.remove("active"));
  const card = was && document.querySelector(`.job-card[data-id="${CSS.escape(was)}"]`);
  if (card) card.focus({ preventScroll: true });
}

// ---------- View switching ----------
function setView() {
  J.view = location.hash === "#saved" ? "saved" : location.hash === "#hidden" ? "hidden" : "matches";
  $("tab-matches").classList.toggle("on", J.view === "matches");
  $("tab-saved").classList.toggle("on", J.view === "saved");
  J.page = 1;
  renderList();
}

// ---------- Jobs data ----------
// Loading and cleaning jobs lives in jobs-data.js, shared with the email preview and the report sender.
const { fromRow, dedupe } = JobsData;
const loadJobs = () => JobsData.loadJobs();

// ---------- Start ----------
async function init() {
  const { data } = await db.auth.getSession();
  if (!data.session) { location.href = "auth.html"; return; }
  J.user = data.session.user;
  $("avatar").textContent = (J.user.email || "?")[0].toUpperCase();

  const { data: profile } = await db.from("profiles").select("*").maybeSingle();
  if (!profile || profile.step !== "review") { location.replace("dashboard.html"); return; }
  J.details = profile.details || {};
  J.prefs = profile.preferences || {};
  J.filters = filtersFromPrefs(J.prefs);
  loadLists();

  let firstTime = true;
  try { firstTime = !sessionStorage.getItem("jp_found") || new URLSearchParams(location.search).has("fresh"); sessionStorage.setItem("jp_found", "1"); } catch {}

  const load = loadJobs().then((d) => {
    J.meta = { updatedAt: d.updatedAt, sources: d.sources };
    J.jobs = Matcher.prepare(d.jobs);
  });
  await runFinder(load, firstTime);

  $("main").classList.remove("hide");
  recall();
  renderFilters();
  setView();
  Agent.mount();
  extensionPromo();
}

// A one-line pointer to GoodFit for Chrome, until you've agreed to it or closed this.
function extensionPromo() {
  const key = "goodfit_ext_promo_closed";
  let closed = false;
  try { closed = localStorage.getItem(key) === "1"; } catch {}
  if (closed || (J.prefs.extension && J.prefs.extension.agreedAt)) return;
  $("ext-promo").classList.remove("hide");
  $("ext-promo-x").onclick = () => { $("ext-promo").classList.add("hide"); try { localStorage.setItem(key, "1"); } catch {} };
}

$("sort").onchange = () => { J.sort = $("sort").value; J.page = 1; remember(); renderList(); };
$("drawer-bg").onclick = closeDrawer;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
$("open-filters").onclick = () => { $("filters").classList.add("open"); $("drawer-bg").classList.add("open"); };
window.addEventListener("hashchange", setView);
$("logout").onclick = async () => { await db.auth.signOut(); location.href = "index.html"; };
init().catch((e) => {
  console.error(e);
  $("finder").classList.add("hide");
  $("main").classList.remove("hide");
  $("list").innerHTML = `<div class="card empty"><h3>Something went wrong loading jobs</h3><p class="muted">${esc(e.message)}</p></div>`;
});
