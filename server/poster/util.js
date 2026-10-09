import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
export const UPLOADS_DIR = path.join(ROOT, 'uploads');

// Every browser-poster keeps its Playwright storage state in a sibling dir,
// mirroring what poster/x.js does with .x-session.
export function sessionDir(platform) {
  return path.join(ROOT, `.${platform}-session`);
}

export function sessionFile(platform) {
  return path.join(sessionDir(platform), 'storage_state.json');
}

export function hasStoredSession(platform) {
  return fs.existsSync(sessionFile(platform));
}

// Fail fast (and clearly) instead of launching a browser that would only end
// up on a login wall.
export function requireSession(platform, label) {
  if (!hasStoredSession(platform)) {
    throw new Error(`No ${label} session saved. Connect the account in Settings first.`);
  }
}

// media_path is stored as a URL like /uploads/post-1-169.mp4; map it to disk.
export function resolveUpload(mediaPath, label) {
  if (!mediaPath) {
    throw new Error(`${label} needs a video file attached. Attach one in the Queue tab before posting.`);
  }
  const file = path.join(UPLOADS_DIR, path.basename(mediaPath));
  if (!fs.existsSync(file)) {
    throw new Error(`${label} video not found on disk: ${path.basename(mediaPath)}. Re-attach it in the Queue tab.`);
  }
  return file;
}

// The AI writes video posts as "Caption:\n<caption>\n\nScript:\n1. ..." so the
// caption field on the platform gets only the caption part. The stop pattern
// also covers beat headings it may label as "Step 1:", "Beat 2 -", "1) ...".
const SCRIPT_SECTION = /^\s*(?:#{1,3}\s*)?(?:(?:Script|Description|Storyboard|Beats?|Slides?|Frames?|Steps?)\b\s*\d*\s*[:.)\-]|\d+[.)]\s)/im;

export function captionFromBody(body) {
  const text = String(body || '').trim();
  if (!text) return '';

  // The caption text may sit on the marker line ("Caption: hook here") or below it.
  const marker = /^\s*#{0,3}\s*Caption\s*:\s*(.*)$/im.exec(text);
  if (!marker) return text;

  const rest = marker[1] + text.slice(marker.index + marker[0].length);
  const stopAt = rest.search(SCRIPT_SECTION);
  return (stopAt < 0 ? rest : rest.slice(0, stopAt)).trim();
}

export function titleFromPost(post) {
  return String(post?.title || '').trim();
}

export async function launchBrowser(platform, fn, { headless = true } = {}) {
  const { chromium } = await import('playwright');
  fs.mkdirSync(sessionDir(platform), { recursive: true });
  const stateFile = sessionFile(platform);

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      storageState: fs.existsSync(stateFile) ? stateFile : undefined,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    try {
      return await fn({ page, context, stateFile });
    } finally {
      // Persist any refreshed cookies/tokens so the next run stays logged in.
      await context.storageState({ path: stateFile }).catch(() => {});
    }
  } finally {
    await browser.close();
  }
}

// Opens a visible window and waits until the user finishes logging in.
export async function interactiveLogin(platform, { label, startUrl, loggedIn, instructions }) {
  const { chromium } = await import('playwright');
  fs.mkdirSync(sessionDir(platform), { recursive: true });
  const stateFile = sessionFile(platform);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

  console.log(`[${platform}] Browser window opened. ${instructions}`);
  console.log(`[${platform}] The ${label} session is saved automatically once login is detected.`);

  const deadline = Date.now() + 10 * 60 * 1000; // 10 min
  let ready = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    ready = await loggedIn(page).catch(() => false);
    if (ready) break;
  }

  if (!ready) {
    await browser.close();
    throw new Error(`Timed out waiting for ${label} login (10 minutes). Try again.`);
  }

  await context.storageState({ path: stateFile });
  await browser.close();
  return { ok: true };
}

// Playwright's setInputFiles() handles the visible-input dance, but every one
// of these UIs mounts the input lazily/offscreen, so retry the common ways of
// reaching it before giving up.
export async function attachFile(page, file, acceptSelector = 'input[type="file"]', { triggerSelectors = [], label = 'This platform' } = {}) {
  let input = page.locator(acceptSelector).first();
  if (!(await input.count())) {
    for (const sel of triggerSelectors) {
      const trigger = page.locator(sel).first();
      if (await trigger.count()) {
        await trigger.click().catch(() => {});
        break;
      }
    }
    input = page.locator(acceptSelector).first();
  }

  try {
    await input.waitFor({ state: 'attached', timeout: 30_000 });
  } catch {
    throw new Error(
      `${label} did not show an upload control. The session may have expired, or the page changed — reconnect in Settings and check the poster selectors.`
    );
  }
  await input.setInputFiles(file);
  return input;
}