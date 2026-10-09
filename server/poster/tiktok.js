import { launchBrowser, interactiveLogin, hasStoredSession, requireSession, resolveUpload, attachFile, captionFromBody, titleFromPost } from './util.js';

const LABEL = 'TikTok';
const PLATFORM = 'tiktok';
const UPLOAD_URL = 'https://www.tiktok.com/upload';

// TikTok's web composer. Selectors are ordered best-first and are the most
// volatile part of this file — check them in DevTools if a post fails.
const CAPTION_SELECTORS = ['[data-e2e="video-desc"]', 'div[data-e2e="video-desc"]', '[data-testid="video-desc"]', 'div[contenteditable="true"][aria-label*="descend" i]'];
const PUBLISH_SELECTORS = ['[data-e2e="publish"]', 'button:has-text("Post")', 'div[role="button"]:has-text("Post")'];

async function postToTikTok({ title, body, mediaPath }) {
  requireSession(PLATFORM, LABEL);
  const file = resolveUpload(mediaPath, LABEL);
  const caption = captionFromBody(body);
  const hook = titleFromPost({ title });
  // TikTok has no separate title field: the hook rides along as the first line
  // of the caption so the idea is not lost.
  const captionText = hook ? `${hook}\n\n${caption}` : caption;

  return launchBrowser(PLATFORM, async ({ page }) => {
    await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded' });

    await attachFile(page, file, 'input[type="file"]', {
      label: LABEL,
      triggerSelectors: ['[data-e2e="upload-icon"]', 'text="Upload"', 'div[role="button"]:has-text("Upload")'],
    });

    // Upload + processing can take a while; the caption box appears when the
    // preview is ready.
    const captionBox = page.locator(CAPTION_SELECTORS.join(', ')).first();
    await captionBox.waitFor({ state: 'visible', timeout: 180_000 });

    // fill() does not work on contenteditable divs everywhere; type() does.
    await captionBox.click();
    await captionBox.fill(captionText).catch(async () => {
      await captionBox.type(captionText, { delay: 5 });
    });

    for (const sel of PUBLISH_SELECTORS) {
      const btn = page.locator(sel).first();
      if (!(await btn.count())) continue;
      await btn.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        break;
      }
    }

    // TikTok shows a "Posting" progress state and then leaves the composer.
    await page
      .waitForFunction(
        () => !document.querySelector('[data-e2e="video-desc"], [data-testid="video-desc"]'),
        { timeout: 300_000 }
      )
      .catch(() => {
        throw new Error(`${LABEL} did not confirm the post. Check the account - the video may or may not have published.`);
      });

    // Best effort permalink from the profile page (newest post is on top).
    const href = await page
      .locator('a[href*="/@"][href$="/video/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);

    return { url: href ? new URL(href, 'https://www.tiktok.com').toString() : null };
  });
}

export async function loginSession() {
  return interactiveLogin(PLATFORM, {
    label: LABEL,
    startUrl: 'https://www.tiktok.com/',
    instructions: 'Log in to TikTok in that window.',
    loggedIn: async (page) => {
      const avatar = page.locator('[data-e2e="profile-icon"], header img[alt*="profile" i], a[href^="/@"] img').first();
      return (await avatar.count().catch(() => 0)) > 0 && page.url().includes('tiktok.com');
    },
  });
}

export async function hasTikTokAccess() {
  return hasStoredSession(PLATFORM);
}

export { postToTikTok };