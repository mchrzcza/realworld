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

test('shows the follow control for a profile with articles', async ({ page }) => {
  const author = await register(page);
  const title = `Profile article ${Date.now()}`;

  await page.goto('/editor');
  await page.fill('input[name="title"]', title);
  await page.fill('input[name="description"]', 'An article for the profile');
  await page.fill('textarea[name="body"]', 'Profile article content.');
  await Promise.all([
    page.waitForURL(/\/article\/.+/),
    page.click('button:has-text("Publish Article")'),
  ]);

  await page.goto('/settings');
  await page.click('button:has-text("logout")');
  const viewer = await register(page);
  await page.goto(`/profile/${author.username}`);

  await expect(page.locator('.user-info')).toContainText('1 article');
  await expect(page.getByRole('button', { name: `Follow ${author.username}` })).toBeVisible();
  await expect(page.locator(`nav a[href="/profile/${viewer.username}"]`)).toBeVisible();
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
