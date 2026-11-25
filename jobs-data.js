// Jobs data shared by the Matches page (jobs.js), the email preview and the report sender (scripts/).
// Plain script: in a browser it sets window.JobsData; the Node sender loads it the same way.
window.JobsData = (() => {
  // With Supabase set up: open jobs from the jobs table, refreshed daily by the fetch-jobs function.
  // Demo mode, or before the table has been filled: the jobs.json snapshot.
  const fromRow = (r) => ({
    id: r.id, company: r.company, industry: r.industry || "Other", companySize: r.company_size || "", title: r.title,
    location: r.location || "", cities: r.cities || [], workMode: r.work_mode, jobType: r.job_type || "Full-time",
    department: r.department, postedAt: r.posted_at, url: r.url, expMin: r.exp_min, expMax: r.exp_max,
    description: r.description || "", source: r.source || "feed", salaryMin: r.salary_min, salaryMax: r.salary_max,
    firstSeenAt: r.first_seen_at || null,
  });

  // The search engine can return an opening we already have (from a company feed, or listed on two job boards).
  // Company-feed jobs are always kept (one company can have several openings with the same title);
  // a search-engine job is dropped when the same company, title and city is already in the list.
  function dedupe(jobs) {
    const key = (j) => `${j.company}|${j.title}|${j.cities[0] || j.location}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").trim();
    const seen = new Set(jobs.filter((j) => j.source !== "adzuna").map(key));
    return jobs.filter((j) => {
      if (j.source !== "adzuna") return true;
      const k = key(j);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async function loadFromTable() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("jobs").select("*").is("closed_at", null)
        .order("posted_at", { ascending: false }).range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    if (!rows.length) return null;
    const { data: src } = await db.from("job_sources").select("company,last_fetched_at").eq("active", true);
    const fetched = (src || []).map((s) => s.last_fetched_at).filter(Boolean).sort();
    return {
      updatedAt: fetched.length ? fetched[fetched.length - 1] : new Date().toISOString(),
      sources: [...new Set(rows.map((r) => r.company))].sort(),
      jobs: dedupe(rows.map(fromRow)),
    };
  }

  async function loadJobs() {
    if (configured) {
      try {
        const live = await loadFromTable();
        if (live) return live;
      } catch (e) {
        console.warn("Couldn't read the jobs table, using the jobs.json snapshot instead:", e.message);
      }
    }
    return fetch("jobs.json").then((r) => r.json());
  }

  return { fromRow, dedupe, loadFromTable, loadJobs };
})();
