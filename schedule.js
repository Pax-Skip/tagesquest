// Tagesplan + Trainingspläne. Hier kannst du Zeiten und Übungen anpassen.

const ANCHOR_MONDAY = new Date(2026, 10, 9); // Montag, 9.11.2026 = Woche 0 (A-B-A), danach B-A-B usw.

const EXERCISES = {
  A: {
    title: 'Ganzkörper A – Brust/Rücken/Beine',
    warmup: '5 Min aufwärmen: Schulterkreisen, Hüftkreisen, leichte Kniebeugen, ein paar lockere Liegestütze.',
    items: [
      { id: 'klimmzuege', name: 'Klimmzüge', sets: 3, target: 'so viele saubere wie möglich', note: '1–2 Wdh. im Tank lassen. 1–3 Stück ist okay.' },
      { id: 'liegestuetze', name: 'Liegestütze', sets: 3, target: '8–15' },
      { id: 'bulgarian', name: 'Bulgarian Split Squats', sets: 3, target: '8–12 je Bein' },
      { id: 'pike', name: 'Pike Push-ups', sets: 3, target: '6–12' },
      { id: 'glute', name: 'Glute Bridge einbeinig', sets: 3, target: '10–15 je Bein' },
      { id: 'knee', name: 'Hanging Knee Raises', sets: 3, target: '8–15' },
      { id: 'situps', name: 'Sit-ups', sets: 2, target: '12–20' },
    ],
  },
  B: {
    title: 'Ganzkörper B – andere Belastung',
    warmup: '5 Min aufwärmen: Schulterkreisen, Hüftkreisen, leichte Kniebeugen, ein paar lockere Liegestütze.',
    items: [
      { id: 'chinups', name: 'Chin-ups (Handflächen zu dir)', sets: 3, target: '4–10' },
      { id: 'enge', name: 'Enge Liegestütze', sets: 3, target: '8–15' },
      { id: 'ausfall', name: 'Ausfallschritte rückwärts', sets: 3, target: '10–15 je Bein' },
      { id: 'pike', name: 'Pike Push-ups', sets: 3, target: '6–12' },
      { id: 'kniebeugen', name: 'Langsame Kniebeugen', sets: 3, target: '15–25', note: '3 Sek. runter, kurz halten, hoch.' },
      { id: 'knee', name: 'Hanging Knee Raises', sets: 3, target: '8–15' },
      { id: 'plank', name: 'Plank', sets: 2, target: '30–60 Sek.' },
    ],
  },
};

// 0 = Sonntag ... 6 = Samstag
const STRENGTH_POS = { 1: 0, 4: 1, 6: 2 }; // Mo, Do, Sa
const WEEK_TYPE = {
  0: { icon: '😴', label: 'Erholung' },
  1: { icon: '💪', label: 'Krafttraining' },
  2: { icon: '🏃', label: '3–4 km locker' },
  3: { icon: '🚶', label: 'Erholung / Spaziergang' },
  4: { icon: '💪', label: 'Krafttraining' },
  5: { icon: '🏃', label: '4–6 km locker' },
  6: { icon: '💪', label: 'Krafttraining' },
};

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// 'A' | 'B' | null
function strengthType(date) {
  const pos = STRENGTH_POS[date.getDay()];
  if (pos === undefined) return null;
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - ANCHOR_MONDAY) / 86400000);
  const week = Math.floor(days / 7);
  const n = week * 3 + pos;
  return ((n % 2) + 2) % 2 === 0 ? 'A' : 'B';
}

// Blöcke eines Wochentags. type = 'A' | 'B' | null (für ICS-Export generisch)
function dayBlocks(dow, type) {
  const strength = STRENGTH_POS[dow] !== undefined;
  const blocks = [];
  const add = (id, time, title, extra = {}) => blocks.push({ id, time, title, ...extra });

  add('wake', '07:30', 'Aufstehen, Wasser trinken', { icon: '☀️' });

  if (dow === 2) add('run', '07:40', '3–4 km locker laufen', { icon: '🏃', km: true });
  else if (dow === 5) add('run', '07:40', '4–6 km locker laufen', { icon: '🏃', km: true });
  else add('run', '07:40', '1 km laufen', { icon: '🏃', km: true });

  add('shower', '08:05', 'Duschen & fertig machen', { icon: '🚿' });
  add('breakfast', '08:20', 'Frühstück', { icon: '🍳' });
  add('prep', '08:30', 'Trading-Vorbereitung (Plan, Levels, News)', { icon: '🧠', end: '09:00' });
  add('trade1', '09:00', 'Trading Morgen', { icon: '📈', end: '11:00' });
  add('room1', '11:00', 'Zimmer aufräumen & kurze Pause', { icon: '🧹' });
  add('lunch', '12:30', 'Mittagessen', { icon: '🍽️' });

  if (strength) {
    add('train', '13:30', type ? `Training: Ganzkörper ${type}` : 'Krafttraining (Ganzkörper A/B)', { icon: '💪', end: '14:30', training: type || true });
  } else if (dow === 3) {
    add('walk', '13:30', 'Spaziergang', { icon: '🚶', end: '14:00' });
  } else if (dow === 0) {
    add('rest', '13:30', 'Erholung, bewusst nichts tun', { icon: '😴' });
  }

  add('trade2', '15:00', 'Trading Mittag', { icon: '📈', end: '18:00' });
  add('dinner', '18:30', 'Abendessen', { icon: '🍝' });
  add('journal', '20:00', 'Trading-Journal & Tagesreview', { icon: '📝' });
  add('room2', '21:30', 'Zimmer fertig machen, morgen vorbereiten', { icon: '🧺' });
  add('sleep', '22:30', 'Schlafen gehen', { icon: '🌙' });
  return blocks;
}
