import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

const databasePath = process.env.CONDUIT_DB_PATH ?? './data/conduit.sqlite';
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath, { create: true });
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    bio TEXT,
    image TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (follower_id, followed_id)
  );
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS article_tags (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (article_id, tag)
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, article_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS articles_created_at_idx ON articles(created_at DESC);
  CREATE INDEX IF NOT EXISTS comments_article_id_idx ON comments(article_id, created_at);
`);

export async function initializeDatabase(): Promise<void> {
  const users = ['johndoe', 'janedoe'];
  const sampleArticles = users.map((username, index) => ({
    slug: `${username}-welcome-to-conduit`,
    timestamp: new Date(Date.now() - (users.length - index) * 24 * 60 * 60 * 1000).toISOString(),
  }));
  const existing = db.query('SELECT id FROM users WHERE username = ?').get('johndoe') as { id: number } | null;
  if (existing) {
    const seededArticles = db.query(
      'SELECT slug, created_at FROM articles WHERE slug IN (?, ?)',
    ).all(...sampleArticles.map(article => article.slug)) as { slug: string; created_at: string }[];
    if (seededArticles.length === sampleArticles.length && seededArticles.every(article => article.created_at === seededArticles[0]?.created_at)) {
      const updateArticleTime = db.query('UPDATE articles SET created_at = ?, updated_at = ? WHERE slug = ?');
      for (const article of sampleArticles) {
        updateArticleTime.run(article.timestamp, article.timestamp, article.slug);
      }
    }
    return;
  }

  const seedPassword = await Bun.password.hash(crypto.randomUUID());
  const createUser = db.query('INSERT INTO users (username, email, password_hash, bio, image) VALUES (?, ?, ?, NULL, NULL)');
  const createArticle = db.query(
    'INSERT INTO articles (slug, title, description, body, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const createTag = db.query('INSERT INTO article_tags (article_id, tag, position) VALUES (?, ?, ?)');

  for (const [index, username] of users.entries()) {
    const sampleArticle = sampleArticles[index]!;
    const result = createUser.run(username, `${username}@example.test`, seedPassword);
    const articleId = createArticle.run(
      sampleArticle.slug,
      `Welcome to Conduit from ${username}`,
      'A sample article to explore the RealWorld application.',
      'Conduit is a community for sharing ideas. Follow authors, leave comments, and save articles you enjoy.',
      Number(result.lastInsertRowid),
      sampleArticle.timestamp,
      sampleArticle.timestamp,
    ).lastInsertRowid;
    createTag.run(Number(articleId), index === 0 ? 'welcome' : 'community', 0);
    createTag.run(Number(articleId), 'conduit', 1);
  }
}
