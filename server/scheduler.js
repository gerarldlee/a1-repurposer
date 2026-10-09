import cron from 'node-cron';
import { listPosts, updatePost } from './db.js';
import { dispatchPost, needsMedia } from './poster/index.js';

async function dispatch(post) {
  if (needsMedia(post.platform) && !post.media_path) {
    updatePost(post.id, { status: 'failed', error: 'Attach a video file to this post before it can be posted.' });
    return;
  }

  updatePost(post.id, { status: 'posting', error: null });

  try {
    const result = await dispatchPost(post);

    updatePost(post.id, {
      status: 'posted',
      posted_at: new Date().toISOString(),
      result_url: result?.url || null,
      error: null,
    });
    console.log(`[scheduler] posted #${post.id} to ${post.platform}${result?.url ? `: ${result.url}` : ''}`);
  } catch (err) {
    console.error(`[scheduler] failed to post #${post.id} to ${post.platform}:`, err.message);
    updatePost(post.id, { status: 'failed', error: err.message });
  }
}

async function tick() {
  const due = listPosts(['scheduled']).filter((p) => p.scheduled_at && new Date(p.scheduled_at) <= new Date());
  for (const post of due) {
    await dispatch(post); // sequential: avoid parallel browser launches / rate limits
  }
}

export function startScheduler() {
  console.log('[scheduler] started, checking every minute');
  cron.schedule('* * * * *', () => {
    tick().catch((err) => console.error('[scheduler] tick error:', err));
  });
  // Also run once at startup in case anything came due while offline
  tick().catch((err) => console.error('[scheduler] startup tick error:', err));
}