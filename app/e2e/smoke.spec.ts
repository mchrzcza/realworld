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

for (const articleCount of [0, 1]) {
  for (const following of [false, true]) {
    test(`shows ${following ? 'Unfollow' : 'Follow'} on another author's profile with ${articleCount} articles`, async ({ page, browser }) => {
      const authorPage = await browser.newPage();
      try {
        const author = await register(authorPage);
        const viewer = await register(page);
        expect(viewer.username).not.toBe(author.username);

        await page.goto(`/profile/${author.username}`);
        const profileInfo = page.locator('.user-info');
        await expect(profileInfo.locator('p').last()).toHaveText('0 articles');
        await expect(page.getByRole('link', { name: 'Edit Profile Settings' })).toHaveCount(0);
        const followButton = page.getByRole('button', { name: `Follow ${author.username}`, exact: true });
        await expect(followButton).toBeVisible();
        if (following) {
          await followButton.click();
          await expect(page.getByRole('button', { name: `Unfollow ${author.username}`, exact: true })).toBeVisible();
        }

        const title = `Profile count article ${author.username}`;
        if (articleCount === 1) {
          await authorPage.goto('/editor');
          await authorPage.fill('input[name="title"]', title);
          await authorPage.fill('input[name="description"]', 'Profile follow regression');
          await authorPage.fill('textarea[name="body"]', 'An article must not hide the profile follow control.');
          await Promise.all([
            authorPage.waitForURL(/\/article\/.+/),
            authorPage.click('button:has-text("Publish Article")'),
          ]);
          await expect(authorPage.locator('h1')).toHaveText(title);
        }

        await page.reload();
        await expect(profileInfo.locator('h4')).toHaveText(author.username);
        await expect(profileInfo.locator('p').last()).toHaveText(articleCount === 1 ? '1 article' : '0 articles');
        await expect(page.locator(`nav a[href="/profile/${viewer.username}"]`)).toBeVisible();
        await expect(page.getByRole('link', { name: 'Edit Profile Settings' })).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        if (articleCount === 1) {
          await expect(page.locator('.profile-articles .article-preview h1')).toHaveText(title);
        }
        await expect(page.getByRole('button', {
          name: `${following ? 'Unfollow' : 'Follow'} ${author.username}`,
          exact: true,
        })).toBeVisible();
      } finally {
        await authorPage.close();
      }
    });
  }
}
