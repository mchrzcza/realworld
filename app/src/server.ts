import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { db, initializeDatabase } from './db';

type UserRow = {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  bio: string | null;
  image: string | null;
};

type ArticleRow = {
  id: number;
  slug: string;
  title: string;
  description: string;
  body: string;
  author_id: number;
  created_at: string;
  updated_at: string;
};

type AuthenticatedContext = Context;
type JsonRecord = Record<string, unknown>;

const ready = initializeDatabase();
const app = new Hono();

app.use('/api/*', cors({ origin: '*' }));
app.use('*', async (context, next) => {
  await ready;
  await next();
});

function error(context: Context, status: 401 | 403 | 404 | 409 | 422, field: string, message: string) {
  return context.json({ errors: { [field]: [message] } }, status);
}

function validation(context: Context, field: string, message = "can't be blank") {
  return error(context, 422, field, message);
}

async function requestObject(context: Context): Promise<JsonRecord | Response> {
  try {
    const body: unknown = await context.req.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as JsonRecord : error(context, 422, 'request', 'is malformed');
  } catch {
    return error(context, 422, 'request', 'is malformed');
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return value;
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function findUserByToken(token: string): UserRow | null {
  return db.query(`
    SELECT users.id, users.username, users.email, users.password_hash, users.bio, users.image
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `).get(tokenDigest(token)) as UserRow | null;
}

function optionalUser(context: AuthenticatedContext): UserRow | null {
  const authorization = context.req.header('Authorization');
  if (!authorization) return null;
  const token = authorization.match(/^Token\s+(.+)$/i)?.[1];
  const user = token ? findUserByToken(token) : null;
  if (!user) throw new ApiError(401, 'credentials', 'invalid');
  return user;
}

function requiredUser(context: AuthenticatedContext): UserRow | Response {
  const authorization = context.req.header('Authorization');
  if (!authorization) return error(context, 401, 'token', 'is missing');
  const token = authorization.match(/^Token\s+(.+)$/i)?.[1];
  const user = token ? findUserByToken(token) : null;
  if (!user) return error(context, 401, 'credentials', 'invalid');
  return user;
}

class ApiError extends Error {
  constructor(readonly status: 401 | 403 | 404 | 409 | 422, readonly field: string, message: string) {
    super(message);
  }
}

function profile(user: UserRow, viewerId: number | null) {
  return {
    username: user.username,
    bio: user.bio,
    image: user.image,
    following: viewerId !== null && Boolean(db.query(
      'SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?',
    ).get(viewerId, user.id)),
  };
}

function issueToken(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  db.query('INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)').run(tokenDigest(token), userId);
  return token;
}

function userResponse(user: UserRow, token: string) {
  return {
    username: user.username,
    email: user.email,
    bio: user.bio,
    image: user.image,
    token,
  };
}

function articleRow(slug: string): ArticleRow | null {
  return db.query('SELECT * FROM articles WHERE slug = ?').get(slug) as ArticleRow | null;
}

function articleTags(articleId: number): string[] {
  return (db.query('SELECT tag FROM article_tags WHERE article_id = ? ORDER BY position').all(articleId) as { tag: string }[])
    .map(({ tag }) => tag);
}

function serializeArticle(row: ArticleRow, viewerId: number | null, includeBody: boolean) {
  const author = db.query(
    'SELECT id, username, email, password_hash, bio, image FROM users WHERE id = ?',
  ).get(row.author_id) as UserRow;
  const article: JsonRecord = {
    slug: row.slug,
    title: row.title,
    description: row.description,
    tagList: articleTags(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    favorited: viewerId !== null && Boolean(db.query('SELECT 1 FROM favorites WHERE user_id = ? AND article_id = ?').get(viewerId, row.id)),
    favoritesCount: Number((db.query('SELECT COUNT(*) AS count FROM favorites WHERE article_id = ?').get(row.id) as { count: number }).count),
    author: profile(author, viewerId),
  };
  if (includeBody) article.body = row.body;
  return article;
}

function articleSlug(title: string): string {
  const base = title.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'article';
  let slug = base;
  let suffix = 2;
  while (db.query('SELECT 1 FROM articles WHERE slug = ?').get(slug)) slug = `${base}-${suffix++}`;
  return slug;
}

function replaceTags(articleId: number, tags: string[]) {
  db.query('DELETE FROM article_tags WHERE article_id = ?').run(articleId);
  const insert = db.query('INSERT INTO article_tags (article_id, tag, position) VALUES (?, ?, ?)');
  const unique = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  unique.forEach((tag, position) => insert.run(articleId, tag, position));
}

function parsePagination(context: Context) {
  const limitValue = Number(context.req.query('limit') ?? 10);
  const offsetValue = Number(context.req.query('offset') ?? 0);
  return {
    limit: Number.isInteger(limitValue) && limitValue >= 0 ? Math.min(limitValue, 100) : 10,
    offset: Number.isInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0,
  };
}

function listArticles(context: AuthenticatedContext, { feed = false, profileUsername }: { feed?: boolean; profileUsername?: string } = {}) {
  const user = optionalUser(context);
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  const joins = ['JOIN users author ON author.id = articles.author_id'];

  if (feed && user) {
    conditions.push('articles.author_id IN (SELECT followed_id FROM follows WHERE follower_id = ?)');
    values.push(user.id);
  }
  if (profileUsername) {
    conditions.push('articles.author_id = (SELECT id FROM users WHERE username = ? COLLATE NOCASE)');
    values.push(profileUsername);
  }
  const tag = context.req.query('tag');
  if (tag) {
    joins.push('JOIN article_tags filter_tag ON filter_tag.article_id = articles.id');
    conditions.push('filter_tag.tag = ?');
    values.push(tag);
  }
  const author = context.req.query('author');
  if (author) {
    conditions.push('author.username = ? COLLATE NOCASE');
    values.push(author);
  }
  const favorited = context.req.query('favorited');
  if (favorited) {
    conditions.push('articles.id IN (SELECT f.article_id FROM favorites f JOIN users u ON u.id = f.user_id WHERE u.username = ? COLLATE NOCASE)');
    values.push(favorited);
  }
  if (context.req.query('favoritedBy')) {
    conditions.push('articles.id IN (SELECT f.article_id FROM favorites f WHERE f.user_id = ?)');
    values.push(Number(context.req.query('favoritedBy')));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(DISTINCT articles.id) AS count FROM articles ${joins.join(' ')} ${where}`;
  const total = Number((db.query(countSql).get(...values) as { count: number }).count);
  const { limit, offset } = parsePagination(context);
  const rows = db.query(`
    SELECT DISTINCT articles.* FROM articles ${joins.join(' ')} ${where}
    ORDER BY articles.created_at DESC, articles.id DESC LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as ArticleRow[];
  const viewerId = user?.id ?? null;
  return {
    articles: rows.map(row => serializeArticle(row, viewerId, false)),
    articlesCount: total,
  };
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function createUserErrors(context: Context, user: JsonRecord | null) {
  if (!user) return validation(context, 'user', 'is invalid');
  for (const field of ['username', 'email', 'password']) {
    if (!nonEmptyString(user[field])) return validation(context, field);
  }
  return null;
}

app.get('/health', context => context.json({ status: 'ok' }));

app.post('/api/users', async context => {
  const body = await requestObject(context);
  if (isResponse(body)) return body;
  const user = asRecord(body.user);
  const invalid = createUserErrors(context, user);
  if (invalid) return invalid;
  const username = user!.username as string;
  const email = user!.email as string;
  const password = user!.password as string;
  if (db.query('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    return error(context, 409, 'username', 'has already been taken');
  }
  if (db.query('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
    return error(context, 409, 'email', 'has already been taken');
  }
  const passwordHash = await Bun.password.hash(password);
  const inserted = db.query('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)').run(username, email, passwordHash);
  const userRow = db.query('SELECT * FROM users WHERE id = ?').get(Number(inserted.lastInsertRowid)) as UserRow;
  const token = issueToken(userRow.id);
  return context.json({ user: userResponse(userRow, token) }, 201);
});

app.post('/api/users/login', async context => {
  const body = await requestObject(context);
  if (isResponse(body)) return body;
  const user = asRecord(body.user);
  if (!user) return validation(context, 'user', 'is invalid');
  if (!nonEmptyString(user.email)) return validation(context, 'email');
  if (!nonEmptyString(user.password)) return validation(context, 'password');
  const row = db.query('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(user.email) as UserRow | null;
  if (!row || !(await Bun.password.verify(user.password as string, row.password_hash))) {
    return error(context, 401, 'credentials', 'invalid');
  }
  return context.json({ user: userResponse(row, issueToken(row.id)) });
});

app.get('/api/user', context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const token = context.req.header('Authorization')!.replace(/^Token\s+/i, '');
  return context.json({ user: userResponse(authenticated, token) });
});

app.put('/api/user', async context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const body = await requestObject(context);
  if (isResponse(body)) return body;
  const update = asRecord(body.user);
  if (!update) return validation(context, 'user', 'is invalid');
  for (const field of ['username', 'email']) {
    if (field in update && !nonEmptyString(update[field])) return validation(context, field);
  }
  if ('password' in update && (!nonEmptyString(update.password) || update.password.length < 8)) {
    return validation(context, 'password', 'is too short (minimum is 8 characters)');
  }
  if ('bio' in update && update.bio !== null && typeof update.bio !== 'string') return validation(context, 'bio', 'is invalid');
  if ('image' in update && update.image !== null && typeof update.image !== 'string') return validation(context, 'image', 'is invalid');

  const username = typeof update.username === 'string' ? update.username : authenticated.username;
  const email = typeof update.email === 'string' ? update.email : authenticated.email;
  const usernameCollision = db.query('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, authenticated.id);
  if (usernameCollision) return error(context, 409, 'username', 'has already been taken');
  const emailCollision = db.query('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email, authenticated.id);
  if (emailCollision) return error(context, 409, 'email', 'has already been taken');

  const fields: string[] = ['username = ?', 'email = ?'];
  const values: (string | number | null)[] = [username as string, email as string];
  if ('bio' in update) {
    fields.push('bio = ?');
    values.push(normalizeNullableText(update.bio as string | null));
  }
  if ('image' in update) {
    fields.push('image = ?');
    values.push(normalizeNullableText(update.image as string | null));
  }
  if ('password' in update) {
    fields.push('password_hash = ?');
    values.push(await Bun.password.hash(update.password as string));
  }
  values.push(authenticated.id);
  db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.query('SELECT * FROM users WHERE id = ?').get(authenticated.id) as UserRow;
  const token = context.req.header('Authorization')!.replace(/^Token\s+/i, '');
  return context.json({ user: userResponse(updated, token) });
});

app.get('/api/profiles/:username', context => {
  const viewer = optionalUser(context);
  const user = db.query('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(context.req.param('username')) as UserRow | null;
  if (!user) return error(context, 404, 'profile', 'not found');
  return context.json({ profile: profile(user, viewer?.id ?? null) });
});

app.post('/api/profiles/:username/follow', context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const target = db.query('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(context.req.param('username')) as UserRow | null;
  if (!target) return error(context, 404, 'profile', 'not found');
  if (target.id === authenticated.id) return error(context, 422, 'profile', 'cannot follow yourself');
  db.query('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)').run(authenticated.id, target.id);
  return context.json({ profile: profile(target, authenticated.id) });
});

app.delete('/api/profiles/:username/follow', context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const target = db.query('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(context.req.param('username')) as UserRow | null;
  if (!target) return error(context, 404, 'profile', 'not found');
  db.query('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(authenticated.id, target.id);
  return context.json({ profile: profile(target, authenticated.id) });
});

app.get('/api/articles/feed', context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  return context.json(listArticles(context, { feed: true }));
});

app.get('/api/articles', context => context.json(listArticles(context)));

app.post('/api/articles', async context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const body = await requestObject(context);
  if (isResponse(body)) return body;
  const article = asRecord(body.article);
  if (!article) return validation(context, 'article', 'is invalid');
  for (const field of ['title', 'description', 'body']) {
    if (!nonEmptyString(article[field])) return validation(context, field);
  }
  if ('tagList' in article && (!Array.isArray(article.tagList) || article.tagList.some(tag => typeof tag !== 'string'))) {
    return validation(context, 'tagList', 'is invalid');
  }
  const timestamp = new Date().toISOString();
  const inserted = db.query(`
    INSERT INTO articles (slug, title, description, body, author_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(articleSlug(article.title as string), article.title as string, article.description as string, article.body as string, authenticated.id, timestamp, timestamp);
  const articleId = Number(inserted.lastInsertRowid);
  if (Array.isArray(article.tagList)) replaceTags(articleId, article.tagList as string[]);
  const row = db.query('SELECT * FROM articles WHERE id = ?').get(articleId) as ArticleRow;
  return context.json({ article: serializeArticle(row, authenticated.id, true) }, 201);
});

app.get('/api/articles/:slug', context => {
  const viewer = optionalUser(context);
  const article = articleRow(context.req.param('slug') ?? '');
  if (!article) return error(context, 404, 'article', 'not found');
  return context.json({ article: serializeArticle(article, viewer?.id ?? null, true) });
});

app.put('/api/articles/:slug', async context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const article = articleRow(context.req.param('slug'));
  if (!article) return error(context, 404, 'article', 'not found');
  if (article.author_id !== authenticated.id) return error(context, 403, 'article', 'forbidden');
  const body = await requestObject(context);
  if (isResponse(body)) return body;
  const update = asRecord(body.article);
  if (!update) return validation(context, 'article', 'is invalid');
  for (const field of ['title', 'description', 'body']) {
    if (field in update && !nonEmptyString(update[field])) return validation(context, field);
  }
  if ('tagList' in update && (!Array.isArray(update.tagList) || update.tagList.some(tag => typeof tag !== 'string'))) {
    return validation(context, 'tagList', 'is invalid');
  }
  const title = (update.title as string | undefined) ?? article.title;
  const timestamp = new Date(Math.max(Date.now(), Date.parse(article.updated_at) + 1)).toISOString();
  db.query(`
    UPDATE articles SET title = ?, description = ?, body = ?, updated_at = ? WHERE id = ?
  `).run(title, (update.description as string | undefined) ?? article.description, (update.body as string | undefined) ?? article.body, timestamp, article.id);
  if (Array.isArray(update.tagList)) replaceTags(article.id, update.tagList as string[]);
  const updated = db.query('SELECT * FROM articles WHERE id = ?').get(article.id) as ArticleRow;
  return context.json({ article: serializeArticle(updated, authenticated.id, true) });
});

app.delete('/api/articles/:slug', context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const article = articleRow(context.req.param('slug'));
  if (!article) return error(context, 404, 'article', 'not found');
  if (article.author_id !== authenticated.id) return error(context, 403, 'article', 'forbidden');
  db.query('DELETE FROM articles WHERE id = ?').run(article.id);
  return context.body(null, 204);
});

app.get('/api/articles/:slug/comments', context => {
  const viewer = optionalUser(context);
  const article = articleRow(context.req.param('slug'));
  if (!article) return error(context, 404, 'article', 'not found');
  const comments = db.query('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at, id').all(article.id) as {
    id: number; body: string; author_id: number; created_at: string; updated_at: string;
  }[];
  return context.json({
    comments: comments.map(comment => {
      const author = db.query('SELECT * FROM users WHERE id = ?').get(comment.author_id) as UserRow;
      return { id: comment.id, body: comment.body, createdAt: comment.created_at, updatedAt: comment.updated_at, author: profile(author, viewer?.id ?? null) };
    }),
  });
});

app.post('/api/articles/:slug/comments', async context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const article = articleRow(context.req.param('slug'));
  if (!article) return error(context, 404, 'article', 'not found');
  const body = await requestObject(context);
  if (isResponse(body)) return body;
  const comment = asRecord(body.comment);
  if (!comment || !nonEmptyString(comment.body)) return validation(context, 'body');
  const timestamp = new Date().toISOString();
  const inserted = db.query(`
    INSERT INTO comments (body, article_id, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `).run(comment.body as string, article.id, authenticated.id, timestamp, timestamp);
  return context.json({
    comment: {
      id: Number(inserted.lastInsertRowid),
      body: comment.body,
      createdAt: timestamp,
      updatedAt: timestamp,
      author: profile(authenticated, authenticated.id),
    },
  }, 201);
});

app.delete('/api/articles/:slug/comments/:id', context => {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const article = articleRow(context.req.param('slug'));
  if (!article) return error(context, 404, 'article', 'not found');
  const comment = db.query('SELECT * FROM comments WHERE id = ? AND article_id = ?')
    .get(Number(context.req.param('id')), article.id) as { id: number; author_id: number } | null;
  if (!comment) return error(context, 404, 'comment', 'not found');
  if (comment.author_id !== authenticated.id) return error(context, 403, 'comment', 'forbidden');
  db.query('DELETE FROM comments WHERE id = ?').run(comment.id);
  return context.body(null, 204);
});

app.post('/api/articles/:slug/favorite', context => favorite(context, true));
app.delete('/api/articles/:slug/favorite', context => favorite(context, false));

function favorite(context: Context, add: boolean) {
  const authenticated = requiredUser(context);
  if (isResponse(authenticated)) return authenticated;
  const article = articleRow(context.req.param('slug') ?? '');
  if (!article) return error(context, 404, 'article', 'not found');
  if (add) {
    db.query('INSERT OR IGNORE INTO favorites (user_id, article_id) VALUES (?, ?)').run(authenticated.id, article.id);
  } else {
    db.query('DELETE FROM favorites WHERE user_id = ? AND article_id = ?').run(authenticated.id, article.id);
  }
  return context.json({ article: serializeArticle(article, authenticated.id, true) });
}

app.get('/api/tags', context => {
  const tags = db.query('SELECT DISTINCT tag FROM article_tags ORDER BY tag COLLATE NOCASE').all() as { tag: string }[];
  return context.json({ tags: tags.map(({ tag }) => tag) });
});

app.notFound(context => context.json({ errors: { request: ['not found'] } }, 404));
app.onError((caught, context) => {
  if (caught instanceof ApiError) return error(context, caught.status, caught.field, caught.message);
  console.error('Unhandled API error:', caught);
  return context.json({ errors: { server: ['Internal server error'] } }, 500);
});

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8000);
  const staticPath = new URL('../dist/', import.meta.url).pathname;
  Bun.serve({
    port,
    fetch: async request => {
      const url = new URL(request.url);
      if (url.pathname === '/default-avatar.svg') {
        return new Response(Bun.file(new URL('../../assets/media/default-avatar.svg', import.meta.url)));
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/health') return app.fetch(request);
      if (process.env.NODE_ENV === 'production') {
        const requestedPath = resolve(staticPath, `.${url.pathname}`);
        if (requestedPath.startsWith(staticPath) && existsSync(requestedPath) && statSync(requestedPath).isFile()) {
          return new Response(Bun.file(requestedPath));
        }
        return new Response(Bun.file(`${staticPath}/index.html`), { headers: { 'Content-Type': 'text/html' } });
      }
      return app.fetch(request);
    },
  });
  console.log(`Conduit API listening on http://localhost:${port}`);
}

export { app, ready };
