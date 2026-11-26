// The GoodFit assistant: a chat panel on the Matches page (see the "GoodFit Agent Spec" doc).
// The conversation loop and the tools run here, on the person's own GoodFit data, using the same
// scoring as the list (Matcher, J from jobs.js). Each model turn goes through the `agent` Supabase
// function, which holds the API key, the instructions and the tool definitions.
// Needs: jobs.js (J, openJob, renderList, renderFilters, storeLists, filtersFromPrefs, expText, ago),
// matching.js, signals.js, ui.js, questions-data.js.
const Agent = (() => {
  const MAX_TOOL_ROUNDS = 6;
  const A = { messages: [], busy: false, open: false };
  const STARTERS = ["Find B2B fintech PM roles", "Why is my top match a fit?", "Anything new this week?"];

  const el = (id) => document.getElementById(id);
  const ready = () => !!(configured && cfg.USE_AGENT);

  // ---------- Panel ----------
  function mount() {
    const btn = document.createElement("button");
    btn.className = "btn marigold sm agent-open";
    btn.id = "agent-open";
    btn.type = "button";
    btn.innerHTML = `${icon("sparkles", "width:16px;height:16px")}Ask GoodFit`;
    btn.onclick = () => toggle(true);
    document.querySelector(".jobs-head .right").prepend(btn);

    const panel = document.createElement("aside");
    panel.className = "agent";
    panel.id = "agent";
    panel.setAttribute("aria-label", "GoodFit assistant");
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `
      <header class="agent-head">
        <div><b>Ask GoodFit</b><span class="small">Find, compare and organise your matches</span></div>
        <button type="button" class="btn text sm" id="agent-new">New chat</button>
        <button type="button" class="close" id="agent-close" aria-label="Close the assistant">${icon("x")}</button>
      </header>
      <div class="agent-log" id="agent-log" aria-live="polite"></div>
      <form class="agent-form" id="agent-form">
        <label class="sr-only" for="agent-input">Message the assistant</label>
        <textarea id="agent-input" rows="2" placeholder="e.g. B2B SaaS roles in Pune, not Group PM"></textarea>
        <button class="btn" id="agent-send" type="submit" aria-label="Send">${icon("arrowR")}</button>
      </form>
      <p class="agent-note small">Your profile and the jobs you ask about are sent to an AI provider (Anthropic) to answer. GoodFit never applies for you.</p>`;
    document.body.appendChild(panel);
    el("agent-close").onclick = () => toggle(false);
    el("agent-new").onclick = reset;
    el("agent-form").onsubmit = (e) => { e.preventDefault(); send(el("agent-input").value); };
    el("agent-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(el("agent-input").value); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && A.open && !$("drawer").classList.contains("open")) toggle(false); });
    reset();
  }

  function toggle(on) {
    A.open = on;
    el("agent").classList.toggle("open", on);
    el("agent").setAttribute("aria-hidden", String(!on));
    document.body.classList.toggle("agent-on", on);
    if (on) el("agent-input").focus(); else el("agent-open").focus();
  }

  function reset() {
    if (A.busy) return;
    A.messages = [];
    el("agent-log").innerHTML = ready()
      ? `<div class="agent-empty"><p>Tell me what you're looking for, in your own words. I can search, explain scores, compare jobs, and update your preferences.</p>
          <div class="agent-starters">${STARTERS.map((s) => `<button type="button" class="chip-btn">${esc(s)}</button>`).join("")}</div></div>`
      : `<div class="agent-empty"><p><b>The assistant isn't switched on yet.</b></p>
          <p class="small">${demo ? "It needs the AI connection, which demo mode doesn't have." : "It needs the agent function deployed in Supabase and an Anthropic API key (README: GoodFit assistant), then USE_AGENT: true in config.js."}</p></div>`;
    el("agent-log").querySelectorAll(".agent-starters .chip-btn").forEach((b) => (b.onclick = () => send(b.textContent)));
    el("agent-input").disabled = el("agent-send").disabled = !ready() && !Agent._model;
  }

  // ---------- Chat log ----------
  const scrollDown = () => { const log = el("agent-log"); log.scrollTop = log.scrollHeight; };
  function add(cls, html) {
    const empty = el("agent-log").querySelector(".agent-empty");
    if (empty) empty.remove();
    const d = document.createElement("div");
    d.className = `agent-msg ${cls}`;
    d.innerHTML = html;
    el("agent-log").appendChild(d);
    scrollDown();
    return d;
  }
  // A small, safe Markdown subset for replies: **bold**, bullet and numbered lines, paragraphs.
  function md(text) {
    const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split("\n");
    let html = "", list = null;
    for (const l of lines) {
      const m = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(l);
      if (m) {
        const kind = m[1] ? "ol" : "ul";
        if (list !== kind) { if (list) html += `</${list}>`; html += `<${kind}>`; list = kind; }
        html += `<li>${m[2]}</li>`;
      } else {
        if (list) { html += `</${list}>`; list = null; }
        if (l.trim()) html += `<p>${l}</p>`;
      }
    }
    return html + (list ? `</${list}>` : "");
  }

  // ---------- The loop ----------
  async function send(text) {
    text = String(text || "").trim();
    if (!text || A.busy) return;
    el("agent-input").value = "";
    add("me", `<p>${esc(text)}</p>`);
    const start = A.messages.length; // to roll back to if this exchange fails
    A.messages.push({ role: "user", content: text });
    A.busy = true;
    el("agent-send").disabled = true;
    try {
      for (let round = 0; ; round++) {
        const bubble = add("bot", `<div class="agent-typing"><span></span><span></span><span></span></div>`);
        let shown = "";
        const msg = await turn((t) => { shown += t; bubble.innerHTML = md(shown); scrollDown(); });
        const finalText = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        if (!finalText.trim()) bubble.remove(); // a turn that only called tools
        else bubble.innerHTML = md(finalText); // the whole text, in case pieces arrived oddly
        A.messages.push({ role: "assistant", content: msg.content }); // as returned, thinking blocks included
        if (msg.stop_reason === "refusal") { add("bot note", `<p>I can't help with that one. Try asking about jobs, scores or your preferences.</p>`); break; }
        const uses = msg.content.filter((b) => b.type === "tool_use");
        if (!uses.length || msg.stop_reason !== "tool_use") {
          if (msg.stop_reason === "max_tokens") add("bot note", `<p>That reply was cut short. Ask me to continue.</p>`);
          break;
        }
        if (round >= MAX_TOOL_ROUNDS) { add("bot note", `<p>That took too many steps. Try asking more specifically.</p>`); A.messages.length = start; break; }
        // All results go back together, in one message.
        const results = [];
        for (const u of uses) results.push(await runTool(u));
        A.messages.push({ role: "user", content: results });
      }
    } catch (e) {
      console.warn(e);
      el("agent-log").querySelectorAll(".agent-typing").forEach((t) => t.closest(".agent-msg").remove());
      add("bot note err", `<p>${esc(e.message || "Something went wrong. Try again.")}</p>`);
      // Forget this exchange so the next message starts from a clean conversation.
      A.messages.length = start;
    } finally {
      A.busy = false;
      el("agent-send").disabled = false;
      el("agent-input").focus();
    }
  }

  // One model turn through the agent function, streamed. Returns { content, stop_reason }.
  async function turn(onText) {
    if (Agent._model) return Agent._model(A.messages, onText); // test hook (simulated model)
    const { data } = await db.auth.getSession();
    const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ messages: A.messages }),
    });
    if (!res.ok || !res.body) {
      let msg = `The assistant didn't answer (${res.status}).`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", done = null;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).replace(/^data: ?/, "");
        buf = buf.slice(i + 2);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "text") onText(ev.text);
        else if (ev.type === "done") done = ev.message;
        else if (ev.type === "error") throw new Error(ev.error);
      }
    }
    if (!done) throw new Error("The reply stopped before it finished.");
    return done;
  }

  // ---------- Tools ----------
  const jobById = (id) => J.jobs.find((j) => j.id === id);
  const lower = (x) => String(x || "").toLowerCase();
  const score = (j) => Matcher.run([j], { ...J.filters, productOnly: false, exactTitles: false, jobTypes: [], workModes: [], companySizes: [], industries: [], avoid: [], search: "", postedWithin: 0 }, profileForScoring(), { minScore: -1 }).shown[0];
  const brief = (r) => ({
    job_id: r.job.id, title: r.job.title, company: r.job.company,
    location: r.job.workMode === "Remote" ? "Remote" : r.job.cities.join(", ") || r.job.location,
    work_mode: r.job.workMode || "not stated", score: r.score, confidence: r.confidence,
    years_asked: (r.job._sig && r.job._sig.pmMin != null ? `${r.job._sig.pmMin}+ in product` : expText(r.job)) || "not stated",
    posted: ago(r.job.postedAt) || "unknown", saved: J.saved.has(r.job.id),
    why: r.good.filter((g) => !/^A true PM role/.test(g)).slice(0, 3), gaps: [...r.caps, ...r.bad].slice(0, 3),
  });

  // Checks tool inputs before running (inputs stream in and aren't validated by the API).
  const isStrs = (x) => x === undefined || (Array.isArray(x) && x.every((s) => typeof s === "string"));
  const isNum = (x) => x === undefined || (typeof x === "number" && isFinite(x));
  const isBool = (x) => x === undefined || typeof x === "boolean";
  const VALID = {
    search_jobs: (i) => ["roles", "domains", "business_models", "cities", "work_modes"].every((k) => isStrs(i[k])) &&
      ["min_years_asked", "max_years_asked", "posted_within_days", "limit"].every((k) => isNum(i[k])) && isBool(i.include_lower_fit),
    get_job: (i) => typeof i.job_id === "string", save_job: (i) => typeof i.job_id === "string", unsave_job: (i) => typeof i.job_id === "string",
    hide_job: (i) => typeof i.job_id === "string", unhide_job: (i) => typeof i.job_id === "string", suggest_questions: (i) => typeof i.job_id === "string",
    compare_jobs: (i) => Array.isArray(i.job_ids) && i.job_ids.length >= 2 && i.job_ids.length <= 3 && i.job_ids.every((s) => typeof s === "string"),
    get_profile: () => true,
    update_preferences: (i) => ["roles", "cities", "work_modes", "avoid"].every((k) => isStrs(i[k])) && ["exact_titles", "relocate", "open_to_services", "open_to_domain_switch"].every((k) => isBool(i[k])),
    update_background: (i) => ["business_models", "industries", "specific_spaces", "company_types"].every((k) => isStrs(i[k])) && isNum(i.years_in_product) && isBool(i.managed_pms),
  };

  async function runTool(u) {
    const out = (content, isError) => ({ type: "tool_result", tool_use_id: u.id, content: typeof content === "string" ? content : JSON.stringify(content), ...(isError ? { is_error: true } : {}) });
    const input = u.input || {};
    if (!TOOLS[u.name]) return out(`Unknown tool ${u.name}.`, true);
    if (!VALID[u.name](input)) return out({ INVALID_INPUT: input }, true);
    try {
      return out(await TOOLS[u.name](input));
    } catch (e) {
      console.warn(`tool ${u.name} failed`, e);
      return out(`The ${u.name} tool failed: ${e.message}`, true);
    }
  }

  const TOOLS = {
    search_jobs(i) {
      const f = { ...J.filters, productOnly: true };
      if (i.roles && i.roles.length) { f.roles = i.roles; f.exactTitles = false; }
      if (i.cities && i.cities.length) f.locations = i.cities;
      if (i.work_modes && i.work_modes.length) f.workModes = i.work_modes;
      if (i.posted_within_days) f.postedWithin = i.posted_within_days;
      f.search = [i.keywords, i.company].filter(Boolean).join(" ");
      const res = Matcher.run(J.jobs, f, profileForScoring(), { hidden: J.hidden, sort: "best", minScore: i.include_lower_fit ? -1 : 50 });
      const want = (list, have) => !list || !list.length || list.some((w) => have.filter(Boolean).some((h) => lower(h).includes(lower(w)) || lower(w).includes(lower(h).split(": ").pop())));
      const rows = res.shown.filter((r) => {
        const s = r.job._sig || {};
        const yrs = s.pmMin ?? r.job.expMin;
        return want(i.domains, [...(s.verticals || []), ...(s.subVerticals || []), r.job.industry || ""]) &&
          want(i.business_models, s.models || []) &&
          (i.min_years_asked == null || (yrs != null && yrs >= i.min_years_asked)) &&
          (i.max_years_asked == null || (yrs != null && yrs <= i.max_years_asked)) &&
          (!i.company || lower(r.job.company).includes(lower(i.company)));
      });
      const limit = Math.max(1, Math.min(10, Math.round(i.limit || 5)));
      const picks = rows.slice(0, limit);
      cards(picks);
      return { total_matching: rows.length, shown: picks.length, jobs: picks.map(brief), note: rows.length ? undefined : "No jobs matched. Suggest loosening a filter (city, domain, years) or include_lower_fit." };
    },
    get_job({ job_id }) {
      const j = jobById(job_id);
      if (!j) throw new Error("No job with that id.");
      const r = score(j), ev = Matcher.evidence(j, J.filters, profileForScoring());
      const lines = [...ev.lines.entries()];
      return {
        ...brief(r), url: j.url, department: j.department, industry: j.industry, company_size: j.companySize,
        score_parts: Object.fromEntries(Matcher.PARTS.map(([k, n, max]) => [n, `${Math.round(r.parts[k] || 0)}/${max}`])),
        ranked_low_because: r.caps, good: r.good, gaps: r.bad,
        must_haves_met: lines.filter(([, v]) => v.kind === "must" && v.met).length, must_haves_missed: lines.filter(([, v]) => v.kind === "must" && !v.met).length,
        description: `<job_description>\n${(j.description || "").slice(0, 6000)}\n</job_description>`,
      };
    },
    compare_jobs({ job_ids }) {
      const js = job_ids.map(jobById).filter(Boolean);
      if (js.length < 2) throw new Error("Couldn't find at least two of those jobs.");
      const rs = js.map(score);
      cards(rs);
      return rs.map((r) => ({
        ...brief(r),
        score_parts: Object.fromEntries(Matcher.PARTS.map(([k, n, max]) => [n, `${Math.round(r.parts[k] || 0)}/${max}`])),
        domain: [...((r.job._sig && r.job._sig.subVerticals) || []), ...((r.job._sig && r.job._sig.verticals) || [])].join(", ") || "not clear",
        business_model: ((r.job._sig && r.job._sig.models) || []).join(", ") || "not clear",
      }));
    },
    get_profile() {
      const d = J.details || {}, b = d.background || {}, p = J.prefs || {};
      return {
        name: d.name, current_role: d.currentRole, company: d.currentCompany, years: d.years, years_in_product: b.pmYears ?? d.pmYears,
        skills: d.skills, background: b, preferences: { roles: p.roles, cities: p.locations, work_modes: p.workModes, seniority: p.seniority,
          exact_titles: !!p.exactTitles, relocate: !!p.relocate, open_to_services: !!p.openToServices, open_to_domain_switch: !!p.openToDomainSwitch,
          avoid: p.avoid, email_updates: p.report || "off" },
        saved_jobs: [...J.saved].map(jobById).filter(Boolean).map((j) => `${j.title}, ${j.company}`),
        hidden_count: J.hidden.size,
      };
    },
    save_job: ({ job_id }) => mark(job_id, "saved", true),
    unsave_job: ({ job_id }) => mark(job_id, "saved", false),
    hide_job: ({ job_id }) => mark(job_id, "hidden", true),
    unhide_job: ({ job_id }) => mark(job_id, "hidden", false),
    async update_preferences(i) {
      const map = { roles: "roles", cities: "locations", work_modes: "workModes", seniority: "seniority", exact_titles: "exactTitles", relocate: "relocate",
        open_to_services: "openToServices", open_to_domain_switch: "openToDomainSwitch", avoid: "avoid", email_updates: "report" };
      const changes = Object.entries(i).filter(([k]) => map[k]).map(([k, v]) => [map[k], v]);
      if (!changes.length) return "Nothing to change.";
      const label = { roles: "Roles", locations: "Cities", workModes: "Work mode", seniority: "Seniority", exactTitles: "Exact titles only", relocate: "Open to relocating",
        openToServices: "Open to services companies", openToDomainSwitch: "Open to switching industry", avoid: "Hide jobs mentioning", report: "Email updates" };
      const yes = await confirm("Update your preferences?", changes.map(([k, v]) => [label[k], show(J.prefs[k]), show(v)]));
      if (!yes) return "The person said no. Nothing was changed.";
      J.prefs = { ...J.prefs, ...Object.fromEntries(changes) };
      await persist();
      J.filters = filtersFromPrefs(J.prefs);
      J.cand = null;
      renderFilters();
      renderList();
      return "Saved. The matches list has been updated.";
    },
    async update_background(i) {
      const map = { role_type: "archetype", years_in_product: "pmYears", business_models: "models", industries: "verticals", specific_spaces: "subVerticals", company_types: "companyModels", managed_pms: "managedPMs" };
      const label = { archetype: "Role type", pmYears: "Years in product", models: "Business models", verticals: "Industries", subVerticals: "Specific spaces", companyModels: "Company types", managedPMs: "Managed PMs" };
      const b = J.details.background || {};
      const changes = Object.entries(i).filter(([k]) => map[k]).map(([k, v]) => [map[k], v]);
      if (!changes.length) return "Nothing to change.";
      const yes = await confirm("Update your background?", changes.map(([k, v]) => [label[k], show(b[k]), show(v)]));
      if (!yes) return "The person said no. Nothing was changed.";
      J.details = { ...J.details, background: { ...b, ...Object.fromEntries(changes) } };
      await persist();
      J.cand = null;
      renderList();
      return "Saved. Scores have been recalculated.";
    },
    suggest_questions({ job_id }) {
      const j = jobById(job_id);
      if (!j || !window.QUESTION_BANK) throw new Error("No job with that id, or no question bank.");
      const s = j._sig || {}, needs = new Set([...(s.must || []), ...(s.pref || [])].flatMap((x) => x.concepts));
      const pick = (cat, n, why) => (QUESTION_BANK.find((c) => c.id === cat) || { items: [] }).items.slice(0, n).map((it) => ({ question: it.q, category: cat, why }));
      const out = [...pick("about", 1, "Every interview opens with it; tie it to this role.")];
      if ([...needs].some((c) => /analytics|experimentation|sql/.test(c))) out.push(...pick("execution", 2, "The job asks for data and metrics skills."));
      else out.push(...pick("sense", 1, "Product sense is tested in most PM loops."));
      if ([...needs].some((c) => /apis|technical|platform|ai_ml/.test(c))) out.push(...pick("technical", 2, "The job asks for technical depth."));
      if (s.peopleMgmt) out.push(...pick("behaviour", 1, "The role manages PMs, so expect leadership stories."));
      if ((s.subVerticals || []).some((x) => /Payments/.test(x))) {
        const upi = QUESTION_BANK.flatMap((c) => c.items).find((it) => /UPI payment/.test(it.q));
        if (upi) out.push({ question: upi.q, category: "technical", why: "It's a payments role." });
      }
      out.push(...pick("hr", 1, "HR will ask about CTC early."));
      return { job: `${j.title}, ${j.company}`, questions: out.slice(0, 5), page: "questions.html" };
    },
  };

  const show = (v) => (v === undefined || v === null || v === "" ? "not set" : Array.isArray(v) ? v.join(", ") || "none" : v === true ? "yes" : v === false ? "no" : String(v));

  async function persist() {
    const { error } = await db.from("profiles").upsert({ user_id: J.user.id, details: J.details, preferences: J.prefs, step: "review", updated_at: new Date().toISOString() });
    if (error) throw new Error(`Couldn't save: ${error.message}`);
  }

  function mark(job_id, list, on) {
    const j = jobById(job_id);
    if (!j) throw new Error("No job with that id.");
    const set = list === "saved" ? J.saved : J.hidden;
    const before = set.has(job_id);
    if (on) set.add(job_id); else set.delete(job_id);
    if (list === "hidden" && on) J.saved.delete(job_id);
    storeLists();
    renderList();
    const what = { "saved:true": "Saved", "saved:false": "Removed from Saved", "hidden:true": "Hidden", "hidden:false": "Brought back" }[`${list}:${on}`];
    const row = add("bot action", `<p>${icon(list === "saved" ? "bookmark" : on ? "eyeOff" : "eye", "width:15px;height:15px")}${what}: ${esc(j.title)}, ${esc(j.company)} <button type="button" class="btn text sm">Undo</button></p>`);
    row.querySelector("button").onclick = (e) => {
      if (before) set.add(job_id); else set.delete(job_id);
      storeLists();
      renderList();
      e.target.replaceWith(Object.assign(document.createElement("span"), { className: "small", textContent: "Undone" }));
    };
    return `${what}: ${j.title}, ${j.company}.`;
  }

  // Before/after card with Yes / No; resolves when the person answers.
  function confirm(title, rows) {
    return new Promise((resolve) => {
      const card = add("bot confirm", `<p><b>${esc(title)}</b></p>
        <table><thead><tr><th></th><th>Now</th><th>After</th></tr></thead><tbody>${rows.map(([k, a, b]) => `<tr><th>${esc(k)}</th><td>${esc(a)}</td><td><b>${esc(b)}</b></td></tr>`).join("")}</tbody></table>
        <div class="agent-btns"><button type="button" class="btn sm" data-yes>Yes, update</button><button type="button" class="btn ghost sm" data-no>No</button></div>`);
      const done = (yes) => {
        card.querySelector(".agent-btns").innerHTML = `<span class="small">${yes ? "Updated" : "Not changed"}</span>`;
        resolve(yes);
      };
      card.querySelector("[data-yes]").onclick = () => done(true);
      card.querySelector("[data-no]").onclick = () => done(false);
      card.querySelector("[data-yes]").focus();
    });
  }

  // Job cards under a reply: open the same detail panel as the list.
  function cards(rows) {
    if (!rows.length) return;
    const box = add("bot cards", rows.map((r) => `<button type="button" class="agent-card" data-id="${esc(r.job.id)}">
        <span class="co" style="background:${coColor(r.job.company)}" aria-hidden="true">${esc(r.job.company[0])}</span>
        <span class="agent-card-body"><b>${esc(r.job.title)}</b><span class="small">${esc(r.job.company)}, ${esc(r.job.workMode === "Remote" ? "Remote" : r.job.cities[0] || r.job.location)}</span></span>
        <span class="agent-score num">${r.score}</span></button>`).join(""));
    box.querySelectorAll(".agent-card").forEach((b) => (b.onclick = () => openJob(b.dataset.id)));
  }

  return { mount, toggle, send, TOOLS, get state() { return A; }, _model: null };
})();
