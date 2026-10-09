import { describe, expect, test } from 'bun:test';
import { app, ready } from '../src/server';

await ready;

let suffix = 0;

async function register(username?: string) {
  suffix += 1;
  const name = username ?? `api-user-${suffix}`;
  const response = await app.request('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: { username: name, email: `${name}@example.test`, password: 'password123' } }),
  });
  return { response, body: await response.json() as { user: { username: string; token: string } } };
}

function authenticated(token: string, method = 'GET', body?: unknown): RequestInit {
  return {
    method,
    headers: { Authorization: `Token ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

describe('RealWorld API', () => {
  test('validates registration and rejects duplicate identities', async () => {
    const invalid = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: { username: '', email: 'blank@example.test', password: 'password123' } }),
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ errors: { username: ["can't be blank"] } });

    const created = await register();
    expect(created.response.status).toBe(201);
    expect(created.body.user.token).toBeTruthy();

    const duplicate = await app.request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: { username: created.body.user.username, email: 'other@example.test', password: 'password123' },
      }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ errors: { username: ['has already been taken'] } });
  });

  test('persists article edits, favorites and comments with ownership checks', async () => {
    const owner = await register();
    const reader = await register();
    const articleResponse = await app.request('/api/articles', authenticated(owner.body.user.token, 'POST', {
      article: { title: 'API Test Article', description: 'Test summary', body: 'Original body', tagList: ['one', 'two'] },
    }));
    expect(articleResponse.status).toBe(201);
    const created = (await articleResponse.json() as { article: { slug: string; tagList: string[] } }).article;
    expect(created.tagList).toEqual(['one', 'two']);

    const summaryResponse = await app.request('/api/articles?limit=1');
    const summary = (await summaryResponse.json() as { articles: Record<string, unknown>[] }).articles[0]!;
    expect(summary.body).toBeUndefined();

    const updatedResponse = await app.request(`/api/articles/${created.slug}`, authenticated(owner.body.user.token, 'PUT', {
      article: { body: 'Changed body' },
    }));
    const updated = (await updatedResponse.json() as { article: { body: string; tagList: string[]; updatedAt: string } }).article;
    expect(updated.body).toBe('Changed body');
    expect(updated.tagList).toEqual(['one', 'two']);

    const forbidden = await app.request(`/api/articles/${created.slug}`, authenticated(reader.body.user.token, 'PUT', {
      article: { body: 'Not allowed' },
    }));
    expect(forbidden.status).toBe(403);

    const favorite = await app.request(`/api/articles/${created.slug}/favorite`, authenticated(reader.body.user.token, 'POST'));
    expect((await favorite.json() as { article: { favorited: boolean; favoritesCount: number } }).article)
      .toMatchObject({ favorited: true, favoritesCount: 1 });

    const commentResponse = await app.request(`/api/articles/${created.slug}/comments`, authenticated(reader.body.user.token, 'POST', {
      comment: { body: 'A comment' },
    }));
    expect(commentResponse.status).toBe(201);
    const comment = (await commentResponse.json() as { comment: { id: number; body: string } }).comment;
    expect(comment.body).toBe('A comment');

    const cannotDelete = await app.request(`/api/articles/${created.slug}/comments/${comment.id}`, authenticated(owner.body.user.token, 'DELETE'));
    expect(cannotDelete.status).toBe(403);
  });

  test('requires authentication for protected endpoints and returns empty followed feeds', async () => {
    const unauthorized = await app.request('/api/articles/feed');
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ errors: { token: ['is missing'] } });

    const user = await register();
    const feedResponse = await app.request('/api/articles/feed', authenticated(user.body.user.token));
    expect(await feedResponse.json()).toEqual({ articles: [], articlesCount: 0 });
  });
});
