import { submitPost } from './reddit.js';
import { postToX } from './x.js';
import { postToTikTok, loginSession as loginTikTok, hasTikTokAccess } from './tiktok.js';
import { postToYtShorts, loginSession as loginYtShorts, hasYtShortsAccess } from './ytshorts.js';
import { postToInstagram, loginSession as loginInstagram, hasInstagramAccess } from './instagram.js';

// One place that maps a post to the right poster, so the scheduler and the
// "post now" button can never drift apart.
export async function dispatchPost(post) {
  switch (post.platform) {
    case 'reddit':
      return submitPost({ subreddit: post.subreddit, title: post.title, body: post.body });
    case 'tiktok':
      return postToTikTok({ title: post.title, body: post.body, mediaPath: post.media_path });
    case 'yt_shorts':
      return postToYtShorts({ title: post.title, body: post.body, mediaPath: post.media_path });
    case 'instagram':
      return postToInstagram({
        title: post.title,
        body: post.body,
        mediaPath: post.media_path,
        imagePath: post.image_path,
      });
    case 'x':
    default:
      return postToX({ body: post.body, imagePath: post.image_path });
  }
}

export function needsMedia(platform) {
  return platform === 'tiktok' || platform === 'yt_shorts';
}

// Browser-session platforms exposed in Settings; the client renders one
// connect button per entry.
export const BROWSER_PLATFORMS = {
  tiktok: { label: 'TikTok', login: loginTikTok, hasAccess: hasTikTokAccess },
  yt_shorts: { label: 'YouTube Shorts', login: loginYtShorts, hasAccess: hasYtShortsAccess },
  instagram: { label: 'Instagram', login: loginInstagram, hasAccess: hasInstagramAccess },
};