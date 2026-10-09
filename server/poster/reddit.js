import { config } from '../config.js';
import { getRedditAccount } from '../db.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';

const USER_AGENT = 'script:newsletter-repurposer:v1.0.0 (by /u/repurposer)';

let cachedToken = null;
let cachedTokenExpiry = 0;

function credentials() {
  const account = getRedditAccount();
  const creds = {
    clientId: config.reddit.clientId || account?.client_id,
    clientSecret: config.reddit.clientSecret || account?.client_secret,
    username: config.reddit.username || account?.username,
    password: config.reddit.password || account?.password,
  };
  const missing = ['clientId', 'clientSecret', 'username', 'password'].filter((k) => !creds[k]);
  if (missing.length) {
    const err = new Error(
      `Reddit credentials incomplete (missing: ${missing.join(', ')}). Set them in Settings or .env.`
    );
    err.status = 400;
    throw err;
  }
  return creds;
}

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - 60_000) return cachedToken;

  const creds = credentials();
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: creds.username,
      password: creds.password,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      throw new Error('Reddit auth failed (401): check client ID/secret and username/password. Also check the app type is "script" and 2FA is handled (TOTP required).');
    }
    throw new Error(`Reddit auth failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`Reddit auth error: ${JSON.stringify(data)}`);

  cachedToken = data.access_token;
  cachedTokenExpiry = now + data.expires_in * 1000;
  return cachedToken;
}

export function invalidateToken() {
  cachedToken = null;
  cachedTokenExpiry = 0;
}

export async function submitPost({ subreddit, title, body }) {
  const sr = (subreddit || '').replace(/^\/?r\//, '').trim();
  if (!sr) throw new Error('Subreddit is required for Reddit posts');
  if (!title) throw new Error('Title is required for Reddit posts');

  const token = await getToken();

  const res = await fetch(`${API_BASE}/api/submit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      sr: sr,
      kind: 'self',
      title,
      text: body || '',
      api_type: 'json',
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.json?.errors?.length) {
    const errs = data?.json?.errors?.map((e) => e.join(': ')).join('; ');
    if (errs) throw new Error(`Reddit rejected the post: ${errs}`);
    if (res.status === 401) {
      invalidateToken();
      throw new Error('Reddit token expired or invalid (401). Will retry with a fresh token.');
    }
    throw new Error(`Reddit submit failed (${res.status})`);
  }

  const postUrl = data?.json?.data?.url;
  return { url: postUrl || `https://www.reddit.com/r/${sr}/` };
}

export async function verifyCredentials() {
  await getToken();
  return { ok: true, username: credentials().username };
}