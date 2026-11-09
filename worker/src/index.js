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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (!authorized(req, env)) return json(req, { error: 'unauthorized' }, 401);

    if (url.pathname === '/ingest' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json(req, { error: 'invalid json' }, 400); }
      const list = Array.isArray(body) ? body : [body];
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
    return json(req, { error: 'not found' }, 404);
  },
};
