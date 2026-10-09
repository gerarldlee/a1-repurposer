import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');

const POSTS_SCHEMA = `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_idea TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('x', 'reddit', 'tiktok', 'yt_shorts', 'instagram')),
    format TEXT,
    subreddit TEXT,
    title TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','scheduled','posting','posted','failed','rejected')),
    scheduled_at TEXT,
    posted_at TEXT,
    result_url TEXT,
    error TEXT,
    image_path TEXT,
    media_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
`;

const POST_COLUMNS = [
  'id', 'source_idea', 'platform', 'format', 'subreddit', 'title', 'body', 'status',
  'scheduled_at', 'posted_at', 'result_url', 'error', 'image_path', 'media_path',
  'created_at', 'updated_at',
];

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (${POSTS_SCHEMA});

  CREATE TABLE IF NOT EXISTS reddit_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_text TEXT NOT NULL,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
    stage TEXT NOT NULL DEFAULT 'parsing',
    report TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS angles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    hook TEXT,
    rationale TEXT,
    facts TEXT,
    formats TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrations for databases created before image support
const postColumns = () => db.pragma('table_info(posts)').map((c) => c.name);
const hasImagePath = postColumns().includes('image_path');
if (!hasImagePath) {
  db.exec('ALTER TABLE posts ADD COLUMN image_path TEXT');
}

// Migration for databases created before the video platforms (tiktok,
// yt_shorts, instagram): SQLite cannot ALTER a CHECK constraint, so the table
// is rebuilt. Only the columns the old table actually has are copied over.
const postsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts'").get()?.sql || '';
if (!postsSql.includes("'tiktok'")) {
  const copy = POST_COLUMNS.filter((c) => postColumns().includes(c));
  db.transaction(() => {
    db.exec(`CREATE TABLE posts_migrated (${POSTS_SCHEMA})`);
    db.exec(`INSERT INTO posts_migrated (${copy.join(', ')}) SELECT ${copy.join(', ')} FROM posts`);
    db.exec('DROP TABLE posts');
    db.exec('ALTER TABLE posts_migrated RENAME TO posts');
  })();
  console.log('[db] migrated posts table for video platforms');
}

// Migration for databases created before video/media support
if (!postColumns().includes('media_path')) {
  db.exec('ALTER TABLE posts ADD COLUMN media_path TEXT');
}

const now = () => new Date().toISOString();

export function createPost({ source_idea, platform, format, subreddit, title, body }) {
  const stmt = db.prepare(`
    INSERT INTO posts (source_idea, platform, format, subreddit, title, body)
    VALUES (@source_idea, @platform, @format, @subreddit, @title, @body)
  `);
  const info = stmt.run({ source_idea, platform, format, subreddit, title, body });
  return getPost(info.lastInsertRowid);
}

export function getPost(id) {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

export function listPosts(statuses) {
  if (statuses && statuses.length) {
    const placeholders = statuses.map(() => '?').join(',');
    return db
      .prepare(`SELECT * FROM posts WHERE status IN (${placeholders}) ORDER BY created_at DESC`)
      .all(...statuses);
  }
  return db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all();
}

export function listScheduledPosts() {
  return db
    .prepare(`SELECT * FROM posts WHERE scheduled_at IS NOT NULL ORDER BY scheduled_at ASC`)
    .all();
}

export function updatePost(id, fields) {
  const allowed = ['platform', 'format', 'subreddit', 'title', 'body', 'status', 'scheduled_at', 'posted_at', 'result_url', 'error', 'image_path', 'media_path'];
  const updates = [];
  const values = {};
  for (const key of allowed) {
    if (key in fields && fields[key] !== undefined) {
      updates.push(`${key} = @${key}`);
      values[key] = fields[key];
    }
  }
  if (!updates.length) return getPost(id);
  updates.push(`updated_at = @updated_at`);
  values.updated_at = now();
  values.id = id;
  db.prepare(`UPDATE posts SET ${updates.join(', ')} WHERE id = @id`).run(values);
  return getPost(id);
}

export function deletePost(id) {
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
}

export function getRedditAccount() {
  return db.prepare('SELECT * FROM reddit_accounts ORDER BY id DESC LIMIT 1').get();
}

// ---------------------------------------------------------------- knowledge

export function createKnowledge({ source_text, title }) {
  const stmt = db.prepare(`
    INSERT INTO knowledge (source_text, title)
    VALUES (@source_text, @title)
  `);
  const info = stmt.run({ source_text, title: title || null });
  return getKnowledgeRaw(info.lastInsertRowid);
}

function getKnowledgeRaw(id) {
  return db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id);
}

export function getKnowledge(id) {
  const row = getKnowledgeRaw(id);
  if (!row) return null;
  return {
    ...row,
    report: row.report ? JSON.parse(row.report) : null,
  };
}

// List for pickers — no report/source payload
export function listKnowledge() {
  return db
    .prepare('SELECT id, title, status, stage, error, created_at, updated_at FROM knowledge ORDER BY id DESC')
    .all();
}

export function updateKnowledge(id, fields) {
  const allowed = ['title', 'status', 'stage', 'report', 'error'];
  const updates = [];
  const values = {};
  for (const key of allowed) {
    if (key in fields && fields[key] !== undefined) {
      updates.push(`${key} = @${key}`);
      // report is stored as JSON text
      values[key] = key === 'report' ? JSON.stringify(fields[key]) : fields[key];
    }
  }
  if (!updates.length) return getKnowledgeRaw(id);
  updates.push('updated_at = @updated_at');
  values.updated_at = now();
  values.id = id;
  db.prepare(`UPDATE knowledge SET ${updates.join(', ')} WHERE id = @id`).run(values);
  return getKnowledgeRaw(id);
}

export function deleteKnowledge(id) {
  db.prepare('DELETE FROM angles WHERE knowledge_id = ?').run(id);
  db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
}

// ---------------------------------------------------------------- angles

export function replaceAngles(knowledgeId, angles) {
  const insert = db.prepare(`
    INSERT INTO angles (knowledge_id, title, hook, rationale, facts, formats)
    VALUES (@knowledge_id, @title, @hook, @rationale, @facts, @formats)
  `);
  const rows = angles.map((a) => ({
    knowledge_id: knowledgeId,
    title: a.title || 'Untitled angle',
    hook: a.hook || null,
    rationale: a.rationale || null,
    facts: a.facts ? JSON.stringify(a.facts) : null,
    formats: a.formats ? JSON.stringify(a.formats) : null,
  }));
  const run = db.transaction((items) => {
    db.prepare('DELETE FROM angles WHERE knowledge_id = ?').run(knowledgeId);
    for (const row of items) insert.run(row);
  });
  run(rows);
  return listAngles(knowledgeId);
}

export function listAngles(knowledgeId) {
  return db
    .prepare('SELECT * FROM angles WHERE knowledge_id = ? ORDER BY id ASC')
    .all(knowledgeId)
    .map((row) => ({
      ...row,
      facts: row.facts ? JSON.parse(row.facts) : [],
      formats: row.formats ? JSON.parse(row.formats) : [],
    }));
}

export function getAngle(id) {
  const row = db.prepare('SELECT * FROM angles WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    facts: row.facts ? JSON.parse(row.facts) : [],
    formats: row.formats ? JSON.parse(row.formats) : [],
  };
}

export function deleteAngle(id) {
  db.prepare('DELETE FROM angles WHERE id = ?').run(id);
}

export function saveRedditAccount({ username, password, client_id, client_secret }) {
  db.prepare('DELETE FROM reddit_accounts').run();
  db.prepare('INSERT INTO reddit_accounts (username, password, client_id, client_secret) VALUES (?, ?, ?, ?)').run(
    username,
    password,
    client_id,
    client_secret
  );
  return getRedditAccount();
}