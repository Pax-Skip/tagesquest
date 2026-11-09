// Tagesquest Health-Relay: nimmt Tageswerte vom iPhone entgegen und liefert sie an die App.
// Geheimes Token (Secret "TOKEN") schützt beide Endpunkte.
const ALLOWED = ['https://pax-skip.github.io', 'http://localhost:5173'];
const FIELDS = ['steps', 'kcal', 'protein', 'carbs', 'fat', 'activeKcal', 'restingHr', 'avgHr', 'maxHr', 'weight', 'sleep'];

function cors(req) {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }); // YYYY-MM-DD
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
  return out;
}

// Health Auto Export (JSON, Version 2) → Tageswerte. Namen laut Hersteller-Doku; bei Protein/Gewicht/Ruhepuls
// werden mehrere Schreibweisen akzeptiert, da dort der exakte Name nicht dokumentiert ist.
function convertHAE(metrics) {
  const days = {};
  const day = (d) => (days[d] = days[d] || { date: d, _avg: [0, 0], _w: '' , _r: '' });
  const dk = (s) => String(s || '').slice(0, 10);
  const kcal = (q, u) => (/kj/i.test(u || '') ? q / 4.184 : q);
  const add = (o, k, v) => { if (Number.isFinite(v)) o[k] = (o[k] || 0) + v; };
  for (const m of metrics) {
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
          const dd = dk(e.endDate || e.end || e.date);
          const so = day(dd);
          so.sleep = so.sleep || {};
          const map = { Deep: 'deepMin', Core: 'coreMin', REM: 'remMin', Awake: 'awakeMin', 'In Bed': 'inBedMin' };
          if (map[e.value]) add(so.sleep, map[e.value], e.qty * 60);
        }
      }
    }
  }
  return Object.values(days).map((o) => {
    if (o._avg[1]) o.avgHr = Math.round(o._avg[0] / o._avg[1]);
    delete o._avg; delete o._w; delete o._r;
    for (const k of ['steps', 'activeKcal', 'kcal', 'protein', 'carbs', 'fat']) if (o[k] !== undefined) o[k] = Math.round(o[k]);
    return o;
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (!authorized(req, env)) return json(req, { error: 'unauthorized' }, 401);

    if (url.pathname === '/ingest' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json(req, { error: 'invalid json' }, 400); }
      let list;
      if (body && body.data && Array.isArray(body.data.metrics)) {
        list = convertHAE(body.data.metrics);
        // Zur Kontrolle: welche Metriknamen kamen wirklich an?
        const seen = body.data.metrics.map((m) => ({ name: m.name, units: m.units, n: (m.data || []).length }));
        await env.HEALTH.put('debug', JSON.stringify({ at: new Date().toISOString(), seen }), { expirationTtl: 60 * 60 * 24 * 30 });
      } else list = Array.isArray(body) ? body : [body];
      for (const item of list) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : today();
        const key = 'day:' + date;
        const prev = JSON.parse((await env.HEALTH.get(key)) || '{}');
        const next = { ...prev, ...clean(item), updated: Date.now() };
        if (prev.sleep && next.sleep) next.sleep = { ...prev.sleep, ...next.sleep };
        // asleepMin fehlt? Dann aus Tief + Kern + REM berechnen (so muss der Kurzbefehl nicht rechnen).
        if (next.sleep && next.sleep.asleepMin === undefined) {
          const sum = (next.sleep.deepMin || 0) + (next.sleep.coreMin || 0) + (next.sleep.remMin || 0);
          if (sum > 0) next.sleep.asleepMin = sum;
        }
        await env.HEALTH.put(key, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 400 });
      }
      return json(req, { ok: true, saved: list.length });
    }

    if (url.pathname === '/data' && req.method === 'GET') {
      const days = Math.min(parseInt(url.searchParams.get('days') || '14', 10) || 14, 60);
      const out = {};
      for (let i = 0; i < days; i++) {
        const d = new Date(Date.now() - i * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
        const v = await env.HEALTH.get('day:' + d);
        if (v) out[d] = JSON.parse(v);
      }
      return json(req, { today: today(), days: out });
    }
    if (url.pathname === '/debug' && req.method === 'GET') return json(req, JSON.parse((await env.HEALTH.get('debug')) || '{}'));
    return json(req, { error: 'not found' }, 404);
  },
};
