// Shared helpers: dates (always local time), durations, formatting.

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const pad = (n) => String(n).padStart(2, '0');

/** Local date -> 'YYYY-MM-DD' */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> local Date at midnight */
export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday of the week containing d */
export function startOfWeek(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Mon=0
  return addDays(x, -dow);
}

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Named period -> { from, to, label } as ISO strings (inclusive). */
export function periodRange(period, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // A single specific day: "day:2026-10-19"
  if (typeof period === 'string' && period.startsWith('day:')) {
    const d = period.slice(4);
    const label = d === isoDate(today) ? 'today' : d === isoDate(addDays(today, -1)) ? 'yesterday' : `on ${fmtDate(d)}`;
    return { from: d, to: d, label };
  }
  switch (period) {
    case 'today':
      return { from: isoDate(today), to: isoDate(today), label: 'today' };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: isoDate(y), to: isoDate(y), label: 'yesterday' };
    }
    case 'last week': {
      const s = addDays(startOfWeek(today), -7);
      return { from: isoDate(s), to: isoDate(addDays(s, 6)), label: 'last week' };
    }
    case 'this month': {
      const s = startOfMonth(today);
      return { from: isoDate(s), to: isoDate(today), label: 'this month' };
    }
    case 'last month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: isoDate(s), to: isoDate(e), label: 'last month' };
    }
    case 'all time':
      return { from: '0000-01-01', to: '9999-12-31', label: 'all time' };
    case 'this week':
    default: {
      const s = startOfWeek(today);
      return { from: isoDate(s), to: isoDate(addDays(s, 6)), label: 'this week' };
    }
  }
}

export const inRange = (iso, r) => iso >= r.from && iso <= r.to;

/** 1.5 -> "1 hr 30 min", 0.25 -> "15 min" */
export function fmtHours(h) {
  const totalMin = Math.round((Number(h) || 0) * 60);
  const hrs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hrs && min) return `${hrs} hr ${min} min`;
  if (hrs) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'}`;
  return `${min} min`;
}

/** 1.5 -> "1.50" */
export const fmtNum = (h) => (Math.round((Number(h) || 0) * 100) / 100).toFixed(2);

/** 'YYYY-MM-DD' -> 'Mon, Nov 9' */
export function fmtDate(iso, withYear = false) {
  const d = parseIso(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** ms -> "1:05:09" */
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Round hours to 2 decimals, minimum 0.02 (about 1 minute). */
export const roundHours = (h) => Math.max(0.02, Math.round(h * 100) / 100);

export const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
