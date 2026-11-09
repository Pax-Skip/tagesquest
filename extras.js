// Zusatzfunktionen: Wasser, Supplements, Check-in, Pausentag, Auto-Abhaken (Apple Watch / Adidas Running),
// Verlauf (Gewicht, Läufe, Training), Wochen-Review, Belohnungen, Backup, Push-Erinnerungen.
// Wird VOR app.js geladen; nutzt app.js-Funktionen nur zur Laufzeit.
const X_URL = 'https://tagesquest-health.tq-mjs-2026.workers.dev';
const X_VAPID = 'BEw8oM93E4oYT_rO5ZlqKHRpnvzp9VON-K__-O9YKUp26vatsveYWtlIowf8Difl5GzPO_FaW6EOE2HKUK_VWBw';

/* ---------- Einstellungen ---------- */
function xcfg() {
  const d = { waterGoal: 2500, supp: '', runKm: 0, runPace: '', rewards: '' };
  try { return Object.assign(d, JSON.parse(localStorage.getItem('xcfg'))); } catch { return d; }
}
const xHeaders = () => ({ Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' });
const xSupps = () => xcfg().supp.split(',').map((s) => s.trim()).filter(Boolean);
const xd = (key) => parseKey(key).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
const xPace = (p) => { if (!Number.isFinite(p) || p <= 0) return '–'; let m = Math.floor(p), s = Math.round((p - m) * 60); if (s === 60) { m++; s = 0; } return `${m}:${String(s).padStart(2, '0')}`; };
const xParsePace = (s) => { const m = String(s).match(/^(\d{1,2})[:.](\d{2})$/); return m ? +m[1] + +m[2] / 60 : 0; };
const xClamp = (v) => Math.max(0, Math.min(1, v));

/* ---------- Streak mit Pausentagen und Streak-Schutz ---------- */
function xStreakInfo() {
  const keys = allKeys();
  if (!keys.length) return { n: 0, freezes: 0 };
  const cur = parseKey(keys[0]), todayK = dateKey(new Date());
  let n = 0, fr = 0;
  for (let guard = 0; guard < 800 && dateKey(cur) <= todayK; guard++) {
    const k = dateKey(cur), d = load(k), c = completion(k);
    if (d.pause) { /* neutral */ }
    else if (c >= 0.7) { n++; if (n % 7 === 0) fr = Math.min(2, fr + 1); }
    else if (k === todayK) { /* heute noch offen */ }
    else if (fr > 0) fr--;
    else n = 0;
    cur.setDate(cur.getDate() + 1);
  }
  return { n, freezes: fr };
}
const xFreezeBadge = () => { const f = xStreakInfo().freezes; return f ? `<small class="fz">❄️×${f}</small>` : ''; };

/* ---------- Trainingstimer (Pause zwischen Sätzen, Trainingsdauer) ---------- */
let _ac;
function xBeep() {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    if (_ac.state === 'suspended') _ac.resume();
    [0, 0.25, 0.5].forEach((t) => {
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.frequency.value = 880; g.gain.value = 0.25; o.connect(g); g.connect(_ac.destination);
      o.start(_ac.currentTime + t); o.stop(_ac.currentTime + t + 0.15);
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch {}
}
function xRestStart(sec) {
  if (sec) { try { localStorage.setItem('restPref', String(sec)); } catch {} }
  sec = sec || +lsGet('restPref') || 90;
  try { localStorage.setItem('restEnd', String(Date.now() + sec * 1000)); localStorage.removeItem('restFired'); } catch {}
  try { _ac = _ac || new (window.AudioContext || window.webkitAudioContext)(); if (_ac.state === 'suspended') _ac.resume(); } catch {}
  const key = todayKey(), d = load(key);
  if (!d.trainStart && expanded === 'train') { d.trainStart = Date.now(); save(key, d); }
  xTimerTick();
}
const xMs = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function xTimerInit() {
  const bar = document.getElementById('timerbar');
  if (!bar || bar.dataset.ready) return;
  bar.dataset.ready = '1';
  bar.innerHTML = `<div class="tl"><span id="tb-el"></span><b id="tb-rest"></b></div>
    <div class="tbtns"><button data-act="trainstart" id="tb-start">▶ Training starten</button>
    ${[45, 60, 90, 120].map((s) => `<button data-act="rest" data-s="${s}">${s} s</button>`).join('')}<button data-act="reststop">✕</button></div>`;
}
function xTimerTick() {
  const bar = document.getElementById('timerbar');
  if (!bar) return;
  xTimerInit();
  const now = Date.now(), d = load(todayKey()), end = +lsGet('restEnd') || 0;
  const trainOpen = tab === 'today' && expanded === 'train' && !d.done.train;
  const resting = end > now, justDone = end && !resting && now - end < 15000;
  if (end && !resting && lsGet('restFired') !== String(end)) {
    try { localStorage.setItem('restFired', String(end)); } catch {}
    xBeep(); toast('⏰ Pause vorbei – nächster Satz!', 'gold');
  }
  if (!trainOpen && !resting && !justDone) { bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById('tb-el').textContent = d.trainStart && !d.done.train ? `⏱ Training ${xMs(now - d.trainStart)}` : 'Satz abhaken startet die Pause';
  const r = document.getElementById('tb-rest');
  r.textContent = resting ? `Pause ${xMs(end - now)}` : justDone ? 'Los! 💪' : '';
  r.className = resting ? '' : 'go';
  document.getElementById('tb-start').hidden = !!d.trainStart || !trainOpen;
}

/* ---------- Merkzettel / Aufgaben ---------- */
function xTodos() { try { return JSON.parse(localStorage.getItem('todos')) || []; } catch { return []; } }
function xSaveTodos(l) { try { localStorage.setItem('todos', JSON.stringify(l)); } catch {} xOnSaved(); }
function xTodoXpSync() {
  const t = todayKey();
  mutate((d) => { d.todoXp = Math.min(5, xTodos().filter((x) => x.doneDate === t).length) * 3; });
}
function xTodoAdd() {
  const el = document.getElementById('todoin'), text = el && el.value.trim();
  if (!text) return;
  const l = xTodos(); l.push({ id: Date.now(), text, done: false, created: todayKey() });
  xSaveTodos(l); render();
}
function xTodoHtml() {
  const t = todayKey(), l = xTodos().filter((x) => !x.done || x.doneDate === t);
  const rows = l.map((x) => `<label class="chkrow"><input type="checkbox" data-act="todotoggle" data-id="${x.id}" ${x.done ? 'checked' : ''}>
    <span style="flex:1;${x.done ? 'text-decoration:line-through;opacity:.6' : ''}">${x.text.replace(/</g, '&lt;')}${!x.done && x.created < t ? ' <small class="gsub">(von früher)</small>' : ''}</span>
    <button class="linkbtn" data-act="tododel" data-id="${x.id}">✕</button></label>`).join('');
  return `<div class="card"><div class="gtop"><b>📝 Heute noch erledigen</b><span>+3 XP je Punkt</span></div>${rows || '<div class="gsub">Nichts offen. Schreib auf, was du nicht vergessen willst.</div>'}
    <div class="todoadd"><input id="todoin" placeholder="Neue Aufgabe oder Notiz …" enterkeyhint="done"><button class="btn sm" data-act="todoadd">＋</button></div>
    <label class="gsub" style="display:block;margin-top:10px">Merkzettel (bleibt gespeichert)</label>
    <textarea data-pad rows="3" placeholder="Dinge, die ich mitbekommen habe …">${(lsGet('notepad') || '').replace(/</g, '&lt;')}</textarea></div>`;
}

/* ---------- Extra-XP ---------- */
function xDayXp(d) {
  let x = d.todoXp || 0;
  if ((d.water || 0) >= xcfg().waterGoal) x += 10;
  const sp = xSupps();
  if (sp.length && sp.every((s) => d.supp && d.supp[s])) x += 5;
  ['am', 'pm'].forEach((s) => { const c = d.checkin && d.checkin[s]; if (c && c.e && c.m) x += 5; });
  return x;
}
function xReward(L) {
  for (const line of xcfg().rewards.split('\n')) {
    const m = line.match(/^\D*(\d+)\s*[:\-–]\s*(.+)$/);
    if (m && +m[1] === L) return m[2].trim();
  }
  return '';
}

/* ---------- Heute: Wasser, Supplements, Check-in, Pause ---------- */
function xToday(d) {
  const x = xcfg(), now = new Date();
  const water = d.water || 0, wp = Math.min(100, (water / x.waterGoal) * 100);
  let h = `<div class="card pausecard"><button class="linkbtn" data-act="pause">${d.pause ? '▶️ Pausentag beenden' : '⏸ Pausentag (krank / Urlaub)'}</button>${d.pause ? '<div class="gsub">Pausentag: dein Streak bleibt unberührt.</div>' : ''}</div>`;
  h += xTodoHtml();
  h += `<div class="card"><div class="gtop"><b>💧 Wasser</b><span>${(water / 1000).toFixed(2).replace('.', ',')} / ${(x.waterGoal / 1000).toFixed(1).replace('.', ',')} L${water >= x.waterGoal ? ' ✅' : ''}</span></div>
    <div class="prog"><i style="width:${wp}%"></i></div>
    <div class="wbtns"><button class="btn sm" data-act="water" data-ml="-250">−250</button><button class="btn sm" data-act="water" data-ml="250">+250 ml</button><button class="btn sm" data-act="water" data-ml="500">+500 ml</button></div></div>`;
  const sp = xSupps();
  if (sp.length) {
    h += `<div class="card"><div class="gtop"><b>💊 Supplements</b></div>${sp.map((s) => `<label class="chkrow"><input type="checkbox" data-act="supp" data-n="${s}" ${d.supp && d.supp[s] ? 'checked' : ''}> ${s}</label>`).join('')}</div>`;
  }
  const slot = now.getHours() < 15 ? 'am' : 'pm', c = (d.checkin && d.checkin[slot]) || {};
  const row = (k, label) => `<div class="cirow"><span>${label}</span>${[['😫', 1], ['😕', 2], ['😐', 3], ['🙂', 4], ['🤩', 5]].map(([e, v]) => `<button class="em ${c[k] === v ? 'on' : ''}" data-act="ci" data-slot="${slot}" data-k="${k}" data-v="${v}">${e}</button>`).join('')}</div>`;
  h += `<div class="card"><div class="gtop"><b>${slot === 'am' ? '🌅 Morgen-Check-in' : '🌙 Abend-Check-in'}</b><span>+5 XP</span></div>${row('e', 'Energie')}${row('m', 'Stimmung')}</div>`;
  if (now.getDay() === 0) {
    h += `<div class="card"><div class="gtop"><b>📏 Taille (Sonntags-Messung)</b></div><div class="ginputs" style="grid-template-columns:1fr"><input data-waist inputmode="decimal" placeholder="cm" value="${d.waist ?? ''}"></div></div>`;
  }
  return h;
}

/* ---------- Auto-Abhaken aus Health-Workouts ---------- */
function xAuto() {
  const key = todayKey(), d = load(key), w = d.workouts || [];
  if (!w.length) return;
  const isRun = (x) => /run|lauf|jog/i.test(x.name), isWalk = (x) => /walk|geh|spazier|hik|wander/i.test(x.name);
  const isStr = (x) => /strength|kraft|functional|hiit|cross|calisthen|core|training/i.test(x.name) && !isRun(x) && !isWalk(x) && !/cycl|rad/i.test(x.name);
  const now = new Date(), blocks = dayBlocks(now.getDay(), strengthType(now));
  const ids = [];
  if (w.some(isRun) && !d.done.run) ids.push('run');
  if (w.some(isStr) && !d.done.train) ids.push('train');
  if (w.some(isWalk) && !d.done.walk) ids.push('walk');
  const todo = ids.filter((id) => blocks.some((b) => b.id === id));
  if (!todo.length) return;
  mutate((dd, bl) => {
    todo.forEach((id) => {
      const b = bl.find((x) => x.id === id);
      dd.done[id] = { t: Date.now(), xp: baseXp(b, now.getDay()), auto: true };
      if (id === 'run' && !dd.km) { const km = w.filter(isRun).reduce((a, x) => a + (x.km || 0), 0); if (km) dd.km = String(Math.round(km * 100) / 100); }
    });
  });
  toast('🤖 Automatisch abgehakt: ' + todo.map((i) => (i === 'run' ? 'Lauf' : i === 'train' ? 'Training' : 'Spaziergang')).join(', '), 'gold');
}

/* ---------- Charts ---------- */
function xChart(vals, o = {}) {
  const pts = vals.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) return '<div class="gsub">Noch zu wenig Daten für ein Diagramm.</div>';
  const W = 300, H = o.h || 110, pd = 16;
  const all = pts.map((p) => p.v).concat(o.goal !== undefined ? [o.goal] : []);
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const n = vals.length - 1 || 1;
  const X = (i) => pd + (i / n) * (W - 2 * pd);
  const Y = (v) => { const t = (v - min) / (max - min); return H - pd - (o.invert ? 1 - t : t) * (H - 2 * pd); };
  const line = pts.map((p) => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1], fmt = o.fmt || ((v) => String(Math.round(v * 10) / 10));
  const goal = o.goal !== undefined ? `<line x1="${pd}" x2="${W - pd}" y1="${Y(o.goal)}" y2="${Y(o.goal)}" class="cg"/><text x="${W - pd}" y="${Y(o.goal) - 4}" class="ct" text-anchor="end">Ziel ${fmt(o.goal)}</text>` : '';
  const dots = pts.map((p) => `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.6" class="cd"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart"><polyline points="${line}" class="cl"/>${goal}${dots}<text x="${X(last.i)}" y="${Y(last.v) - 7}" class="ct" text-anchor="end">${fmt(last.v)}</text></svg>`;
}
function xBars(vals, labels, color) {
  const max = Math.max(...vals, 1);
  return `<div class="weekbars" style="height:100px">${vals.map((v, i) => `<div class="wb"><i style="height:${(v / max) * 100}%;${color ? 'background:' + color : ''}"></i><small>${labels[i]}</small></div>`).join('')}</div>`;
}

/* ---------- Verlauf ---------- */
function xRuns() {
  const out = [];
  allKeys().forEach((k) => {
    const d = load(k);
    const rs = (d.workouts || []).filter((w) => /run|lauf|jog/i.test(w.name) && w.km > 0);
    rs.forEach((w) => out.push({ key: k, km: w.km, min: w.min, pace: w.min && w.km ? w.min / w.km : null, hr: w.avgHr }));
    if (!rs.length && d.km && parseFloat(d.km) > 0) out.push({ key: k, km: parseFloat(d.km), min: null, pace: null });
  });
  return out;
}
function xWeightHtml() {
  const c = cfg();
  const pts = allKeys().map((k) => [k, (load(k).health || {}).weight]).filter((p) => p[1]);
  if (!setupDone()) return '<div class="gsub">Richte zuerst dein Gewichtsziel auf „Heute“ ein.</div>';
  if (pts.length < 1) return '<div class="gsub">Noch keine Gewichtswerte. Sie kommen aus Apple Health oder du trägst sie auf „Heute“ ein.</div>';
  const now = pts[pts.length - 1][1];
  const prog = Math.round(xClamp((c.startKg - now) / (c.startKg - c.goalKg)) * 100);
  // Trend: Regression der letzten 28 Tage
  const t0 = parseKey(pts[pts.length - 1][0]).getTime(), recent = pts.filter((p) => t0 - parseKey(p[0]).getTime() <= 28 * 864e5);
  let eta = '';
  if (recent.length >= 4) {
    const xs = recent.map((p) => (parseKey(p[0]).getTime() - t0) / 864e5), ys = recent.map((p) => p[1]);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0), slope = den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : 0;
    if (slope < -0.005 && now > c.goalKg) {
      const days = (now - c.goalKg) / -slope, date = new Date(t0 + days * 864e5);
      eta = `Tempo ${(slope * 7).toFixed(1).replace('.', ',')} kg/Woche · Ziel ca. ${date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}`;
    } else if (now > c.goalKg) eta = 'Aktuell kein Abwärtstrend, das Zieldatum lässt sich noch nicht schätzen.';
  }
  return `<div class="bigstat"><b>${now} kg</b> · ${prog} % zum Ziel (${c.startKg} → ${c.goalKg} kg)</div>
    <div class="prog"><i style="width:${prog}%"></i></div>
    ${xChart(pts.slice(-60).map((p) => p[1]), { goal: c.goalKg, invert: false })}
    ${eta ? `<div class="gsub">${eta}</div>` : ''}`;
}
function xRunHtml() {
  const runs = xRuns(), x = xcfg();
  if (!runs.length) return '<div class="gsub">Noch keine Läufe. Aktiviere in Adidas Running die Verbindung zu Apple Health und lege in Health Auto Export eine Automation für „Workouts“ an. Läufe erscheinen dann hier automatisch.</div>';
  const last = runs[runs.length - 1], prev = runs[runs.length - 2];
  const paced = runs.filter((r) => r.pace);
  let cmp = '';
  if (prev) {
    const dk = last.km - prev.km, dp = last.pace && prev.pace ? last.pace - prev.pace : null;
    cmp = `<div class="gsub">Gegenüber dem Lauf davor (${xd(prev.key)}): ${dk >= 0 ? '+' : '−'}${Math.abs(dk).toFixed(2).replace('.', ',')} km${dp !== null ? `, Tempo ${dp <= 0 ? 'schneller' : 'langsamer'} um ${Math.abs(Math.round(dp * 60))} s/km` : ''}</div>`;
  }
  let goal = '';
  const gp = xParsePace(x.runPace);
  if (x.runKm > 0 || gp > 0) {
    const recent = runs.slice(-10), bestKm = Math.max(...recent.map((r) => r.km));
    const distPct = x.runKm > 0 ? Math.round(xClamp(bestKm / x.runKm) * 100) : null;
    let pacePct = null;
    if (gp > 0 && paced.length) {
      const base = paced.slice(0, 3).reduce((a, r) => a + r.pace, 0) / Math.min(3, paced.length), cur = Math.min(...paced.slice(-3).map((r) => r.pace));
      pacePct = base <= gp ? (cur <= gp ? 100 : 0) : Math.round(xClamp((base - cur) / (base - gp)) * 100);
    }
    goal = `<div class="bigstat">Laufziel: ${x.runKm > 0 ? x.runKm + ' km' : ''}${x.runKm > 0 && gp > 0 ? ' in ' : ''}${gp > 0 ? xPace(gp) + ' min/km' : ''}<br>
      ${distPct !== null ? `Distanz <b>${distPct} %</b> (bester letzter Lauf ${bestKm.toFixed(1).replace('.', ',')} km)<br>` : ''}${pacePct !== null ? `Tempo <b>${pacePct} %</b> (bestes der letzten 3: ${xPace(Math.min(...paced.slice(-3).map((r) => r.pace)))} min/km)` : ''}</div>`;
  } else goal = '<div class="gsub">Lege unter Profil dein Laufziel fest (Distanz und Tempo), dann zeige ich dir den Fortschritt in Prozent.</div>';
  const list = runs.slice(-6).reverse().map((r) => `<div class="runrow"><b>${xd(r.key)}</b><span>${r.km.toFixed(2).replace('.', ',')} km</span><span>${r.min ? (r.min >= 60 ? fmtH(r.min) : Math.round(r.min) + ' min') : '–'}</span><span>${r.pace ? xPace(r.pace) + ' /km' : '–'}</span><span>${r.hr ? '❤️ ' + r.hr : ''}</span></div>`).join('');
  return `${goal}${cmp}
    ${paced.length >= 2 ? `<h4>Tempo (min/km, schneller = höher)</h4>${xChart(paced.slice(-15).map((r) => r.pace), { invert: true, goal: gp || undefined, fmt: xPace })}` : ''}
    <h4>Distanz (km)</h4>${xChart(runs.slice(-15).map((r) => r.km), { goal: x.runKm || undefined })}
    <div class="card">${list}</div>`;
}
function xTrainHtml() {
  const names = {};
  ['A', 'B'].forEach((t) => EXERCISES[t].items.forEach((e) => (names[e.id] = e.name)));
  const keys = allKeys(), rows = [];
  Object.keys(names).forEach((id) => {
    const series = [];
    keys.forEach((k) => {
      const sets = ((load(k).sets || {})[id] || []).filter((s) => s.done && (parseInt(s.reps) || 0) > 0);
      if (!sets.length) return;
      const best = sets.reduce((a, s) => (score(s) > score(a) ? s : a));
      series.push({ k, sc: score(best), reps: parseInt(best.reps), kg: parseFloat(best.kg) || 0 });
    });
    if (series.length) rows.push({ id, name: names[id], series });
  });
  if (!rows.length) return '<div class="gsub">Noch keine geloggten Sätze. Trag beim Training Wiederholungen ein, dann siehst du hier deinen Fortschritt.</div>';
  return rows.map((r) => {
    const l = r.series[r.series.length - 1], f = r.series[0], diff = l.reps - f.reps;
    return `<div class="card"><div class="gtop"><b>${r.name}</b><span>${l.reps}${l.kg ? ' +' + l.kg + ' kg' : ''} Wdh${r.series.length > 1 ? ` (${diff >= 0 ? '+' : ''}${diff} seit Start)` : ''}</span></div>${xChart(r.series.slice(-10).map((s) => s.sc), { h: 70, fmt: (v) => String(Math.round(v)) })}</div>`;
  }).join('');
}
function xMoodHtml() {
  const hi = [], lo = [];
  allKeys().forEach((k) => {
    const d = load(k), ci = d.checkin && d.checkin.am, sc = d.sleep && sleepScore(d.sleep);
    if (ci && ci.e && ci.m && sc) (sc.score >= 70 ? hi : lo).push((ci.e + ci.m) / 2);
  });
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  if (hi.length >= 3 && lo.length >= 3) return `<div class="bigstat">Morgen-Stimmung/Energie: nach gutem Schlaf <b>${avg(hi).toFixed(1).replace('.', ',')}</b>, nach schwachem Schlaf <b>${avg(lo).toFixed(1).replace('.', ',')}</b> (von 5)</div>`;
  return '<div class="gsub">Mit ein paar Tagen Morgen-Check-in und Schlafdaten zeige ich dir hier, wie Schlaf deine Energie beeinflusst.</div>';
}
function renderVerlauf() {
  const keys = allKeys().slice(-14);
  const steps = keys.map((k) => (load(k).health || {}).steps || 0), labels = keys.map((k) => parseKey(k).toLocaleDateString('de-DE', { weekday: 'short' }).slice(0, 2));
  const waist = allKeys().map((k) => [k, load(k).waist]).filter((p) => p[1]);
  return `<h2>Verlauf</h2>
  <h3>⚖️ Gewicht</h3>${xWeightHtml()}
  <h3>🏃 Läufe</h3>${xRunHtml()}
  <h3>💪 Training</h3>${xTrainHtml()}
  <h3>👣 Schritte (14 Tage)</h3>${keys.length ? xBars(steps, labels) : ''}
  ${waist.length ? `<h3>📏 Taille</h3>${xChart(waist.map((p) => p[1]), { h: 80 })}<div class="gsub">${waist.slice(-4).map((p) => `${xd(p[0])}: ${p[1]} cm`).join(' · ')}</div>` : ''}
  <h3>🧠 Energie & Schlaf</h3>${xMoodHtml()}`;
}

/* ---------- Wochen-Review ---------- */
function xWeekKeys(offset = 0) {
  const t = new Date(), m = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => dateKey(new Date(m.getFullYear(), m.getMonth(), m.getDate() + i)));
}
function xReview() {
  const wk = xWeekKeys(), today = todayKey(), upto = wk.filter((k) => k <= today);
  const ds = upto.map((k) => ({ k, d: load(k) }));
  const avgC = upto.length ? Math.round((upto.reduce((a, k) => a + completion(k), 0) / upto.length) * 100) : 0;
  const xp = ds.reduce((a, o) => a + dayXp(o.d), 0);
  const trains = ds.filter((o) => o.d.done.train).length, runs = ds.filter((o) => o.d.done.run).length;
  const km = ds.reduce((a, o) => a + (parseFloat(o.d.km) || 0), 0);
  const sc = ds.map((o) => o.d.sleep && sleepScore(o.d.sleep)).filter(Boolean).map((s) => s.score);
  const ws = ds.map((o) => o.d.health && o.d.health.weight).filter(Boolean);
  const moods = ds.map((o) => o.d.checkin && o.d.checkin.am).filter((c) => c && c.m).map((c) => c.m);
  const prevGoal = lsGet('rev:' + xWeekKeys(-1)[0]) || '', goal = lsGet('rev:' + wk[0]) || '';
  const sunday = new Date().getDay() === 0;
  return `<h3>📋 Wochen-Review${sunday ? ' · heute ist Sonntag' : ''}</h3>
  <div class="card ${sunday ? 'now' : ''}">
    <div class="stats" style="grid-template-columns:repeat(3,1fr)"><div><b>${avgC}%</b>Quests</div><div><b>${xp}</b>XP</div><div><b>${trains}</b>Trainings</div>
      <div><b>${runs}</b>Läufe${km ? ` (${km.toFixed(1).replace('.', ',')} km)` : ''}</div><div><b>${sc.length ? Math.round(sc.reduce((a, b) => a + b) / sc.length) : '–'}</b>Ø Schlaf</div><div><b>${ws.length > 1 ? (ws[ws.length - 1] - ws[0] > 0 ? '+' : '') + (ws[ws.length - 1] - ws[0]).toFixed(1).replace('.', ',') : '–'}</b>kg</div></div>
    ${moods.length ? `<div class="gsub">Ø Stimmung am Morgen: ${(moods.reduce((a, b) => a + b) / moods.length).toFixed(1).replace('.', ',')} von 5</div>` : ''}
    ${prevGoal ? `<div class="gsub">Dein Vorsatz letzte Woche: <b>${prevGoal}</b></div>` : ''}
    <label class="gsub" style="display:block;margin-top:8px">Eine Sache, die ich nächste Woche verbessere:</label>
    <textarea data-rev rows="2" placeholder="z. B. früher ins Bett, 2 Läufe schaffen …">${goal}</textarea>
  </div>`;
}

/* ---------- Profil: Erinnerungen, Ziele, Backup ---------- */
const xStandalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
function xProfile() {
  const x = xcfg(), on = lsGet('pushOn') === '1';
  const rw = x.rewards.split('\n').filter((l) => l.trim());
  const bk = +lsGet('backupAt');
  return `<h3>🔔 Push-Erinnerungen</h3>
  <div class="card"><div class="gsub" style="margin-top:0">Der Server schickt dir zu jeder Quest-Uhrzeit eine Meldung, wenn sie noch nicht abgehakt ist, auch bei geschlossener App. Dafür muss die App vom Home-Bildschirm geöffnet sein${xStandalone() ? ' (ist sie).' : ' (gerade ist sie es nicht).'}</div>
    ${on ? '<div class="gsub">Status: ✅ aktiv</div><button class="btn" data-act="pushtest">📨 Testmeldung senden</button><button class="btn" data-act="pushoff">Erinnerungen ausschalten</button>' : '<button class="btn" data-act="pushon">🔔 Push-Erinnerungen aktivieren</button>'}</div>
  <h3>🎯 Weitere Ziele</h3>
  <div class="card"><div class="ginputs" style="grid-template-columns:1fr 1fr">
    <label>Wasserziel (ml)<input data-xcfg="waterGoal" inputmode="numeric" value="${x.waterGoal}"></label>
    <label>Lauf-Ziel (km)<input data-xcfg="runKm" inputmode="decimal" value="${x.runKm || ''}"></label>
    <label>Ziel-Tempo (min:sek/km)<input data-xcfg="runPace" placeholder="6:00" value="${x.runPace}"></label>
    <label>Supplements (Komma)<input data-xcfg="supp" placeholder="Kreatin, Vitamin D" value="${x.supp}"></label></div>
    <label class="gsub" style="display:block;margin-top:10px">Belohnungen pro Level (eine pro Zeile, z. B. „Level 3: Lieblingsessen“)</label>
    <textarea data-xcfg="rewards" rows="3" placeholder="Level 3: Lieblingsessen&#10;Level 5: Neues Shirt">${x.rewards}</textarea>
    ${rw.length ? `<div class="gsub">${rw.map((l) => '🎁 ' + l).join('<br>')}</div>` : ''}</div>
  <h3>☁️ Backup</h3>
  <div class="card"><div class="gsub" style="margin-top:0">Deine Daten werden automatisch auf deinem Server gesichert, sobald das Token eingetragen ist. ${bk ? 'Letzte Sicherung: ' + new Date(bk).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'Noch keine Sicherung.'}</div>
    <button class="btn" data-act="backup">☁️ Jetzt sichern</button><button class="btn" data-act="restore">♻️ Aus Backup wiederherstellen</button></div>`;
}

/* ---------- Backup ---------- */
let _xpT, _xbT;
function xOnSaved() {
  clearTimeout(_xpT); _xpT = setTimeout(() => xPostState(), 3000);
  clearTimeout(_xbT); _xbT = setTimeout(() => xBackup(false), 20000);
}
function xApply(j) {
  const items = (j.data && j.data.items) || {};
  Object.entries(items).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch {} });
  try { localStorage.setItem('backupBase', String(j.at || 1)); localStorage.setItem('backupAt', String(j.at || Date.now())); } catch {}
  location.reload();
}
async function xBackup(manual) {
  if (!getToken()) { if (manual) toast('Erst Token eintragen'); return; }
  try {
    if (!lsGet('backupBase')) {
      const r = await fetch(X_URL + '/backup', { headers: xHeaders() }), j = await r.json();
      if (j.data) {
        if (confirm(`Auf dem Server liegt ein Backup vom ${new Date(j.at).toLocaleString('de-DE')}.\n\nOK = wiederherstellen\nAbbrechen = neu beginnen (das Backup wird später überschrieben)`)) return xApply(j);
      }
      try { localStorage.setItem('backupBase', String(j.at || 1)); } catch {}
    }
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || ['synctoken', 'backupBase', 'backupAt', 'syncAt', 'pushOn'].includes(k) || k.startsWith('n:')) continue;
      items[k] = localStorage.getItem(k);
    }
    const r = await fetch(X_URL + '/backup', { method: 'POST', headers: xHeaders(), body: JSON.stringify({ v: 1, items }) });
    if (!r.ok) throw new Error(r.status);
    try { localStorage.setItem('backupAt', String(Date.now())); } catch {}
    if (manual) { toast('☁️ Gesichert'); render(); }
  } catch (e) { if (manual) toast('Backup fehlgeschlagen: ' + e.message); }
}
async function xRestore() {
  if (!getToken()) return toast('Erst Token eintragen');
  try {
    const r = await fetch(X_URL + '/backup', { headers: xHeaders() }), j = await r.json();
    if (!j.data) return toast('Kein Backup auf dem Server');
    if (confirm(`Backup vom ${new Date(j.at).toLocaleString('de-DE')} wiederherstellen? Aktuelle Daten auf diesem Gerät werden überschrieben.`)) xApply(j);
  } catch (e) { toast('Fehler: ' + e.message); }
}

/* ---------- Push ---------- */
function xKey(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'), r = atob(s);
  return Uint8Array.from([...r].map((c) => c.charCodeAt(0)));
}
function xSchedule() {
  const s = {};
  for (let dow = 0; dow < 7; dow++) s[dow] = dayBlocks(dow, null).map((b) => ({ id: b.id, time: b.time, title: b.title, icon: b.icon }));
  return s;
}
async function xPostState(schedule) {
  if (!getToken()) return;
  const d = load(todayKey()), body = { date: todayKey(), done: Object.keys(d.done) };
  if (schedule !== undefined) body.schedule = schedule;
  else if (lsGet('pushOn') === '1') body.schedule = xSchedule();
  try { await fetch(X_URL + '/state', { method: 'POST', headers: xHeaders(), body: JSON.stringify(body) }); } catch {}
}
async function xEnablePush() {
  try {
    if (!getToken()) return toast('Erst Token eintragen');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Push geht nur in der App vom Home-Bildschirm');
    if (!xStandalone()) return toast('Bitte „Zum Home-Bildschirm“ und von dort öffnen');
    if ((await Notification.requestPermission()) !== 'granted') return toast('Benachrichtigungen nicht erlaubt');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: xKey(X_VAPID) });
    const r = await fetch(X_URL + '/subscribe', { method: 'POST', headers: xHeaders(), body: JSON.stringify({ subscription: sub.toJSON() }) });
    if (!r.ok) throw new Error('Server ' + r.status);
    localStorage.setItem('pushOn', '1');
    await xPostState(xSchedule());
    toast('🔔 Erinnerungen aktiv');
    render();
  } catch (e) { toast('Push fehlgeschlagen: ' + e.message); }
}
async function xDisablePush() {
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { await fetch(X_URL + '/subscribe', { method: 'DELETE', headers: xHeaders(), body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
    localStorage.removeItem('pushOn');
    await xPostState({});
    toast('Erinnerungen ausgeschaltet'); render();
  } catch (e) { toast('Fehler: ' + e.message); }
}
async function xTestPush() {
  try {
    const r = await fetch(X_URL + '/push-test', { method: 'POST', headers: xHeaders(), body: '{}' }), j = await r.json();
    toast(j.sent ? `📨 Test an ${j.sent} Gerät gesendet` : 'Kein Gerät erreicht. Erinnerungen neu aktivieren?');
  } catch (e) { toast('Fehler: ' + e.message); }
}

/* ---------- Event-Anbindung (von app.js aufgerufen) ---------- */
function xClick(t) {
  const a = t.dataset.act, rect = t.getBoundingClientRect();
  if (a === 'water') { mutate((d) => { d.water = Math.max(0, (d.water || 0) + +t.dataset.ml); }); return true; }
  if (a === 'supp') { const n = t.dataset.n; mutate((d) => { d.supp = d.supp || {}; d.supp[n] = !d.supp[n]; }); return true; }
  if (a === 'ci') { mutate((d) => { d.checkin = d.checkin || {}; (d.checkin[t.dataset.slot] = d.checkin[t.dataset.slot] || {})[t.dataset.k] = +t.dataset.v; }, rect); return true; }
  if (a === 'pause') { mutate((d) => { d.pause = !d.pause; }); return true; }
  if (a === 'rest') { xRestStart(+t.dataset.s); return true; }
  if (a === 'reststop') { try { localStorage.removeItem('restEnd'); } catch {} xTimerTick(); return true; }
  if (a === 'trainstart') { const k = todayKey(), d = load(k); d.trainStart = Date.now(); save(k, d); xTimerTick(); return true; }
  if (a === 'todoadd') { xTodoAdd(); return true; }
  if (a === 'todotoggle' || a === 'tododel') {
    const l = xTodos(), id = +t.dataset.id, it = l.find((x) => x.id === id);
    if (!it) return true;
    if (a === 'tododel') xSaveTodos(l.filter((x) => x.id !== id));
    else { it.done = !it.done; it.doneDate = it.done ? todayKey() : undefined; xSaveTodos(l); }
    xTodoXpSync(); return true;
  }
  if (a === 'pushon') { xEnablePush(); return true; }
  if (a === 'pushoff') { xDisablePush(); return true; }
  if (a === 'pushtest') { xTestPush(); return true; }
  if (a === 'backup') { xBackup(true); return true; }
  if (a === 'restore') { xRestore(); return true; }
  return false;
}
function xChange(e) {
  const el = e.target;
  if (el.dataset.xcfg) {
    const c = xcfg(), k = el.dataset.xcfg;
    c[k] = ['waterGoal', 'runKm'].includes(k) ? parseFloat(String(el.value).replace(',', '.')) || (k === 'waterGoal' ? 2500 : 0) : el.value.trim();
    try { localStorage.setItem('xcfg', JSON.stringify(c)); } catch {}
    xOnSaved(); render(); return true;
  }
  if (el.dataset.pad !== undefined) { try { localStorage.setItem('notepad', el.value); } catch {} xOnSaved(); return true; }
  if (el.dataset.rev !== undefined) { try { localStorage.setItem('rev:' + xWeekKeys()[0], el.value); } catch {} xOnSaved(); return true; }
  if (el.dataset.waist !== undefined) {
    const v = parseFloat(el.value.replace(',', '.'));
    mutate((d) => { if (isNaN(v)) delete d.waist; else d.waist = v; }); return true;
  }
  return false;
}
function xStartup() {
  setInterval(xTimerTick, 500);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'todoin') { e.preventDefault(); xTodoAdd(); } });
  if (getToken()) {
    setTimeout(() => { if (!lsGet('backupBase')) xBackup(false); }, 4000);
    if (lsGet('pushOn') === '1') xPostState();
  }
}
