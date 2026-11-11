// Slack: post messages to a channel through an "Incoming Webhook" link.
// Jarvis only posts; it can't read your Slack.

const ALLOW_LOCAL = process.env.JARVIS_SLACK_ALLOW_LOCAL === '1'; // for tests only

export function validWebhook(url) {
  const u = String(url || '').trim();
  return /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/\S+$/.test(u)
    || (ALLOW_LOCAL && /^http:\/\/127\.0\.0\.1:\d+\/\S*$/.test(u));
}

/** Slack's text format: *bold*, <url|label>, and & < > escaped. */
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Turn one of Jarvis's answers ({ title, speech, sections }) into Slack text. */
export function toSlackText(res, heading = '') {
  const L = [];
  if (heading || res.title) L.push(`*${esc(heading || res.title)}*`);
  if (res.speech) L.push(esc(res.speech));
  for (const s of res.sections || []) {
    if (!s.items?.length) continue;
    L.push('', `*${esc(s.heading)}*`);
    for (const i of s.items) L.push(`• ${esc(i)}`);
  }
  return L.join('\n');
}

/** Plain text (agenda, report) inside a Slack message: title in bold, the rest as-is. */
export function textBlock(title, text) {
  return `*${esc(title)}*\n${esc(text)}`;
}

export async function postToSlack(webhook, text) {
  if (!validWebhook(webhook)) throw new Error('That isn’t a Slack webhook link. It should start with https://hooks.slack.com/services/');
  let res;
  try {
    res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Couldn't reach Slack. Check your internet connection.");
  }
  const body = await res.text().catch(() => '');
  if (res.ok) return true;
  const why = {
    no_service: 'Slack says this webhook was removed. Make a new one (Settings → Slack → How to get a link).',
    invalid_token: 'Slack says this webhook link is no longer valid. Make a new one.',
    channel_not_found: 'Slack can’t find that channel any more. Make a new webhook for another channel.',
    channel_is_archived: 'That Slack channel was archived. Make a new webhook for another channel.',
    action_prohibited: 'Your Slack admin has blocked this webhook.',
    no_text: 'The message was empty.',
    invalid_payload: 'Slack didn’t understand the message.',
  }[body.trim()];
  throw new Error(why || `Slack returned an error (${res.status}${body ? `: ${body.slice(0, 80)}` : ''}).`);
}
