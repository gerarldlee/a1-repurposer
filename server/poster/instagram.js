import { launchBrowser, interactiveLogin, hasStoredSession, requireSession, resolveUpload, attachFile, captionFromBody, titleFromPost } from './util.js';

const LABEL = 'Instagram';
const PLATFORM = 'instagram';

const CAPTION_SELECTORS = [
  'div[aria-label="Write a caption..."]',
  'div[aria-label="Add a caption..."]',
  'div[contenteditable="true"][aria-label*="caption" i]',
  'textarea[aria-label*="caption" i]',
];
const SHARE_SELECTORS = [
  'div[role="button"]:has-text("Share")',
  'button:has-text("Share")',
  'span[aria-label="Share"]',
];

async function clickShare(page) {
  for (const sel of SHARE_SELECTORS) {
    const btn = page.locator(sel).first();
    if (!(await btn.count())) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.click();
    return;
  }
  throw new Error(`${LABEL} share button not found — the composer UI likely changed. Re-attach the media and check the poster selectors.`);
}

async function waitForPublished(page) {
  await page
    .waitForFunction(
      () => {
        const text = document.body.innerText || '';
        return text.includes('Your reel has been shared') || text.includes('Your post has been shared') || text.includes('Photo has been shared');
      },
      { timeout: 120_000 }
    )
    .catch(() => {
      throw new Error(`${LABEL} did not confirm the post. Check the account - it may or may not have published.`);
    });
}

async function postReel(page, { title, body, mediaPath }) {
  const file = resolveUpload(mediaPath, LABEL);
  const caption = captionFromBody(body);
  const hook = titleFromPost({ title });
  const captionText = hook ? `${hook}\n\n${caption}` : caption;

  // Deep link opens the Reel composer directly; fall back to Create → Reel.
  await page.goto('https://www.instagram.com/reels/create/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  if (!(await page.locator('input[type="file"]').count())) {
    await page.locator('[aria-label="Create"], div[role="button"]:has-text("Create")').first().click();
    await page.locator('div[role="menuitem"]:has-text("Reel"), [role="dialog"] div[role="button"]:has-text("Reel")').first().click();
  }

  await attachFile(page, file, 'input[type="file"]', { label: LABEL });

  // Crop/cover step.
  await page.locator('button:has-text("Next")').first().click({ timeout: 120_000 });

  const captionBox = page.locator(CAPTION_SELECTORS.join(', ')).first();
  await captionBox.waitFor({ state: 'visible', timeout: 180_000 });

  // Instagram has no title field; the hook rides along as the caption opener.
  await captionBox.click();
  await captionBox.fill(captionText).catch(async () => {
    await captionBox.type(captionText, { delay: 5 });
  });

  await clickShare(page);
  await waitForPublished(page);
}

async function postPhoto(page, { title, body, imagePath }) {
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  await page.locator('[aria-label="Create"], div[role="button"]:has-text("Create")').first().click();
  await page.locator('div[role="menuitem"]:has-text("Post"), [role="dialog"] div[role="button"]:has-text("Post")').first().click();

  await attachFile(page, imagePath, 'input[type="file"]', { label: LABEL });
  await page.locator('button:has-text("Next")').first().click({ timeout: 60_000 });
  await page.locator('button:has-text("Next")').first().click({ timeout: 60_000 }); // filters

  const caption = captionFromBody(body);
  const hook = titleFromPost({ title });
  const captionText = hook ? `${hook}\n\n${caption}` : caption;
  const box = page.locator(CAPTION_SELECTORS.join(', ')).first();
  await box.waitFor({ state: 'visible', timeout: 120_000 });
  await box.click();
  await box.fill(captionText).catch(async () => {
    await box.type(captionText, { delay: 5 });
  });

  await clickShare(page);
  await waitForPublished(page);
}

async function postToInstagram({ title, body, mediaPath, imagePath }) {
  requireSession(PLATFORM, LABEL);
  return launchBrowser(PLATFORM, async ({ page }) => {
    if (mediaPath) {
      await postReel(page, { title, body, mediaPath });
    } else if (imagePath) {
      await postPhoto(page, { title, body, imagePath });
    } else {
      throw new Error(`${LABEL} needs media attached. Attach a video (Reel) or a photo in the Queue tab before posting.`);
    }
    return { url: 'https://www.instagram.com/' };
  });
}

export async function loginSession() {
  return interactiveLogin(PLATFORM, {
    label: LABEL,
    startUrl: 'https://www.instagram.com/',
    instructions: 'Log in to Instagram in that window.',
    loggedIn: async (page) => {
      const nav = page.locator('nav a[href*="/direct/"], nav a[href="/"], nav [aria-label="Home"]').first();
      return (await nav.count().catch(() => 0)) > 0 && !page.url().includes('/accounts/login');
    },
  });
}

export async function hasInstagramAccess() {
  return hasStoredSession(PLATFORM);
}

export { postToInstagram };