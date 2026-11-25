// Common questions page: search, filter by category, and tick off questions you've practised.
// Content lives in questions-data.js. Practised ticks are kept in this browser.
const QB = { cat: "all", search: "", hidePractised: false, practised: new Set() };
const PKEY = "goodfit_practised";

try { QB.practised = new Set(JSON.parse(localStorage.getItem(PKEY) || "[]")); } catch {}
const storePractised = () => { try { localStorage.setItem(PKEY, JSON.stringify([...QB.practised])); } catch {} };

const qid = (cat, i) => `${cat}-${i}`;
const allItems = () => QUESTION_BANK.flatMap((c) => c.items.map((it, i) => ({ ...it, id: qid(c.id, i), cat: c })));

function matches(it) {
  if (QB.cat !== "all" && it.cat.id !== QB.cat) return false;
  if (QB.hidePractised && QB.practised.has(it.id)) return false;
  if (!QB.search) return true;
  const hay = [it.q, it.look, ...(it.how || []), it.tip || "", it.cat.name].join(" ").toLowerCase();
  return QB.search.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

// Wraps search words in <mark> inside already-escaped text.
function mark(text) {
  const safe = esc(text);
  if (!QB.search) return safe;
  const words = QB.search.split(/\s+/).filter((w) => w.length > 1).map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return words.length ? safe.replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>") : safe;
}

function renderCats() {
  const total = allItems().length;
  const cats = [["all", `All (${total})`], ...QUESTION_BANK.map((c) => [c.id, `${c.name} (${c.items.length})`])];
  $("q-cats").innerHTML = cats.map(([id, label]) =>
    `<label class="opt"><input type="radio" name="qcat" value="${id}" ${QB.cat === id ? "checked" : ""}><span>${esc(label)}</span></label>`).join("");
  $("q-cats").querySelectorAll("input").forEach((r) => (r.onchange = () => { QB.cat = r.value; render(); }));
}

function render() {
  const items = allItems();
  const shown = items.filter(matches);
  const done = items.filter((it) => QB.practised.has(it.id)).length;
  $("q-count").textContent = `You've practised ${done} of ${items.length}` + (shown.length !== items.length ? `. Showing ${shown.length}.` : ".");

  if (!shown.length) {
    $("q-list").innerHTML = `<div class="card empty"><div class="icon-tile">${icon("search")}</div><h3>No questions match</h3>
      <p class="muted">Try another word, or choose All.</p></div>`;
    return;
  }
  $("q-list").innerHTML = QUESTION_BANK.map((c) => {
    const list = shown.filter((it) => it.cat.id === c.id);
    if (!list.length) return "";
    return `<section class="q-sec" aria-labelledby="h-${c.id}">
      <h2 id="h-${c.id}">${esc(c.name)}</h2>
      <p class="q-blurb">${esc(c.blurb)}</p>
      ${list.map((it) => `
        <details class="q-item ${QB.practised.has(it.id) ? "done" : ""}" data-id="${it.id}" ${QB.search ? "open" : ""}>
          <summary><span class="q-text">${mark(it.q)}</span>${QB.practised.has(it.id) ? `<span class="q-done">${icon("check")}Practised</span>` : ""}</summary>
          <div class="q-body">
            <h3>What they're listening for</h3>
            <p>${mark(it.look)}</p>
            <h3>How to approach it</h3>
            <ol>${(it.how || []).map((h) => `<li>${mark(h)}</li>`).join("")}</ol>
            ${it.tip ? `<p class="q-tip">${icon("info")}<span>${mark(it.tip)}</span></p>` : ""}
            <label class="switch q-mark"><input type="checkbox" data-practise="${it.id}" ${QB.practised.has(it.id) ? "checked" : ""}>I've practised this</label>
          </div>
        </details>`).join("")}
    </section>`;
  }).join("");

  $("q-list").querySelectorAll("[data-practise]").forEach((box) => (box.onchange = () => {
    const id = box.dataset.practise;
    if (box.checked) QB.practised.add(id); else QB.practised.delete(id);
    storePractised();
    const open = [...document.querySelectorAll(".q-item[open]")].map((d) => d.dataset.id);
    render();
    open.forEach((oid) => { const d = document.querySelector(`.q-item[data-id="${oid}"]`); if (d) d.open = true; });
    const again = document.querySelector(`[data-practise="${id}"]`);
    if (again) again.focus();
    if (box.checked) toast("Marked as practised");
  }));
}

// Logged in: show the app tabs and account chip. Logged out: the page still works, with Log in links.
async function initNav() {
  if (!db) return;
  const { data } = await db.auth.getSession();
  const user = data && data.session && data.session.user;
  if (!user) return;
  $("app-tabs").classList.remove("hide");
  $("user-chip").classList.remove("hide");
  $("guest-links").classList.add("hide");
  $("avatar").textContent = (user.email || "?")[0].toUpperCase();
  $("logout").onclick = async () => { await db.auth.signOut(); location.href = "index.html"; };
}

let searchTimer;
$("q-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { QB.search = $("q-search").value.trim(); render(); }, 120);
});
$("q-unpractised").onchange = () => { QB.hidePractised = $("q-unpractised").checked; render(); };

renderCats();
render();
initNav().catch((e) => console.warn(e));
