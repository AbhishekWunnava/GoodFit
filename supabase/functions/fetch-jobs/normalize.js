// Turns raw careers-feed postings (Greenhouse, Lever, Ashby) into GoodFit's job shape.
// Plain JavaScript with no imports, so the Edge Function (Deno) and a browser can both use it.
//
// Job shape (same fields as jobs.json, which the Matches page and matching.js expect):
//   { id, company, industry, companySize, title, location, cities[], workMode, jobType,
//     department, postedAt (YYYY-MM-DD), url, expMin, expMax, description }
// workMode is "Remote" | "Hybrid" | "On-site" | null (not stated).
// Only jobs based in India (or remote within India) are kept.

export const FEEDS = {
  greenhouse: (board) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
  lever: (board) => `https://api.lever.co/v0/postings/${board}?mode=json`,
  ashby: (board) => `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
};

// Spellings people use -> the city names the app filters on (keep in step with matching.js).
const CITY = {
  bengaluru: "Bengaluru", bangalore: "Bengaluru", "navi mumbai": "Mumbai", mumbai: "Mumbai", thane: "Mumbai",
  "delhi ncr": "Delhi NCR", "delhi-ncr": "Delhi NCR", "new delhi": "Delhi NCR", delhi: "Delhi NCR", ncr: "Delhi NCR",
  gurugram: "Delhi NCR", gurgaon: "Delhi NCR", noida: "Delhi NCR", hyderabad: "Hyderabad", pune: "Pune",
  chennai: "Chennai", kolkata: "Kolkata", ahmedabad: "Ahmedabad", jaipur: "Jaipur", kochi: "Kochi",
  indore: "Indore", chandigarh: "Chandigarh", lucknow: "Lucknow", coimbatore: "Coimbatore", mohali: "Chandigarh",
};
const CITY_KEYS = Object.keys(CITY).sort((a, b) => b.length - a.length);
const INDIA_WORDS = /\b(india|indian|karnataka|maharashtra|telangana|tamil nadu|haryana|uttar pradesh|west bengal|gujarat|kerala|rajasthan)\b/i;

// ---------- Text helpers ----------
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", rarr: "→", trade: "™", reg: "®", copy: "©", eacute: "é" };
export function decode(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

// HTML -> plain text that the Matches page's description renderer understands:
// paragraphs separated by blank lines, list items as "• item" lines, headings on their own line.
export function htmlToText(html) {
  let s = String(html ?? "");
  if (/&lt;\s*\w/.test(s) && !/<\s*\w/.test(s)) s = decode(s); // Greenhouse escapes its HTML once
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n\n")
    .replace(/<h[1-6][^>]*>/gi, "\n\n")
    .replace(/<\/(h[1-6]|p|div|section|blockquote|table|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  s = decode(s).replace(/ /g, " ").replace(/[ \t]+/g, " ");
  const lines = s.split("\n").map((l) => l.trim());
  const out = [];
  for (const l of lines) {
    if (l === "•" || l === "• ") continue;
    if (!l) { if (out.length && out[out.length - 1] !== "") out.push(""); continue; }
    // A bullet right after a paragraph line starts its own block; bullets stay together.
    if (l.startsWith("•") && out.length && out[out.length - 1] !== "" && !out[out.length - 1].startsWith("•")) out.push("");
    if (!l.startsWith("•") && out.length && out[out.length - 1].startsWith("•")) out.push("");
    out.push(l);
  }
  // Drop blank lines between consecutive bullets.
  const tidy = out.filter((l, i) => !(l === "" && out[i - 1]?.startsWith("•") && out[i + 1]?.startsWith("•")));
  return tidy.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- Field helpers ----------
export function citiesIn(...texts) {
  const found = [];
  for (const t of texts) {
    const low = ` ${String(t ?? "").toLowerCase()} `;
    for (const k of CITY_KEYS) {
      if (new RegExp(`(^|[^a-z])${k.replace(/[-]/g, "\\-")}([^a-z]|$)`).test(low) && !found.includes(CITY[k])) found.push(CITY[k]);
    }
  }
  return found;
}

export function isIndia(texts, country) {
  if (country && /^(in|ind|india)$/i.test(country)) return true;
  const all = texts.filter(Boolean).join(" | ");
  return INDIA_WORDS.test(all) || citiesIn(all).length > 0;
}

function workModeFrom(value, ...texts) {
  const v = String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (v === "remote") return "Remote";
  if (v === "hybrid") return "Hybrid";
  if (v === "onsite" || v === "inoffice" || v === "office") return "On-site";
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (/\bhybrid\b/.test(t)) return "Hybrid";
  if (/\bremote\b/.test(t)) return "Remote";
  if (/\bon-?site\b|\bin-office\b|work from (the )?office/.test(t)) return "On-site";
  return null;
}

function jobTypeFrom(value, title) {
  const v = String(value ?? "").toLowerCase();
  const t = String(title ?? "").toLowerCase();
  if (/intern/.test(v) || /\bintern(ship)?\b/.test(t)) return "Internship";
  if (/contract|temporary|fixed.?term/.test(v) || /\bcontract(ual)?\b/.test(t)) return "Contract";
  if (/part.?time/.test(v)) return "Part-time";
  return "Full-time";
}

const day = (d) => {
  const t = typeof d === "number" ? d : Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

// Years of experience the job asks for, e.g. "3-5 years", "5+ years", "at least 4 years of experience".
export function experienceFrom(text) {
  const t = String(text ?? "").replace(/\s+/g, " ");
  const Y = "(?:years?|yrs?)";
  const tries = [
    [new RegExp(`(\\d{1,2}(?:\\.\\d)?)\\s*\\+?\\s*(?:-|–|—|to)\\s*(\\d{1,2})\\s*\\+?\\s*${Y}`, "i"), (m) => [m[1], m[2]]],
    [new RegExp(`(?:at least|minimum(?: of)?|min\\.?|over|more than)\\s*(\\d{1,2})\\s*\\+?\\s*${Y}`, "i"), (m) => [m[1], null]],
    [new RegExp(`(\\d{1,2})\\s*(?:\\+|or more|plus)\\s*${Y}`, "i"), (m) => [m[1], null]],
    [new RegExp(`(\\d{1,2})\\s*${Y}\\s*(?:of\\s+)?(?:[\\w/&,-]+\\s+){0,5}?(?:experience|exp\\b)`, "i"), (m) => [m[1], null]],
  ];
  // A stated range ("2-5 years") wins; otherwise the first mention in the text.
  let best = null;
  for (const [i, [re, pick]] of tries.entries()) {
    const m = re.exec(t);
    if (!m) continue;
    let [min, max] = pick(m).map((x) => (x == null ? null : Math.floor(Number(x))));
    if (!(min >= 0 && min <= 30)) continue;
    if (max != null && !(max > min && max <= 40)) max = null;
    // "up to 2 years" is a ceiling, not a minimum.
    if (max == null && /up to\s*~?\s*$/i.test(t.slice(Math.max(0, m.index - 10), m.index))) { max = min; min = 0; }
    const hit = { index: m.index, min, max };
    if (i === 0 && max != null) { best = hit; break; }
    if (!best || hit.index < best.index) best = hit;
  }
  return best ? { expMin: best.min, expMax: best.max } : { expMin: null, expMax: null };
}

// ---------- Per-feed normalisers ----------
// source = { company, ats, board, industry, company_size }
function base(source, raw) {
  const desc = raw.description;
  return {
    company: source.company,
    industry: source.industry || "Other",
    companySize: source.company_size || "Mid-size (501–5,000)",
    ...experienceFrom(desc),
    ...raw,
    title: String(raw.title || "").trim(),
    description: desc,
  };
}

function fromGreenhouse(source, j) {
  const offices = (j.offices || []).map((o) => o.location || o.name);
  const location = j.location?.name || offices.join(", ");
  if (!isIndia([location, ...offices])) return null;
  const description = htmlToText(j.content);
  return base(source, {
    id: `${source.board}-${j.id}`,
    title: j.title,
    location,
    cities: citiesIn(location).length ? citiesIn(location) : citiesIn(...offices),
    workMode: workModeFrom(null, location, j.title),
    jobType: jobTypeFrom(null, j.title),
    department: j.departments?.[0]?.name || null,
    postedAt: day(j.first_published || j.updated_at),
    url: j.absolute_url,
    description,
  });
}

function fromLever(source, j) {
  const c = j.categories || {};
  const all = c.allLocations || (c.location ? [c.location] : []);
  if (!isIndia([c.location, ...all], j.country)) return null;
  const lists = (j.lists || []).map((l) => `${l.text}\n\n${htmlToText(`<ul>${l.content}</ul>`)}`).join("\n\n");
  const description = [htmlToText(j.description || j.descriptionPlain), lists, htmlToText(j.additional || j.additionalPlain)]
    .filter(Boolean).join("\n\n");
  return base(source, {
    id: `${source.board}-${j.id}`,
    title: j.text,
    location: all.join(", ") || c.location || "India",
    cities: citiesIn(...all),
    workMode: workModeFrom(j.workplaceType === "unspecified" ? null : j.workplaceType, c.location, j.text),
    jobType: jobTypeFrom(c.commitment, j.text),
    department: c.department || c.team || null,
    postedAt: day(j.createdAt),
    url: j.hostedUrl,
    description,
  });
}

function fromAshby(source, j) {
  if (j.isListed === false) return null;
  const locs = [j.location, ...(j.secondaryLocations || []).map((l) => l.location)];
  const country = j.address?.postalAddress?.addressCountry;
  if (!isIndia(locs, country)) return null;
  return base(source, {
    id: `${source.board}-${j.id}`,
    title: j.title,
    location: locs.filter(Boolean).join(", ") || "India",
    cities: citiesIn(...locs, j.address?.postalAddress?.addressLocality),
    workMode: workModeFrom(j.workplaceType || (j.isRemote ? "remote" : null), j.location),
    jobType: jobTypeFrom(j.employmentType, j.title),
    department: j.department || j.team || null,
    postedAt: day(j.publishedAt),
    url: j.jobUrl,
    description: htmlToText(j.descriptionHtml || j.descriptionPlain),
  });
}

// ---------- Job search engine: Adzuna ----------
// One page of an Adzuna India search. Docs: developer.adzuna.com (endpoint /v1/api/jobs/in/search/{page}).
export function adzunaUrl(search, page, appId, appKey) {
  const q = new URLSearchParams({
    app_id: appId, app_key: appKey, results_per_page: "50", what: search.what,
    max_days_old: String(search.max_days_old || 30), sort_by: "date", "content-type": "application/json",
  });
  if (search.where) q.set("where", search.where);
  return `https://api.adzuna.com/v1/api/jobs/in/search/${page}?${q}`;
}

// Company name without legal suffixes, for spotting the same employer twice
// ("Razorpay Software Private Limited" and "Razorpay" -> "razorpay software" / "razorpay").
export function companyKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(private|pvt|limited|ltd|llp|inc|incorporated|corp|corporation|co|company|india|technologies|technology|tech|solutions|services|software|labs|group)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
export const sameCompany = (a, b) => {
  const x = companyKey(a), y = companyKey(b);
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
};

// Adzuna result -> GoodFit job. Descriptions are short snippets, and "url" goes to the original posting via Adzuna.
export function fromAdzuna(r) {
  const title = htmlToText(r.title);
  const description = htmlToText(r.description);
  const area = r.location?.area || [];
  const location = r.location?.display_name || area.slice(1).reverse().join(", ") || "India";
  if (!isIndia([location, ...area])) return null;
  const company = htmlToText(r.company?.display_name || "") || "Company not named";
  const ct = r.contract_type === "contract" ? "contract" : r.contract_time === "part_time" ? "part time" : "";
  const predicted = String(r.salary_is_predicted) === "1"; // Adzuna's own estimate, not from the employer
  const salary = (n) => (Number.isFinite(n) && n > 0 && !predicted ? Math.round(n) : null);
  return {
    id: `adzuna-${r.id}`,
    source: "adzuna",
    company,
    industry: (r.category?.label || "Other").replace(/\s+Jobs$/i, ""),
    companySize: "",
    title,
    location,
    cities: citiesIn(location, ...area),
    workMode: workModeFrom(null, title, description),
    jobType: jobTypeFrom(ct, title),
    department: null,
    postedAt: day(r.created),
    url: r.redirect_url,
    ...experienceFrom(`${title}. ${description}`),
    salaryMin: salary(Number(r.salary_min)),
    salaryMax: salary(Number(r.salary_max)),
    description,
  };
}

// Feed JSON -> list of jobs in GoodFit's shape (India only).
export function normalize(source, feed) {
  const list = source.ats === "greenhouse" ? feed.jobs : source.ats === "lever" ? feed : source.ats === "ashby" ? feed.jobs : null;
  if (!Array.isArray(list)) throw new Error(`Unexpected ${source.ats} response for ${source.board}`);
  const fn = { greenhouse: fromGreenhouse, lever: fromLever, ashby: fromAshby }[source.ats];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const job = fn(source, raw);
    if (job && job.title && job.url && !seen.has(job.id)) { seen.add(job.id); out.push(job); }
  }
  return out;
}
