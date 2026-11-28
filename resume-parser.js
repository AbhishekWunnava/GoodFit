// Reads a resume (PDF or .docx) in the browser and pulls out the key details.
// Nothing is sent anywhere: the text never leaves this page.
// The rules below are best-effort, so the user always reviews and fixes the result.
window.ResumeParser = (() => {
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error("Couldn't load the resume reader. Check your internet connection."));
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  // ---------- 1. File -> plain text ----------

  async function pdfText(buf) {
    await loadScript(PDFJS);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
      const page = await pdf.getPage(p);
      const { items } = await page.getTextContent();
      // Group text pieces that sit on the same baseline into one line.
      let line = "", lastY = null, lastEnd = null;
      for (const it of items) {
        const y = it.transform[5], x = it.transform[4];
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ""; lastEnd = null; }
        if (line && lastEnd !== null && x - lastEnd > 12) line += "   "; // a wide gap = separate column
        else if (line && !line.endsWith(" ") && it.str && !it.str.startsWith(" ")) line += lastEnd !== null && x - lastEnd > 1 ? " " : "";
        line += it.str;
        lastY = y;
        lastEnd = x + (it.width || 0);
        if (it.hasEOL) { lines.push(line); line = ""; lastY = null; lastEnd = null; }
      }
      if (line) lines.push(line);
      lines.push("");
    }
    return lines.join("\n");
  }

  async function docxText(buf) {
    await loadScript(MAMMOTH);
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return value;
  }

  async function extractText(file) {
    const buf = await file.arrayBuffer();
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "pdf" || file.type === "application/pdf") return pdfText(buf);
    if (ext === "docx") return docxText(buf);
    throw new Error("Only PDF and .docx resumes can be read.");
  }

  // ---------- 2. Text -> details ----------

  const HEADERS = {
    experience: /^(work\s+|professional\s+|relevant\s+|employment\s+)?(experience|employment(\s+history)?|work\s+history|career\s+history|internships?)$/i,
    education: /^(education|educational\s+(background|qualifications?)|academic\s+(background|qualifications?|details)|academics|qualifications)$/i,
    skills: /^((technical|key|core|professional|relevant)\s+)?(skills(\s*(&|and)\s*\w+)?|competencies|expertise|technologies|tech\s+stack|tools(\s*(&|and)\s*technologies)?|skill\s*set)$/i,
    summary: /^(summary|profile|professional\s+summary|profile\s+summary|career\s+summary|about(\s+me)?|objective|career\s+objective)$/i,
    other: /^(projects|key\s+projects|personal\s+projects|certifications?|courses|awards|honou?rs|achievements|accomplishments|languages|interests|hobbies|publications|volunteer(ing)?|references|personal\s+(details|information)|declaration|extra[-\s]?curricular(\s+activities)?|leadership|positions\s+of\s+responsibility)$/i,
  };

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  const DATE = `(?:${MON}\\s*[',’]?\\s*\\d{2,4}|\\d{1,2}\\s*[/.-]\\s*\\d{2,4}|(?:19|20)\\d{2})`;
  const END = `(?:${DATE}|present|current(?:ly)?|now|till\\s+date|to\\s+date|today|ongoing|date)`;
  const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|till|until|~)\\s*(${END})`, "ig");

  const ROLE_WORDS = /\b(engineer|developer|manager|analyst|designer|consultant|lead|director|associate|intern|specialist|executive|officer|architect|scientist|head|vp|vice\s+president|president|coordinator|administrator|founder|co-?founder|owner|programmer|tester|qa|sde|accountant|advisor|adviser|strategist|recruiter|writer|editor|researcher|technician|supervisor|representative|trainee|fellow|principal|teacher|professor|lecturer|marketer|scrum\s+master|devops|sre|product|marketing|sales|operations)\b/i;
  const COMPANY_WORDS = /\b(pvt|private|ltd|limited|inc|llc|llp|corp|corporation|company|co\.|technologies|technology|tech|solutions|systems|labs?|software|services|consulting|consultancy|bank|group|global|ventures|studios?|digital|networks|industries|enterprises|university|institute|hospital|foundation|capital|partners|media|analytics|retail|health|finance|financial)\b/i;

  const CITIES = ["Bengaluru", "Bangalore", "Mumbai", "Navi Mumbai", "Thane", "New Delhi", "Delhi", "Delhi NCR", "NCR", "Gurugram", "Gurgaon", "Noida", "Hyderabad", "Chennai", "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Kochi", "Chandigarh", "Indore", "Coimbatore", "Thiruvananthapuram", "Trivandrum", "Mysuru", "Lucknow", "Bhubaneswar", "Nagpur", "Visakhapatnam", "Vadodara", "Surat", "Goa", "London", "New York", "San Francisco", "Seattle", "Austin", "Boston", "Toronto", "Vancouver", "Singapore", "Dubai", "Berlin", "Amsterdam", "Sydney", "Melbourne"];
  const CITY_RE = new RegExp(`\\b(${CITIES.map((c) => c.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

  const DEGREE_RE = /\b(ph\.?\s?d|doctorate|m\.?\s?tech|m\.?\s?e\.?|m\.?\s?s\.?|m\.?\s?sc|mca|mba|pgdm|pgp|pgdba|master'?s?|m\.?\s?com|m\.?\s?a\.?|b\.?\s?tech|b\.?\s?e\.?|b\.?\s?sc|bca|bba|b\.?\s?com|b\.?\s?a\.?|bachelor'?s?|diploma)\b/i;
  const DEGREE_RANK = [/ph\.?\s?d|doctorate/i, /mba|pgdm|pgp|pgdba|m\.?\s?tech|m\.?\s?e\b|m\.?\s?s\b|m\.?\s?sc|mca|master|m\.?\s?com|m\.?\s?a\b/i, /b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|bca|bba|b\.?\s?com|b\.?\s?a\b|bachelor/i, /diploma/i];

  const clean = (s) => s.replace(/\s+/g, " ").replace(/^[\s•▪●◦\-*–|,]+|[\s|,–-]+$/g, "").trim();
  const isBullet = (s) => /^\s*[•▪●◦*•\-–]\s/.test(s) || /^\s*[•▪●◦•]/.test(s);
  const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

  function headerOf(line) {
    const t = line.trim().replace(/[:\s]+$/, "");
    if (!t || t.length > 45 || /\d/.test(t)) return null;
    for (const [name, re] of Object.entries(HEADERS)) if (re.test(t)) return name;
    return null;
  }

  function sections(lines) {
    const out = { top: [] };
    let cur = "top";
    for (const l of lines) {
      const h = headerOf(l);
      if (h) { cur = h; out[cur] = out[cur] || []; continue; }
      (out[cur] = out[cur] || []).push(l);
    }
    return out;
  }

  function parseDate(s, isEnd) {
    s = s.toLowerCase().trim();
    if (/present|current|now|date|today|ongoing/.test(s)) { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), now: true }; }
    let m = s.match(/^([a-z]+)\.?\s*[',’]?\s*(\d{2,4})$/);
    if (m && MONTHS[m[1].slice(0, 3)] !== undefined) return { y: fixYear(m[2]), m: MONTHS[m[1].slice(0, 3)] };
    m = s.match(/^(\d{1,2})\s*[/.-]\s*(\d{2,4})$/);
    if (m) return { y: fixYear(m[2]), m: Math.min(11, Math.max(0, +m[1] - 1)) };
    m = s.match(/^(\d{4})$/);
    if (m) return { y: +m[1], m: isEnd ? 11 : 0 };
    return null;
  }
  const fixYear = (y) => (y.length === 2 ? 2000 + +y : +y);

  function ranges(lines) {
    const found = [];
    lines.forEach((line, i) => {
      for (const m of line.matchAll(RANGE)) {
        const a = parseDate(m[1], false), b = parseDate(m[2], true);
        if (!a || !b) continue;
        const start = a.y * 12 + a.m, end = b.y * 12 + b.m;
        if (end < start || end - start > 50 * 12 || a.y < 1970) continue;
        found.push({ start, end: end + (b.now ? 0 : 1), now: !!b.now, line: i, text: m[0] });
      }
    });
    return found;
  }

  // A date range belongs to an internship when the line with the dates, or the title line just above it,
  // says "intern", "internship" or "summer trainee". (Not the line below: that's often the next job.)
  function isInternship(lines, r) {
    const near = [lines[r.line - 1], lines[r.line]].filter((l) => l && !isBullet(l));
    return near.some((l) => /\b(intern|internship|summer\s+trainee)\b/i.test(l));
  }

  function totalYears(rs) {
    if (!rs.length) return null;
    const sorted = rs.map((r) => [r.start, r.end]).sort((a, b) => a[0] - b[0]);
    let months = 0, [s, e] = sorted[0];
    for (const [a, b] of sorted.slice(1)) {
      if (a <= e) e = Math.max(e, b);
      else { months += e - s; [s, e] = [a, b]; }
    }
    months += e - s;
    return Math.round((months / 12) * 2) / 2; // nearest half year
  }

  // Splits "Senior PM | Acme Corp | Bengaluru" or "Senior PM at Acme Corp" into parts.
  function parts(line) {
    return line
      .replace(RANGE, " ")
      .replace(/[([]\s*[)\]]/g, " ")
      .split(/\s+(?:at|@)\s+|\s*[|•·]\s*|\s+[–—-]\s+|\s*,\s*|\s{3,}|\t/i)
      .map(clean)
      .filter((p) => p && p.length > 1 && p.length < 70 && !/^\(?\s*\)?$/.test(p));
  }

  function roleAndCompany(lines, first) {
    if (!first) return {};
    // Look at the date line and its neighbours, skipping bullet points.
    const near = [], nearAt = [];
    for (let i = Math.max(0, first.line - 2); i <= Math.min(lines.length - 1, first.line + 2); i++) {
      const l = lines[i];
      if (!l.trim() || isBullet(l)) { if (i > first.line) break; else continue; }
      if (i > first.line && RANGE.test(l)) { RANGE.lastIndex = 0; break; }
      RANGE.lastIndex = 0;
      near.push(l);
      nearAt.push(i);
    }
    // Which line each part came from: the company usually shares a line with the dates, while the words
    // after a title on its own line ("Product Manager - Payments Platform") are the team, not the company.
    const lineOf = new Map();
    near.forEach((l, k) => parts(l).forEach((p) => { if (!lineOf.has(p)) lineOf.set(p, nearAt[k]); }));
    // Indian titles often split a band from the function: "Deputy Manager - Key Account Management".
    const BAND = /^(deputy|assistant|associate|senior|sr\.?|general|chief|regional|area)?\s*(manager|executive|director|associate|vp|vice president|gm|dgm|agm|am|dm|lead)$/i;
    const joined = near.flatMap((l) => {
      const ps = parts(l), out = [];
      for (let i = 0; i + 1 < ps.length; i++) {
        if (BAND.test(ps[i]) && window.ROLES && ROLES.match(ps[i + 1])) out.push(`${ps[i]} - ${ps[i + 1]}`);
        if (BAND.test(ps[i + 1]) && window.ROLES && ROLES.match(ps[i])) out.push(`${ps[i]} - ${ps[i + 1]}`);
      }
      return out;
    });
    const cands = [...near.flatMap(parts), ...joined].filter((p) => !CITY_RE.test(p) || p.split(" ").length > 3)
      .filter((p) => !/^(remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|internship)$/i.test(p))
      .filter((p) => !new RegExp(`^${DATE}$`, "i").test(p) && !/^\d+$/.test(p));
    // A role must contain a real job title (see roles.js), so achievement lines like
    // "Product-market-fit for UPI lending" or section names like "SKILLS" are never picked.
    const knows = (p) => (window.ROLES ? !!ROLES.match(p) : ROLE_WORDS.test(p));
    const isAction = (p) => /^(led|grew|built|launched|drove|owned|managed|created|reduced|increased|improved|delivered|designed|developed|achieved|scaled|shipped|ran|worked|helped)\b/i.test(p) || /\d+\s*%|\b\d+x\b/i.test(p);
    const hasLevel = (p) => !!(window.ROLES && ROLES.match(p) && ROLES.match(p).seniority);
    const roleScore = (p) => (knows(p) ? 3 : 0) + (hasLevel(p) ? 1 : 0) - (COMPANY_WORDS.test(p) ? 1 : 0) - (p.split(" ").length > 6 ? 2 : 0) - (isAction(p) ? 5 : 0);
    const compScore = (p) => (COMPANY_WORDS.test(p) ? 2 : 0) - (knows(p) ? 2 : 0) - (p.split(" ").length > 6 ? 2 : 0) - (isAction(p) ? 5 : 0) - (headerOf(p) ? 5 : 0);
    let role = null, company = null;
    // A title above or on the date line belongs to this job; one below may be the next job's title
    // (when a job has a single line of detail). Use the lines below only if nothing above is a title.
    const above = cands.filter((p) => (lineOf.get(p) ?? first.line) <= first.line && roleScore(p) >= 3);
    const byRole = [...(above.length ? above : cands)].sort((a, b) => roleScore(b) - roleScore(a));
    if (byRole[0] && roleScore(byRole[0]) >= 3) role = byRole[0];
    const rest = cands.filter((p) => p !== role);
    const roleLine = role != null ? lineOf.get(role) : null;
    const place = (p) => {
      const at = lineOf.get(p);
      if (at == null) return 0;
      return (at === first.line ? 1 : 0) - (roleLine != null && at === roleLine && roleLine !== first.line ? 2 : 0);
    };
    const compTotal = (p) => compScore(p) + place(p);
    const byComp = [...rest].sort((a, b) => compTotal(b) - compTotal(a));
    if (byComp[0] && compTotal(byComp[0]) >= 0) company = byComp[0];
    return { currentRole: role ? role.replace(/\s*\(.*?\)\s*/g, " ").trim() : null, currentCompany: company };
  }

  function findName(top) {
    for (const raw of top.slice(0, 6)) {
      const l = clean(raw.split(/\s{3,}|\||,/)[0]);
      if (!l || /[@\d]|resume|curriculum|vitae|linkedin|http/i.test(l)) continue;
      const words = l.split(" ");
      if (words.length < 2 || words.length > 4) continue;
      if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) continue;
      if (ROLE_WORDS.test(l) && words.length > 2) continue;
      return l === l.toUpperCase() ? titleCase(l) : l;
    }
    return null;
  }

  function findSkills(lines) {
    const out = [];
    for (const raw of lines) {
      let l = raw.replace(/^[\s•▪●◦*\-–]+/, "");
      if (l.includes(":")) l = l.slice(l.indexOf(":") + 1); // "Languages: Python, SQL"
      for (const s of l.split(/[,|•·;]|\s{3,}|\s\/\s/)) {
        const t = clean(s).replace(/\.$/, "");
        if (t.length >= 2 && t.length <= 30 && t.split(" ").length <= 4 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
      }
      if (out.length >= 20) break;
    }
    return out.slice(0, 20);
  }

  function findEducation(lines) {
    let best = null, bestRank = 99;
    for (const raw of lines) {
      const l = clean(raw);
      if (!DEGREE_RE.test(l)) continue;
      const rank = DEGREE_RANK.findIndex((re) => re.test(l));
      if (rank !== -1 && rank < bestRank) { bestRank = rank; best = clean(l.replace(RANGE, "").replace(/\b(19|20)\d{2}\b/g, "")); }
    }
    return best ? best.slice(0, 90) : null;
  }

  function seniorityFor(years) {
    if (years == null) return null;
    if (years < 1.5) return "Entry level";
    if (years < 5) return "Mid level";
    if (years < 9) return "Senior";
    if (years < 14) return "Lead / Manager";
    return "Director and above";
  }

  function parse(text) {
    // Blank lines carry no meaning here and would push a job title away from its dates.
    const lines = text.replace(/\r/g, "").split("\n").map((l) => l.replace(/ /g, " ").trimEnd()).filter((l) => l.trim());
    const sec = sections(lines);
    const all = lines.join("\n");

    const email = (all.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || null;
    const phone = ((all.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}/g) || []).find((p) => p.replace(/\D/g, "").length >= 10) || "").trim() || null;
    const linkedin = (all.match(/linkedin\.com\/in\/[\w-]+/i) || [])[0] || null;

    // Experience: prefer the experience section; otherwise any dates outside education.
    const expLines = sec.experience && sec.experience.length ? sec.experience : [...sec.top, ...(sec.summary || [])];
    const expRanges = ranges(expLines);
    // Internships don't count towards years of experience (the same rule as yearsFromPositions).
    const work = expRanges.filter((r) => !isInternship(expLines, r));
    let years = work.length ? totalYears(work) : expRanges.length ? 0 : null, yearsSource = years != null ? "dates" : null;
    const stated = all.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years|yrs)(?:\s+of)?(?:\s+\w+){0,3}?\s+experience/i);
    if (years == null && stated) { years = parseFloat(stated[1]); yearsSource = "stated"; }

    const current = work.find((r) => r.now) || work[0] || expRanges.find((r) => r.now) || expRanges[0];
    // No dates at all? Fall back to the first lines of the experience section.
    const anchor = current || (sec.experience && sec.experience.length ? { line: 0 } : null);
    const { currentRole, currentCompany } = roleAndCompany(expLines, anchor);

    const header = lines.slice(0, 10).join(" ");
    const loc = header.match(CITY_RE) || all.match(CITY_RE);

    return {
      name: findName(sec.top.filter((l) => l.trim())),
      email, phone, linkedin,
      location: loc ? loc[1].replace(/\s+/g, " ") : null,
      currentRole: currentRole || null,
      currentCompany: currentCompany || null,
      years,
      yearsSource,
      seniority: seniorityFor(years),
      skills: findSkills(sec.skills || []),
      education: findEducation(sec.education || lines),
      stillWorking: !!(current && current.now),
    };
  }

  // Years spent in product roles (PM, PO, product lead, head of product), from the dates next to those titles.
  const PM_TITLE = /product\s+(manager|management|owner|lead|head)|head\s+of\s+product|\b(a?pm|spm|gpm)\b|director.{0,4}product\b|\bvp\b.{0,6}product/i;
  function pmYears(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/ /g, " ").trimEnd()).filter((l) => l.trim());
    const sec = sections(lines);
    const expLines = sec.experience && sec.experience.length ? sec.experience : lines;
    const rs = ranges(expLines).filter((r) => {
      const near = expLines.slice(Math.max(0, r.line - 2), r.line + 2).join(" ");
      return PM_TITLE.test(near) && !/\bintern(ship)?\b/i.test(near);
    });
    return totalYears(rs);
  }

  // Total years from a list of jobs like { start: "2021-01", end: null | "2023-06", type }.
  // Internships don't count. Someone with only internships has 0 years.
  function yearsFromPositions(positions) {
    const ym = (s) => { const m = /^(\d{4})-(\d{2})$/.exec(s || ""); return m ? +m[1] * 12 + Math.min(11, Math.max(0, +m[2] - 1)) : null; };
    const now = new Date(), nowM = now.getFullYear() * 12 + now.getMonth();
    const rs = [];
    for (const p of positions || []) {
      if (p.type === "internship") continue;
      const start = ym(p.start);
      const end = p.end ? ym(p.end) : nowM;
      if (start === null || end === null) continue;
      const e = p.end ? end + 1 : end;
      if (e > start) rs.push({ start, end: e });
    }
    const y = totalYears(rs);
    if (y === null && (positions || []).length && positions.every((p) => p.type === "internship")) return 0;
    return y;
  }

  return { extractText, parse, seniorityFor, yearsFromPositions, pmYears };
})();
