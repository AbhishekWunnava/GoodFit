// GoodFit extension, page part: reads the job you're looking at, scores it against your GoodFit profile
// with the same code as the website (lib/matching.js), and shows the result in a small panel.
// Runs by itself on LinkedIn and Naukri, and on other job sites you've turned on in the popup ("Always check
// jobs on this site"); on any other page once, when you click "Check this page" or use the right-click menu.
// Once it's on a page it keeps the panel open and re-scores when you move to another job, until you hide it.
// Only the page you're viewing is read, only when you view it, and nothing from it leaves your browser.
(() => {
  if (window.__goodfit) return;
  window.__goodfit = true;

  const HOST = window.__goodfitTestHost || location.hostname; // tests/extension/ pretends to be a job site
  const AUTO = /(^|\.)linkedin\.com$|(^|\.)naukri\.com$/.test(HOST);
  // On LinkedIn the script loads on every page (it's one app), but only looks for jobs in the Jobs section.
  const inJobsArea = () => !/linkedin\.com$/.test(HOST) || !!window.__goodfitTestHost || location.pathname.startsWith("/jobs");
  const SITE = "https://goodfitjobsonly.com";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const T = window.JobText;

  // ---------- Reading the job from the page ----------
  const pick = (sels, root = document) => {
    for (const s of sels) {
      for (const el of root.querySelectorAll(s)) if (clean(el.innerText || el.textContent)) return el;
    }
    return null;
  };
  const textOf = (sels) => { const el = pick(sels); return el ? clean(el.innerText || el.textContent) : ""; };

  // Most job sites (Naukri, Greenhouse, Lever, Workday, LinkedIn's public pages…) describe the job for search
  // engines in a JobPosting block. It's the most reliable source when it's there.
  function fromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch { continue; }
      const all = [].concat(data, ...[].concat(data).map((d) => (d && d["@graph"]) || []));
      const jp = all.find((d) => d && [].concat(d["@type"]).includes("JobPosting"));
      if (!jp || !jp.title || !jp.description) continue;
      const locs = [].concat(jp.jobLocation || []).map((l) => {
        const a = (l && l.address) || {};
        return typeof a === "string" ? a : [a.addressLocality, a.addressRegion].filter(Boolean).join(", ");
      }).filter(Boolean);
      const exp = jp.experienceRequirements;
      const months = exp && typeof exp === "object" ? Number(exp.monthsOfExperience) : NaN;
      const sal = jp.baseSalary && jp.baseSalary.value;
      const yearly = sal && /year/i.test(sal.unitText || "YEAR") && /inr/i.test(jp.baseSalary.currency || "INR");
      return {
        title: clean(T.decode(jp.title)),
        company: clean(T.decode((jp.hiringOrganization && (jp.hiringOrganization.name || jp.hiringOrganization)) || "")),
        location: locs.join(" | "),
        remote: /telecommute/i.test(jp.jobLocationType || ""),
        employmentType: [].concat(jp.employmentType || []).join(" "),
        html: jp.description,
        expText: typeof exp === "string" ? exp : Number.isFinite(months) ? `${Math.round(months / 12)} years` : "",
        postedAt: jp.datePosted || null,
        salaryMin: yearly ? Number(sal.minValue || sal.value) || null : null,
        salaryMax: yearly ? Number(sal.maxValue || sal.value) || null : null,
      };
    }
    return null;
  }

  // Site layouts change often, so each field has a few fallbacks.
  const SITES = {
    linkedin: {
      title: [".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title", ".jobs-details h1", "main h1"],
      company: [".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link", ".top-card-layout__second-subline a"],
      location: [".job-details-jobs-unified-top-card__primary-description-container", ".job-details-jobs-unified-top-card__tertiary-description-container", ".jobs-unified-top-card__bullet", ".topcard__flavor--bullet"],
      description: ["#job-details", ".jobs-description__content", ".jobs-box__html-content", ".show-more-less-html__markup", ".description__text"],
      extra: [".job-details-fit-level-preferences", ".job-details-preferences-and-skills", ".jobs-unified-top-card__job-insight"],
    },
    naukri: {
      title: ['[class*="jd-header-title"]', "h1"],
      company: ['[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]', '[class*="comp-name"]'],
      location: ['[class*="jhc__location"]', '[class*="location"] a', '[class*="loc"]'],
      description: ['[class*="dang-inner-html"]', '[class*="job-desc"]', ".job-desc"],
      exp: ['[class*="jhc__exp"]', '[class*="exp"] span'],
      extra: ['[class*="key-skill"]'],
    },
  };

  function fromSite() {
    const s = /linkedin\.com$/.test(HOST) ? SITES.linkedin : /naukri\.com$/.test(HOST) ? SITES.naukri : null;
    if (!s) return null;
    const d = pick(s.description);
    const title = textOf(s.title);
    if (!d || !title) return null;
    return {
      title, company: textOf(s.company).replace(/\s*\d(\.\d)?\s*(\d+\s*reviews?)?$/i, ""), location: textOf(s.location),
      html: d.innerHTML, extraText: s.extra ? textOf(s.extra) : "", expText: s.exp ? textOf(s.exp) : "", postedAt: null,
    };
  }

  // Any other page: the heading, and the block of text that reads most like a job description.
  const JD_WORDS = /responsibilit|requirement|qualification|experience|what you('| wi)ll|you will|about the role|who you are|must have|nice to have/gi;
  // The company: the site's own name if it gives one, else the hosted job board's path
  // (boards.greenhouse.io/razorpay) or the main part of the address (careers.razorpay.com).
  function companyGuess() {
    const og = document.querySelector('meta[property="og:site_name"]');
    if (og && clean(og.content) && !/linkedin|naukri|indeed|greenhouse|lever|workday|ashby/i.test(og.content)) return clean(og.content);
    if (/greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com/.test(HOST)) {
      const seg = location.pathname.split("/").filter(Boolean)[0] || "";
      return seg ? seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
    }
    const parts = HOST.replace(/^(www|careers|jobs|apply|boards|career)\./, "").split(".");
    const name = parts.length > 2 && /^(co|com|org|net)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2] || parts[0];
    return /^(localhost|\d+)$/.test(name || "") ? "" : (name || "").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Where the open job is shown, on sites that list jobs next to it (LinkedIn's search page).
  const DETAIL_ROOTS = [".jobs-search__job-details--container", ".jobs-search__job-details", ".scaffold-layout__detail", ".job-view-layout", "main", "body"];

  // The job title: the heading closest above the description, else the page's main heading.
  function titleNear(el) {
    for (let a = el, i = 0; a && i < 8; a = a.parentElement, i++) {
      for (const h of a.querySelectorAll("h1, h2")) {
        if (el.contains(h)) continue;
        const t = clean(h.textContent);
        if (t.length >= 4 && t.length <= 150 && !/^(about the job|job description|search results|jobs you may|people also)/i.test(t)) return { el: h, text: t };
      }
    }
    const h1 = document.querySelector("h1");
    return { el: h1, text: clean((h1 || {}).textContent || document.title.split(/[|–-]/)[0]) };
  }

  function fromAnyPage(selection) {
    const scope = pick(DETAIL_ROOTS) || document.body;
    let best = null, bestScore = 0;
    // textContent (not innerText) so this doesn't force the page to lay itself out for every block.
    for (const el of scope.querySelectorAll("article, section, div")) {
      const t = el.textContent || "";
      if (t.length < 500 || t.length > 25000) continue;
      const hits = (t.match(JD_WORDS) || []).length;
      const score = hits * 1000 - t.length / 50; // most job words, then the tightest block
      if (hits >= 3 && score > bestScore) { best = el; bestScore = score; }
    }
    const head = best ? titleNear(best) : titleNear(scope);
    // The city and company are usually printed just under the job title.
    const box = head.el ? (head.el.closest("section, header, div") || head.el.parentElement || head.el) : null;
    // innerText here (one small block): textContent runs words together ("App ProductNoida") and hides the city.
    const near = box ? clean(box.innerText || box.textContent).slice(0, 500) : "";
    const coLink = box && box.parentElement && box.parentElement.querySelector('a[href*="/company/"]');
    const company = (coLink && clean(coLink.textContent).slice(0, 80)) || companyGuess();
    const loc = T.citiesIn(near).join(", ");
    if (selection && selection.length > 200) return { title: head.text, company, location: loc, text: selection, postedAt: null };
    return best ? { title: head.text, company, location: loc, html: best.innerHTML, postedAt: null } : null;
  }

  // The job in the same shape as the website's jobs (see normalize.js), so matching.js can score it.
  // The page-wide search for a description ("deep") runs when asked and for a few seconds after you move to
  // another job, not every second: it's slower than the site-specific checks.
  function readJob(selection, deep) {
    const raw = (AUTO && fromSite()) || fromJsonLd() || (deep ? fromAnyPage(selection) : null);
    if (!raw) return null;
    const description = raw.text ? raw.text.trim() : T.htmlToText(raw.html || "");
    if (description.length < 150 || !raw.title) return null;
    const all = [raw.location, raw.extraText, raw.title].join(" | ");
    const exp = T.experienceFrom(raw.expText || "").expMin != null ? T.experienceFrom(raw.expText) : T.experienceFrom(description);
    const cities = T.citiesIn(raw.location || "").length ? T.citiesIn(raw.location) : T.citiesIn(description.slice(0, 600));
    return {
      id: location.href.split("#")[0], url: location.href, source: location.hostname.replace(/^www\./, ""),
      title: raw.title, company: raw.company || companyGuess(),
      location: raw.location || cities.join(", "), cities,
      workMode: raw.remote ? "Remote" : T.workModeFrom(null, all, description.slice(0, 1500)),
      jobType: T.jobTypeFrom(raw.employmentType, raw.title),
      postedAt: raw.postedAt ? String(raw.postedAt).slice(0, 10) : null,
      expMin: exp.expMin, expMax: exp.expMax, salaryMin: raw.salaryMin || null, salaryMax: raw.salaryMax || null,
      industry: "Other", companySize: "", department: null, description,
    };
  }

  // ---------- Scoring (same rules as the Matches page) ----------
  function filtersFrom(p) {
    return {
      productOnly: false, exactTitles: false, search: "", roles: [...(p.roles || [])], seniority: p.seniority || "",
      jobTypes: [], workModes: [], locations: [...(p.locations || [])], relocate: !!p.relocate,
      companySizes: [], industries: [], avoid: [], postedWithin: 0,
    };
  }
  function scoreJob(job, profile) {
    const [j] = Matcher.prepare([job]);
    const f = filtersFrom(profile.prefs || {});
    // No city found on the page: don't count location for or against the job.
    if (!j.cities.length && j.workMode !== "Remote") f.locations = [];
    const cand = Matcher.candidate(profile.details || {}, profile.prefs || {});
    const r = Matcher.run([j], f, cand, { minScore: -1 }).shown[0];
    const ev = Matcher.evidence(j, f, cand);
    const reqs = (kind) => ((j._sig && j._sig[kind]) || []).map((item) => ({ text: clean(item.text), met: (ev.lines.get(ev.norm(item.text)) || {}).met || "no" }));
    return { job: j, r, must: reqs("must"), pref: reqs("pref"), product: Matcher.isProductRole(j), noCity: !j.cities.length && j.workMode !== "Remote" };
  }

  // ---------- The panel ----------
  const PARTS = () => Matcher.PARTS;
  const fitBar = (parts) => `<div class="fit" aria-hidden="true">${PARTS().map(([k, , max]) =>
    `<span class="seg" style="flex:${max}"><i style="width:${Math.round((((parts || {})[k] || 0) / max) * 100)}%"></i></span>`).join("")}</div>`;
  const fitList = (parts) => `<ul class="fit-list">${PARTS().map(([k, n, max]) => {
    const v = (parts || {})[k] || 0;
    return `<li><span>${n}</span><span class="fit"><span class="seg" style="flex:1"><i style="width:${Math.round((v / max) * 100)}%"></i></span></span><b>${Math.round(v)}/${max}</b></li>`;
  }).join("")}</ul>`;
  const label = (s) => (s >= 75 ? "Strong fit" : s >= 60 ? "Good fit" : s >= 50 ? "Partial fit" : "Weak fit");
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const ALERT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';

  function peopleLinks(company) {
    const net = encodeURIComponent('["F","S"]'); // your 1st and 2nd connections first
    const q = (k) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(k)}&network=${net}&origin=FACETED_SEARCH`;
    return { product: q(`${company} product manager`), recruiters: q(`${company} recruiter talent acquisition`) };
  }

  // A short, honest referral request built from your profile and this job. You edit it and send it yourself.
  function referralNote(s, profile) {
    const d = profile.details || {}, b = d.background || {};
    const yrs = b.pmYears ?? d.pmYears ?? d.years;
    // "B2B payments", or "B2B fintech" when there's no narrower space.
    const space = (b.subVerticals || []).map((v) => v.split(": ").pop().toLowerCase())[0] || ((b.verticals || [])[0] || "").toLowerCase();
    const domain = [(b.models || []).join("/"), space].filter(Boolean).join(" ");
    const me = [d.currentRole ? `I'm a ${d.currentRole}` : "I'm a product manager", yrs ? `with ${yrs} years in product` : ""].filter(Boolean).join(" ")
      + (domain ? `, mostly in ${domain}` : "");
    return [
      "Hi [name],",
      "",
      `I came across the ${s.job.title} role at ${s.job.company} and it looks like a close fit for me. ${me}.`,
      "",
      "Would you be open to referring me, or pointing me to the right person on the team? I'm happy to send my resume and a short note on why I'd be a good fit.",
      "",
      "Thank you,",
      d.name && d.name !== "Sample PM" ? d.name.split(" ")[0] : "[your name]",
    ].join("\n");
  }

  let host, root, state = { open: true, last: null, key: null };

  function mount() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("goodfit-panel");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483646; right: 16px; bottom: 16px;";
    root = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
    root.addEventListener("click", onClick);
  }

  function render(html) {
    mount();
    root.innerHTML = `<style>${CSS}</style><div class="gf ${state.open ? "open" : "min"}">${html}</div>`;
  }

  function view(s, profile) {
    const { r, job } = s;
    const sample = profile.mode === "sample";
    const sum = Matcher.summary(r);
    // The main gap gets its own box at the top, so it isn't repeated under "Watch out for".
    const good = r.good.slice(0, 3), bad = [...r.caps, ...r.bad].filter((v, i, a) => a.indexOf(v) === i && v !== sum.gap).slice(0, 3);
    const shown = s.must.filter((m) => m.met === "yes").length;
    const tag = { yes: ["yes", "Shown"], partly: ["partly", "Partly shown"], no: ["no", "Not shown"] };
    const links = peopleLinks(job.company);
    const pill = `<button class="pill" data-act="open" aria-label="Open GoodFit: ${r.score} out of 100, ${label(r.score)}"><span class="mark">${CHECK}</span>GoodFit <b>${r.score}</b></button>`;
    return pill + `
      <section class="card" role="dialog" aria-label="GoodFit: how this job fits you">
        <header><span class="mark">${CHECK}</span><span class="brand">GoodFit</span><span class="sp"></span>
          <button class="ic" data-act="min" aria-label="Hide (the score stays in the corner)" title="Hide (the score stays in the corner)">×</button></header>
        <div class="body">
          <div class="top">
            <div class="score"><b>${r.score}</b><span>/100</span></div>
            <div class="what"><div class="label">${esc(s.product ? label(r.score) : "Not a product role")}${r.confidence === "low" ? ' <span class="chip">Limited info</span>' : ""}${s.noCity ? ' <span class="chip" title="Location isn\'t counted in this score">City not found</span>' : ""}</div>
              <div class="job">${esc(job.title)}${job.company ? ` · ${esc(job.company)}` : ""}</div></div>
          </div>
          ${fitBar(r.parts)}
          <details><summary>Score breakdown</summary>${fitList(r.parts)}</details>
          ${sum.gap ? `<p class="gap">${ALERT}<span>${esc(sum.gap)}</span></p>` : ""}
          ${good.length ? `<h4>Why it fits</h4><ul class="reasons good">${good.map((g) => `<li>${CHECK}<span>${esc(g)}</span></li>`).join("")}</ul>` : ""}
          ${bad.length ? `<h4>Watch out for</h4><ul class="reasons bad">${bad.map((g) => `<li>${ALERT}<span>${esc(g)}</span></li>`).join("")}</ul>` : ""}
          ${s.must.length ? `<h4>Must-haves <small>${shown} of ${s.must.length} shown in your resume</small></h4>
            <ul class="req">${s.must.slice(0, 6).map((m) => `<li class="${tag[m.met][0]}"><span class="tag">${tag[m.met][1]}</span>${esc(m.text.replace(/^[•●▪◦‣·–\-*\s]+/, "").slice(0, 160))}</li>`).join("")}</ul>
            ${s.must.length > 6 ? `<p class="more">+${s.must.length - 6} more in the description</p>` : ""}` : ""}
          ${job.company ? `<h4>Get a referral</h4>
          <div class="links"><a href="${esc(links.product)}" target="_blank" rel="noopener">Product people at ${esc(job.company)} ↗</a><a href="${esc(links.recruiters)}" target="_blank" rel="noopener">Recruiters ↗</a></div>
          <button class="btn ghost" data-act="note" type="button">Write a referral ask</button>
          <div class="note hide"><textarea rows="9" aria-label="Referral message">${esc(referralNote(s, profile))}</textarea>
            <div class="row"><button class="btn" data-act="copy" type="button">Copy message</button><span class="copied" aria-live="polite"></span></div>
            <p class="fine">Replace [name], check it reads like you, and send it yourself on LinkedIn.</p></div>` : ""}
        </div>
        <footer>${sample ? 'Scored against a <b>sample profile</b>. Click the GoodFit icon in your toolbar to sign in. · ' : ""}Scored on your device. Nothing on this page is sent anywhere. · <a href="${SITE}/jobs.html" target="_blank" rel="noopener">Open GoodFit</a></footer>
      </section>`;
  }

  function message(title, text) {
    return `<button class="pill" data-act="open"><span class="mark">${CHECK}</span>GoodFit</button>
      <section class="card"><header><span class="mark">${CHECK}</span><span class="brand">GoodFit</span><span class="sp"></span>
        <button class="ic" data-act="min" aria-label="Hide" title="Hide">×</button></header>
        <div class="body"><h3>${esc(title)}</h3><p>${text}</p></div></section>`;
  }

  async function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    const gf = root.querySelector(".gf");
    if (act === "open" || act === "min") {
      state.open = act === "open";
      gf.classList.toggle("open", state.open);
      gf.classList.toggle("min", !state.open);
      try { chrome.storage.local.set({ panelOpen: state.open }); } catch {}
    } else if (act === "note") {
      root.querySelector(".note").classList.toggle("hide");
    } else if (act === "copy") {
      const t = root.querySelector("textarea");
      try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand("copy"); }
      root.querySelector(".copied").textContent = "Copied";
    }
  }

  // ---------- Running ----------
  const ask = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: false })); }
    catch (e) { res({ ok: false, error: e.message }); }
  });

  // Nothing on the page is read until you've agreed in the popup (first run).
  const CONSENT_VERSION = 1; // keep in step with popup.js
  const consented = () => new Promise((res) => {
    try { chrome.storage.local.get("consent", (v) => res(!!(v && v.consent && v.consent.version >= CONSENT_VERSION))); }
    catch { res(false); }
  });

  // force: you asked (popup or right-click). deep: also look for a description anywhere on the page.
  // Returns true when a job was found.
  async function update(force, selection, deep) {
    if (!(await consented())) {
      if (force) { state.key = null; state.open = true; render(message("Set up GoodFit first", "Click the GoodFit icon in your browser's toolbar and read what the extension does. It won't read any page until you agree.")); }
      return false;
    }
    if (!force && !inJobsArea()) return false;
    const job = readJob(selection, force || deep);
    if (!job) {
      if (force) { state.key = null; state.open = true; render(message("No job description found here", "Open a single job's page, or select the job description text, right-click it and choose <b>Check my fit with GoodFit</b>.")); }
      return false;
    }
    const key = job.url + "|" + job.title + "|" + job.description.length;
    if (!force && key === state.key) return true;
    state.key = key;
    const res = await ask({ type: "get-profile" });
    const profile = res.ok ? res.data : null;
    if (!profile) {
      render(message("See how this job fits you", `Click the GoodFit icon in your browser's toolbar to sign in, or try it with a sample profile. No account yet? <a href="${SITE}/auth.html?mode=signup" target="_blank" rel="noopener">Create one on GoodFit</a>.`));
      return true;
    }
    // Non-PM roles are still scored (they're capped low) and labelled "Not a product role".
    const s = scoreJob(job, profile);
    state.last = { s, profile };
    if (force) state.open = true;
    render(view(s, profile));
    return true;
  }

  // Watching: many job sites (LinkedIn, Naukri, Workday…) switch jobs without loading a new page, so check
  // about every second. When the address or page title changes, also search the page more deeply for a few
  // seconds, while the new description loads.
  let lastSig = null, deepTries = 0;
  async function tick() {
    if (document.hidden) return;
    const sig = location.href + "|" + document.title;
    if (sig !== lastSig) { lastSig = sig; deepTries = 6; }
    const found = await update(false, "", deepTries > 0);
    if (deepTries > 0) deepTries = found && deepTries <= 3 ? 0 : deepTries - 1;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "score") { state.open = true; update(true, msg.selection); }
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.consent && !changes.consent.newValue && host) { host.remove(); state.key = null; return; } // withdrawn
    if (changes.profile || changes.consent) { state.key = null; lastSig = null; }
    if (changes.panelOpen && root) {
      state.open = changes.panelOpen.newValue !== false;
      const gf = root.querySelector(".gf");
      if (gf) { gf.classList.toggle("open", state.open); gf.classList.toggle("min", !state.open); }
    }
  });

  // Open or hidden is remembered across jobs, pages and tabs until you change it.
  try { chrome.storage.local.get("panelOpen", (v) => { if (v && v.panelOpen === false) state.open = false; tick(); }); } catch { tick(); }
  setInterval(tick, 1200);

  const CSS = `
  :host, .gf { --paper:#F4F6F3; --card:#FFFFFF; --ink:#1A2233; --soft:#4A5568; --peacock:#0E5A57; --peacock-soft:#E3EFEC;
    --marigold:#F2B230; --mari-soft:#FDF3DC; --mist:#D5DDD8; --brick:#B3361F; --brick-soft:#F8E6E2; --track:#E4E9E6; }
  @media (prefers-color-scheme: dark) { .gf { --paper:#121821; --card:#18202B; --ink:#E8EDF0; --soft:#A9B4BF; --peacock:#5FB8B1;
    --peacock-soft:#173533; --marigold:#F2B230; --mari-soft:#3A2F15; --mist:#2C3744; --brick:#E8826D; --brick-soft:#3A221D; --track:#2A3440; } }
  .gf { font: 14px/1.45 "Anek Latin", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); }
  .gf * { box-sizing: border-box; }
  .gf svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .gf.open .pill, .gf.min .card { display: none; }
  .hide { display: none !important; }
  .pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px 8px 8px; border-radius: 999px; border: 1px solid var(--mist);
    background: var(--card); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; box-shadow: 0 6px 24px rgba(26,34,51,.18); }
  .pill b { font-size: 16px; color: var(--peacock); }
  .mark { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; background: var(--peacock); color: #fff; }
  .mark svg { width: 15px; height: 15px; stroke-width: 3; }
  .card { width: min(360px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 32px)); display: flex; flex-direction: column;
    background: var(--card); border: 1px solid var(--mist); border-radius: 14px; box-shadow: 0 12px 40px rgba(26,34,51,.22); overflow: hidden; }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; background: var(--paper); border-bottom: 1px solid var(--mist); }
  .brand { font-weight: 700; letter-spacing: -.01em; }
  .sp { flex: 1; }
  .ic { width: 30px; height: 30px; border-radius: 8px; border: 0; background: transparent; color: var(--soft); font: 600 18px/1 system-ui, sans-serif; cursor: pointer; }
  .ic:hover { background: var(--track); color: var(--ink); }
  .body { padding: 14px; overflow: auto; }
  .body h3 { margin: 0 0 6px; font-size: 16px; }
  .body p { margin: 0 0 8px; color: var(--soft); }
  a { color: var(--peacock); font-weight: 600; }
  .top { display: flex; gap: 12px; align-items: center; margin-bottom: 10px; }
  .score { display: flex; align-items: baseline; gap: 2px; }
  .score b { font-size: 40px; line-height: 1; font-weight: 800; letter-spacing: -.03em; }
  .score span { color: var(--soft); font-weight: 600; }
  .label { font-weight: 700; font-size: 16px; }
  .job { color: var(--soft); font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .chip { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--track); color: var(--soft); vertical-align: 2px; }
  .fit { display: flex; gap: 3px; height: 8px; }
  .seg { background: var(--track); border-radius: 3px; overflow: hidden; }
  .seg i { display: block; height: 100%; background: var(--peacock); border-radius: 3px; }
  details { margin: 8px 0 4px; }
  summary { cursor: pointer; color: var(--soft); font-size: 13px; font-weight: 600; }
  .fit-list { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
  .fit-list li { display: grid; grid-template-columns: 86px 1fr 44px; align-items: center; gap: 8px; font-size: 13px; }
  .fit-list .fit { height: 6px; }
  .fit-list b { text-align: right; font-weight: 600; }
  .gap { display: flex; gap: 8px; margin: 10px 0 0 !important; padding: 8px 10px; border-radius: 10px; background: var(--mari-soft); color: var(--ink) !important; font-size: 13px; }
  .gap svg { color: #A36B00; margin-top: 2px; }
  h4 { margin: 14px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--soft); }
  h4 small { text-transform: none; letter-spacing: 0; font-weight: 500; }
  .reasons { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; font-size: 13px; }
  .reasons li { display: flex; gap: 7px; }
  .reasons svg { margin-top: 2px; }
  .reasons.good svg { color: var(--peacock); }
  .reasons.bad svg { color: #C98A00; }
  .req { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 13px; }
  .req li { padding: 7px 9px; border-radius: 9px; background: var(--paper); border-left: 3px solid var(--mist); }
  .req li.yes { border-left-color: var(--peacock); }
  .req li.partly { border-left-color: var(--marigold); }
  .req li.no { border-left-color: var(--brick); }
  .tag { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }
  .yes .tag { color: var(--peacock); } .partly .tag { color: #A36B00; } .no .tag { color: var(--brick); }
  @media (prefers-color-scheme: dark) { .partly .tag, .gap svg, .reasons.bad svg { color: var(--marigold); } }
  .more { font-size: 12px; margin: 6px 0 0 !important; }
  .links { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 10px; font-size: 13px; }
  .btn { font: inherit; font-weight: 600; padding: 8px 14px; border-radius: 9px; border: 1px solid var(--peacock); background: var(--peacock); color: #fff; cursor: pointer; }
  .btn.ghost { background: transparent; color: var(--peacock); }
  .btn:hover { filter: brightness(1.08); }
  button:focus-visible, a:focus-visible, summary:focus-visible, textarea:focus-visible { outline: 2px solid var(--marigold); outline-offset: 2px; }
  .note { margin-top: 10px; }
  textarea { width: 100%; font: 13px/1.45 inherit; font-family: inherit; color: var(--ink); background: var(--paper); border: 1px solid var(--mist); border-radius: 9px; padding: 9px; resize: vertical; }
  .row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .copied { color: var(--peacock); font-weight: 600; font-size: 13px; }
  .fine { font-size: 12px; margin-top: 6px !important; }
  footer { padding: 9px 14px; border-top: 1px solid var(--mist); background: var(--paper); color: var(--soft); font-size: 11.5px; }
  footer a { font-weight: 600; }
  @media (prefers-reduced-motion: no-preference) { .card { animation: up .18s ease-out; } @keyframes up { from { transform: translateY(8px); opacity: 0; } } }
  `;
})();
