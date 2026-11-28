// Scores PM jobs against a person's profile and filters, and says why (V1, rules-based).
// Every point comes with a reason. Job details are read by signals.js; the person by candidate().
//
// Score out of 100:
//   Role        23  true PM vs Product Owner / program / BA role (15) + level and people management (8)
//   Must-haves  19  share of the job's checkable must-haves you meet (15) + preferred qualifications (4)
//   Experience  15  your years in product vs the years asked (12) + total years (3)
//   Domain      28  same sub-vertical / vertical / nearby (12) + B2B / B2C model (10) + segment, market, GTM (6)
//   Company      8  product company vs GCC vs services, and what you're open to
//   Practical    7  location and work mode (5) + pay and notice period (2)
// Unknown counts as 70% of a part, not zero. A must-have line counts by how much of it your profile shows
// ("Android or iOS, and UX" with only UX = half). Mismatches cap the score (the lowest cap wins):
// not a product role 25, PO / delivery / BA role 40, not in your cities 40, missing a must-have domain or
// regulation 45, too few years in product 45, more senior than the role needs 72 / 62 / 48 (1–2, 2–4, 4+ years
// over the top of the range), written for early-career PMs 60, likely below your level 55.
// Older postings then lose points: 2 after a month, 5 after two, 10 after three, 20 after six.
// Best-match order spreads companies out: at most 3 from one company in each block of 10.
// Hard filters (product roles only, job type, work mode, company size, industry, keywords to avoid, posted date, search,
// exact titles) remove a job entirely; the score orders what's left.
window.Matcher = (() => {
  const LEVELS = ["Entry level", "Mid level", "Senior", "Lead / Manager", "Director and above"];
  const CITY = {
    bengaluru: "Bengaluru", bangalore: "Bengaluru", mumbai: "Mumbai", "navi mumbai": "Mumbai", thane: "Mumbai",
    "delhi ncr": "Delhi NCR", delhi: "Delhi NCR", "new delhi": "Delhi NCR", ncr: "Delhi NCR", gurugram: "Delhi NCR",
    gurgaon: "Delhi NCR", noida: "Delhi NCR", hyderabad: "Hyderabad", pune: "Pune", chennai: "Chennai", kolkata: "Kolkata",
    ahmedabad: "Ahmedabad", jaipur: "Jaipur", kochi: "Kochi", indore: "Indore", chandigarh: "Chandigarh", lucknow: "Lucknow",
  };
  const city = (c) => CITY[String(c).toLowerCase().trim()] || String(c).trim();
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : /(s|x|ch|sh)$/.test(w) ? "es" : "s"}`;

  // Work out each job's standard role and level once.
  function prepare(jobs) {
    for (const j of jobs) {
      const m = window.ROLES ? ROLES.match(j.title) : null;
      j._role = m ? m.role : null;
      j._family = m ? m.family : null;
      j._level = m ? m.seniority : null;
      j._text = (j.title + "\n" + j.description).toLowerCase();
      j._time = j.postedAt ? Date.parse(j.postedAt) : 0;
      j._sig = window.Signals ? Signals.extractJob(j) : null;
    }
    return jobs;
  }

  // Turn the person's wanted roles into standard roles + families.
  function targets(roles) {
    const std = new Set(), fam = new Set(), raw = [];
    for (const r of roles || []) {
      raw.push(r.toLowerCase());
      const m = window.ROLES ? ROLES.match(r) : null;
      if (m) { std.add(m.role); fam.add(m.family); }
    }
    return { std, fam, raw };
  }

  // Title words in one form, so "Sr. PM-2", "Senior PM 2" and "Senior Product Manager II" compare equal.
  function titleKey(s) {
    const t = String(s || "").toLowerCase()
      .replace(/\bsr\b\.?/g, "senior").replace(/\bspm\b/g, "senior product manager").replace(/\bpm\b/g, "product manager")
      .replace(/[^a-z0-9]+/g, " ").replace(/\b1\b/g, "i").replace(/\b2\b/g, "ii").replace(/\b3\b/g, "iii").replace(/\b4\b/g, "iv");
    return ` ${t.replace(/\s+/g, " ").trim()} `;
  }
  // "Only these exact titles": the job title must contain one of the wanted titles as whole words,
  // so "Product Manager II" matches "Product Manager II - Ads" but not "Product Manager III" or "Group Product Manager".
  const titleHit = (title, roles) => roles.some((r) => r.trim() && titleKey(title).includes(titleKey(r)));

  // A PM-type title: Product Manager / Owner / Lead / Head, APM, SPM, GPM, Director or VP of Product.
  const isProductRole = (j) => !!(j._sig ? j._sig.productTitle : window.Signals && Signals.extractJob(j).productTitle);

  function passes(j, f) {
    if (f.productOnly && !isProductRole(j)) return false;
    if (f.exactTitles && (f.roles || []).length && !titleHit(j.title, f.roles)) return false;
    if (f.jobTypes && f.jobTypes.length && !f.jobTypes.includes(j.jobType)) return false;
    if (f.workModes && f.workModes.length && j.workMode && !f.workModes.includes(j.workMode)) return false;
    // Unstated work mode is almost always office-based, so "Remote only" leaves those out.
    if (f.workModes && f.workModes.length && !j.workMode && f.workModes.every((m) => m === "Remote")) return false;
    if (f.companySizes && f.companySizes.length && !f.companySizes.includes(j.companySize)) return false;
    if (f.industries && f.industries.length && !f.industries.includes(j.industry)) return false;
    if (f.companies && f.companies.length && !f.companies.includes(j.company)) return false;
    if ((f.avoid || []).some((w) => w && (j._text.includes(w.toLowerCase()) || j.company.toLowerCase() === w.toLowerCase()))) return false;
    if (f.postedWithin && j._time && Date.now() - j._time > f.postedWithin * 864e5) return false;
    if (f.search) {
      const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
      const hay = (j.title + " " + j.company + " " + j.location).toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  // ---------- The person, in the same terms as a job ----------
  // details = profile.details (resume + "Your background"), prefs = profile.preferences.
  function candidate(details = {}, prefs = {}) {
    const b = details.background || {};
    const sig = details.signals || {};
    const concepts = new Set(sig.concepts || []);
    const add = (text) => window.Signals && Signals.conceptsIn(String(text || "").toLowerCase()).forEach((c) => concepts.add(c));
    add((details.skills || []).join(". "));
    add(details.education);
    add(details.currentRole);
    const models = b.models && b.models.length ? b.models : sig.models || [];
    const verticals = b.verticals && b.verticals.length ? b.verticals : sig.verticals || [];
    const subVerticals = b.subVerticals && b.subVerticals.length ? b.subVerticals : sig.subVerticals || [];
    models.forEach((m) => { if (m === "B2B") concepts.add("b2b"); if (m === "B2C") concepts.add("b2c"); });
    verticals.forEach((v) => concepts.add(`v:${v}`));
    subVerticals.forEach((v) => { concepts.add(`sv:${v}`); concepts.add(`v:${v.split(":")[0]}`); });
    (b.regulatory || sig.regulatory || []).forEach((r) => concepts.add(`reg:${r}`));
    if (b.managedPMs ?? sig.managedPMs) concepts.add("people_mgmt");
    if (concepts.has("engineering_degree")) concepts.add("technical"); // an engineering degree counts as a technical foundation
    const levelFromYears = details.seniority || null;
    return {
      years: details.years ?? null,
      pmYears: b.pmYears ?? details.pmYears ?? null,
      archetype: b.archetype || ((ROLES && details.currentRole && /product/i.test(details.currentRole)) ? (/owner/i.test(details.currentRole) ? "po" : "pm") : null),
      models, verticals, subVerticals,
      companyModels: b.companyModels && b.companyModels.length ? b.companyModels : sig.companyModels && sig.companyModels.length ? sig.companyModels : ["Product"],
      managedPMs: !!(b.managedPMs ?? sig.managedPMs),
      level: prefs.seniority || levelFromYears,
      concepts,
      openToServices: !!prefs.openToServices,
      openToDomainSwitch: !!prefs.openToDomainSwitch,
      expectedMin: Number(prefs.currency === "INR" || !prefs.currency ? prefs.expectedMin : 0) || null,
      notice: prefs.notice || "",
      skills: details.skills || [],
    };
  }

  // A requirement line is met when you have one of the things it names. If it names something specific
  // (a regulation, or a space like lending), the broad industry alone doesn't count: "KYC/AML experience"
  // isn't met by "fintech".
  // How much of a requirement line your profile shows, 0 to 1. "Android or iOS products and a strong
  // understanding of user experience" names two things (mobile, design): showing only design is half, not a yes.
  function coverage(item, has) {
    const specific = item.concepts.filter((k) => /^(reg:|sv:)/.test(k));
    const pool = specific.length ? [...specific, ...item.concepts.filter((k) => !/^(v:|reg:|sv:)/.test(k))] : item.concepts;
    return pool.length ? pool.filter(has).length / pool.length : 0;
  }
  // "yes" = everything it names is in your profile, "partly" = some of it, "no" = none of it.
  const meetsItem = (item, has) => { const c = coverage(item, has); return c >= 1 ? "yes" : c > 0 ? "partly" : "no"; };

  const NEUTRAL = 0.7; // share of a part's points when the job (or you) doesn't say
  const adjacent = (a, b) => window.Signals && Signals.ADJACENT.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const ARCH_NAME = { pm: "Product Manager", po: "Product Owner", program: "Program / project manager", ba: "Business analyst" };

  // Score out of 100 in six parts (see PARTS), each with reasons; caps for serious mismatches.
  function score(j, f, c, t) {
    const sig = j._sig || {};
    const good = [], bad = [], caps = [];
    const parts = {};
    // links: reason text -> what to point at in the description (see evidence()).
    const links = {};
    const cap = (n, why, k) => { caps.push([n, why]); if (k) links[why] = k; };
    const tag = (list, text, k) => { list.push(text); if (k) links[text] = k; };

    // --- Role (23): archetype 15 + scope and level 8
    let role = 0;
    const isTarget = (j._role && t.std.has(j._role)) || t.raw.some((r) => j.title.toLowerCase().includes(r));
    const isProduct = sig.productTitle || j._family === "Product";
    if (!isTarget && !isProduct) cap(25, j._role ? `A ${j._role} role, not a product role` : "Not a product role");
    else if (!isTarget && j._role) bad.push(`${j._role}, close to the roles you picked`);
    const ja = sig.archetype, ca = c.archetype || "pm";
    if (!ja) role += 15 * NEUTRAL;
    else if (ja === ca) { role += 15; good.push(ja === "pm" ? "A true PM role (strategy and outcomes)" : `${ARCH_NAME[ja]} role, like yours`); }
    else if ((ja === "po" && ca === "pm") || (ja === "pm" && ca === "po")) { role += 5; bad.push(`Reads like a ${ARCH_NAME[ja]} role (backlog and delivery) more than product strategy`); }
    else bad.push(`Reads like a ${ARCH_NAME[ja]} role`);
    if (ca === "pm" && ["po", "program", "ba"].includes(ja)) cap(40, sig.companyModel === "Services" ? `A ${ARCH_NAME[ja]} role at a services company` : `This is really a ${ARCH_NAME[ja]} role`);
    const myLevel = f.seniority || c.level;
    const want = LEVELS.indexOf(myLevel), have = LEVELS.indexOf(j._level);
    let scope = want < 0 || have < 0 ? 8 * NEUTRAL : want === have ? 8 : Math.abs(want - have) === 1 ? 4 : 0;
    const lvl = (l) => (/level|above/.test(l) ? l : `${l} level`); // "Mid level", "Senior level", "Director and above"
    if (want >= 0 && have >= 0 && want !== have) bad.push(`${lvl(j._level)} role (you're ${myLevel})`);
    else if (want >= 0 && want === have) good.push(`${lvl(j._level)}, like you`);
    if (sig.peopleMgmt && !c.managedPMs) { scope = Math.max(0, scope - 5); tag(bad, "Asks for managing a team of PMs", "people_mgmt"); }
    else if (sig.peopleMgmt && c.managedPMs) tag(good, "Asks for managing PMs, which you've done", "people_mgmt");
    else if (!sig.peopleMgmt && c.managedPMs && want >= 0 && have >= 0 && want - have >= 2) cap(55, `${j._level} individual role; likely below your level`);
    parts.role = role + scope;

    // --- Must-haves (19): must-haves 15 + preferred 4
    const mine = (k) => c.concepts.has(k);
    const share = (item) => coverage(item, mine);
    const must = sig.must || [], pref = sig.pref || [];
    const metM = must.filter((x) => share(x) >= 1), partM = must.filter((x) => share(x) > 0 && share(x) < 1);
    const missM = must.filter((x) => share(x) === 0);
    let reqs = must.length ? 15 * (must.reduce((a, x) => a + share(x), 0) / must.length) : 15 * NEUTRAL;
    if (must.length) {
      const partly = partM.length ? `, partly ${partM.length} more` : "";
      tag(metM.length === must.length ? good : bad, `Your resume shows ${metM.length} of ${must.length} must-haves we could check${partly}`, "must");
    }
    // A missed must-have caps the score only when it names a regulation or a specific space (e.g. lending)
    // and isn't softened ("or similar", "preferably", "a plus").
    const hardMiss = missM.find((x) => x.concepts.every((k) => /^(reg:|sv:)/.test(k)) && !/\b(or similar|or other|or related|or equivalent|preferably|ideally|a plus|is a plus|bonus|nice to have)\b/i.test(x.text));
    if (hardMiss) cap(45, `Requires: ${hardMiss.text.length > 90 ? hardMiss.text.slice(0, 87) + "…" : hardMiss.text}`, "must");
    const metP = pref.filter((x) => share(x) >= 1);
    reqs += pref.length ? 4 * (pref.reduce((a, x) => a + share(x), 0) / pref.length) : 4 * NEUTRAL;
    if (metP.length) tag(good, `Your resume shows ${metP.length} of ${pref.length} nice-to-haves`, "pref");
    parts.must = reqs;

    // --- Experience (15): years asked (12) + total years (3)
    // When the job asks for years in product, compare your years in product; otherwise your total years.
    const inProduct = sig.pmMin != null;
    const min = inProduct ? sig.pmMin : j.expMin, max = inProduct ? sig.pmMax : j.expMax;
    const py = inProduct ? (c.pmYears ?? (ca === "pm" ? c.years : null)) : c.years;
    const asks = min == null ? null : max != null ? `${min}–${max} yrs` : `${min}+ yrs`;
    const what = inProduct ? "in product" : "";
    let exp = 0;
    if (min == null || py == null) { exp += 12 * NEUTRAL; if (min == null) bad.push("Experience needed isn't stated"); }
    else if (py >= min && (max == null || py <= max + 1)) { exp += 12; tag(good, `Your ${py} yrs ${what || "of experience"} fit (asks ${asks}${what ? " " + what : ""})`, "years"); }
    else if (py < min) {
      if (min - py <= 1) { exp += 8; tag(bad, `Slight stretch: asks ${asks} ${what}`.trim(), "years"); }
      else { tag(bad, `Asks ${asks} ${what}; you have ${py}`.replace("  ", " "), "years"); cap(45, `Asks ${asks}${what ? " " + what : ""}; you have ${py}`, "years"); }
    } else {
      // More than a year over the top of the range: a junior role for you. The further over, the lower it ranks,
      // whatever else matches; a 90 for a role two levels down isn't a good match.
      const over = py - max;
      exp += over <= 2 ? 9 : over <= 4 ? 5 : 2;
      const why = `More senior than this role needs (asks ${asks}${what ? " " + what : ""}; you have ${py})`;
      tag(bad, why, "years");
      cap(over <= 2 ? 72 : over <= 4 ? 62 : 48, why, "years");
    }
    // Written for early-career people ("We are looking for early-career Product Managers").
    const mineYrs = py ?? c.years;
    if (sig.earlyCareer && mineYrs != null && mineYrs >= 4 && (max == null || max <= 5)) {
      const why = `Written for early-career PMs; you have ${mineYrs} yrs`;
      tag(bad, why);
      cap(60, why);
    }
    if (j.expMin == null || c.years == null) exp += 3 * NEUTRAL;
    else exp += c.years >= j.expMin && (j.expMax == null || c.years <= j.expMax + 2) ? 3 : 1;
    parts.experience = exp;

    // --- Domain (28): vertical 12 + business model 10 + market fit 6
    let dom = 0;
    const jsv = sig.subVerticals || [], jv = sig.verticals || [];
    if (!jv.length || !c.verticals.length) dom += 12 * NEUTRAL;
    else if (jsv.some((x) => c.subVerticals.includes(x))) { dom += 12; { const x = jsv.find((y) => c.subVerticals.includes(y)); tag(good, `Same space: ${x}`, `sv:${x}`); } }
    else if (jv.some((x) => c.verticals.includes(x))) { dom += 8; { const x = jv.find((y) => c.verticals.includes(y)); tag(good, `Same industry: ${x}`, `v:${x}`); } }
    else if (jv.some((x) => c.verticals.some((y) => adjacent(x, y)))) { dom += c.openToDomainSwitch ? 6 : 5; tag(bad, `Nearby industry: ${jv[0]}`, `v:${jv[0]}`); }
    else { dom += c.openToDomainSwitch ? 4 : 1; tag(bad, `Different industry: ${jv[0]}`, `v:${jv[0]}`); }
    const jm = sig.models || [], cm = c.models;
    if (!jm.length || !cm.length) dom += 10 * NEUTRAL;
    else if (jm.some((m) => cm.includes(m))) { dom += 10; { const m = jm.find((x) => cm.includes(x)); tag(good, `${m} business, like yours`, `model:${m}`); } }
    else if (jm.includes("B2B2C") || cm.includes("B2B2C") || jm.includes("Marketplace") || cm.includes("Marketplace")) { dom += 6; tag(bad, `${jm.join(" / ")} business (you: ${cm.join(" / ")})`, `model:${jm[0]}`); }
    else { dom += 2; tag(bad, `${jm.join(" / ")} business; your background is ${cm.join(" / ")}`, `model:${jm[0]}`); }
    // Market fit: segment, market, GTM motion, product type (1.5 each), compared through concepts.
    const fit = (known, ok) => (known ? (ok ? 1.5 : 0.3) : 1.5 * NEUTRAL);
    const seg = sig.segments || [];
    dom += fit(seg.length && c.concepts.size > 0, seg.some((x) => (x === "Consumer" ? c.models.includes("B2C") : c.models.includes("B2B") || c.concepts.has("b2b"))));
    dom += fit(!!sig.market, sig.market === "Global" ? c.concepts.has("global_market") : true);
    dom += fit(sig.gtm === "PLG", c.concepts.has("growth") || c.concepts.has("experimentation"));
    dom += fit(jm.length > 0 && cm.length > 0, true);
    parts.domain = dom;

    // --- Company (8): product company / GCC / services
    const jc = sig.companyModel, cc = c.companyModels;
    let comp;
    if (!jc) comp = 8 * NEUTRAL;
    else if (cc.includes(jc)) { comp = 8; if (jc !== "Product") good.push(`${jc} company, like your background`); }
    else if (jc === "GCC" && cc.includes("Product")) { comp = 6; bad.push("A global company's India centre (GCC)"); }
    else if (jc === "Services") { comp = c.openToServices ? 5 : 1; bad.push("A services / consulting company"); }
    else if (jc === "Product" && cc.includes("Services")) { comp = 4; bad.push("A product company; your background is services"); }
    else comp = 4;
    parts.company = comp;

    // --- Practical (7): location 5 + pay and notice 2
    let prac = 0;
    const wanted = (f.locations || []).map(city);
    const inCity = j.cities.find((x) => wanted.includes(x));
    if (j.workMode === "Remote") { prac += 5; tag(good, "Remote", "city"); }
    else if (inCity) { prac += 5; tag(good, `In ${inCity}`, "city"); }
    else if (!wanted.length) prac += 5;
    else { prac += 2; tag(bad, `Needs a move to ${j.cities[0] || j.location}`, "city"); if (!f.relocate) cap(40, `Not in your cities (${j.cities[0] || j.location})`, "city"); }
    let pn = 2;
    if (j.salaryMax && c.expectedMin && j.salaryMax / 1e5 < c.expectedMin) { pn -= 1.5; bad.push(`Pays up to ₹${Math.round(j.salaryMax / 1e5)} LPA (you want ${c.expectedMin}+)`); }
    if (sig.immediate && /60|90|more/i.test(c.notice)) { pn -= 1; bad.push("Wants immediate joiners"); }
    prac += Math.max(0, pn);
    parts.practical = prac;

    for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 10) / 10;
    let total = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
    caps.sort((a, b) => a[0] - b[0]);
    if (caps.length && total > caps[0][0]) total = caps[0][0];
    // Older postings rank lower: after two months many are filled, and after six they're likely stale.
    const age = ageDays(j);
    const stale = agePenalty(age);
    if (stale) {
      total = Math.max(0, total - stale);
      bad.push(`Posted ${ageText(age)}; it may already be filled`);
    }
    return { score: total, good, bad, parts, caps: caps.map((x) => x[1]), links, confidence: sig.confidence || "medium", ageDays: age };
  }

  const ageDays = (j) => (j._time ? Math.max(0, Math.floor((Date.now() - j._time) / 864e5)) : null);
  // Points off for age: none in the first month, then more the older it is.
  const agePenalty = (d) => (d == null || d <= 30 ? 0 : d <= 60 ? 2 : d <= 90 ? 5 : d <= 180 ? 10 : 20);
  const ageText = (d) => (d < 60 ? `${d} days ago` : d < 365 ? `${Math.round(d / 30)} months ago` : "over a year ago");
  // Jobs older than this are left out unless you choose "Any time".
  const DEFAULT_MAX_AGE = 180;

  // What a list card says: the one or two best reasons it fits, in plain words, and the main thing against it.
  // Leaves out reasons every PM job shares ("A true PM role"), so each card says something different.
  const SAME_FOR_ALL = /^A true PM role|^Product Manager role, like yours/;
  function summary(r) {
    const fit = r.good.filter((g) => !SAME_FOR_ALL.test(g)).slice(0, 2);
    const minor = /isn't stated/;
    const gap = r.caps[0] || r.bad.find((b) => !minor.test(b)) || null;
    return { fit, gap };
  }

  // Keeps one company from filling the list: at most `per` jobs from the same company in each block of `block`.
  // The rest move down (in score order) rather than disappear.
  function spread(rows, per = 3, block = 10) {
    const out = [];
    let pool = rows;
    while (pool.length) {
      const seen = {}, take = [], left = [];
      for (const r of pool) {
        const co = r.job.company.toLowerCase();
        if (take.length < block && (seen[co] || 0) < per) { take.push(r); seen[co] = (seen[co] || 0) + 1; }
        else left.push(r);
      }
      out.push(...take);
      pool = left;
    }
    return out;
  }

  // ---------- Evidence: where in the description the match (or gap) is ----------
  // Returns what a page needs to highlight a job description for this person:
  //  terms:  [{ words, key, cls: "hit" | "gap", scope: "all" | "req" }]  (scope "req" = only inside requirement lines)
  //  lines:  normalised requirement line -> { kind: "must" | "pref", met }
  //  years:  (a, b) => "hit" | "gap"   for "5+ years" / "3-5 years" phrases
  //  places: city words to mark as a match
  function evidence(j, f, c) {
    const sig = j._sig || {};
    const has = (key) => (key.startsWith("model:") ? c.models.includes(key.slice(6)) || c.concepts.has(key.slice(6).toLowerCase()) : c.concepts.has(key));
    const jm = sig.models || [];
    const terms = [];
    for (const t of (window.Signals ? Signals.vocab() : [])) {
      if (has(t.key)) terms.push({ ...t, cls: "hit", scope: t.kind === "specific" ? "all" : "req" });
      // A business model you haven't worked in is worth flagging anywhere; other gaps only where the job requires them.
      else if (t.key.startsWith("model:") && jm.includes(t.key.slice(6)) && c.models.length) terms.push({ ...t, cls: "gap", scope: "all" });
      else terms.push({ ...t, cls: "gap", scope: "req" });
    }
    const skills = c.skills.filter((k) => k && k.length > 1);
    if (skills.length) terms.unshift({ key: "skill", words: skills.map((k) => k.toLowerCase()), cls: "hit", scope: "all" });
    const wanted = (f.locations || []).map(city);
    const places = Object.keys(CITY).filter((k) => wanted.includes(CITY[k]));
    if (j.workMode === "Remote") places.push("remote");
    const norm = (t) => String(t).toLowerCase().replace(/^[•●▪◦‣·–\-*\d.)\s]+/, "").replace(/\s+/g, " ").trim().slice(0, 80);
    const lines = new Map();
    for (const [kind, list] of [["must", sig.must || []], ["pref", sig.pref || []]]) {
      for (const item of list) lines.set(norm(item.text), { kind, met: meetsItem(item, has) });
    }
    const inProduct = sig.pmMin != null;
    const py = c.pmYears ?? c.years;
    const years = (a, b) => {
      const mine = inProduct ? py : c.years;
      if (mine == null) return null;
      return mine >= a && (b == null || mine <= b + 1) ? "hit" : mine < a ? "gap" : null;
    };
    return { terms, lines, years, places, norm };
  }

  const CONF = { high: 2, medium: 1, low: 0 };
  // Returns { shown, lowFit, total } with jobs sorted by the chosen order.
  function run(jobs, f, profile, opts = {}) {
    const t = targets(f.roles);
    const all = [];
    for (const j of jobs) {
      if (opts.hidden && opts.hidden.has(j.id)) continue;
      if (!passes(j, f)) continue;
      all.push({ job: j, ...score(j, f, profile, t) });
    }
    const best = (a, b) => b.score - a.score || CONF[b.confidence] - CONF[a.confidence] || b.job._time - a.job._time;
    const yrs = (r) => r.job._sig?.pmMin ?? r.job.expMin; // years asked; unknown goes last
    const byYears = (dir) => (a, b) => (yrs(a) == null) - (yrs(b) == null) || dir * ((yrs(a) ?? 0) - (yrs(b) ?? 0)) || best(a, b);
    const by = {
      newest: (a, b) => b.job._time - a.job._time || best(a, b),
      "exp-asc": byYears(1),
      "exp-desc": byYears(-1),
      company: (a, b) => a.job.company.localeCompare(b.job.company) || best(a, b),
    }[opts.sort] || best;
    all.sort(by);
    // Best match: spread companies out, separately for good matches and lower-fit ones, so a lower-fit job
    // never jumps above a good one.
    let list = all;
    if (by === best && opts.spread !== false) list = [...spread(all.filter((r) => r.score >= 50)), ...spread(all.filter((r) => r.score < 50))];
    const cut = opts.minScore ?? 50;
    return { shown: list.filter((r) => r.score >= cut), lowFit: list.filter((r) => r.score < cut), total: jobs.length };
  }

  // The six parts of the score and their maximum points, in display order.
  const PARTS = [["role", "Role", 23], ["must", "Must-haves", 19], ["experience", "Experience", 15], ["domain", "Domain", 28], ["company", "Company", 8], ["practical", "Practical", 7]];

  return { prepare, run, candidate, evidence, summary, city, plural, LEVELS, PARTS, titleHit, isProductRole, DEFAULT_MAX_AGE };
})();
