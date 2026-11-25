// Job-title vocabulary, built from ~2,500 live postings (Nov 2026) on the public
// careers feeds of Razorpay, Groww, Druva, CRED, Zeta, Paytm, Stripe, Databricks,
// Airbnb, Figma and GitLab.
//
// A posted title is almost always:   [seniority / band]  BASE ROLE  [qualifier]
//   e.g. "Senior Product Manager - Ads", "KAM - Manager - Paytm Ads", "Product Designer II"
// The qualifier is a team, product, segment or city ("Ads", "Lending Collections",
// "Enterprise", "Bengaluru"); it is NOT part of the role.
// Anything that doesn't contain a base role below (e.g. "Product-market-fit") is not a title.
window.ROLES = {
  families: {
    "Engineering": {
      "Software Engineer": ["software engineer", "software development engineer", "sde", "sde 1", "sde 2", "sde 3", "software developer", "developer", "programmer", "member of technical staff", "mts"],
      "Backend Engineer": ["backend engineer", "back-end engineer", "backend developer", "java developer", "golang developer", "python developer", "node.js developer"],
      "Frontend Engineer": ["frontend engineer", "front-end engineer", "frontend developer", "ui engineer", "react developer", "web developer"],
      "Full Stack Engineer": ["full stack engineer", "fullstack engineer", "full-stack engineer", "full stack developer"],
      "Mobile Engineer": ["mobile engineer", "android engineer", "android developer", "ios engineer", "ios developer", "flutter developer", "react native developer"],
      "DevOps Engineer": ["devops engineer", "devsecops engineer", "cloud engineer", "infrastructure engineer", "build and release engineer"],
      "Site Reliability Engineer": ["site reliability engineer", "sre", "production engineer", "reliability engineer"],
      "Platform Engineer": ["platform engineer"],
      "Security Engineer": ["security engineer", "product security engineer", "application security engineer", "information security analyst", "director product security", "head product security", "head of product security"],
      "QA Engineer": ["qa engineer", "sdet", "test engineer", "quality engineer", "automation engineer", "quality analyst"],
      "Data Engineer": ["data engineer", "analytics engineer", "etl developer", "big data engineer"],
      "Machine Learning Engineer": ["machine learning engineer", "ml engineer", "mlops engineer"],
      "AI Engineer": ["ai engineer", "applied ai engineer", "llm engineer", "genai engineer", "ai/ml engineer"],
      "Database Engineer": ["database administrator", "dba", "database engineer", "data base engineer"],
      "Solutions Architect": ["solutions architect", "solution architect", "cloud architect", "technical architect", "enterprise architect", "solutions architecture", "manager solutions architecture"],
      "Forward Deployed Engineer": ["forward deployed engineer", "fde", "deployment engineer"],
      "Support Engineer": ["support engineer", "technical support engineer", "backline engineer", "incident manager", "escalation specialist", "customer support engineer", "escalation engineer", "l2 support engineer"],
      "Developer Advocate": ["developer advocate", "developer relations", "devrel"],
      "Engineering Manager": ["engineering manager", "software engineering manager", "head of engineering", "director of engineering", "vp engineering", "cto", "manager engineering", "engineering lead"],
    },
    "Product": {
      "Product Manager": ["product manager", "product management", "pm", "product owner", "apm", "associate product manager", "group product manager", "gpm", "head of product", "head product", "product head", "director of product", "director product", "vp product", "vp of product", "cpo"],
      "Technical Product Manager": ["technical product manager", "tpm (product)", "platform product manager"],
      "Product Analyst": ["product analyst"],
      "Product Operations Manager": ["product operations manager", "product ops"],
    },
    "Program & Project": {
      "Program Manager": ["program manager", "program management", "programme manager"],
      "Technical Program Manager": ["technical program manager", "tpm"],
      "Project Manager": ["project manager", "delivery manager", "scrum master", "pmo"],
    },
    "Design": {
      "Product Designer": ["product designer", "product design"],
      "UX Designer": ["ux designer", "ui/ux designer", "ux/ui designer", "interaction designer", "ui designer"],
      "UX Researcher": ["ux researcher", "user researcher", "design researcher"],
      "Communication Designer": ["communication designer", "graphic designer", "visual designer", "brand designer", "illustrator", "creative illustrator", "motion designer"],
      "Design Manager": ["design manager", "head of design", "design director"],
    },
    "Data & Analytics": {
      "Data Analyst": ["data analyst", "analytics", "business analytics", "mis analyst", "bi analyst", "business intelligence analyst"],
      "Business Analyst": ["business analyst", "operations analyst"],
      "Data Scientist": ["data scientist", "applied scientist", "research scientist", "decision scientist"],
      "Analytics Manager": ["analytics manager", "analytics lead", "head of analytics"],
    },
    "Sales & Business Development": {
      "Account Executive": ["account executive", "ae", "enterprise account executive", "strategic account executive", "commercial account executive"],
      "Sales Development Representative": ["sales development representative", "sdr", "business development representative", "bdr", "inside sales representative", "inside sales executive"],
      "Business Development Manager": ["business development manager", "bdm", "business development executive", "bde", "business development"],
      "Key Account Manager": ["key account manager", "kam", "key account management", "strategic account manager", "global account manager"],
      "Sales Manager": ["sales manager", "area sales manager", "asm", "regional sales manager", "field sales manager", "territory manager", "cluster manager", "regional manager", "zonal sales manager", "head of sales", "sales director", "regional sales director", "sales leader", "sales specialist", "manager sales development", "team leader"],
      "Partnerships Manager": ["partnerships manager", "partner manager", "alliance manager", "alliances manager", "channel manager", "channel business manager", "partner development manager", "banking alliances", "banking alliance", "partner solutions manager", "partner specialist", "strategic partnerships"],
      "Solutions Consultant": ["solutions consultant", "sales engineer", "solutions engineer", "pre-sales consultant", "presales consultant", "technical solutions engineer", "field engineering", "field cto"],
      "Relationship Manager": ["relationship manager", "rm", "wealth manager", "portfolio specialist"],
    },
    "Customer Success & Support": {
      "Customer Success Manager": ["customer success manager", "csm", "customer success", "client success manager"],
      "Account Manager": ["account manager", "client servicing manager", "client partner", "renewals manager", "head of renewals"],
      "Technical Account Manager": ["technical account manager"],
      "Implementation Manager": ["implementation manager", "onboarding manager", "implementation consultant", "professional services consultant"],
      "Customer Support Associate": ["customer support associate", "customer support executive", "customer service executive", "cst", "support specialist", "customer experience associate"],
    },
    "Marketing & Growth": {
      "Product Marketing Manager": ["product marketing manager", "pmm", "product marketing"],
      "Growth Manager": ["growth manager", "growth management", "growth lead", "growth marketing manager", "user growth"],
      "Performance Marketing Manager": ["performance marketing manager", "performance marketing", "digital marketing manager", "paid marketing manager", "campaign manager", "campaign management"],
      "Marketing Manager": ["marketing manager", "field marketing manager", "head of marketing", "cmo"],
      "Brand Manager": ["brand manager", "brand marketing manager"],
      "Content Writer": ["content writer", "content marketer", "content strategist", "copywriter", "editor", "content creator"],
      "Communications Manager": ["communications manager", "pr manager", "corporate communications", "employer branding"],
      "SEO Specialist": ["seo specialist", "seo manager"],
    },
    "Operations & Strategy": {
      "Operations Manager": ["operations manager", "business operations manager", "bizops", "operations associate", "operations executive", "ops manager"],
      "Strategy Manager": ["strategy manager", "corporate strategy", "strategy & operations", "strategy and operations", "strategy & execution manager", "chief of staff", "founder's office", "corporate development", "finance & strategy", "deal pricing strategist", "pricing strategist"],
      "Category Manager": ["category manager", "business category lead", "category lead"],
      "Supply Chain Manager": ["supply chain manager", "logistics manager", "procurement manager", "procurement specialist", "purchase manager", "sourcing manager", "demand planning", "forecasting and demand planning", "it procurement"],
      "Collections Manager": ["collections manager", "collection manager", "area collections manager", "regional collections manager", "recovery manager"],
    },
    "Finance, Risk & Compliance": {
      "Financial Analyst": ["financial analyst", "fp&a analyst", "fp&a manager", "corporate fp&a", "finance analyst", "treasury specialist", "treasury manager", "treasury"],
      "Accountant": ["accountant", "chartered accountant", "accounts executive", "revenue accounting", "accounts manager", "legal entity controller", "billing operations analyst", "go-to-market accounting"],
      "Finance Manager": ["finance manager", "finance controller", "financial controller", "head of finance", "cfo"],
      "Auditor": ["internal auditor", "internal audit", "it audit", "audit manager", "auditor"],
      "Risk Manager": ["risk manager", "risk management", "credit risk analyst", "credit risk manager", "market risk manager", "fraud analyst", "fraud analytics", "risk analyst"],
      "Compliance Manager": ["compliance manager", "regulatory compliance", "compliance officer", "aml analyst", "mlro"],
    },
    "People & HR": {
      "Recruiter": ["recruiter", "talent acquisition", "talent acquisition specialist", "technical recruiter", "gtm recruiter", "sourcer"],
      "HR Business Partner": ["hr business partner", "hrbp", "people partner"],
      "HR Generalist": ["hr generalist", "hr executive", "hr manager", "people operations", "hr operations"],
      "Learning & Development Manager": ["learning and development", "l&d manager", "learning & development", "talent management", "org development", "trainer", "process trainer", "enablement manager", "enablement specialist", "technical enablement"],
      "Total Rewards Specialist": ["total rewards", "compensation and benefits", "c&b manager", "payroll specialist"],
    },
    "Legal & Admin": {
      "Legal Counsel": ["legal counsel", "counsel", "corporate counsel", "lawyer", "legal manager", "legal associate", "company secretary", "legal", "legal specialist"],
      "Executive Assistant": ["executive assistant", "personal assistant", "office administrator", "admin executive", "office manager", "administrative coordinator"],
      "Public Policy Manager": ["public policy", "policy lead", "policy manager", "public affairs", "government affairs"],
    },
  },

  // Seniority words seen before the base role, mapped to the app's levels.
  // Indian corporate bands (Executive -> AM -> DM -> Manager -> AGM -> DGM -> GM -> AVP -> VP)
  // appear constantly in Indian postings, often abbreviated ("AM/DM", "DGM/GM").
  seniority: {
    "Entry level": ["intern", "trainee", "graduate", "new grad", "fresher", "junior", "jr", "associate", "executive", "analyst", "i", "1", "sde 1"],
    "Mid level": ["ii", "2", "sde 2", "senior executive", "sr executive", "assistant manager", "am", "deputy manager", "dm"],
    "Senior": ["senior", "sr", "sr.", "iii", "3", "sde 3"],
    "Lead / Manager": ["lead", "staff", "principal", "senior manager", "sr manager", "group", "agm", "assistant general manager", "team lead"],
    "Director and above": ["director", "associate director", "senior director", "head of", "head", "dgm", "gm", "general manager", "avp", "vp", "vice president", "svp", "chief", "cxo", "founder", "co-founder"],
  },
};

// Look up a free-text title. Returns { role, family, seniority } or null when it
// doesn't contain a known base role (so "Product-market-fit for UPI" -> null).
window.ROLES.match = function (text) {
  if (!text) return null;
  const t = " " + text.toLowerCase().replace(/[^a-z0-9&/+.]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  let best = null;
  for (const [family, roles] of Object.entries(window.ROLES.families)) {
    for (const [role, aliases] of Object.entries(roles)) {
      for (const a of [role.toLowerCase(), ...aliases]) {
        if (a.length <= 3 && !new RegExp(`(^| )${a.replace(/[.+]/g, "\\$&")}( |$)`).test(t)) continue; // short codes must stand alone
        if (t.includes(" " + a + " ") && (!best || a.length > best.len)) best = { role, family, len: a.length };
      }
    }
  }
  if (!best) return null;
  // The longest seniority phrase wins ("deputy manager" beats "manager"); ties go to the higher level.
  let seniority = null, seniorityLen = 0;
  for (const [level, words] of Object.entries(window.ROLES.seniority)) {
    for (const w of words) {
      // Level numbers ("I", "II", "3") only count at the end ("Product Manager II"), not in "Exp : 3-8 yrs".
      const hit = /^(i{1,3}|[1-3])$/.test(w) ? t.trimEnd().endsWith(" " + w) : t.includes(" " + w + " ");
      if (hit && w.length >= seniorityLen) { seniority = level; seniorityLen = w.length; }
    }
  }
  return { role: best.role, family: best.family, seniority };
};

// All standard role names, e.g. for the AI's allowed list or an autocomplete.
window.ROLES.names = function () {
  return Object.values(window.ROLES.families).flatMap((roles) => Object.keys(roles));
};

// The family a standard role belongs to ("Product Manager" -> "Product").
window.ROLES.familyOf = function (role) {
  for (const [family, roles] of Object.entries(window.ROLES.families)) if (role in roles) return family;
  return null;
};
