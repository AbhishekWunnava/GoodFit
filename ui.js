// Shared UI helpers used by the onboarding (dashboard.js) and jobs (jobs.js) pages.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uniq = (arr) => arr.filter((v, i) => v && arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);

const OPTIONS = {
  seniority: ["Entry level", "Mid level", "Senior", "Lead / Manager", "Director and above"],
  jobTypes: ["Full-time", "Contract", "Part-time", "Internship", "Freelance"],
  workModes: ["Remote", "Hybrid", "On-site"],
  notice: ["Immediately available", "15 days", "30 days", "60 days", "90 days", "More than 90 days"],
  companySizes: ["Early-stage startup (1–50)", "Growth startup (51–500)", "Mid-size (501–5,000)", "Large / MNC (5,000+)"],
  mustHaves: ["Health insurance", "Flexible hours", "ESOPs / equity", "Learning budget", "Parental leave", "Visa sponsorship"],
  currencies: { INR: "₹", USD: "$", EUR: "€", GBP: "£", SGD: "S$", AED: "AED " },
};
const CITY_SUGGESTIONS = ["Bengaluru", "Mumbai", "Delhi NCR", "Hyderabad", "Pune", "Chennai", "Kolkata", "Ahmedabad"];
const INDUSTRY_SUGGESTIONS = ["Fintech", "SaaS", "E-commerce", "Healthtech", "Edtech", "AI / ML", "Consumer tech", "BFSI", "Consulting", "Logistics", "Gaming", "Media"];

const ICON = {
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  arrowR: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  arrowL: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/>',
};
const icon = (name, style = "") => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" ${style ? `style="${style}"` : ""}>${ICON[name]}</svg>`;

// The fit bar: one segment per part of the score, sized by its maximum points, filled by what the job earned.
function fitBar(parts, opts = {}) {
  const P = (window.Matcher && Matcher.PARTS) || [["role", "Role", 45], ["experience", "Experience", 25], ["seniority", "Seniority", 15], ["location", "Location", 10], ["skills", "Skills", 5]];
  const p = parts || {};
  const total = P.reduce((a, [k]) => a + (p[k] || 0), 0);
  const label = `Match ${total} out of 100: ` + P.map(([k, n, max]) => `${n.toLowerCase()} ${p[k] || 0} of ${max}`).join(", ");
  return `<div class="fit ${opts.cls || ""}" role="img" aria-label="${esc(label)}">${P.map(([k, , max]) =>
    `<span class="seg" style="flex:${max}"><i style="width:${Math.round(((p[k] || 0) / max) * 100)}%"></i></span>`).join("")}</div>`;
}
// The same parts as labelled rows, for the job detail drawer.
function fitList(parts) {
  const P = Matcher.PARTS;
  return `<ul class="fit-list">${P.map(([k, n, max]) => {
    const v = (parts || {})[k] || 0;
    return `<li><span>${n}</span><div class="fit" aria-hidden="true"><span class="seg" style="flex:1"><i style="width:${Math.round((v / max) * 100)}%"></i></span></div><b class="${v ? "" : "zero"}">${Math.round(v)}/${max}</b></li>`;
  }).join("")}</ul>`;
}

function fmtYears(y) {
  if (y === null || y === undefined || y === "") return "—";
  y = Number(y);
  if (y < 1) return "Less than 1 year";
  return `${y} year${y === 1 ? "" : "s"}`;
}

function toast(text, isErr) {
  const t = $("toast");
  t.innerHTML = (isErr ? icon("alert", "width:16px;height:16px") : icon("check", "width:16px;height:16px")) + esc(text);
  t.style.background = isErr ? "var(--brick)" : "var(--ink)";
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- Reusable bits ----------
function field(label, inner, opts = {}) {
  const badge = opts.badge === undefined ? "" : opts.badge
    ? `<span class="badge found">${icon("check")}From your resume</span>`
    : `<span class="badge missing">Please add</span>`;
  return `<div class="field" ${opts.id ? `id="f-${opts.id}"` : ""}>
    <label ${opts.for ? `for="${opts.for}"` : 'class="label"'}>${label}${opts.hint ? ` <span class="hint">${opts.hint}</span>` : ""}${badge}</label>
    ${inner}
    ${opts.err ? `<div class="err-text">${opts.err}</div>` : ""}
  </div>`;
}

function optsHTML(name, options, selected, type = "checkbox") {
  const sel = Array.isArray(selected) ? selected : [selected];
  return `<div class="opts" role="group">${options.map((o) =>
    `<label class="opt"><input type="${type}" name="${name}" value="${esc(o)}" ${sel.includes(o) ? "checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div>`;
}
const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

function chipsHTML(key, placeholder, list) {
  return `<div class="chips-input" data-chips="${key}"><input type="text" id="chips-${key}" placeholder="${esc(placeholder)}" autocomplete="off" ${list ? `list="${list}"` : ""}></div>
    <div class="suggest" data-suggest="${key}"></div>`;
}

// Tag input: Enter or comma adds, Backspace on empty removes the last one.
function mountChips(key, initial, suggestions, onChange = () => {}) {
  const box = document.querySelector(`[data-chips="${key}"]`);
  const input = box.querySelector("input");
  const sug = document.querySelector(`[data-suggest="${key}"]`);
  const list = [...(initial || [])];
  const changed = () => { draw(); onChange(list); };
  const add = (v) => {
    v = v.trim().replace(/,+$/, "").trim();
    if (!v || list.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    list.push(v);
    changed();
  };
  function draw() {
    box.querySelectorAll(".chip").forEach((c) => c.remove());
    list.forEach((v, i) => {
      const c = document.createElement("span");
      c.className = "chip";
      c.innerHTML = `${esc(v)}<button type="button" aria-label="Remove ${esc(v)}">×</button>`;
      c.querySelector("button").onclick = () => { list.splice(i, 1); changed(); input.focus(); };
      box.insertBefore(c, input);
    });
    const left = (suggestions() || []).filter((s) => !list.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
    sug.innerHTML = left.length ? `<span class="small">Add:</span>` + left.map((s) => `<button type="button" class="chip-btn">+ ${esc(s)}</button>`).join("") : "";
    sug.querySelectorAll(".chip-btn").forEach((b, i) => (b.onclick = () => add(left[i])));
  }
  input.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); add(input.value); input.value = ""; }
    else if (e.key === "Enter") e.preventDefault();
    else if (e.key === "Backspace" && !input.value && list.length) { list.pop(); changed(); }
  });
  input.addEventListener("blur", () => { if (input.value.trim()) { add(input.value); input.value = ""; } });
  box.addEventListener("click", (e) => { if (e.target === box) input.focus(); });
  draw();
  return list;
}


function roleDatalist() {
  if (!window.ROLES || $("role-list")) return "";
  return `<datalist id="role-list">${ROLES.names().map((r) => `<option value="${esc(r)}">`).join("")}</datalist>`;
}
