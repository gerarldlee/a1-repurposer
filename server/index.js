import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, AI_PROVIDERS, setAiProvider } from './config.js';
import { generateVariants, activeProvider } from './ai.js';
import { runKnowledgeExtraction, generateAngles } from './research.js';
import { startScheduler } from './scheduler.js';
import {
  createPost, getPost, listPosts, listScheduledPosts, updatePost, deletePost, saveRedditAccount, getRedditAccount,
  createKnowledge, getKnowledge, listKnowledge, updateKnowledge, deleteKnowledge,
  replaceAngles, listAngles, getAngle, deleteAngle,
} from './db.js';
import { submitPost, verifyCredentials } from './poster/reddit.js';
import { postToX, loginSession, hasXAccess, hasStoredSession } from './poster/x.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const app = express();
// 10mb: base64 of a 5MB screenshot (X's image cap) is ~6.7MB
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[api]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });
};

// --- generation ---

app.post('/api/generate', wrap(async (req, res) => {
  const { idea, platform, subreddit, count, angleId } = req.body || {};
  if (!['x', 'reddit'].includes(platform)) return res.status(400).json({ error: 'Platform must be "x" or "reddit".' });
  if (platform === 'reddit' && !subreddit?.trim()) return res.status(400).json({ error: 'Subreddit is required for Reddit posts.' });

  let angle;
  let sourceIdea;
  if (angleId) {
    const angleRow = getAngle(Number(angleId));
    if (!angleRow) return res.status(404).json({ error: 'Angle not found.' });
    const knowledge = getKnowledge(angleRow.knowledge_id);
    if (!knowledge) return res.status(404).json({ error: 'Knowledge report for this angle was deleted.' });
    angle = {
      title: angleRow.title,
      hook: angleRow.hook || '',
      rationale: angleRow.rationale || '',
      facts: angleRow.facts || [],
      formats: angleRow.formats || [],
    };
    sourceIdea = knowledge.source_text;
  } else {
    sourceIdea = idea;
    if (!sourceIdea || !sourceIdea.trim()) return res.status(400).json({ error: 'Provide the idea or content to repurpose.' });
  }

  const variants = await generateVariants({
    idea: sourceIdea.trim(),
    platform,
    subreddit: subreddit?.trim(),
    count: Math.min(Math.max(Number(count) || 4, 1), 8),
    angle,
  });

  const saved = variants.map((v) => createPost({ source_idea: sourceIdea.trim(), ...v }));
  res.json({ posts: saved });
}));

// --- knowledge extraction (background job) ---

app.post('/api/knowledge', wrap(async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Provide the idea, content, blog, or product to analyze.' });
  if (!config.tavily.apiKey) {
    return res.status(400).json({ error: 'TAVILY_API_KEY is not configured. Add it to .env (free key at tavily.com) and restart.' });
  }

  const trimmed = text.trim();
  const row = createKnowledge({
    source_text: trimmed,
    title: trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed,
  });

  // fire-and-forget: progress + result are written to the row and read via polling
  runKnowledgeExtraction(trimmed, {
    onUpdate: (stage) => {
      try {
        updateKnowledge(row.id, { stage });
      } catch (err) {
        console.warn('[knowledge] stage update failed:', err.message);
      }
    },
  })
    .then((report) => {
      updateKnowledge(row.id, { status: 'done', stage: 'done', report, title: report.title, error: null });
    })
    .catch((err) => {
      console.error('[knowledge] extraction failed:', err);
      updateKnowledge(row.id, { status: 'failed', error: err.message || 'Knowledge extraction failed.' });
    });

  res.json({ knowledge: row });
}));

app.get('/api/knowledge', wrap(async (req, res) => {
  res.json({ knowledge: listKnowledge() });
}));

app.get('/api/knowledge/:id', wrap(async (req, res) => {
  const row = getKnowledge(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Knowledge report not found.' });
  res.json({ knowledge: row });
}));

app.delete('/api/knowledge/:id', wrap(async (req, res) => {
  deleteKnowledge(Number(req.params.id));
  res.json({ ok: true });
}));

// --- angles ---

app.post('/api/knowledge/:id/angles', wrap(async (req, res) => {
  const row = getKnowledge(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Knowledge report not found.' });
  if (row.status !== 'done' || !row.report) {
    return res.status(400).json({ error: 'Knowledge extraction is not finished yet.' });
  }
  const count = Math.min(Math.max(Number(req.body?.count) || 15, 5), 20);
  const angles = await generateAngles(row.report, count);
  const saved = replaceAngles(row.id, angles);
  res.json({ angles: saved });
}));

app.get('/api/knowledge/:id/angles', wrap(async (req, res) => {
  const row = getKnowledge(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Knowledge report not found.' });
  res.json({ angles: listAngles(row.id) });
}));

app.delete('/api/angles/:id', wrap(async (req, res) => {
  deleteAngle(Number(req.params.id));
  res.json({ ok: true });
}));

// --- posts CRUD ---

app.get('/api/posts', wrap(async (req, res) => {
  const statuses = req.query.status ? String(req.query.status).split(',') : undefined;
  res.json({ posts: listPosts(statuses) });
}));

// must come before /api/posts/:id so "scheduled" is not parsed as an id
app.get('/api/posts/scheduled', wrap(async (req, res) => {
  res.json({ posts: listScheduledPosts() });
}));

app.get('/api/posts/:id', wrap(async (req, res) => {
  const post = listPosts().find((p) => p.id === Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post });
}));

app.patch('/api/posts/:id', wrap(async (req, res) => {
  const fields = req.body || {};
  const allowed = ['title', 'body', 'subreddit', 'format', 'status'];
  const clean = {};
  for (const k of allowed) if (k in fields) clean[k] = fields[k];
  if (clean.status && !['draft', 'approved', 'scheduled', 'rejected'].includes(clean.status)) {
    return res.status(400).json({ error: 'Invalid status. Use the schedule endpoint to schedule.' });
  }
  const post = updatePost(Number(req.params.id), clean);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post });
}));

app.delete('/api/posts/:id', wrap(async (req, res) => {
  const post = getPost(Number(req.params.id));
  if (post?.image_path) {
    fs.rmSync(path.join(UPLOADS_DIR, path.basename(post.image_path)), { force: true });
  }
  deletePost(Number(req.params.id));
  res.json({ ok: true });
}));

// --- images (screenshot format) ---

const IMAGE_LIMITS = { jpg: true, jpeg: true, png: true, gif: true, webp: true };

app.post('/api/posts/:id/image', wrap(async (req, res) => {
  const post = getPost(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const { image } = req.body || {};
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(image || '');
  if (!match || !IMAGE_LIMITS[match[1].toLowerCase().replace('jpeg', 'jpg')]) {
    return res.status(400).json({ error: 'Provide a base64 data-URL image (png, jpg, gif, webp).' });
  }

  // Remove previous image if any
  if (post.image_path) {
    fs.rmSync(path.join(UPLOADS_DIR, path.basename(post.image_path)), { force: true });
  }

  const filename = `post-${post.id}-${Date.now()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(match[2], 'base64'));

  const updated = updatePost(post.id, { image_path: `/uploads/${filename}` });
  res.json({ post: updated });
}));

app.delete('/api/posts/:id/image', wrap(async (req, res) => {
  const post = getPost(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.image_path) {
    fs.rmSync(path.join(UPLOADS_DIR, path.basename(post.image_path)), { force: true });
  }
  const updated = updatePost(post.id, { image_path: null });
  res.json({ post: updated });
}));

// --- approval + scheduling ---

app.post('/api/posts/:id/approve', wrap(async (req, res) => {
  const post = updatePost(Number(req.params.id), { status: 'approved', error: null });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post });
}));

app.post('/api/posts/:id/schedule', wrap(async (req, res) => {
  const { scheduled_at } = req.body || {};
  if (!scheduled_at || Number.isNaN(new Date(scheduled_at).getTime())) {
    return res.status(400).json({ error: 'Provide a valid scheduled_at datetime.' });
  }
  const post = updatePost(Number(req.params.id), { status: 'scheduled', scheduled_at: new Date(scheduled_at).toISOString(), error: null });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post });
}));

app.post('/api/posts/:id/post-now', wrap(async (req, res) => {
  const posts = listPosts();
  const post = posts.find((p) => p.id === Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (!['draft', 'approved', 'scheduled', 'failed'].includes(post.status)) {
    return res.status(400).json({ error: `Cannot post a post in "${post.status}" status.` });
  }

  updatePost(post.id, { status: 'posting' });
  try {
    const result =
      post.platform === 'reddit'
        ? await submitPost({ subreddit: post.subreddit, title: post.title, body: post.body })
        : await postToX({ body: post.body, imagePath: post.image_path });
    const updated = updatePost(post.id, { status: 'posted', posted_at: new Date().toISOString(), result_url: result?.url || null, error: null });
    res.json({ post: updated });
  } catch (err) {
    const updated = updatePost(post.id, { status: 'failed', error: err.message });
    res.status(502).json({ error: err.message, post: updated });
  }
}));

// --- posting helpers ---

app.post('/api/preview-reddit', wrap(async (req, res) => {
  // dry-run: verifies credentials/token without submitting
  const result = await verifyCredentials();
  res.json(result);
}));

// --- settings ---

app.get('/api/settings', wrap(async (req, res) => {
  const reddit = getRedditAccount();
  const active = activeProvider();
  res.json({
    ai: {
      provider: active.key,
      available: AI_PROVIDERS.map((key) => {
        const p = config.ai.providers[key];
        return {
          key,
          name: p.name,
          model: p.model,
          base_url: p.baseUrl || null,
          configured: key === 'ollama' ? Boolean(p.baseUrl) : Boolean(p.apiKey),
        };
      }),
    },
    reddit: reddit
      ? { username: reddit.username, client_id: reddit.client_id, configured: true }
      : { configured: Boolean(config.reddit.clientId) },
    x: {
      api_configured: Boolean(config.x.bearerToken),
      browser_session: hasStoredSession(),
      has_access: await hasXAccess(),
    },
  });
}));

app.post('/api/settings/ai', wrap(async (req, res) => {
  const { provider } = req.body || {};
  setAiProvider(provider); // throws 400 on unknown provider; writes .env + runtime config
  res.json({ ok: true, provider });
}));

app.post('/api/settings/reddit', wrap(async (req, res) => {
  const { username, password, client_id, client_secret } = req.body || {};
  for (const [k, v] of Object.entries({ username, password, client_id, client_secret })) {
    if (!v || !String(v).trim()) return res.status(400).json({ error: `Missing field: ${k}` });
  }
  saveRedditAccount({
    username: String(username).trim(),
    password: String(password),
    client_id: String(client_id).trim(),
    client_secret: String(client_secret).trim(),
  });
  res.json({ ok: true });
}));

app.post('/api/settings/x/connect', wrap(async (req, res) => {
  // Opens a visible browser window; user logs in; session is stored.
  await loginSession();
  res.json({ ok: true, browser_session: true });
}));

app.listen(config.port, () => {
  console.log(`Repurposer running at http://localhost:${config.port}`);
  const active = activeProvider();
  const anyKeySet = AI_PROVIDERS.some((k) => config.ai.providers[k].apiKey && k !== 'ollama');
  if (!anyKeySet && active.key !== 'ollama') console.warn(`WARNING: No AI provider key set (${AI_PROVIDERS.join(', ')}) - generation will fail. Copy .env.example to .env and fill it in.`);
  console.log(`[ai] active provider: ${active.name} (${active.model})`);
  startScheduler();
});