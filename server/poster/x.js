import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_DIR = path.join(__dirname, '..', '..', '.x-session');

export const hasStoredSession = () => fs.existsSync(path.join(STORAGE_DIR, 'storage_state.json'));

// ---------------------------------------------------------------------------
// Official API v2 (free tier: 500 posts/month). Used when bearer token is set.
// ---------------------------------------------------------------------------

async function postViaApi({ body }) {
  if (!config.x.bearerToken) return false;

  // Split threads on the separator the AI module uses
  const tweets = body
    .split(/\n\n---\n\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tweets.length) throw new Error('Post body is empty');

  let createdId = null;
  let createdText = null;

  for (let i = 0; i < tweets.length; i++) {
    const payload = { text: tweets[i] };
    if (i > 0) payload.reply = { in_reply_to_tweet_id: createdId };

    const res = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.x.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (i > 0) {
        throw new Error(
          `X thread partially posted (post ${i}/${tweets.length} failed: ${data?.detail || res.status}). Check the account and post the remainder manually.`
        );
      }
      console.warn(`[x] API post failed (${res.status}), falling back to browser:`, data?.detail || '');
      return false;
    }
    createdId = data?.data?.id;
    createdText = tweets[i];
  }

  return { url: createdId ? `https://x.com/i/status/${createdId}` : null };
}

// ---------------------------------------------------------------------------
// Playwright fallback using a stored login session.
// ---------------------------------------------------------------------------

async function postViaBrowser({ body, imagePath }) {
  const { chromium } = await import('playwright');
  const tweets = body
    .split(/\n\n---\n\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tweets.length) throw new Error('Post body is empty');

  // image_path is a URL like /uploads/post-1-169.png; map to disk
  let imageFile = null;
  if (imagePath) {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    imageFile = path.join(uploadsDir, path.basename(imagePath));
    if (!fs.existsSync(imageFile)) {
      throw new Error(`Attached screenshot not found on disk: ${path.basename(imagePath)}. Re-attach it in the Queue tab.`);
    }
  }

  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const stateFile = path.join(STORAGE_DIR, 'storage_state.json');

  const launchOpts = { headless: true };
  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({ storageState: fs.existsSync(stateFile) ? stateFile : undefined });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);

    let lastUrl = null;

    for (let i = 0; i < tweets.length; i++) {
      await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('div[data-testid="tweetTextarea_0"]', { timeout: 30_000 });

      const box = page.locator('div[data-testid="tweetTextarea_0"]').first();
      await box.click();
      // Type in chunks so X doesn't lose characters on long posts
      const text = tweets[i];
      for (let pos = 0; pos < text.length; pos += 200) {
        await box.type(text.slice(pos, pos + 200), { delay: 5 });
      }

      // Attach the screenshot (first post of a thread only - X attaches media
      // per-post and a thread with random mid-thread images looks broken)
      if (imageFile && i === 0) {
        let fileInput = page.locator('input[type="file"][accept*="image"]').first();
        if (!(await fileInput.count())) {
          // Some X builds only mount the input after the media button is clicked
          await page.locator('[data-testid="mediaIconButton"], [aria-label*="photo" i], [aria-label*="media" i]').first().click();
          fileInput = page.locator('input[type="file"]').first();
        }
        await fileInput.waitFor({ state: 'attached', timeout: 15_000 });
        await fileInput.setInputFiles(imageFile);
        // Wait for the thumbnail preview to render before submitting
        await page
          .locator('[data-testid="tweetPhoto"], [data-testid="attachments"] img, [data-testid="media"] img')
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
      }

      await page.getByTestId('tweetButton').first().click();

      // Wait for the compose box to clear (post accepted)
      await page
        .waitForFunction(
          () => {
            const el = document.querySelector('div[data-testid="tweetTextarea_0"]');
            return !el || el.textContent.trim() === '';
          },
          { timeout: 30_000 }
        )
        .catch(() => {
          throw new Error('X did not confirm the post (compose box never cleared). The post may or may not have gone through - check the account.');
        });

      if (i === 0) {
        // Grab the profile link to build a permalink to the newest post
        await page.waitForSelector('a[data-testid="AppTabBar_Profile_Link"]', { timeout: 30_000 });
        const href = await page
          .locator('a[data-testid="AppTabBar_Profile_Link"]')
          .first()
          .getAttribute('href');
        if (href) lastUrl = href;
      }

      if (i < tweets.length - 1) await page.waitForTimeout(4000);
    }

    await context.storageState({ path: stateFile });

    if (lastUrl) {
      const handle = lastUrl.replace(/^https?:\/\/(www\.)?(x|twitter)\.com/, '');
      return { url: `https://x.com${handle}` }; // profile URL; newest post is on top
    }
    return { url: null };
  } finally {
    await browser.close();
  }
}

export async function postToX(post) {
  // Media upload needs a *user-context* OAuth token; an app-only bearer token
  // cannot attach images. So posts with an image go straight to the browser.
  if (post.imagePath) {
    return { ...(await postViaBrowser(post)), method: 'browser' };
  }
  try {
    const result = await postViaApi(post);
    if (result !== false) return { ...result, method: 'api' };
  } catch (err) {
    // Threads that partially posted must NOT be retried via browser (dupes)
    if (err.message?.includes('partially posted')) throw err;
    console.warn('[x] API attempt errored, trying browser:', err.message);
  }
  return { ...(await postViaBrowser(post)), method: 'browser' };
}

export async function loginSession(interactive = true) {
  const { chromium } = await import('playwright');
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const stateFile = path.join(STORAGE_DIR, 'storage_state.json');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded' });

  console.log('[x] Browser window opened. Log in to X in that window; this tool saves the session automatically once you are done.');

  // Poll until the user lands on the home timeline (logged in)
  const deadline = Date.now() + 10 * 60 * 1000; // 10 min
  let loggedIn = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    loggedIn = await page
      .getByTestId('AppTabBar_Profile_Link')
      .count()
      .catch(() => 0);
    if (loggedIn) break;
  }

  if (!loggedIn) {
    await browser.close();
    throw new Error('Timed out waiting for X login (10 minutes). Try again.');
  }

  await context.storageState({ path: stateFile });
  await browser.close();
  return { ok: true };
}

export async function hasXAccess() {
  return Boolean(config.x.bearerToken) || hasStoredSession();
}