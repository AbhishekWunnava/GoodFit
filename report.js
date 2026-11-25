// The daily / weekly email report: which jobs go in it, and the email itself (HTML + plain text).
// Shared by the in-app preview (email-preview.html) and the sender (scripts/send-reports.mjs).
// Needs Matcher (matching.js), Signals (signals.js) and ROLES (roles.js) loaded first.
window.Report = (() => {
  const DAY = 864e5;
  const MAX_JOBS = 10;
  const FREQ = { daily: { days: 1, word: "today", every: "every morning" }, weekly: { days: 7, word: "this week", every: "every Monday" } };

  const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, w) => Matcher.plural(n, w); // "1 new match", "3 new matches"

  // Monday in India (the report goes out at 08:00 IST).
  const isMondayIST = (now) => new Date(now.getTime() + 5.5 * 3600e3).getUTCDay() === 1;

  // Should this person get an email now? frequency = prefs.report ("off" | "daily" | "weekly").
  function due(frequency, lastSentAt, now = new Date()) {
    if (!FREQ[frequency]) return false;
    const last = lastSentAt ? Date.parse(lastSentAt) : 0;
    if (frequency === "daily") return now - last > 20 * 3600e3;
    return isMondayIST(now) && now - last > 6 * DAY;
  }

  // The same filters the Matches page starts from (jobs.js filtersFromPrefs), product roles only.
  function filtersFromPrefs(p = {}) {
    return {
      productOnly: true, search: "", roles: [...(p.roles || [])], seniority: p.seniority || "", jobTypes: [...(p.jobTypes || [])],
      workModes: [...(p.workModes || [])], locations: [...(p.locations || [])], relocate: !!p.relocate, exactTitles: !!p.exactTitles,
      companySizes: [...(p.companySizes || [])], industries: [...(p.industries || [])], avoid: [...(p.avoid || [])], postedWithin: 0,
    };
  }

  const placeOf = (j) => (j.workMode === "Remote" ? "Remote" : j.cities.join(", ") || j.location || "India");

  // jobs: prepared with Matcher.prepare. since: only jobs first seen after this go in.
  // hidden: ids the person marked "Not interested" (optional).
  function build({ jobs, details = {}, prefs = {}, frequency = "weekly", since, now = new Date(), siteUrl = "", hidden = new Set() }) {
    const f = FREQ[frequency] || FREQ.weekly;
    const from = since ? new Date(since) : new Date(now - f.days * DAY);
    const seen = (j) => Date.parse(j.firstSeenAt || j.postedAt || 0);
    const fresh = jobs.filter((j) => seen(j) >= from.getTime() && !hidden.has(j.id));
    const cand = Matcher.candidate(details, prefs);
    const res = Matcher.run(fresh, filtersFromPrefs(prefs), cand, { minScore: 50, sort: "best" });
    const good = res.shown;
    const picks = good.slice(0, MAX_JOBS);
    const strong = good.filter((r) => r.score >= 80).length;
    const newProduct = fresh.filter(Matcher.isProductRole).length;
    const name = String(details.name || "").trim().split(/\s+/)[0];
    const site = siteUrl.replace(/\/+$/, "");

    const subject = good.length
      ? `${plural(good.length, "new match")} for you ${f.word}${strong ? `, ${strong} strong` : ""}`
      : `No new strong matches ${f.word}`;
    const when = f.word === "today" ? "since yesterday" : "since your last email";
    const summary = good.length
      ? `${plural(newProduct, "new product role")} came up ${when}. ${good.length === 1 ? "1 is a good match" : `${good.length} are good matches`}` +
        (strong ? `, and ${strong} ${strong === 1 ? "is a strong fit" : "are strong fits"} (80 or more).` : ".")
      : newProduct
        ? `${plural(newProduct, "new product role")} came up ${when}, but none scored 50 or more against your profile. Widening your roles or cities in Preferences can help.`
        : `No new product roles came up ${when}. GoodFit keeps checking every morning.`;

    const reasons = (r) => r.good.filter((g) => !/^A true PM role/.test(g)).slice(0, 2);
    const linkJobs = site ? `${site}/jobs.html` : "jobs.html";
    const linkPrefs = site ? `${site}/dashboard.html?edit=preferences` : "dashboard.html?edit=preferences";

    // ---------- HTML (tables and inline styles, so it looks right in Gmail and Outlook) ----------
    const C = { ink: "#1A2233", ink2: "#3B4557", muted: "#5A6577", peacock: "#0E5A57", paper: "#F4F6F3", rule: "#E2E8E4", marigold: "#F2B230", soft: "#E1EEEC" };
    const font = "font-family:'Anek Latin',Segoe UI,Helvetica,Arial,sans-serif;";
    const row = (r) => {
      const j = r.job;
      return `<tr><td style="padding:16px 0;border-top:1px solid ${C.rule};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="${font}">
            <a href="${escH(j.url)}" style="color:${C.ink};font-size:17px;font-weight:700;text-decoration:none;">${escH(j.title)}</a>
            <div style="color:${C.muted};font-size:14px;margin-top:2px;">${escH(j.company)}, ${escH(placeOf(j))}</div>
            ${reasons(r).length ? `<div style="color:${C.ink2};font-size:14px;margin-top:6px;">${reasons(r).map(escH).join("; ")}</div>` : ""}
          </td>
          <td valign="top" align="right" width="64" style="${font}">
            <div style="display:inline-block;min-width:44px;padding:6px 0;border-radius:8px;text-align:center;background:${r.score >= 80 ? C.marigold : C.soft};color:${C.ink};font-size:18px;font-weight:800;">${r.score}</div>
          </td>
        </tr></table>
      </td></tr>`;
    };
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;">${escH(summary)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;">
    <tr><td style="padding:24px 24px 4px;${font}">
      <div style="font-size:18px;font-weight:800;color:${C.ink};"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:${C.marigold};font-size:14px;">✓</span> GoodFit</div>
    </td></tr>
    <tr><td style="padding:16px 24px 0;${font}">
      <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:${C.ink};">${name ? `${escH(name)}, ` : ""}${good.length ? `here are your new matches ${f.word}` : `a quiet ${f.word === "today" ? "day" : "week"}`}</h1>
      <p style="margin:0;font-size:15px;line-height:1.5;color:${C.ink2};">${escH(summary)}</p>
    </td></tr>
    ${picks.length ? `<tr><td style="padding:12px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${picks.map(row).join("")}</table></td></tr>` : ""}
    ${good.length > picks.length ? `<tr><td style="padding:4px 24px 0;${font}font-size:14px;color:${C.muted};">And ${good.length - picks.length} more ${good.length - picks.length === 1 ? "match" : "matches"} on GoodFit.</td></tr>` : ""}
    <tr><td style="padding:20px 24px 24px;${font}">
      <a href="${escH(linkJobs)}" style="display:inline-block;background:${C.peacock};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px;">See all your matches</a>
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td style="padding:16px 24px;${font}font-size:12px;line-height:1.5;color:${C.muted};">
    You get this email ${f.every} because you turned it on in GoodFit. Scores compare each job with your profile; open a job to see why.
    <a href="${escH(linkPrefs)}" style="color:${C.peacock};">Change how often, or turn it off</a>.
  </td></tr></table>
</td></tr></table>
</body></html>`;

    const text = [
      subject, "", summary, "",
      ...picks.flatMap((r) => [`${r.score}/100  ${r.job.title}, ${r.job.company}, ${placeOf(r.job)}`, ...reasons(r).map((x) => `  - ${x}`), `  ${r.job.url}`, ""]),
      `See all your matches: ${linkJobs}`,
      `Change how often, or turn it off: ${linkPrefs}`,
    ].join("\n");

    return { subject, html, text, matches: good.length, strong, newProduct, picks, since: from.toISOString() };
  }

  return { build, due, filtersFromPrefs, FREQ };
})();
