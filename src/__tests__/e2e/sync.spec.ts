// src/__tests__/e2e/sync.spec.ts
// End-to-end tests for offline sync and collaboration.
// These tests simulate real user workflows using two browser contexts.

import { test, expect, chromium } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.describe("Offline Sync Flow", () => {
  test("User can edit while offline and sync on reconnect", async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as Alice
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', "alice@example.com");
    await page.fill('input[name="password"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // Create a new document
    await page.click('[data-testid="new-document-btn"]');
    await page.waitForURL(/\/editor\/.+/);

    // Type some content
    const editor = page.locator('[data-testid="editor-content"]');
    await editor.click();
    await page.keyboard.type("Hello, ");

    // Simulate going offline
    await context.setOffline(true);

    // Type more while offline
    await page.keyboard.type("offline world!");

    // Verify the offline indicator appears
    await expect(page.locator('[data-testid="connection-status"]')).toContainText(
      "Offline"
    );

    // Come back online
    await context.setOffline(false);

    // Wait for sync to complete
    await expect(page.locator('[data-testid="sync-status"]')).toContainText(
      "Synced",
      { timeout: 10_000 }
    );

    // Content should be preserved
    await expect(editor).toContainText("Hello, offline world!");

    await browser.close();
  });
});

test.describe("Real-time Collaboration", () => {
  test("Two users see each other's edits in real time", async () => {
    const browser = await chromium.launch();

    // Open two browser contexts (simulate two users)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Login both users
    const loginUser = async (page: typeof pageA, email: string, password: string) => {
      await page.goto(`${BASE_URL}/login`);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForURL(`${BASE_URL}/dashboard`);
    };

    await loginUser(pageA, "alice@example.com", "Password123!");
    await loginUser(pageB, "bob@example.com", "Password123!");

    // Alice creates a document
    await pageA.click('[data-testid="new-document-btn"]');
    await pageA.waitForURL(/\/editor\/.+/);
    const docUrl = pageA.url();

    // Bob navigates to the same document
    await pageB.goto(docUrl);
    await pageB.waitForURL(docUrl);

    // Alice types
    const editorA = pageA.locator('[data-testid="editor-content"]');
    await editorA.click();
    await pageA.keyboard.type("Alice was here");

    // Bob should see Alice's text
    const editorB = pageB.locator('[data-testid="editor-content"]');
    await expect(editorB).toContainText("Alice was here", { timeout: 5_000 });

    // Bob types a response
    await editorB.click();
    await pageB.keyboard.press("End");
    await pageB.keyboard.type(". Bob too!");

    // Alice should see Bob's addition
    await expect(editorA).toContainText("Bob too!", { timeout: 5_000 });

    await browser.close();
  });
});

test.describe("Version History", () => {
  test("User can create and restore a version", async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', "alice@example.com");
    await page.fill('input[name="password"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.click('[data-testid="new-document-btn"]');
    await page.waitForURL(/\/editor\/.+/);

    // Type initial content
    const editor = page.locator('[data-testid="editor-content"]');
    await editor.click();
    await page.keyboard.type("Version 1 content");

    // Create a snapshot
    await page.click('[data-testid="version-history-btn"]');
    await page.click('[data-testid="create-version-btn"]');
    await page.fill('[data-testid="version-label-input"]', "My first version");
    await page.click('[data-testid="confirm-version-btn"]');

    await expect(page.locator('[data-testid="version-list"]')).toContainText(
      "My first version"
    );

    // Modify the document
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Completely different content now");

    // Restore the version
    await page.click('[data-testid="restore-version-btn"]:first-child');
    await page.click('[data-testid="confirm-restore-btn"]');

    // Content should be restored
    await expect(editor).toContainText("Version 1 content", { timeout: 5_000 });

    await browser.close();
  });
});

test.describe("Role-based Access Control", () => {
  test("Viewer cannot edit document", async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as Carol (Viewer)
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', "carol@example.com");
    await page.fill('input[name="password"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // Open the shared document
    await page.click('[data-testid="document-item"]:first-child');
    await page.waitForURL(/\/editor\/.+/);

    // Editor should be read-only
    const editor = page.locator('[data-testid="editor-content"]');
    await expect(editor).toHaveAttribute("contenteditable", "false");

    // Viewer badge should be visible
    await expect(page.locator('[data-testid="role-badge"]')).toContainText("Viewer");

    await browser.close();
  });
});
