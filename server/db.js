import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_idea TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('x', 'reddit')),
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reddit_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration for databases created before image support
const hasImagePath = db.pragma("table_info(posts)").some((c) => c.name === 'image_path');
if (!hasImagePath) {
  db.exec('ALTER TABLE posts ADD COLUMN image_path TEXT');
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
  const allowed = ['platform', 'format', 'subreddit', 'title', 'body', 'status', 'scheduled_at', 'posted_at', 'result_url', 'error', 'image_path'];
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