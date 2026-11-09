// Tagesquest Health-Relay: nimmt Tageswerte vom iPhone entgegen, liefert sie an die App,
// sichert App-Daten (Backup) und verschickt Web-Push-Erinnerungen.
// Geheimes Token (Secret "TOKEN") schützt alle Endpunkte außer /lastpush.
const ALLOWED = ['https://pax-skip.github.io', 'http://localhost:5173'];
const FIELDS = ['steps', 'kcal', 'protein', 'carbs', 'fat', 'activeKcal', 'restingHr', 'avgHr', 'maxHr', 'weight', 'sleep'];
const DAY = 60 * 60 * 24;

function cors(req) {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
}
const json = (req, obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

function authorized(req, env) {
  const a = req.headers.get('Authorization') || '';
  const t = a.replace(/^Bearer\s+/i, '');
  if (!env.TOKEN || t.length !== env.TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < t.length; i++) diff |= t.charCodeAt(i) ^ env.TOKEN.charCodeAt(i);
  return diff === 0;
}
// Aktuelle Zeit in Berlin: { date: 'YYYY-MM-DD', dow: 0-6, min: Minuten seit 00:00 }
function berlin(d = new Date()) {
  const date = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t).value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { date, dow, min: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10) };
}
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : undefined; };

function clean(raw) {
  const out = {};
  for (const k of FIELDS) {
    if (raw[k] === undefined || raw[k] === null || raw[k] === '') continue;
    if (k === 'sleep') {
      if (typeof raw.sleep !== 'object') continue;
      const s = {};
      for (const [sk, sv] of Object.entries(raw.sleep)) {
        if (sk === 'bedtime' && /^\d{1,2}:\d{2}$/.test(String(sv))) s.bedtime = String(sv);
        else if (num(sv) !== undefined) s[sk] = num(sv);
      }
      out.sleep = s;
    } else if (num(raw[k]) !== undefined) out[k] = num(raw[k]);
  }
  if (Array.isArray(raw.workouts)) {
    out.workouts = raw.workouts.map((w) => ({
      name: String(w.name || '').slice(0, 40), start: String(w.start || '').slice(0, 25),
      min: num(w.min), km: num(w.km), avgHr: num(w.avgHr), kcal: num(w.kcal),
    })).filter((w) => w.name);
  }
  return out;
}

// "2024-02-06 14:30:00 -0800" -> Date
function parseHaeDate(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ?([+-]\d{2})(\d{2})?/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3]}:${m[4] || '00'}`);
  return isNaN(d) ? null : d;
}

// Health Auto Export (JSON, Version 2) -> Tageswerte. Namen laut Hersteller-Doku; bei Protein/Gewicht/Ruhepuls
// werden mehrere Schreibweisen akzeptiert, da dort der exakte Name nicht dokumentiert ist.
function convertHAE(data) {
  const days = {};
  const day = (d) => (days[d] = days[d] || { date: d, _avg: [0, 0], _w: '', _r: '' });
  const dk = (s) => String(s || '').slice(0, 10);
  const kcal = (q, u) => (/kj/i.test(u || '') ? q / 4.184 : q);
  const add = (o, k, v) => { if (Number.isFinite(v)) o[k] = (o[k] || 0) + v; };
  for (const m of data.metrics || []) {
    const name = String(m.name || '').toLowerCase();
    for (const e of m.data || []) {
      const d = dk(e.date || e.endDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const o = day(d);
      if (name === 'step_count') add(o, 'steps', e.qty);
      else if (name === 'active_energy') add(o, 'activeKcal', kcal(e.qty, m.units));
      else if (name === 'dietary_energy') add(o, 'kcal', kcal(e.qty, m.units));
      else if (name === 'protein') add(o, 'protein', e.qty);
      else if (name === 'carbohydrates') add(o, 'carbs', e.qty);
      else if (name === 'total_fat') add(o, 'fat', e.qty);
      else if (name === 'heart_rate') {
        const a = e.Avg ?? e.avg ?? e.qty;
        if (Number.isFinite(a)) { o._avg[0] += a; o._avg[1]++; }
        const mx = e.Max ?? e.max;
        if (Number.isFinite(mx)) o.maxHr = Math.max(o.maxHr || 0, mx);
      } else if (name === 'resting_heart_rate') {
        const v = e.qty ?? e.Avg;
        if (Number.isFinite(v) && String(e.date) >= o._r) { o.restingHr = v; o._r = String(e.date); }
      } else if (['weight_body_mass', 'weight', 'body_mass', 'weight_&_body_mass'].includes(name)) {
        let v = e.qty;
        if (/lb/i.test(m.units || '')) v *= 0.45359237;
        if (Number.isFinite(v) && String(e.date) >= o._w) { o.weight = Math.round(v * 10) / 10; o._w = String(e.date); }
      } else if (name === 'sleep_analysis') {
        if (e.totalSleep !== undefined || e.deep !== undefined) {
          const h = (x) => (Number.isFinite(x) ? x * 60 : undefined);
          o.sleep = { asleepMin: h(e.totalSleep), deepMin: h(e.deep), remMin: h(e.rem), coreMin: h(e.core), awakeMin: h(e.awake) };
          if (e.inBed > 0) o.sleep.inBedMin = h(e.inBed);
          if (e.sleepStart) o.sleep.bedtime = String(e.sleepStart).slice(11, 16);
        } else if (e.value) {
          const so = day(dk(e.endDate || e.end || e.date));
          so.sleep = so.sleep || {};
          const map = { Deep: 'deepMin', Core: 'coreMin', REM: 'remMin', Awake: 'awakeMin', 'In Bed': 'inBedMin' };
          if (map[e.value]) add(so.sleep, map[e.value], e.qty * 60);
        }
      }
    }
  }
  // Workouts (z. B. Läufe von Adidas Running über Apple Health). Feldnamen tolerant gelesen.
  for (const w of data.workouts || []) {
    const start = w.start || w.startDate || w.date;
    const d = dk(start);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const o = day(d);
    let min;
    const s = parseHaeDate(start), en = parseHaeDate(w.end || w.endDate);
    if (s && en) min = (en - s) / 60000;
    else if (Number.isFinite(w.duration)) min = w.duration > 600 ? w.duration / 60 : w.duration; // Sekunden oder Minuten
    const dist = w.distance && (w.distance.qty ?? w.distance);
    let km = Number.isFinite(dist) ? dist : undefined;
    if (km !== undefined && /mi/i.test((w.distance && w.distance.units) || '')) km *= 1.609344;
    const hr = w.avgHeartRate ? (w.avgHeartRate.qty ?? w.avgHeartRate) : w.heartRate && w.heartRate.avg ? (w.heartRate.avg.qty ?? w.heartRate.avg) : undefined;
    const en2 = w.activeEnergyBurned ? (w.activeEnergyBurned.qty ?? w.activeEnergyBurned) : undefined;
    (o.workouts = o.workouts || []).push({
      name: w.name, start: String(start), min: min && Math.round(min * 10) / 10,
      km: km !== undefined ? Math.round(km * 100) / 100 : undefined,
      avgHr: Number.isFinite(hr) ? Math.round(hr) : undefined, kcal: Number.isFinite(en2) ? Math.round(en2) : undefined,
    });
  }
  return Object.values(days).map((o) => {
    if (o._avg[1]) o.avgHr = Math.round(o._avg[0] / o._avg[1]);
    delete o._avg; delete o._w; delete o._r;
    for (const k of ['steps', 'activeKcal', 'kcal', 'protein', 'carbs', 'fat']) if (o[k] !== undefined) o[k] = Math.round(o[k]);
    return o;
  });
}

/* ---------- Web Push (VAPID, ohne Payload) ---------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();
async function vapidJwt(aud, env) {
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://pax-skip.github.io/tagesquest/' })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${h}.${c}`));
  return `${h}.${c}.${b64u(sig)}`;
}
async function sendPush(sub, env) {
  const aud = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(aud, env);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, TTL: '1800', Urgency: 'high' },
  });
}
async function pushAll(env) {
  const list = await env.HEALTH.list({ prefix: 'sub:' });
  let ok = 0;
  for (const k of list.keys) {
    const sub = JSON.parse((await env.HEALTH.get(k.name)) || 'null');
    if (!sub) continue;
    try {
      const r = await sendPush(sub, env);
      if (r.status === 404 || r.status === 410) await env.HEALTH.delete(k.name);
      else if (r.ok) ok++;
    } catch {}
  }
  return ok;
}
async function subKey(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(endpoint));
  return 'sub:' + b64u(h).slice(0, 24);
}

export default {
  async scheduled(event, env) {
    const now = berlin();
    const schedule = JSON.parse((await env.HEALTH.get('schedule')) || 'null');
    if (!schedule) return;
    const done = (JSON.parse((await env.HEALTH.get('state:' + now.date)) || '{}').done) || [];
    const due = [];
    for (const b of schedule[now.dow] || []) {
      const [h, m] = b.time.split(':').map(Number);
      const diff = now.min - (h * 60 + m);
      if (diff < 0 || diff >= 6 || done.includes(b.id)) continue;
      const sk = `sent:${now.date}:${b.id}`;
      if (await env.HEALTH.get(sk)) continue;
      await env.HEALTH.put(sk, '1', { expirationTtl: 2 * DAY });
      due.push(b);
    }
    if (!due.length) return;
    const first = due[0];
    await env.HEALTH.put('lastpush', JSON.stringify({
      title: `${first.icon || '⏰'} ${first.title}`,
      body: due.length > 1 ? `und ${due.length - 1} weitere Quests` : 'Jetzt erledigen und abhaken!',
      at: Date.now(),
    }), { expirationTtl: DAY });
    await pushAll(env);
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

    // Öffentlich: nur der Text der letzten Erinnerung (Quest-Titel), damit das Service Worker die Meldung anzeigen kann.
    if (url.pathname === '/lastpush' && req.method === 'GET') {
      return json(req, JSON.parse((await env.HEALTH.get('lastpush')) || '{"title":"Tagesquest","body":"Eine Quest ist fällig."}'));
    }
    if (!authorized(req, env)) return json(req, { error: 'unauthorized' }, 401);

    if (url.pathname === '/ingest' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json(req, { error: 'invalid json' }, 400); }
      let list;
      if (body && body.data && (Array.isArray(body.data.metrics) || Array.isArray(body.data.workouts))) {
        list = convertHAE(body.data);
        const seen = (body.data.metrics || []).map((m) => ({ name: m.name, units: m.units, n: (m.data || []).length }));
        const wk = (body.data.workouts || []).map((w) => ({ name: w.name, keys: Object.keys(w).slice(0, 25) }));
        await env.HEALTH.put('debug', JSON.stringify({ at: new Date().toISOString(), seen, workouts: wk }), { expirationTtl: 30 * DAY });
      } else list = Array.isArray(body) ? body : [body];
      for (const item of list) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : berlin().date;
        const key = 'day:' + date;
        const prev = JSON.parse((await env.HEALTH.get(key)) || '{}');
        const next = { ...prev, ...clean(item), updated: Date.now() };
        if (prev.sleep && next.sleep) next.sleep = { ...prev.sleep, ...next.sleep };
        if (next.sleep && next.sleep.asleepMin === undefined) {
          const sum = (next.sleep.deepMin || 0) + (next.sleep.coreMin || 0) + (next.sleep.remMin || 0);
          if (sum > 0) next.sleep.asleepMin = sum;
        }
        if (prev.workouts && next.workouts) {
          const byStart = new Map(prev.workouts.map((w) => [w.start, w]));
          next.workouts.forEach((w) => byStart.set(w.start, w));
          next.workouts = [...byStart.values()];
        }
        await env.HEALTH.put(key, JSON.stringify(next), { expirationTtl: 400 * DAY });
      }
      return json(req, { ok: true, saved: list.length });
    }

    if (url.pathname === '/data' && req.method === 'GET') {
      const days = Math.min(parseInt(url.searchParams.get('days') || '14', 10) || 14, 400);
      const out = {};
      for (let i = 0; i < days; i++) {
        const d = berlin(new Date(Date.now() - i * 86400000)).date;
        const v = await env.HEALTH.get('day:' + d);
        if (v) out[d] = JSON.parse(v);
      }
      return json(req, { today: berlin().date, days: out });
    }

    // App-Backup: kompletter Zustand der App als JSON-Text
    if (url.pathname === '/backup' && req.method === 'POST') {
      const text = await req.text();
      if (text.length > 5_000_000) return json(req, { error: 'too large' }, 413);
      await env.HEALTH.put('backup', text);
      await env.HEALTH.put('backupAt', String(Date.now()));
      return json(req, { ok: true, bytes: text.length });
    }
    if (url.pathname === '/backup' && req.method === 'GET') {
      return json(req, { at: +(await env.HEALTH.get('backupAt')) || 0, data: JSON.parse((await env.HEALTH.get('backup')) || 'null') });
    }

    // Zustand für Erinnerungen: heutige erledigte Quests + Tagesplan je Wochentag (leer = Erinnerungen aus)
    if (url.pathname === '/state' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) await env.HEALTH.put('state:' + b.date, JSON.stringify({ done: b.done || [] }), { expirationTtl: 3 * DAY });
      if (b.schedule !== undefined) await env.HEALTH.put('schedule', JSON.stringify(b.schedule));
      return json(req, { ok: true });
    }
    if (url.pathname === '/subscribe' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (!b.subscription || !b.subscription.endpoint) return json(req, { error: 'invalid' }, 400);
      await env.HEALTH.put(await subKey(b.subscription.endpoint), JSON.stringify({ endpoint: b.subscription.endpoint }));
      return json(req, { ok: true });
    }
    if (url.pathname === '/subscribe' && req.method === 'DELETE') {
      const b = await req.json().catch(() => ({}));
      if (b.endpoint) await env.HEALTH.delete(await subKey(b.endpoint));
      return json(req, { ok: true });
    }
    if (url.pathname === '/push-test' && req.method === 'POST') {
      await env.HEALTH.put('lastpush', JSON.stringify({ title: '🔔 Test', body: 'Erinnerungen funktionieren!', at: Date.now() }), { expirationTtl: DAY });
      return json(req, { ok: true, sent: await pushAll(env) });
    }
    if (url.pathname === '/debug' && req.method === 'GET') return json(req, JSON.parse((await env.HEALTH.get('debug')) || '{}'));
    return json(req, { error: 'not found' }, 404);
  },
};
