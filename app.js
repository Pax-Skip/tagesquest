// Tagesquest – Spiel-Logik & UI. Alle Daten bleiben lokal im Handy (localStorage).
const $ = (s) => document.querySelector(s);
const app = $('#app');
let tab = 'today';
let expanded = null;

/* ---------- Speicher ---------- */
const K = (k) => 'tag:' + k;
const blank = () => ({ done: {}, sets: {}, km: null, bonus: 0, health: {} });

/* ---------- Körperziele ---------- */
// Persönliche Werte stehen bewusst nicht im Code: Einrichtung beim ersten Start (0 = nicht gesetzt / automatisch)
const CFG_DEFAULT = { age: 0, height: 0, startKg: 0, goalKg: 0, steps: 10000, kcalGoal: 0, proteinGoal: 0 };
const setupDone = () => { const c = cfg(); return c.age > 0 && c.height > 0 && c.startKg > 0 && c.goalKg > 0; };
function cfg() { try { return Object.assign({}, CFG_DEFAULT, JSON.parse(localStorage.getItem('cfg'))); } catch { return { ...CFG_DEFAULT }; } }
let _w = null;
function latestWeight() {
  if (_w !== null) return _w;
  const ks = allKeys().reverse();
  for (const k of ks) { const w = load(k).health && load(k).health.weight; if (w) return (_w = w); }
  return (_w = cfg().startKg);
}
// Mifflin-St Jeor (Mann), Aktivitätsfaktor 1.5 (3× Kraft + 2× Laufen), minus 500 kcal ≈ 0,5 kg/Woche
function targetKcal() {
  const c = cfg(), w = latestWeight();
  if (c.kcalGoal > 0) return c.kcalGoal; // Yazio-Ziel hat Vorrang
  if (!setupDone()) return 0;
  const bmr = 10 * w + 6.25 * c.height - 5 * c.age + 5;
  return Math.round((bmr * 1.5 - 500) / 50) * 50;
}
const targetProtein = () => cfg().proteinGoal > 0 ? cfg().proteinGoal : Math.round(latestWeight() * 1.8);
const goalSteps = (h) => h && h.steps >= cfg().steps;
const goalKcal = (h) => h && targetKcal() > 0 && h.kcal >= 1400 && h.kcal <= targetKcal() + 100;
function load(key) {
  try { return Object.assign(blank(), JSON.parse(localStorage.getItem(K(key)))); } catch { return blank(); }
}
function save(key, d) {
  _w = null;
  try { localStorage.setItem(K(key), JSON.stringify(d)); } catch {}
  if (typeof xOnSaved === 'function') xOnSaved(key);
}
function allKeys() {
  const ks = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('tag:')) ks.push(k.slice(4)); } } catch {}
  return ks.sort();
}
const todayKey = () => dateKey(new Date());
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

/* ---------- Spielwerte ---------- */
const RANKS = ['Rookie', 'Lehrling', 'Routinier', 'Krieger', 'Veteran', 'Elite', 'Meister', 'Legende'];
const lvl = (xp) => Math.floor(Math.sqrt(xp / 50)) + 1;
const rank = (L) => RANKS[Math.min(L - 1, RANKS.length - 1)];

function baseXp(b, dow) {
  if (b.id === 'train') return 50;
  if (b.id === 'trade1' || b.id === 'trade2') return 25;
  if (b.id === 'prep') return 15;
  if (b.id === 'run') return dow === 2 || dow === 5 ? 35 : 20;
  if (b.id === 'journal' || b.id === 'sleep') return 15;
  return 10;
}
function dayXp(d) {
  let x = d.bonus || 0;
  if (goalSteps(d.health)) x += 20;
  if (goalKcal(d.health)) x += 20;
  if (d.sleep && (sleepScore(d.sleep) || {}).score >= 70) x += 20;
  x += xDayXp(d);
  Object.values(d.done).forEach((v) => (x += v.xp || 0));
  Object.values(d.sets).forEach((arr) => arr.forEach((s) => { if (s.done) x += 5; }));
  return x;
}
const totalXp = () => allKeys().reduce((a, k) => a + dayXp(load(k)), 0);

function completion(key) {
  const dt = parseKey(key);
  const bl = dayBlocks(dt.getDay(), strengthType(dt));
  const d = load(key);
  return bl.filter((b) => d.done[b.id]).length / bl.length;
}
function streak() { return xStreakInfo().n; }
function stats() {
  let checks = 0, perfect = 0, trainings = 0, runs = 0;
  allKeys().forEach((k) => {
    const d = load(k);
    checks += Object.keys(d.done).length;
    if (d.bonus > 0) perfect++;
    if (d.done.train) trainings++;
    if (d.done.run) runs++;
  });
  return { checks, perfect, trainings, runs, streak: streak() };
}
const ACH = [
  { id: 'first', icon: '🌱', name: 'Erster Schritt', desc: 'Erste Quest erledigt', ok: (s) => s.checks >= 1 },
  { id: 'run5', icon: '👟', name: 'Läufer', desc: '5 Läufe', ok: (s) => s.runs >= 5 },
  { id: 'tr1', icon: '💪', name: 'Boss besiegt', desc: 'Erstes Training', ok: (s) => s.trainings >= 1 },
  { id: 'tr10', icon: '🏋️', name: 'Eisen-Routine', desc: '10 Trainings', ok: (s) => s.trainings >= 10 },
  { id: 'perf1', icon: '⭐', name: 'Perfekter Tag', desc: 'Alle Quests an einem Tag', ok: (s) => s.perfect >= 1 },
  { id: 'perf7', icon: '🌟', name: 'Sieben Sterne', desc: '7 perfekte Tage', ok: (s) => s.perfect >= 7 },
  { id: 'st3', icon: '🔥', name: 'Auf Feuer', desc: '3 Tage Streak', ok: (s) => s.streak >= 3 },
  { id: 'st7', icon: '☄️', name: 'Unaufhaltsam', desc: '7 Tage Streak', ok: (s) => s.streak >= 7 },
  { id: 'st30', icon: '👑', name: 'Gewohnheits-König', desc: '30 Tage Streak', ok: (s) => s.streak >= 30 },
  { id: 'c100', icon: '💯', name: 'Hundert', desc: '100 Quests erledigt', ok: (s) => s.checks >= 100 },
];
function unlocked() { try { return JSON.parse(localStorage.getItem('ach')) || []; } catch { return []; } }
function checkAch() {
  const s = stats(), have = unlocked(), now = [...have];
  ACH.forEach((a) => { if (!have.includes(a.id) && a.ok(s)) { now.push(a.id); toast(`${a.icon} Erfolg: ${a.name}`, 'ach'); confetti(); } });
  try { localStorage.setItem('ach', JSON.stringify(now)); } catch {}
}

/* ---------- Effekte ---------- */
function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3400);
}
function floatXp(rect, text) {
  if (!rect) return;
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  el.style.left = rect.left + rect.width / 2 + 'px';
  el.style.top = rect.top + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}
function confetti() {
  const colors = ['#ffd24a', '#4be3a0', '#6aa8ff', '#ff6a8a', '#c58bff'];
  for (let i = 0; i < 45; i++) {
    const p = document.createElement('i');
    p.className = 'conf';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.4 + 's';
    p.style.setProperty('--dx', Math.random() * 160 - 80 + 'px');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 2200);
  }
}

/* ---------- Änderungen ---------- */
// Führt eine Änderung am Tageszustand aus, verrechnet Bonus, zeigt Feedback.
function mutate(fn, rect, floatText) {
  const key = todayKey(), now = new Date();
  const blocks = dayBlocks(now.getDay(), strengthType(now));
  const d = load(key);
  const beforeL = lvl(totalXp());
  const wasPerfect = d.bonus > 0;
  fn(d, blocks);
  const isPerfect = blocks.every((b) => d.done[b.id]);
  d.bonus = isPerfect ? 100 : 0;
  save(key, d);
  if (floatText) floatXp(rect, floatText);
  if (!wasPerfect && isPerfect) { toast('⭐ PERFEKTER TAG! +100 XP', 'gold'); confetti(); }
  const afterL = lvl(totalXp());
  if (afterL > beforeL) {
    toast(`🎉 LEVEL UP! Level ${afterL} – ${rank(afterL)}`, 'gold'); confetti();
    const rw = xReward(afterL); if (rw) toast('🎁 Belohnung: ' + rw, 'gold');
  }
  checkAch();
  render();
}

function toggleBlock(id, el) {
  const rect = el && el.getBoundingClientRect();
  const now = new Date();
  let gained = 0, early = false;
  mutate((d, blocks) => {
    const b = blocks.find((x) => x.id === id);
    if (d.done[id]) { delete d.done[id]; return; }
    let xp = baseXp(b, now.getDay());
    const [h, m] = b.time.split(':').map(Number);
    const diff = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
    if (diff >= -15 && diff <= 30) { xp += 5; early = true; }
    d.done[id] = { t: Date.now(), xp };
    gained = xp;
  }, rect, null);
  if (gained) { floatXp(rect, `+${gained} XP` + (early ? ' ⚡' : '')); }
}

function bestScore(exId) {
  let best = 0;
  allKeys().forEach((k) => {
    (load(k).sets[exId] || []).forEach((s) => { if (s.done) best = Math.max(best, score(s)); });
  });
  return best;
}
const score = (s) => (parseFloat(s.kg) || 0) * 100 + (parseInt(s.reps) || 0);

function toggleSet(exId, i, el) {
  const rect = el.getBoundingClientRect();
  const type = strengthType(new Date());
  const ex = EXERCISES[type].items.find((e) => e.id === exId);
  let pr = false, on = false;
  mutate((d, blocks) => {
    d.sets[exId] = d.sets[exId] || Array.from({ length: ex.sets }, () => ({}));
    const s = d.sets[exId][i];
    s.done = !s.done;
    on = s.done;
    if (s.done && score(s) > 0 && score(s) > bestScore(exId) && bestScore(exId) > 0) pr = true;
    // Alle Sätze fertig → Training automatisch abhaken
    const all = EXERCISES[type].items.every((e) => (d.sets[e.id] || []).length >= e.sets && d.sets[e.id].slice(0, e.sets).every((x) => x.done));
    const tb = blocks.find((b) => b.id === 'train');
    if (all && tb && !d.done.train) d.done.train = { t: Date.now(), xp: 50 };
  }, rect, null);
  if (on) floatXp(rect, '+5 XP');
  if (pr) { toast(`🏆 NEUER REKORD: ${ex.name}!`, 'gold'); confetti(); }
}

/* ---------- Rendering ---------- */
function lastFor(exId, today) {
  const ks = allKeys().filter((k) => k < today).reverse();
  for (const k of ks) {
    const arr = (load(k).sets[exId] || []).filter((s) => s.done);
    if (arr.length) return arr[arr.length - 1];
  }
  return {};
}
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function renderToday() {
  const now = new Date(), key = dateKey(now), d = load(key);
  const type = strengthType(now);
  const blocks = dayBlocks(now.getDay(), type);
  const nowM = now.getHours() * 60 + now.getMinutes();
  const total = totalXp(), L = lvl(total), lo = 50 * (L - 1) ** 2, hi = 50 * L * L;
  const pct = Math.round(((total - lo) / (hi - lo)) * 100);
  const doneN = blocks.filter((b) => d.done[b.id]).length;
  const dayLabel = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const dt = WEEK_TYPE[now.getDay()];

  let currentFound = false;
  const cards = blocks.map((b) => {
    const done = !!d.done[b.id];
    const start = mins(b.time);
    const endM = b.end ? mins(b.end) : start + 45;
    let st = 'up';
    if (done) st = 'done';
    else if (nowM >= endM) st = 'late';
    else if (nowM >= start && !currentFound) { st = 'now'; currentFound = true; }
    else if (nowM >= start) st = 'now';
    const xp = baseXp(b, now.getDay());
    const boss = b.training ? '<span class="tag boss">BOSS</span>' : '';
    const late = st === 'late' ? '<span class="tag late">Bestätigen!</span>' : '';
    const nowTag = st === 'now' ? '<span class="tag now">JETZT</span>' : '';
    let body = '';
    if (b.km) {
      body += `<div class="km"><input data-km inputmode="decimal" placeholder="km" value="${d.km ?? ''}"><span>km gelaufen</span></div>`;
    }
    if (b.training) body += trainingHtml(type, d, key, expanded === 'train');
    return `<div class="card ${st} ${b.training ? 'bosscard' : ''}">
      <div class="row">
        <div class="time">${b.time}${b.end ? `<small>–${b.end}</small>` : ''}</div>
        <div class="main" ${b.training ? 'data-act="expand" data-id="train"' : ''}>
          <div class="title">${b.icon} ${b.title} ${boss}${nowTag}${late}</div>
          <div class="xp">+${xp} XP${b.training ? ' · + je Satz' : ''}</div>
        </div>
        <button class="chk ${done ? 'on' : ''}" data-act="block" data-id="${b.id}" aria-label="abhaken">${done ? '✓' : ''}</button>
      </div>${body}</div>`;
  }).join('');

  return `
  <section class="hero">
    <div class="lvl"><b>${L}</b><small>LVL</small></div>
    <div class="herotxt">
      <div class="rank">${rank(L)}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="xpnum">${total - lo} / ${hi - lo} XP bis Level ${L + 1}</div>
    </div>
    <div class="streak">🔥<b>${streak()}</b>${xFreezeBadge()}</div>
  </section>
  <div class="daybar">
    <div><div class="dl">${dayLabel}</div><div class="dt">${dt.icon} ${dt.label}${type ? ' · ' + type : ''}</div></div>
    <div class="dq">${doneN}/${blocks.length}<small>Quests</small></div>
  </div>
  <div class="prog"><i style="width:${(doneN / blocks.length) * 100}%"></i></div>
  ${goalsHtml(d)}
  ${overviewHtml(d)}
  ${xToday(d)}
  ${cards}
  <p class="foot">Alle Quests = Perfekter Tag (+100 XP). Pünktlich abhaken gibt +5 XP.</p>`;
}

function setupHtml() {
  return `<div class="card goals"><div class="gtop"><b>👋 Einrichtung</b><span>einmalig, bleibt nur auf deinem Handy</span></div>
    <div class="ginputs setup">
      <label>Alter<input id="su-age" inputmode="numeric"></label>
      <label>Größe (cm)<input id="su-height" inputmode="numeric"></label>
      <label>Gewicht (kg)<input id="su-start" inputmode="decimal"></label>
      <label>Ziel (kg)<input id="su-goal" inputmode="decimal"></label>
    </div>
    <button class="btn" data-act="setup">Los geht's ⚔️</button></div>`;
}
function saveSetup() {
  const v = (id) => parseFloat(($('#' + id).value || '').replace(',', '.'));
  const [age, height, startKg, goalKg] = ['su-age', 'su-height', 'su-start', 'su-goal'].map(v);
  if (![age, height, startKg, goalKg].every((x) => x > 0)) return toast('Bitte alle vier Felder ausfüllen');
  try { localStorage.setItem('cfg', JSON.stringify({ ...cfg(), age, height, startKg, goalKg })); } catch {}
  _w = null; toast('✅ Gespeichert'); render();
}

function goalsHtml(d) {
  if (!setupDone()) return setupHtml();
  const c = cfg(), w = latestWeight(), h = d.health || {}, tk = targetKcal();
  const prog = Math.max(0, Math.min(100, ((c.startKg - w) / (c.startKg - c.goalKg)) * 100));
  const left = Math.max(0, w - c.goalKg).toFixed(1);
  return `<div class="card goals">
    <div class="gtop"><b>⚖️ ${w} kg</b><span>Ziel ${c.goalKg} kg · noch ${left} kg</span></div>
    <div class="prog"><i style="width:${prog}%"></i></div>
    <div class="gsub">Heute: ca. <b>${tk} kcal</b> · Protein ca. <b>${targetProtein()} g</b> · ${c.steps.toLocaleString('de-DE')} Schritte</div>
    <div class="ginputs">
      <label>👣 Schritte ${goalSteps(h) ? '✅' : ''}<input data-h="steps" inputmode="numeric" placeholder="0" value="${h.steps ?? ''}"></label>
      <label>🍎 kcal ${goalKcal(h) ? '✅' : ''}<input data-h="kcal" inputmode="numeric" placeholder="0" value="${h.kcal ?? ''}"></label>
      <label>⚖️ Gewicht<input data-h="weight" inputmode="decimal" placeholder="${w}" value="${h.weight ?? ''}"></label>
    </div>
    <div class="gsub">Schritte-Ziel +20 XP · Kalorien im Ziel +20 XP</div>
  </div>`;
}

function trainingHtml(type, d, key, open) {
  if (!open) return '<div class="hint" data-act="expand" data-id="train">▸ Tippen, um den Boss-Fight zu öffnen</div>';
  const plan = EXERCISES[type];
  const ex = plan.items.map((e) => {
    const last = lastFor(e.id, key);
    const rows = Array.from({ length: e.sets }, (_, i) => {
      const s = (d.sets[e.id] || [])[i] || {};
      return `<div class="set ${s.done ? 'on' : ''}"><span class="sn">${i + 1}</span>
        <input data-ex="${e.id}" data-i="${i}" data-k="kg" inputmode="decimal" placeholder="${last.kg || '+kg'}" value="${s.kg ?? ''}">
        <input data-ex="${e.id}" data-i="${i}" data-k="reps" inputmode="numeric" placeholder="${last.reps || (e.id === 'plank' ? 'Sek' : 'Wdh')}" value="${s.reps ?? ''}">
        <button class="chk sm ${s.done ? 'on' : ''}" data-act="set" data-ex="${e.id}" data-i="${i}">${s.done ? '✓' : ''}</button></div>`;
    }).join('');
    return `<div class="ex"><div class="exh"><b>${e.name}</b><span>${e.sets} × ${e.target}</span></div>${e.note ? `<div class="note">${e.note}</div>` : ''}${rows}</div>`;
  }).join('');
  return `<div class="train"><div class="note">${plan.title}<br>${plan.warmup}</div>${ex}
    <div class="hint" data-act="expand" data-id="train">▾ einklappen</div></div>`;
}

function renderWeek() {
  const t = new Date();
  const monday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
  let weekXp = 0;
  const rows = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const k = dateKey(dt), c = completion(k), wt = WEEK_TYPE[dt.getDay()], ty = strengthType(dt);
    weekXp += dayXp(load(k));
    const isToday = k === todayKey();
    return `<div class="card wk ${isToday ? 'now' : ''}"><div class="row">
      <div class="time">${dt.toLocaleDateString('de-DE', { weekday: 'short' })}<small>${dt.getDate()}.${dt.getMonth() + 1}.</small></div>
      <div class="main"><div class="title">${wt.icon} ${wt.label}${ty ? ' · ' + ty : ''}</div>
      <div class="prog thin"><i style="width:${Math.round(c * 100)}%"></i></div></div>
      <div class="pc">${Math.round(c * 100)}%</div></div></div>`;
  }).join('');
  return `<h2>Diese Woche</h2><div class="bigstat"><b>${weekXp}</b> XP gesammelt</div>${rows}${xReview()}`;
}

function renderProfile() {
  const s = stats(), have = unlocked(), total = totalXp(), L = lvl(total);
  const notifState = 'Notification' in window ? Notification.permission : 'nicht verfügbar';
  const grid = ACH.map((a) => `<div class="ach ${have.includes(a.id) ? 'on' : ''}"><div class="ai">${have.includes(a.id) ? a.icon : '🔒'}</div><b>${a.name}</b><small>${a.desc}</small></div>`).join('');
  return `<h2>Profil</h2>
  <div class="bigstat"><b>Level ${L}</b> · ${rank(L)} · ${total} XP</div>
  <div class="stats"><div><b>${s.streak}</b>Streak</div><div><b>${s.perfect}</b>Perfekte Tage</div><div><b>${s.trainings}</b>Trainings</div><div><b>${s.runs}</b>Läufe</div></div>
  <h3>Erfolge</h3><div class="achgrid">${grid}</div>
  <h3>Körperziel</h3>
  <div class="card"><div class="ginputs">
    <label>Alter<input data-cfg="age" inputmode="numeric" value="${cfg().age || ''}"></label>
    <label>Zielgewicht<input data-cfg="goalKg" inputmode="decimal" value="${cfg().goalKg || ''}"></label>
    <label>Schritte/Tag<input data-cfg="steps" inputmode="numeric" value="${cfg().steps}"></label>
    <label>Yazio kcal-Ziel<input data-cfg="kcalGoal" inputmode="numeric" placeholder="auto ${targetKcal()}" value="${cfg().kcalGoal || ''}"></label>
    <label>Yazio Protein (g)<input data-cfg="proteinGoal" inputmode="numeric" placeholder="auto ${targetProtein()}" value="${cfg().proteinGoal || ''}"></label>
  </div><div class="gsub">Automatisch: Grundumsatz × 1,5 − 500 kcal ≈ 0,5 kg pro Woche. Trag hier deine Yazio-Ziele ein, dann gelten diese.</div></div>
  <h3>Apple Health / Yazio</h3>
  <div class="card"><div class="gsub" style="margin-top:0">Ein Kurzbefehl auf dem iPhone schickt Schritte, Kalorien (Yazio), Puls und Schlaf (Apple Watch) an deinen privaten Server. Hier trägst du dein Token ein, danach holt die App die Daten automatisch.</div>
    <input id="tok" type="password" placeholder="Token einfügen" value="${getToken()}" style="text-align:left;margin:8px 0">
    <button class="btn" data-act="token">🔗 Token speichern &amp; verbinden</button>
    <button class="btn" data-act="sync">🔄 Jetzt synchronisieren</button>
    <div class="gsub">${syncStatus()}</div></div>
  ${xProfile()}
  <h3>Erinnerungen (nur bei geöffneter App)</h3>
  <button class="btn" data-act="notif">🔔 Benachrichtigungen aktivieren (${notifState})</button>
  <button class="btn" data-act="ics">📅 Kalender-Erinnerungen exportieren (.ics)</button>
  <p class="foot">Benachrichtigungen kommen, solange die App geöffnet ist. Der Kalender-Export erinnert dich auch bei geschlossener App.</p>`;
}

/* ---------- Health-Sync (Cloudflare-Worker) & Schlaf ---------- */
const SYNC_URL = 'https://tagesquest-health.tq-mjs-2026.workers.dev';
const SLEEP_TARGET = '22:30';
const getToken = () => { try { return localStorage.getItem('synctoken') || ''; } catch { return ''; } };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
function syncStatus() {
  if (!getToken()) return 'Noch nicht verbunden.';
  const t = +lsGet('syncAt');
  return t ? `Zuletzt synchronisiert: ${new Date(t).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Verbunden, noch keine Daten empfangen.';
}
const HEALTH_KEYS = ['steps', 'kcal', 'protein', 'carbs', 'fat', 'activeKcal', 'restingHr', 'avgHr', 'maxHr', 'weight'];
async function sync(manual) {
  const t = getToken();
  if (!t) { if (manual) toast('Erst Token eintragen'); return; }
  try {
    const r = await fetch(SYNC_URL + '/data?days=14', { headers: { Authorization: 'Bearer ' + t } });
    if (r.status === 401) throw new Error('Token falsch');
    if (!r.ok) throw new Error('Fehler ' + r.status);
    const j = await r.json();
    Object.entries(j.days || {}).forEach(([date, v]) => {
      const d = load(date);
      d.health = d.health || {};
      HEALTH_KEYS.forEach((k) => { if (v[k] !== undefined) d.health[k] = v[k]; });
      if (v.sleep) d.sleep = v.sleep;
      if (v.workouts) d.workouts = v.workouts;
      save(date, d);
    });
    xAuto();
    try { localStorage.setItem('syncAt', String(Date.now())); } catch {}
    if (manual) toast('🔄 Synchronisiert');
    checkAch();
    if (!document.activeElement || !document.activeElement.matches('input')) render();
  } catch (e) {
    if (manual) toast('Sync fehlgeschlagen: ' + e.message);
  }
}

const fmtH = (min) => `${Math.floor(min / 60)} h ${pad(Math.round(min % 60))} min`;
// Eigener Schlaf-Score (0–100). Fehlende Teile werden herausgerechnet.
function sleepScore(s) {
  if (!s || !(s.asleepMin > 0)) return null;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const asleep = s.asleepMin;
  const parts = [{ k: 'Dauer', w: 40, v: clamp((asleep / 60 - 4) / 3), txt: fmtH(asleep) }];
  const inBed = s.inBedMin > 0 ? s.inBedMin : s.awakeMin !== undefined ? asleep + s.awakeMin : 0;
  if (inBed >= asleep) {
    const eff = asleep / inBed;
    parts.push({ k: 'Effizienz', w: 20, v: clamp((eff - 0.75) / 0.15), txt: Math.round(eff * 100) + ' %' });
  }
  if (s.deepMin >= 0) parts.push({ k: 'Tiefschlaf', w: 15, v: clamp(s.deepMin / asleep / 0.13), txt: Math.round((s.deepMin / asleep) * 100) + ' %' });
  if (s.remMin >= 0) parts.push({ k: 'REM', w: 15, v: clamp(s.remMin / asleep / 0.2), txt: Math.round((s.remMin / asleep) * 100) + ' %' });
  if (s.bedtime) {
    let m = mins(s.bedtime); if (m < 720) m += 1440;
    const diff = Math.abs(m - mins(SLEEP_TARGET));
    parts.push({ k: 'Regelmäßigkeit', w: 10, v: clamp(1 - (diff - 30) / 120), txt: s.bedtime + ' Uhr' });
  }
  const W = parts.reduce((a, p) => a + p.w, 0);
  const score = Math.round((parts.reduce((a, p) => a + p.w * p.v, 0) / W) * 100);
  return { score, parts };
}
const scoreLabel = (s) => (s >= 85 ? 'Sehr gut' : s >= 70 ? 'Gut' : s >= 55 ? 'Okay' : 'Schwach');

function latestSleep() {
  for (const k of allKeys().reverse()) { const d = load(k); if (d.sleep && d.sleep.asleepMin > 0) return { key: k, s: d.sleep }; }
  return null;
}

function renderSleep() {
  const ls = latestSleep();
  if (!ls) return `<h2>Schlaf</h2><div class="bigstat">Noch keine Schlafdaten.</div><p class="foot">Verbinde die App im Profil mit deinem Health-Server. Sobald dein iPhone die Nacht gesendet hat, siehst du hier Score, Phasen und Verlauf.</p>`;
  const { s, key } = ls, r = sleepScore(s);
  const dayName = parseKey(key).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const bars = r.parts.map((p) => `<div class="sp"><div class="spt"><span>${p.k}</span><b>${p.txt}</b></div><div class="prog thin"><i style="width:${Math.round(p.v * 100)}%"></i></div></div>`).join('');
  const total = (s.deepMin || 0) + (s.remMin || 0) + (s.coreMin || 0) + (s.awakeMin || 0);
  const seg = (m, c, n) => (m > 0 && total ? `<i style="width:${(m / total) * 100}%;background:${c}" title="${n}"></i>` : '');
  const phases = total ? `<div class="phases">${seg(s.deepMin, '#5b6cff', 'Tief')}${seg(s.coreMin, '#6aa8ff', 'Kern')}${seg(s.remMin, '#c58bff', 'REM')}${seg(s.awakeMin, '#ff8a5c', 'Wach')}</div>
    <div class="legend"><span><i style="background:#5b6cff"></i>Tief ${Math.round(s.deepMin || 0)}′</span><span><i style="background:#6aa8ff"></i>Kern ${Math.round(s.coreMin || 0)}′</span><span><i style="background:#c58bff"></i>REM ${Math.round(s.remMin || 0)}′</span><span><i style="background:#ff8a5c"></i>Wach ${Math.round(s.awakeMin || 0)}′</span></div>` : '';
  const week = allKeys().filter((k) => load(k).sleep).slice(-7).map((k) => {
    const sc = (sleepScore(load(k).sleep) || {}).score || 0;
    return `<div class="wb"><i style="height:${sc}%"></i><small>${parseKey(k).toLocaleDateString('de-DE', { weekday: 'short' })}</small></div>`;
  }).join('');
  const hr = load(todayKey()).health || {};
  return `<h2>Schlaf</h2>
  <div class="card sleephero">
    <div class="ring" style="--p:${r.score * 3.6}deg"><div><b>${r.score}</b><small>von 100</small></div></div>
    <div><div class="rank">${scoreLabel(r.score)}</div><div class="gsub" style="margin:2px 0">${Math.max(1, Math.round(r.score / 10))} von 10 · ${dayName}</div>
    ${r.score >= 70 ? '<div class="xp">+20 XP für guten Schlaf</div>' : '<div class="gsub">Ab 70 gibt es +20 XP</div>'}</div>
  </div>
  ${phases}
  <h3>Bewertung</h3><div class="card">${bars}</div>
  ${hr.restingHr ? `<div class="bigstat">❤️ Ruhepuls <b>${hr.restingHr}</b> bpm</div>` : ''}
  ${week ? `<h3>Letzte Nächte</h3><div class="weekbars">${week}</div>` : ''}
  <p class="foot">Der Score ist eine eigene Schätzung aus Dauer (40), Effizienz (20), Tief (15), REM (15) und Regelmäßigkeit (10). Die Schlafphasen der Apple Watch sind Schätzungen, Dauer und Effizienz sind verlässlicher.</p>`;
}

function overviewHtml(d) {
  const h = d.health || {}, tk = targetKcal(), t = [];
  const tile = (i, v, l) => t.push(`<div class="tile"><span>${i}</span><b>${v}</b><small>${l}</small></div>`);
  if (h.steps !== undefined) tile('👣', Math.round(h.steps).toLocaleString('de-DE'), `Schritte / ${cfg().steps.toLocaleString('de-DE')}`);
  if (h.kcal !== undefined) { tile('🍎', Math.round(h.kcal), 'kcal gegessen'); if (tk) tile('🎯', Math.round(tk - h.kcal), 'kcal noch übrig'); }
  if (h.activeKcal !== undefined) tile('🔥', Math.round(h.activeKcal), 'aktive kcal');
  if (h.protein !== undefined) tile('🥩', Math.round(h.protein) + ' g', `Protein / ${targetProtein()}`);
  if (h.restingHr !== undefined) tile('❤️', Math.round(h.restingHr), 'Ruhepuls');
  if (h.avgHr !== undefined) tile('💓', Math.round(h.avgHr), 'Ø Puls');
  const ls = d.sleep ? sleepScore(d.sleep) : null;
  if (ls) tile('😴', ls.score, 'Schlaf-Score');
  return t.length ? `<div class="tiles">${t.join('')}</div>` : '';
}

function render() {
  const keepScroll = window.scrollY;
  app.innerHTML = tab === 'today' ? renderToday() : tab === 'week' ? renderWeek() : tab === 'verlauf' ? renderVerlauf() : tab === 'sleep' ? renderSleep() : renderProfile();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo(0, keepScroll);
}

/* ---------- Events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-tab]');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const a = t.dataset.act;
  if (xClick(t)) return;
  if (a === 'block') toggleBlock(t.dataset.id, t);
  else if (a === 'set') toggleSet(t.dataset.ex, +t.dataset.i, t);
  else if (a === 'expand') { expanded = expanded === t.dataset.id ? null : t.dataset.id; render(); }
  else if (a === 'setup') saveSetup();
  else if (a === 'sync') sync(true);
  else if (a === 'token') {
    try { localStorage.setItem('synctoken', $('#tok').value.trim()); } catch {}
    sync(true);
  }
  else if (a === 'notif') enableNotif();
  else if (a === 'ics') exportIcs();
});
document.addEventListener('change', (e) => {
  if (xChange(e)) return;
  const el = e.target;
  if (el.dataset.cfg) {
    const c = cfg(); c[el.dataset.cfg] = parseFloat(el.value.replace(',', '.')) || c[el.dataset.cfg];
    try { localStorage.setItem('cfg', JSON.stringify(c)); } catch {}
    render(); return;
  }
  if (!el.dataset.h) return;
  const key = todayKey(), before = dayXp(load(key));
  const v = parseFloat(el.value.replace(',', '.'));
  mutate((d) => { d.health = d.health || {}; if (isNaN(v)) delete d.health[el.dataset.h]; else d.health[el.dataset.h] = v; });
  const diff = dayXp(load(key)) - before;
  if (diff > 0) toast(`🎯 Ziel erreicht! +${diff} XP`, 'gold');
});
document.addEventListener('input', (e) => {
  const el = e.target;
  const key = todayKey();
  if (el.dataset.km !== undefined) { const d = load(key); d.km = el.value; save(key, d); return; }
  if (el.dataset.ex) {
    const type = strengthType(new Date());
    const ex = EXERCISES[type].items.find((x) => x.id === el.dataset.ex);
    const d = load(key);
    d.sets[ex.id] = d.sets[ex.id] || Array.from({ length: ex.sets }, () => ({}));
    d.sets[ex.id][+el.dataset.i][el.dataset.k] = el.value.replace(',', '.');
    save(key, d);
  }
});

/* ---------- Erinnerungen ---------- */
async function notify(title, body) {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) return reg.showNotification(title, { body, icon: 'icon.svg', tag: title });
    new Notification(title, { body });
  } catch {}
}
async function enableNotif() {
  if (!('Notification' in window)) return toast('Benachrichtigungen werden hier nicht unterstützt.');
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? '🔔 Aktiviert' : 'Nicht erlaubt');
  render();
}
function tick() {
  const now = new Date(), key = dateKey(now), d = load(key);
  const blocks = dayBlocks(now.getDay(), strengthType(now));
  const nowM = now.getHours() * 60 + now.getMinutes();
  blocks.forEach((b) => {
    const s = mins(b.time);
    if (d.done[b.id] || nowM < s || nowM > s + 120) return;
    const nk = `n:${key}:${b.id}`;
    try { if (localStorage.getItem(nk)) return; localStorage.setItem(nk, '1'); } catch { return; }
    toast(`⏰ ${b.icon} ${b.title}`, 'gold');
    if ('Notification' in window && Notification.permission === 'granted') notify('Quest fällig', `${b.icon} ${b.title} – jetzt abhaken!`);
  });
  if (tab === 'today' && !document.activeElement.matches('input')) render();
}
setInterval(tick, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); sync(false); } });
setInterval(() => sync(false), 5 * 60 * 1000);

/* ---------- Kalender-Export ---------- */
function exportIcs() {
  const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const map = new Map();
  for (let dow = 0; dow < 7; dow++) {
    dayBlocks(dow, null).forEach((b) => {
      const k = b.time + '|' + b.title + '|' + (b.end || '');
      if (!map.has(k)) map.set(k, { ...b, dows: [] });
      map.get(k).dows.push(days[dow]);
    });
  }
  const base = new Date(); const ds = `${base.getFullYear()}${pad(base.getMonth() + 1)}${pad(base.getDate())}`;
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tagesquest//DE'];
  let i = 0;
  map.forEach((b) => {
    const st = b.time.replace(':', '') + '00';
    const en = (b.end || b.time).replace(':', '') + '00';
    out.push('BEGIN:VEVENT', `UID:tq-${i++}@tagesquest`, `DTSTAMP:${ds}T000000`,
      `DTSTART;TZID=Europe/Berlin:${ds}T${st}`, `DTEND;TZID=Europe/Berlin:${ds}T${en}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${b.dows.join(',')}`, `SUMMARY:${b.icon} ${b.title}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${b.title}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  });
  out.push('END:VCALENDAR');
  const blob = new Blob([out.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'tagesquest.ics';
  document.body.appendChild(a); a.click(); a.remove();
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Import aus Kurzbefehlen: ?steps=8000&kcal=2100&weight=87.4
(function importHealth() {
  const q = new URLSearchParams(location.search);
  const num = (k) => parseFloat((q.get(k) || '').replace(',', '.'));
  const vals = { steps: num('steps'), kcal: num('kcal'), weight: num('weight'), protein: num('protein') };
  if (Object.values(vals).every(isNaN)) return;
  const key = todayKey(), d = load(key);
  d.health = d.health || {};
  Object.entries(vals).forEach(([k, v]) => { if (!isNaN(v)) d.health[k] = v; });
  save(key, d);
  history.replaceState(null, '', location.pathname);
  setTimeout(() => toast('❤️ Health-Daten importiert'), 300);
})();
render();
checkAch();
tick();
sync(false);
xStartup();
