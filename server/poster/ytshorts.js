import { launchBrowser, interactiveLogin, hasStoredSession, requireSession, resolveUpload, attachFile, captionFromBody, titleFromPost } from './util.js';

const LABEL = 'YouTube Shorts';
const PLATFORM = 'yt_shorts';

// Studio is the only web surface that uploads a Short. Its DOM changes often,
// so each step has fallbacks and the failure messages say what to do.
const TITLE_SELECTORS = ['#textbox', '#title', 'input[aria-label*="title" i]', 'ytcp-social-proofs-textarea#title'];
const DESCRIPTION_SELECTORS = ['#description', 'ytcp-social-proofs-textarea#description', 'textarea[aria-label*="describ" i]'];

async function channelStudioUrl(page) {
  await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded' });

  // Studio redirects to the active channel, so the channel id shows up in the URL.
  await page
    .waitForFunction(() => /\/channel\/[^/]+/.test(location.pathname), { timeout: 60_000 })
    .catch(() => {});

  let channelId = (page.url().match(/\/channel\/([^/]+)/) || [])[1];
  if (!channelId) {
    const href = await page.locator('a[href*="/channel/"]').first().getAttribute('href').catch(() => null);
    channelId = href && (href.match(/\/channel\/([^/]+)/) || [])[1];
  }
  if (!channelId) {
    throw new Error(`${LABEL} could not find your YouTube channel in Studio. Make sure the logged-in account owns a channel with Shorts enabled.`);
  }
  return `https://studio.youtube.com/channel/${channelId}/editing/upload?uploadType=short`;
}

async function postToYtShorts({ title, body, mediaPath }) {
  requireSession(PLATFORM, LABEL);
  const file = resolveUpload(mediaPath, LABEL);
  const videoTitle = (titleFromPost({ title }) || 'Untitled Short').slice(0, 100);
  const description = captionFromBody(body);

  return launchBrowser(PLATFORM, async ({ page }) => {
    const uploadUrl = await channelStudioUrl(page);
    await page.goto(uploadUrl, { waitUntil: 'domcontentloaded' });

    await attachFile(page, file, 'input[type="file"]', { label: LABEL });

    // Upload + transcoding: the details form only mounts once it is done.
    const titleInput = page.locator(TITLE_SELECTORS.join(', ')).first();
    await titleInput.waitFor({ state: 'visible', timeout: 600_000 });

    await titleInput.click();
    await titleInput.fill(videoTitle);

    if (description) {
      const descInput = page.locator(DESCRIPTION_SELECTORS.join(', ')).first();
      await descInput.waitFor({ state: 'visible', timeout: 30_000 });
      await descInput.click();
      await descInput.fill(description);
    }

    // Visibility step: Public → Next → Done.
    const publicOption = page.locator('#visibility-dropdown [role="option"]:has-text("Public")').first();
    if (await publicOption.count().catch(() => 0)) {
      await publicOption.click();
    }
    await page.locator('#next-button, button:has-text("Next")').first().click();

    const doneBtn = page.locator('#done-button, button:has-text("Done")').first();
    await doneBtn.waitFor({ state: 'visible', timeout: 120_000 });
    await doneBtn.click();
    await page
      .waitForFunction(() => /\/videos\/upload/.test(location.pathname) || document.body.innerText.includes('Shorts'), { timeout: 120_000 })
      .catch(() => {});

    const channelId = (page.url().match(/\/channel\/([^/]+)/) || [])[1];
    return { url: channelId ? `https://studio.youtube.com/channel/${channelId}/content/videos/uploaded` : null };
  });
}

export async function loginSession() {
  return interactiveLogin(PLATFORM, {
    label: LABEL,
    startUrl: 'https://studio.youtube.com/',
    instructions: 'Log in to the Google account that owns your YouTube channel in that window.',
    loggedIn: async (page) => {
      await page.waitForTimeout(1500);
      return /\/channel\/[^/]+/.test(page.url());
    },
  });
}

export async function hasYtShortsAccess() {
  return hasStoredSession(PLATFORM);
}

export { postToYtShorts };