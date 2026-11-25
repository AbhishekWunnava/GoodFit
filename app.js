// Shared helpers used by every page.
const cfg = window.APP_CONFIG;
// Add ?demo to any page URL to try the app in browser-only demo mode for this tab,
// even when Supabase is set up (handy for testing without creating real accounts).
let forceDemo = false;
try {
  if (new URLSearchParams(location.search).has("demo")) sessionStorage.setItem("jp_demo", "1");
  forceDemo = sessionStorage.getItem("jp_demo") === "1";
} catch {}
// Both values must be filled in; until then the app stays in demo mode.
const configured = !forceDemo && !!(cfg && !cfg.SUPABASE_URL.startsWith("PASTE") && !cfg.SUPABASE_ANON_KEY.startsWith("PASTE"));

// Demo mode: while config.js still has the placeholder values, a small
// stand-in for Supabase keeps accounts and resumes in THIS browser only.
// Nothing is uploaded and nothing is secure. Fill in config.js and the
// real Supabase is used automatically.
const demo = !configured;
const db = configured ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : makeDemoDb();

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = "msg " + type;
}

// Kept for the pages that call it. In demo mode there is nothing to set up.
function needConfig(el) {
  return false;
}

if (demo) {
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  bar.textContent = "Demo mode: any email and password works, and your resume stays in this browser only. Add your Supabase keys to config.js for real accounts.";
  document.body.prepend(bar);
}

function makeDemoDb() {
  const KEY_SESSION = "jobpilot_demo_session";
  const KEY_ROWS = "jobpilot_demo_resumes";
  const read = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
  };
  const session = () => read(KEY_SESSION, null);
  const startSession = (email) => {
    const s = { user: { id: "demo-" + email.toLowerCase(), email } };
    write(KEY_SESSION, s);
    return s;
  };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Resume files go in IndexedDB: localStorage is too small for a 5 MB file.
  function files(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("jobpilot_demo", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("files");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("files", mode);
        const req = fn(tx.objectStore("files"));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  // Covers only the table calls this app makes: select/order/limit/maybeSingle,
  // insert, upsert (one row per user) and delete().in(). Each table is its own key.
  function table(name) {
    const KEY = name === "resumes" ? KEY_ROWS : "jobpilot_demo_" + name;
    let op = "select", ids = null, row = null, max = null, single = false;
    const q = {
      select() { return q; },
      order() { return q; }, // results always come back newest first
      limit(n) { max = n; return q; },
      maybeSingle() { single = true; return q; },
      insert(r) { op = "insert"; row = r; return q; },
      upsert(r) { op = "upsert"; row = r; return q; },
      delete() { op = "delete"; return q; },
      in(_col, list) { ids = list; return q; },
      then(ok, fail) { return run().then(ok, fail); },
    };
    async function run() {
      const s = session();
      if (!s) return { data: null, error: { message: "Please log in again." } };
      const all = read(KEY, []);
      const now = new Date().toISOString();
      if (op === "insert") {
        all.push({ id: newId(), user_id: s.user.id, created_at: now, ...row });
        write(KEY, all);
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const i = all.findIndex((r) => r.user_id === s.user.id);
        const merged = { ...(i >= 0 ? all[i] : { created_at: now }), ...row, user_id: s.user.id };
        if (i >= 0) all[i] = merged; else all.push(merged);
        if (!write(KEY, all)) return { data: null, error: { message: "Couldn't save in this browser." } };
        return { data: null, error: null };
      }
      if (op === "delete") {
        write(KEY, all.filter((r) => !(r.user_id === s.user.id && ids.includes(r.id))));
        return { data: null, error: null };
      }
      let mine = all.filter((r) => r.user_id === s.user.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      if (max) mine = mine.slice(0, max);
      return { data: single ? mine[0] || null : mine, error: null };
    }
    return q;
  }

  return {
    auth: {
      async getSession() { return { data: { session: session() } }; },
      async signUp({ email }) { return { data: { session: startSession(email) }, error: null }; },
      async signInWithPassword({ email }) { startSession(email); return { error: null }; },
      async signOut() { try { localStorage.removeItem(KEY_SESSION); } catch {} return { error: null }; },
    },
    from: table,
    storage: {
      from() {
        return {
          async upload(path, file) {
            try { await files("readwrite", (s) => s.put(file, path)); return { error: null }; }
            catch { return { error: { message: "Couldn't save the file in this browser." } }; }
          },
          async createSignedUrl(path) {
            const blob = await files("readonly", (s) => s.get(path)).catch(() => null);
            return { data: blob ? { signedUrl: URL.createObjectURL(blob) } : null };
          },
          async remove(paths) {
            await files("readwrite", (s) => { paths.forEach((p) => s.delete(p)); }).catch(() => {});
            return { error: null };
          },
        };
      },
    },
  };
}
