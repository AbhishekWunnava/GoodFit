// Rules that read a job description (or a resume) and pull out what a PM match depends on:
// role archetype, business model, vertical, company type, market, requirements, years asked, and more.
// Rules first (free, instant, runs in the browser); an AI reader can replace extractJob() later
// without changing the scoring in matching.js.
window.Signals = (() => {
  // ---------- Vocabularies ----------
  // Verticals and their sub-verticals. Words are matched as whole words, case-insensitive.
  const VERTICALS = {
    Fintech: { words: ["fintech", "financial services", "financial technology", "neobank", "bfsi", "banking", "nbfc"],
      subs: {
        Payments: ["payments", "payment gateway", "upi", "merchant acquiring", "checkout", "remittance", "payouts", "acquiring"],
        Lending: ["lending", "loans", "loan", "credit underwriting", "underwriting", "collections", "bnpl", "nbfc", "credit risk"],
        Wealth: ["wealth", "investing", "investments", "mutual funds", "stocks", "trading", "brokerage", "asset management"],
        Insurance: ["insurance", "insurtech", "policy issuance", "claims"],
        Cards: ["credit card", "credit cards", "cards", "card issuing", "prepaid"],
        Banking: ["core banking", "neobank", "deposits", "banking"],
        Crypto: ["crypto", "blockchain", "web3"],
        "Risk & fraud": ["fraud", "risk management", "transaction monitoring", "aml", "kyc"],
      } },
    HRtech: { words: ["hrtech", "hr tech", "hcm", "payroll", "recruiting software", "talent acquisition platform", "hris", "workforce management", "employee experience"] },
    Healthtech: { words: ["healthtech", "health tech", "healthcare", "hospital", "clinical", "patients", "pharmacy", "telemedicine", "medtech", "diagnostics"] },
    Edtech: { words: ["edtech", "education", "learning platform", "students", "upskilling", "k-12", "test prep"] },
    "E-commerce": { words: ["e-commerce", "ecommerce", "online shopping", "d2c", "retail", "catalog", "sellers", "shoppers", "quick commerce"] },
    Logistics: { words: ["logistics", "supply chain", "shipping", "freight", "fleet", "last mile", "warehouse", "visibility platform"] },
    Adtech: { words: ["adtech", "ad tech", "advertising", "advertisers", "programmatic", "ad exchange", "ssp", "dsp", "monetization of ads", "martech", "marketing technology"] },
    Mobility: { words: ["mobility", "ride-hailing", "ride hailing", "automotive", "dealerships", "vehicles", "electric vehicle"] },
    Travel: { words: ["travel", "hospitality", "hotels", "flights", "bookings"] },
    Foodtech: { words: ["food delivery", "restaurants", "foodtech", "grocery"] },
    Gaming: { words: ["gaming", "games", "fantasy sports", "real money gaming"] },
    Media: { words: ["media", "streaming", "content platform", "ott", "creators", "social media", "lock screen"] },
    "Security": { words: ["cybersecurity", "security platform", "identity", "zero trust", "threat", "siem", "data security", "access management"] },
    "Data & AI": { words: ["data platform", "analytics platform", "observability", "data infrastructure", "machine learning platform", "ai platform", "data pipelines", "etl"] },
    "Dev tools": { words: ["developer tools", "devops", "ci/cd", "developer platform", "devsecops", "software delivery"] },
    "Enterprise software": { words: ["erp", "crm", "procurement", "contract management", "clm", "legal tech", "sales enablement", "customer success platform", "itsm"] },
    "Real estate": { words: ["real estate", "proptech", "property"] },
    Telecom: { words: ["telecom", "telco", "recharges", "mobile operators"] },
  };
  // Verticals close enough that experience in one carries over (both ways).
  const ADJACENT = [
    ["Fintech", "Insurance"], ["E-commerce", "Logistics"], ["E-commerce", "Foodtech"], ["Foodtech", "Logistics"],
    ["Adtech", "Media"], ["HRtech", "Enterprise software"], ["Security", "Dev tools"], ["Dev tools", "Data & AI"],
    ["Security", "Data & AI"], ["Mobility", "Logistics"], ["Mobility", "Travel"], ["Gaming", "Media"],
  ];

  const MODELS = {
    B2B: { strong: ["b2b", "b2b saas", "enterprise saas"], weak: ["enterprise customers", "enterprises", "merchants", "businesses", "smbs", "smb", "saas", "b2b customers", "account managers", "admins", "workflows for teams"] },
    B2C: { strong: ["b2c", "consumer-facing", "consumer facing", "d2c"], weak: ["consumers", "consumer app", "end users", "millions of users", "users across india", "retail customers", "mobile app users", "daus", "mau"] },
    B2B2C: { strong: ["b2b2c"], weak: ["partners and their customers", "embedded finance"] },
    Marketplace: { strong: ["marketplace", "two-sided"], weak: ["buyers and sellers", "supply and demand", "sellers and buyers"] },
  };

  const SERVICES_COMPANIES = ["tcs", "tata consultancy", "infosys", "wipro", "accenture", "cognizant", "hcl", "hcltech", "tech mahindra",
    "capgemini", "ltimindtree", "lti", "mindtree", "mphasis", "hexaware", "persistent systems", "deloitte", "ernst & young", "ey",
    "kpmg", "pwc", "ibm consulting", "virtusa", "birlasoft", "coforge", "zensar", "cyient", "sonata software", "nagarro", "globallogic",
    "epam", "thoughtworks", "publicis sapient", "genpact", "ust", "ust global", "ness", "quess", "teamlease"];

  // Concepts a requirement can ask for, and the words that signal them (in a job or a resume).
  const CONCEPTS = {
    sql: ["sql", "querying data", "write queries"],
    analytics: ["data-driven", "data driven", "analytics", "analytical", "metrics", "dashboards", "amplitude", "mixpanel", "looker", "tableau"],
    experimentation: ["a/b test", "a/b testing", "ab testing", "experimentation", "experiments", "hypothesis testing"],
    apis: ["apis", "api", "rest", "integrations", "sdk", "webhooks"],
    technical: ["technical background", "engineering background", "computer science", "cs degree", "software engineer", "former engineer", "hands-on technical", "technical product", "system design", "architecture"],
    ai_ml: ["machine learning", "ml models", "artificial intelligence", "ai/ml", "genai", "gen ai", "generative ai", "llm", "llms", "agentic", "ai products", "ai-powered"],
    pricing: ["pricing", "monetisation", "monetization", "packaging", "revenue"],
    growth: ["growth", "retention", "activation", "funnel", "conversion", "engagement", "acquisition"],
    zero_to_one: ["0 to 1", "0-1", "0→1", "zero to one", "from scratch", "greenfield", "new product", "launch new products", "build new products"],
    scale: ["1 to n", "scale the product", "scaling products", "at scale"],
    mobile: ["mobile app", "android", "ios", "mobile-first"],
    platform: ["platform", "platform product", "infrastructure", "developer experience"],
    design: ["ux", "user experience", "design thinking", "figma", "wireframes"],
    research: ["user research", "customer research", "discovery", "customer interviews", "usability"],
    gtm: ["go-to-market", "go to market", "gtm", "launches", "product marketing"],
    people_mgmt: ["manage a team of", "managing a team of", "lead a team of", "leading a team of", "people management", "people manager", "mentor and grow", "hire and develop", "build and lead", "managed a team"],
    startup: ["startup experience", "early-stage", "early stage", "fast-paced startup", "startup environment", "founder", "co-founder", "founding"],
    mba: ["mba", "pgdm", "pgp"],
    engineering_degree: ["b.tech", "btech", "b.e.", "bachelor of engineering", "engineering degree", "degree in engineering", "computer science degree", "bachelor's in computer science"],
    tier1: ["iit", "iim", "bits pilani", "isb", "tier 1", "tier-1", "tier one", "premier institute", "top-tier institute"],
    consulting: ["consulting background", "management consulting", "mckinsey", "bcg", "bain"],
    stakeholders: ["stakeholder management", "cross-functional", "cross functional"],
    b2b: ["b2b", "enterprise customers", "b2b saas", "enterprise saas"],
    b2c: ["b2c", "consumer products", "consumer-facing", "consumer tech", "consumer internet"],
    saas: ["saas"],
    global_market: ["us market", "north america", "global customers", "us customers", "international markets", "global markets", "us-based"],
    india_market: ["bharat", "tier 2", "tier-2", "indian market", "india market", "vernacular"],
  };
  const REGULATORY = { RBI: ["rbi", "reserve bank"], NPCI: ["npci", "upi"], SEBI: ["sebi"], IRDAI: ["irdai", "irda"], "KYC/AML": ["kyc", "aml", "anti-money laundering"],
    PCI: ["pci", "pci-dss", "pci dss"], HIPAA: ["hipaa"], GDPR: ["gdpr"], "SOC 2": ["soc 2", "soc2"], "Data privacy": ["dpdp", "data protection"] };

  // Archetype words: what the day-to-day of the role is.
  const ARCH = {
    pm: ["product strategy", "product vision", "roadmap", "discovery", "outcomes", "kpis", "okrs", "product-market fit", "prioritize", "prioritise",
      "user research", "prd", "prds", "go-to-market", "own the product", "end-to-end ownership", "business impact", "north star", "customer problems"],
    po: ["product owner", "backlog", "user stories", "sprint", "scrum", "acceptance criteria", "grooming", "refinement", "client requirements",
      "business requirements", "requirement gathering", "requirements gathering", "functional specifications", "brd", "frd", "agile ceremonies"],
    program: ["program manager", "programme manager", "project manager", "project plan", "timelines", "raid", "pmo", "resource allocation",
      "status reports", "delivery management", "project delivery", "risk register", "milestones"],
    ba: ["business analyst", "gap analysis", "process mapping", "uat", "as-is", "to-be", "use cases", "data mapping"],
  };

  const PRODUCT_TITLE = /product\s+(manag|owner|lead|head)|head\s+of\s+product|\b(a?pm|spm|gpm)\b|director\W{0,4}product\b|\bvp\W{0,6}product|chief product/i;
  const NOT_PRODUCT_TITLE = /product\s+(marketing|design|analyst|operations|support|security|engineer|specialist)/i;

  // ---------- Text helpers ----------
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reCache = new Map();
  function wordRe(words) {
    const k = words.join("|");
    if (!reCache.has(k)) reCache.set(k, new RegExp(`(^|[^a-z0-9])(${words.map(esc).join("|")})(?=[^a-z0-9]|$)`, "gi"));
    return reCache.get(k);
  }
  const count = (text, words) => (text.match(wordRe(words)) || []).length;
  const has = (text, words) => { const r = wordRe(words); r.lastIndex = 0; return r.test(text); };

  // ---------- Pieces ----------
  function verticalsIn(text) {
    const out = [], subs = [];
    for (const [v, def] of Object.entries(VERTICALS)) {
      let n = count(text, def.words);
      for (const [s, words] of Object.entries(def.subs || {})) {
        const m = count(text, words);
        if (m >= 2) subs.push(`${v}: ${s}`);
        n += m;
      }
      if (n >= 2) out.push([v, n]);
    }
    out.sort((a, b) => b[1] - a[1]);
    const top = out.length ? out[0][1] : 0;
    return { verticals: out.filter((x) => x[1] >= Math.max(2, top * 0.4)).slice(0, 3).map((x) => x[0]), subVerticals: subs };
  }

  function modelsIn(text) {
    const scores = Object.entries(MODELS).map(([m, w]) => [m, 3 * count(text, w.strong) + count(text, w.weak)]);
    const top = Math.max(...scores.map((s) => s[1]));
    if (top < 2) return [];
    return scores.filter(([, s]) => s >= 2 && s >= top / 2).map(([m]) => m);
  }

  function companyModelIn(text, company) {
    const c = String(company || "").toLowerCase();
    if (SERVICES_COMPANIES.some((s) => c === s || c.startsWith(s + " "))) return "Services";
    if (has(text, ["global capability center", "global capability centre", "gcc", "india development center", "india development centre", "captive center", "technology center in india", "global technology centre"])) return "GCC";
    const services = count(text, ["our clients", "client's", "clients'", "client engagements", "client engagement", "statement of work", "onsite-offshore", "offshore", "it services", "consulting firm", "for our client", "our client is", "service delivery", "billable"]);
    if (services >= 2) return "Services";
    const product = count(text, ["our product", "our products", "our platform", "our customers", "our users", "product company", "saas", "our app"]);
    if (product >= 1) return "Product";
    return null;
  }

  function archetypeIn(title, text) {
    const t = String(title || "").toLowerCase();
    if (/\bproduct owner\b/.test(t)) return "po";
    if (/\b(program|programme|project|delivery) manager\b/.test(t) && !/product/.test(t)) return "program";
    if (/\bbusiness analyst\b/.test(t)) return "ba";
    const s = Object.fromEntries(Object.entries(ARCH).map(([k, w]) => [k, count(text, w)]));
    const best = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 2) return /product (manager|management|lead)|head of product|\bpm\b/.test(t) ? "pm" : null;
    // Plenty of real PM roles mention sprints and user stories; only call it PO/program/BA when it clearly dominates.
    if (best[0] !== "pm" && best[1] >= 1.5 * Math.max(1, s.pm) + 2) return best[0];
    return s.pm >= 2 || /product (manager|management|lead)|head of product/.test(t) ? "pm" : best[0];
  }

  function regulatoryIn(text) {
    return Object.entries(REGULATORY).filter(([, w]) => has(text, w)).map(([k]) => k);
  }

  function conceptsIn(text) {
    const out = [];
    for (const [k, w] of Object.entries(CONCEPTS)) if (has(text, w)) out.push(k);
    for (const r of regulatoryIn(text)) out.push(`reg:${r}`);
    const v = verticalsIn(text + " " + text); // one mention is enough inside a single requirement line
    v.verticals.forEach((x) => out.push(`v:${x}`));
    v.subVerticals.forEach((x) => out.push(`sv:${x}`));
    return out;
  }

  // "4+ years of product management experience", "3-5 years as a PM", "5 years in product".
  function pmYearsAsked(text) {
    const t = text.replace(/\s+/g, " ");
    const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\b[^.;•\n]{0,40}?\b(product management|product manager|product owner|product role|as a pm|in product|of pm|pm experience|managing products)/i;
    const m = re.exec(t);
    if (!m) return { pmMin: null, pmMax: null };
    const a = +m[1], b = m[2] ? +m[2] : null;
    return a <= 25 ? { pmMin: a, pmMax: b && b > a ? b : null } : { pmMin: null, pmMax: null };
  }

  // Splits a description into blocks under headings, and finds the must-have and preferred lists.
  const MUST_H = /(requirements?|must[- ]haves?|what you('|’)?ll need|you('|’)?ll need|what we('|’)?re looking for|what we are looking for|what we look for|you will need|what you need|what you('|’)?ll bring|experience and background|background|experience|qualifications|who you are|about you|you have|you bring|you should have|skills|experience required|minimum qualifications|basic qualifications|eligibility|what makes you a fit|great fit)/i;
  const PREF_H = /(preferred|nice[- ]to[- ]have|good[- ]to[- ]have|bonus|plus points?|added advantage|brownie points|would be great|desirable|ideally)/i;
  function requirementLists(description) {
    const lines = String(description || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const must = [], pref = [];
    let mode = null;
    for (const l of lines) {
      const isBullet = /^[•●▪◦‣·–\-*]\s?/.test(l) || /^\d+[.)]\s/.test(l);
      const isHeading = !isBullet && l.length < 80 && !/[.!?]$/.test(l);
      if (isHeading) {
        mode = PREF_H.test(l) ? "pref" : MUST_H.test(l) ? "must" : null;
        continue;
      }
      if (!mode) {
        // Inline cues: "Bonus: experience with ..." or "Nice to have - ..."
        if (PREF_H.test(l.slice(0, 40))) pref.push(l);
        continue;
      }
      const item = l.replace(/^([•●▪◦‣·–\-*]|\d+[.)])\s*/, "");
      if (mode === "must" && PREF_H.test(item.slice(0, 60))) pref.push(item);
      else (mode === "must" ? must : pref).push(item);
    }
    return { must: must.slice(0, 25), pref: pref.slice(0, 15) };
  }

  // A requirement line becomes a checkable item if it names concepts we can compare;
  // soft skills ("excellent communication") are left out. The years in a line are scored in Experience;
  // the rest of the line ("…owning a platform or API product") is checked here.
  function checkable(items) {
    return items.map((text) => ({ text, concepts: conceptsIn(text).filter((c) => !["stakeholders"].includes(c)) }))
      .filter((x) => x.concepts.length);
  }

  // ---------- Public: a job ----------
  function extractJob(j) {
    const text = `${j.title}\n${j.department || ""}\n${j.description || ""}`.toLowerCase();
    const { verticals, subVerticals } = verticalsIn(text);
    const industryV = Object.keys(VERTICALS).find((v) => v.toLowerCase() === String(j.industry || "").toLowerCase());
    const lists = requirementLists(j.description);
    const words = (j.description || "").split(/\s+/).length;
    // Whether it's a product role at all comes from the title; the description only decides PM vs PO vs the rest.
    const productTitle = PRODUCT_TITLE.test(j.title || "") && !NOT_PRODUCT_TITLE.test(j.title || "");
    const sig = {
      productTitle,
      archetype: productTitle ? archetypeIn(j.title, text) : null,
      models: modelsIn(text),
      verticals: verticals.length ? verticals : industryV ? [industryV] : [],
      subVerticals,
      companyModel: companyModelIn(text, j.company) || (j.source === "feed" || !j.source ? "Product" : null),
      peopleMgmt: has(text, CONCEPTS.people_mgmt),
      regulatory: regulatoryIn(text),
      segments: [has(text, ["enterprise customers", "large enterprises", "fortune 500", "enterprise clients"]) && "Enterprise",
        has(text, ["mid-market", "mid market"]) && "Mid-market", has(text, ["smb", "smbs", "small businesses", "msme", "msmes", "small and medium"]) && "SMB",
        has(text, ["consumers", "consumer app", "b2c", "end users"]) && "Consumer"].filter(Boolean),
      market: has(text, CONCEPTS.global_market) ? "Global" : has(text, CONCEPTS.india_market) ? "India" : null,
      gtm: has(text, ["product-led", "product led", "plg", "self-serve", "self serve", "freemium"]) ? "PLG" : has(text, ["enterprise sales", "sales-led", "account executives", "sales team"]) ? "Sales-led" : null,
      ...pmYearsAsked(text),
      must: checkable(lists.must),
      pref: checkable(lists.pref),
      immediate: has(text, ["immediate joiner", "immediate joiners", "join immediately", "notice period of 30 days or less", "15 days notice"]),
      words,
    };
    sig.confidence = j.source === "adzuna" || words < 300 ? "low" : (sig.must.length >= 2 || (sig.models.length && sig.verticals.length)) ? "high" : "medium";
    return sig;
  }

  // ---------- Public: a resume ----------
  // Signals read from resume text, stored on the profile when the resume is read.
  function fromResume(text) {
    const t = String(text || "").toLowerCase();
    const v = verticalsIn(t);
    return {
      concepts: conceptsIn(t),
      models: modelsIn(t),
      verticals: v.verticals,
      subVerticals: v.subVerticals,
      regulatory: regulatoryIn(t),
      managedPMs: /\b(led|lead|leading|managed|managing|manage|built and led|mentored|mentoring|grew)\s+(a\s+)?(team\s+of\s+)?(\d+\s+|several\s+|multiple\s+)?(product managers|pms|apms)\b/.test(t)
        || has(t, ["group product manager", "head of product", "director of product", "director product"]),
      // Worked at a services firm too? Keep product companies in the list as well; the person can untick either.
      companyModels: has(t, SERVICES_COMPANIES.filter((c) => c.length > 3)) ? ["Product", "Services"] : [],
    };
  }

  // Every term the rules look for, with the key it stands for, so a page can highlight them in a description.
  // kind "specific" = a domain, business model or regulation (worth showing anywhere in the text);
  // kind "generic" = a skill or practice (only shown inside requirement lines, where it means something).
  let VOCAB = null;
  function vocab() {
    if (VOCAB) return VOCAB;
    VOCAB = [];
    for (const [v, def] of Object.entries(VERTICALS)) {
      VOCAB.push({ key: `v:${v}`, words: def.words, kind: "specific", label: v });
      for (const [sub, words] of Object.entries(def.subs || {})) VOCAB.push({ key: `sv:${v}: ${sub}`, words, kind: "specific", label: `${v}: ${sub}` });
    }
    for (const [m, w] of Object.entries(MODELS)) VOCAB.push({ key: `model:${m}`, words: w.strong, kind: "specific", label: m });
    for (const [r, words] of Object.entries(REGULATORY)) VOCAB.push({ key: `reg:${r}`, words, kind: "specific", label: r });
    for (const [k, words] of Object.entries(CONCEPTS)) if (!["b2b", "b2c"].includes(k)) VOCAB.push({ key: k, words, kind: "generic", label: k });
    return VOCAB;
  }

  return {
    extractJob, fromResume, conceptsIn, requirementLists, vocab,
    VERTICALS, ADJACENT, MODELS: Object.keys(MODELS),
    SUB_VERTICALS: Object.entries(VERTICALS).flatMap(([v, d]) => Object.keys(d.subs || {}).map((s) => `${v}: ${s}`)),
    VERTICAL_NAMES: Object.keys(VERTICALS),
  };
})();
