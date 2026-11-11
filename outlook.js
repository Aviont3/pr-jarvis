// Outlook (Microsoft 365) connection: sign-in, meetings, flagged emails and new emails.
// Read-only: Jarvis never sends, deletes or changes anything in the mailbox or calendar.
//
// Sign-in uses Microsoft's standard "authorization code + PKCE" flow for desktop apps:
// no password ever touches Jarvis, and no app secret is needed. Tokens are kept only in
// Jarvis's local data file (never in backups or the Google Sheet).

import crypto from 'node:crypto';

const LOGIN_BASE = process.env.JARVIS_MS_LOGIN_BASE || 'https://login.microsoftonline.com';
const GRAPH_BASE = process.env.JARVIS_GRAPH_BASE || 'https://graph.microsoft.com/v1.0';
export const SCOPES = 'offline_access openid profile User.Read Calendars.Read Mail.Read';

const pending = new Map(); // state -> { verifier, at }

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function emptyOutlook() {
  return { refreshToken: null, accessToken: null, expiresAt: 0, account: null, lastSyncAt: null, lastError: null, needsAdmin: false };
}

/** What the browser may see (never the tokens). */
export function outlookStatus(o, settings) {
  return {
    configured: !!settings.msClientId,
    connected: !!o?.refreshToken,
    account: o?.account || null,
    lastSyncAt: o?.lastSyncAt || null,
    lastError: o?.lastError || null,
    needsAdmin: !!o?.needsAdmin,
    adminConsentUrl: settings.msClientId
      ? `${LOGIN_BASE}/${settings.msTenant || 'organizations'}/adminconsent?client_id=${encodeURIComponent(settings.msClientId)}`
      : null,
  };
}

export function loginUrl(settings, redirectUri) {
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  pending.set(state, { verifier, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60 * 1000) pending.delete(k);
  const q = new URLSearchParams({
    client_id: settings.msClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${LOGIN_BASE}/${settings.msTenant || 'organizations'}/oauth2/v2.0/authorize?${q}`;
}

/** Turn Microsoft's error codes into plain English (and spot "IT must approve"). */
export function explainMsError(code, description = '') {
  const text = `${code || ''} ${description || ''}`;
  if (/AADSTS65001|AADSTS90094|AADSTS90095|admin(istrator)? (consent|approval)|needs permission to access resources|need admin approval/i.test(text)) {
    return { needsAdmin: true, message: 'Your company needs to approve Jarvis before it can read Outlook. In Jarvis, go to Settings → Outlook and send the approval link there to your IT team. Once they approve, click “Sign in with Microsoft” again.' };
  }
  if (/AADSTS50011/i.test(text)) return { message: 'The Microsoft app setup has the wrong “Redirect URI”. It must be exactly http://localhost:4747/api/outlook/callback (see the setup steps).' };
  if (/AADSTS700016|AADSTS90002|unauthorized_client/i.test(text)) return { message: 'Microsoft doesn’t recognise the app ID. Check the “Application (client) ID” in Settings → Advanced.' };
  if (/AADSTS7000218|client_assertion|client_secret/i.test(text)) return { message: 'In the Microsoft app setup, turn on “Allow public client flows” (Authentication page) and save.' };
  if (/access_denied|AADSTS65004|consent_required|user canceled|user_cancelled/i.test(text)) return { message: 'Sign-in was cancelled. Click “Sign in with Microsoft” to try again.' };
  if (/invalid_grant|AADSTS70008|AADSTS700082|AADSTS50173/i.test(text)) return { message: 'Your Microsoft sign-in has expired. Click “Sign in with Microsoft” again.', expired: true };
  return { message: `Microsoft said: ${description || code || 'something went wrong'}` };
}

async function tokenRequest(settings, params) {
  const res = await fetch(`${LOGIN_BASE}/${settings.msTenant || 'organizations'}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: settings.msClientId, scope: SCOPES, ...params }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = explainMsError(json.error, json.error_description);
    const err = new Error(e.message);
    Object.assign(err, e);
    throw err;
  }
  return json;
}

function saveTokens(o, json) {
  o.accessToken = json.access_token;
  o.expiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000 - 60000;
  if (json.refresh_token) o.refreshToken = json.refresh_token;
}

/** Finish sign-in after Microsoft sends the browser back to Jarvis. */
export async function finishLogin(o, settings, { code, state, redirectUri }) {
  const p = pending.get(state);
  if (!p) throw new Error('That sign-in link is old. Click “Sign in with Microsoft” again.');
  pending.delete(state);
  const json = await tokenRequest(settings, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: p.verifier });
  saveTokens(o, json);
  o.needsAdmin = false;
  o.lastError = null;
  const me = await graph(o, settings, '/me?$select=displayName,mail,userPrincipalName');
  o.account = { name: me.displayName || '', email: me.mail || me.userPrincipalName || '' };
}

async function accessToken(o, settings) {
  if (!o.refreshToken) throw Object.assign(new Error('Outlook isn’t connected.'), { notConnected: true });
  if (o.accessToken && Date.now() < o.expiresAt) return o.accessToken;
  try {
    saveTokens(o, await tokenRequest(settings, { grant_type: 'refresh_token', refresh_token: o.refreshToken }));
  } catch (err) {
    if (err.expired) { o.refreshToken = null; o.accessToken = null; }
    throw err;
  }
  return o.accessToken;
}

export async function graph(o, settings, path, extraHeaders = {}) {
  const token = await accessToken(o, settings);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extraHeaders },
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = json?.error?.code || res.status;
    const msg = json?.error?.message || '';
    if (res.status === 401) o.accessToken = null;
    const e = explainMsError(code, msg);
    if (res.status === 403 && !e.needsAdmin) e.message = 'Outlook said Jarvis isn’t allowed to read this. Your IT team may need to approve Jarvis.';
    throw Object.assign(new Error(e.message), e, { status: res.status });
  }
  return json;
}

// ------------------------------------------------------------------ calendar

const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const utc = (s) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);

/** Meetings between two local dates (inclusive), in the same shape as Google Calendar events. */
export async function getOutlookEvents(o, settings, fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const start = new Date(fy, fm - 1, fd).toISOString();
  const end = new Date(ty, tm - 1, td + 1).toISOString();
  const q = `startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`
    + '&$select=id,subject,start,end,location,attendees,isAllDay,isCancelled,responseStatus,webLink&$top=200&$orderby=start/dateTime';
  const r = await graph(o, settings, `/me/calendarView?${q}`, { Prefer: 'outlook.timezone="UTC"' });
  return (r.value || [])
    .filter((ev) => !ev.isAllDay && !ev.isCancelled && ev.responseStatus?.response !== 'declined')
    .map((ev) => {
      const s = utc(ev.start.dateTime);
      const e = utc(ev.end.dateTime);
      return {
        id: `ms_${ev.id}`,
        title: ev.subject || '(No title)',
        start: s.toISOString(),
        end: e.toISOString(),
        date: localIso(s),
        location: ev.location?.displayName || '',
        guests: (ev.attendees || []).length,
        calendar: 'Outlook',
        link: ev.webLink || '',
      };
    });
}

// ------------------------------------------------------------------ flagged emails -> to-dos

/** Flagged emails, newest first. */
export async function getFlagged(o, settings) {
  const q = "$filter=flag/flagStatus eq 'flagged'&$select=id,subject,from,receivedDateTime,flag,webLink,importance&$top=50";
  const r = await graph(o, settings, `/me/messages?${q}`);
  return (r.value || []).map((m) => ({
    id: m.id,
    subject: m.subject || '(No subject)',
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
    received: m.receivedDateTime,
    due: m.flag?.dueDateTime?.dateTime ? localIso(utc(m.flag.dueDateTime.dateTime)) : '',
    important: m.importance === 'high',
    link: m.webLink || '',
  }));
}

/** Current flag of one message: 'flagged' | 'complete' | 'notFlagged' | 'gone'. */
export async function flagStatus(o, settings, id) {
  try {
    const m = await graph(o, settings, `/me/messages/${encodeURIComponent(id)}?$select=flag`);
    return m.flag?.flagStatus || 'notFlagged';
  } catch (err) {
    if (err.status === 404) return 'gone';
    throw err;
  }
}

// ------------------------------------------------------------------ new emails

/** Unread inbox emails from the last `days` days (Focused first when available). */
export async function getInbox(o, settings, days = 2) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const q = `$filter=receivedDateTime ge ${since} and isRead eq false&$orderby=receivedDateTime desc&$top=25`
    + '&$select=id,subject,from,receivedDateTime,importance,webLink,inferenceClassification';
  const r = await graph(o, settings, `/me/mailFolders/inbox/messages?${q}`);
  return (r.value || []).map((m) => ({
    id: m.id,
    subject: m.subject || '(No subject)',
    from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
    received: m.receivedDateTime,
    important: m.importance === 'high',
    focused: m.inferenceClassification !== 'other',
    link: m.webLink || '',
  }));
}
