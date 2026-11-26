# GoodFit – onboarding + job matches

Plain HTML/CSS/JS. No install, no build. Free tools only.

## What a new user sees

1. **A short greeting** explaining the 3-minute setup, then a 4-stop progress line.
2. **Resume:** drag and drop a PDF or .docx (up to 5 MB).
3. **Your details:** Claude reads the resume and pre-fills name, current role (plus the standard
   role it maps to), company, total years of experience (worked out from the job dates, internships
   excluded), city, education, skills and industries. Each field says whether it came from the resume
   or needs adding; everything is editable.
4. **Preferences:** roles (suggestions are real titles from the same job family), seniority, job type,
   work mode, cities, relocation, current/expected pay (₹ LPA or other currencies, with the hike %),
   notice period, company size, industries, must-haves, companies/keywords to avoid, free-text notes.
5. **Review:** a summary of both, with Edit links, and a **Find my jobs** button.
6. **"We're finding jobs" loader**, then the **Matches page** (`jobs.html`): filters seeded from the
   preferences (roles, cities, relocation, work mode, seniority, job type, company size, industry,
   posted date, keywords to hide, search), a ranked list with a match score and the reasons, and a
   detail panel with the full description and an "Apply on <company>'s site" link. Save jobs, or mark
   them "Not interested" (with Undo). "Save as my preferences" writes the filters back to the profile.
   Once onboarding is done, logging in goes straight to Matches; Profile opens the onboarding to edit.
   Match highlights: in a job's detail panel, the description marks the words that match your profile
   (teal: your industry and space, B2B/B2C, regulations, skills, cities, years asked that you meet) and
   possible gaps (amber: must-have terms you may lack, years you're short of). Each must-have and
   preferred line is tagged "you have this" / "you may not have this", and reasons in "How it fits you"
   have a Show link that jumps to the evidence. A Highlight switch turns it off (remembered in the browser).
   (`Matcher.evidence()` decides what to mark; `Signals.vocab()` lists the terms.)
   List tools: pages (10 / 20 / 50 / 100 per page), sort by best match, newest, experience asked
   (low→high, high→low) or company A–Z (sort and page size are remembered in the browser), "Show / Hide
   lower-fit jobs", a Hidden view (#hidden) to bring back jobs marked "Not interested", and "Download
   list" on Saved, which saves a .csv for Excel or Google Sheets.

### Where the jobs come from
With Supabase set up, jobs live in the `jobs` table. Every morning (06:00 India time) the `fetch-jobs`
Edge Function reads the public careers feeds (Greenhouse, Lever, Ashby) of every company in the
`job_sources` table, keeps the openings based in India, and saves them. Postings that vanish from a
feed are marked closed and drop off the Matches page. To follow another company, add a row to
`job_sources` (company, `ats`, and the `board` name from its careers URL); no code change needed.
Starting list: Razorpay, Groww, Druva, CRED, Zeta, Paytm, Meesho, Atlan, InMobi, Stripe, Databricks,
Airbnb, Figma and GitLab. `supabase-jobs-add-companies.sql` adds 16 more that post PM roles in Bengaluru,
Hyderabad, Pune or Chennai: Tekion, Zenoti, PubMatic, Mindtickle, FourKites, Bureau, SpotDraft, FamPay,
Hevo Data, Sumo Logic, Rubrik, Harness, Okta, Pure Storage, Glance and Netskope. (Many Indian startups,
e.g. PhonePe and Swiggy, don't use these three careers systems, so they can't be added this way yet.)

`jobs.json` is an older snapshot of the same feeds. Demo mode uses it, and so does the Matches page
until the `jobs` table has been filled. Saved / hidden jobs are kept in the browser for now, not in Supabase.

### How matching works (`signals.js` + `matching.js`) — V1, PM roles, rules-based
`signals.js` reads each job description (in the browser, when the Matches page loads) and pulls out:
role archetype (true PM vs Product Owner vs program/project manager vs business analyst, decided only for
jobs with a product title), business model (B2B / B2C / B2B2C / marketplace), vertical and sub-vertical
(e.g. Fintech: Payments), company type (product company / GCC / services), segments, market, GTM motion,
regulations named (RBI, NPCI, SEBI, KYC/AML…), years asked *in product*, people management, and the
must-have and preferred lists (from sections like "Requirements", "What you'll need", "Nice to have").
It reads the resume the same way when it's uploaded, and the person confirms the result in
"Your background" (details step): role type, years in product, B2B/B2C, industries, specific spaces,
company types, managed PMs. Preferences add "Open to services companies" and "Open to switching industry".

Score out of 100, in six parts (the fit bar), each point with a reason:
| Part | Points | What it compares |
|---|---|---|
| Role | 23 | archetype 15 (PM↔PM full, PM↔PO 5) + level and people management 8 |
| Must-haves | 19 | share of the job's checkable must-haves you meet 15 + preferred 4 |
| Experience | 15 | your years in product vs years asked in product (else total vs total) 12 + total years 3 |
| Domain | 28 | sub-vertical 12 / vertical 8 / nearby 5 + business model 10 + segment, market, GTM 6 |
| Company | 8 | product company / GCC / services vs your background and openness |
| Practical | 7 | location and work mode 5 + pay and notice 2 |

Unknown counts as 70% of a part, not zero. Serious mismatches don't hide a job; they cap its score below
the 50 "good match" line and the reason is shown first: really a PO / delivery /
BA role (40), not in your cities and not open to relocating (40), missing a must-have regulation or
specific space (45), 2+ years short of the years asked (45), likely below your level (55). Each job also
gets a confidence (high / medium / low); "Limited info" jobs (short or search-engine previews) rank below
equal scores with full descriptions. Only product roles are shown at all (a PM-type title: Product
Manager / Owner / Lead / Head, APM, SPM, GPM, Director or VP of Product); other jobs are left out.
Filters (job type, work mode, company size, industry, keywords to
avoid, posted date, search, exact titles) still remove jobs outright. Jobs scoring under 50 are behind a
"lower-fit" button.

## How resumes are read

1. **With Supabase set up: Claude (AI).** The browser calls the `parse-resume` Supabase Edge Function
   (`supabase/functions/parse-resume/index.ts`). It downloads the PDF from the user's private folder
   (or receives the text of a .docx), sends it to Claude (`claude-opus-5-5`, low effort) and gets back
   structured JSON. The API key stays on the server, and only logged-in users can call the function.
   Roughly $0.05 (about ₹4) per resume. The resume is sent to Anthropic to be read.
2. **Fallback: rules in the browser** (`resume-parser.js`, pdf.js + mammoth from cdnjs). Used in demo
   mode, or if the AI call fails (the user is told, and asked to check every field). A role is only
   accepted if it contains a real job title from `roles.js`, so achievement lines like
   "Product-market-fit for UPI lending" are never picked. Two-column layouts can still confuse it.

`roles.js` is a job-title vocabulary built from ~2,500 live postings (Razorpay, Groww, Druva, CRED,
Zeta, Paytm, Stripe, Databricks, Airbnb, Figma, GitLab): 12 families, ~75 standard roles with their
real-world variants (SDE 2, KAM, HRBP...) and seniority words including Indian bands (AM/DM/AGM/DGM/GM/AVP).
It recognises 78% of all those titles and 91% of Indian-style ones.

## Demo mode (no Supabase needed)

While `config.js` still has the `PASTE_...` placeholders, the app runs in demo mode:
any email and password logs you in, and your resume, details and preferences are kept
in this browser only (localStorage + IndexedDB). Nothing is uploaded or secure, and resumes
are read with the rules fallback, not the AI (the AI needs the Supabase function).
A yellow bar shows it's on. Paste your Supabase keys into `config.js` and the real
backend is used automatically.

## Do these in order (about 15 minutes)

**1. Create a free Supabase project**
- Go to supabase.com, sign in with GitHub, click "New project". Free plan. Pick any name and region (Mumbai is closest).
- *Supabase = a hosted database + login + file storage, so we don't write a backend.*

**2. Paste your keys**
- Supabase: Project Settings -> API. Copy "Project URL" and the "anon public" key.
- Paste both into `config.js`.

**3. Run the SQL**
- Supabase: SQL Editor -> New query. Paste all of `supabase-setup.sql` -> Run.
- *This creates a private resume folder, a `profiles` table for details + preferences,
  and rules so each user sees only their own data.*
- Already ran it for step 1? Run only part 4 (the `profiles` table) at the bottom of the file.
- Seeing "permission denied for table resumes" (or `profiles`)? Run only part 5 (the two `grant` lines).
  Newer Supabase projects don't give logged-in users access to new tables until you do.

**4. Turn on AI resume reading (about 5 minutes)**
- Get an API key: platform.claude.com -> sign in -> API Keys -> Create key. Add a few dollars of credit under Billing.
- Supabase: Edge Functions -> Deploy a new function -> Via editor. Name it exactly `parse-resume`,
  paste in all of `supabase/functions/parse-resume/index.ts`, and click Deploy.
  (Or, with Node installed: `npx supabase functions deploy parse-resume`.)
- Supabase: Edge Functions -> Secrets -> add `ANTHROPIC_API_KEY` with your key. Never put the key in `config.js`.
- Leave "Verify JWT" on for the function, so only logged-in users can use it (and your credit).
- In `config.js`, set `USE_AI_READER: true`. (While it's false, the free rules-based reader is used.)
- Test: upload a resume. The details screen should say "Our AI read your resume". If it says the AI
  wasn't available, the reason is shown there.

**Password reset (needed for "Forgot password?")**
- Authentication -> URL Configuration -> Redirect URLs: add the address of `reset.html` for every place
  GoodFit runs, e.g. `http://localhost:8000/reset.html` and `https://<you>.github.io/<repo>/reset.html`.
  Without it, Supabase sends people to the Site URL instead of the page that sets a new password.
- Supabase's built-in email only sends a few emails per hour; for real users, set up your own SMTP
  (Authentication -> Emails -> SMTP settings).

**5. (Optional) Make testing easier**
- Authentication -> Providers -> Email -> turn off "Confirm email" while developing. Turn it back on before sharing publicly.

**6. Try it locally**
- In this folder run `ruby -run -e httpd . -p 8000` (built into macOS) or `python3 -m http.server 8000`.
- Open http://localhost:8000, sign up, upload a resume, check the details, set preferences.

**7. Turn on the daily job refresh (about 10 minutes)**
- SQL Editor -> New query: paste all of `supabase-jobs.sql` -> Run. (Creates `job_sources` and `jobs`.)
- Make up a long random password for the refresher, e.g. run `openssl rand -hex 24` in Terminal. Keep it handy.
- Edge Functions -> Deploy a new function -> Via editor. Name it exactly `fetch-jobs` (the editor suggests a
  random name like `rapid-endpoint`; change it before deploying, because a function can't be renamed later). Paste
  `supabase/functions/fetch-jobs/index.ts` as `index.ts`, add a second file named `normalize.js` with
  the contents of `supabase/functions/fetch-jobs/normalize.js`, and Deploy.
  (Or, with Node installed: `npx supabase functions deploy fetch-jobs --no-verify-jwt`.)
- In the function's settings, turn **"Verify JWT" off**. The daily job has no user login; the function
  checks the password instead.
- Edge Functions -> Secrets -> add `FETCH_JOBS_SECRET` = your random password.
- Database -> Extensions: turn on `pg_cron` and `pg_net`.
- Open `supabase-jobs-schedule.sql`, replace `<PROJECT_URL>` and `<FETCH_SECRET>`, then run it in the SQL Editor.
  It saves the two values in Supabase's Vault, schedules the daily refresh, and runs one refresh straight away.
- Check after a minute: `select company, last_count, last_error from public.job_sources;` should show a count
  for each company. Reload the Matches page: the "updated" date is today.

**8. Widen the search with Adzuna (about 10 minutes, free key)**
Adzuna is a job search engine with an official API. Every morning the refresher asks it for the newest
jobs matching each row in `job_searches` (starts with "product manager" in Bangalore, Hyderabad, Pune
and Chennai, up to 500 each), from any employer. Employers GoodFit already reads directly are skipped,
and duplicates are removed. Results are short previews; "See the full job" opens the full posting.
- Get a free key: developer.adzuna.com -> Register -> your dashboard shows an Application ID and Application Key.
- SQL Editor: run all of `supabase-jobs-search.sql` FIRST (it adds the columns the new function writes).
- Edge Functions -> Secrets: add `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.
- Edge Functions -> `fetch-jobs`: paste in the updated `index.ts` and `normalize.js` and deploy again
  (keep "Verify JWT" off).
- Run a refresh now (the commented `net.http_post` query at the bottom of `supabase-jobs-search.sql`), then check:
  `select what, "where", last_count, last_error from public.job_searches order by id;`
- To search for more, add rows to `job_searches`, e.g. `insert into public.job_searches (what, "where") values ('product owner', 'Pune');`
  Adzuna's free plan has daily request limits; each search uses up to `max_pages` requests per day.

**9. Put it online (free)**
- Push the folder to a GitHub repo -> repo Settings -> Pages -> deploy from `main`.
- Then in Supabase: Authentication -> URL Configuration -> add your Pages URL as the Site URL.

## Files
- `index.html` landing page
- `auth.html` create account / log in / forgot password (`?mode=reset` emails a reset link)
- `reset.html` the page the reset email opens: set a new password
- `dashboard.html` + `dashboard.js` onboarding (login required)
- `supabase/functions/parse-resume/index.ts` server function that reads a resume with Claude
- `jobs.html` + `jobs.js` the Matches page; `matching.js` filters and the V1 score (six parts, caps, confidence); `jobs.json` job snapshot
- `questions.html` + `questions.js` + `questions-data.js` common questions for PM job seekers (static content):
  screening and HR (CTC, notice period), product sense, execution and metrics, strategy and estimation,
  leadership, technical and domain, and questions to ask. Search, category filter, "practised" ticks saved in the browser.
  Works logged in or out; linked from the Matches tabs and the landing page.
- `ui.js` shared UI pieces (chips, option pills, icons, toast, and the fit bar `fitBar()` / `fitList()`)
- `signals.js` rules that read job descriptions and resumes for matching (archetype, B2B/B2C, verticals, must-haves…)
- `resume-parser.js` rules-based fallback reader (PDF/.docx) + years-of-experience maths
- `roles.js` standard job titles, families and seniority words (from real postings)
- `app.js` shared helpers + demo mode, `config.js` your keys, `style.css` all styles (see Design below)
- `supabase-setup.sql` database + storage rules
- `supabase-jobs.sql` job tables (`job_sources`, `jobs`); `supabase-jobs-schedule.sql` the daily refresh; `supabase-jobs-search.sql` saved searches for the Adzuna job search engine; `supabase-jobs-add-companies.sql` 16 more companies
- `supabase/functions/fetch-jobs/` the daily job refresher: `index.ts` (fetch + save), `normalize.js`
  (turns Greenhouse / Lever / Ashby postings into GoodFit's job shape; plain JS, also loads in a browser)

## Design
- Palette: paper `#F4F6F3`, ink `#1A2233`, peacock `#0E5A57` (buttons, links, filled fit), marigold `#F2B230`
  (focus rings, highlights), mist `#D5DDD8` (lines, empty fit), brick `#B3361F` (errors). All are CSS variables in `style.css`.
- Type: one family, Anek Latin (Google Fonts), with headlines set wide (`font-stretch`) and heavy.
- The fit bar: every job's score is drawn as five segments sized by their maximum points
  (role 45, experience 25, seniority 15, location 10, skills 5) and filled by what the job earned.
  It appears on the landing page, each job row, the detail drawer (with a labelled breakdown) and the loader.

## Ideas for later
- Add a per-user daily limit on AI reads, to cap spend if the app goes public.
- Grow `roles.js` with titles from more Indian companies (Naukri-style postings use different words).
- Store saved / hidden jobs in Supabase so they follow you across devices.
- Assisted apply (after the job-fetching layer): "Prepare application" drafts a cover note and answers to
  common questions with Claude, the user edits and saves it, then "Open the application" goes to the
  company's own form with answers ready to copy. Later, a browser extension could fill the form.
  The user always clicks Submit. (Fully automatic applying isn't possible: Greenhouse/Lever/Ashby
  only accept applications through their APIs with the hiring company's own key, and their forms use CAPTCHAs.)

## Resume line (when done)
"Built and deployed the onboarding flow for an AI job-application agent: Supabase auth with row-level security, private resume storage, AI resume parsing with Claude via a Supabase Edge Function (role, company, experience), and a structured job-preference profile."
