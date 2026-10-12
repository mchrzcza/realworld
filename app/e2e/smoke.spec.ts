import { expect, test } from '@playwright/test';

function uniqueUser() {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  return {
    username: `smoke${id}`,
    email: `smoke${id}@example.test`,
    password: 'password123',
  };
}

async function register(page: import('@playwright/test').Page) {
  const user = uniqueUser();
  await page.goto('/register');
  await page.fill('input[name="username"]', user.username);
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await Promise.all([
    page.waitForURL('/'),
    page.click('button[type="submit"]'),
  ]);
  await expect(page.locator(`nav a[href="/profile/${user.username}"]`)).toBeVisible();
  return user;
}

test('registers a user and restores the session after reload', async ({ page }) => {
  const user = await register(page);
  await page.reload();
  await expect(page.locator(`nav a[href="/profile/${user.username}"]`)).toBeVisible();
});

test('publishes an article and comment', async ({ page }) => {
  await register(page);
  const title = `Smoke article ${Date.now()}`;

  await page.goto('/editor');
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="description"]', 'A short smoke-test article');
  await page.fill('textarea[name="body"]', 'Article content for the smoke test.');
  await Promise.all([
    page.waitForURL(/\/article\/.+/),
    page.click('button:has-text("Publish Article")'),
  ]);
  await expect(page.locator('h1')).toHaveText(title);

  const comment = 'Smoke-test comment';
  await page.fill('textarea[placeholder="Write a comment..."]', comment);
  await page.click('button:has-text("Post Comment")');
  await expect(page.locator('.card:not(.comment-form) .card-block')).toContainText(comment);
});

test('updates the user bio in settings', async ({ page }) => {
  const user = await register(page);
  const bio = `Smoke-test bio ${Date.now()}`;

  await page.goto('/settings');
  await page.fill('textarea[name="bio"]', bio);
  await Promise.all([
    page.waitForURL(`/profile/${user.username}`),
    page.click('button:has-text("Update Settings")'),
  ]);
  await expect(page.locator('.user-info')).toContainText(bio);
});

test('can follow and unfollow another author with a published article', async ({ page, browser, baseURL }) => {
  const author = await register(page);
  const title = `Profile follow article ${Date.now()}`;
  await page.goto('/editor');
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="description"]', 'An article by the followed author');
  await page.fill('textarea[name="body"]', 'Published content for the profile follow regression.');
  await Promise.all([
    page.waitForURL(/\/article\/.+/),
    page.click('button:has-text("Publish Article")'),
  ]);
  await expect(page.locator('h1')).toHaveText(title);

  const viewerContext = await browser.newContext({ baseURL });
  try {
    const viewerPage = await viewerContext.newPage();
    const viewer = await register(viewerPage);
    expect(viewer.username).not.toBe(author.username);
    const profileResponsePromise = viewerPage.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/profiles/${author.username}`
      && response.request().method() === 'GET');
    await viewerPage.goto(`/profile/${author.username}`);
    const profileResponse = await profileResponsePromise;
    expect(profileResponse.status()).toBe(200);
    expect((await profileResponse.json()).profile.username).toBe(author.username);
    await expect(viewerPage.locator(`nav a[href="/profile/${viewer.username}"]`)).toBeVisible();

    const header = viewerPage.locator('.user-info');
    await expect(header.locator('h4')).toHaveText(author.username);
    await expect(header.locator('p').filter({ hasText: /^1 article$/ })).toBeVisible();
    await expect(viewerPage.locator('.article-preview h1')).toHaveText(title);
    const follow = header.getByRole('button', { name: `Follow ${author.username}`, exact: true });
    await expect(follow).toBeVisible();
    await follow.click();
    const unfollow = header.getByRole('button', { name: `Unfollow ${author.username}`, exact: true });
    await expect(unfollow).toBeVisible();
    await unfollow.click();
    await expect(follow).toBeVisible();
  } finally {
    await viewerContext.close();
  }
});
