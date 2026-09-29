/**
 * End-to-end: for each robot, load the app, start the obstacle course from the home screen, walk
 * forward with the keyboard and check the robot really moved forward without falling. Along the way
 * it saves screenshots of every screen to test-results/screenshots/ and logs how fast the physics
 * ran (simulated seconds per wall-clock second) in this browser.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { LessonId } from '../../src/lessons/types';

const SHOTS = 'test-results/screenshots';
const DRIVE_MS = 6000;
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__app?.ready === true, null, { timeout: 120_000 });
}

async function robotState(page: Page) {
  return page.evaluate(() => {
    const s = window.__sim!.getState();
    return { x: s.position[0], y: s.position[1], heading: s.heading, fallen: s.fallen, time: s.time };
  });
}

async function openLesson(page: Page, id: LessonId): Promise<void> {
  await page.evaluate((lesson) => window.__app!.startLesson(lesson), id);
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'lesson');
}

for (const robot of ['g1', 'go2'] as const) {
  test(`${robot}: walks forward through the start of the obstacle course`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(`page error: ${err.message}`));

    const t0 = Date.now();
    await page.goto('/');
    await waitReady(page);
    const card = page.locator(`[data-robot="${robot}"]`);
    if ((await card.getAttribute('aria-checked')) !== 'true') {
      // Switch robots from the keyboard: the arrow keys move the radio selection and focus follows it,
      // even though the cards are re-rendered when the new robot has loaded.
      await page.locator('[data-robot][aria-checked="true"]').focus();
      await page.keyboard.press('ArrowRight');
      await expect(card).toHaveAttribute('aria-checked', 'true');
      await waitReady(page);
      await expect(card).toBeFocused();
    }
    const loadS = (Date.now() - t0) / 1000;
    await expect(page.locator('.home')).toBeVisible();
    await page.waitForTimeout(1000);
    await shot(page, `${robot}-home`);

    // Start the obstacle course the way a student would.
    await page.locator('[data-lesson="course"]').click();
    await expect(page.locator('#app')).toHaveAttribute('data-screen', 'lesson');
    await expect(page.locator('.hud')).toBeVisible();
    // The rules card comes first; the clock starts on Start.
    await expect(page.locator('.lesson-card h2')).toHaveText('Obstacle course');
    await shot(page, `${robot}-course-rules`);
    await page.locator('.lesson-card [data-action="go"]').click();
    await expect(page.locator('.lesson-card')).toBeHidden();
    await page.waitForTimeout(1500);
    const start = await robotState(page);
    expect(start.fallen).toBe(false);

    await page.evaluate(() => window.__app!.resetStats());
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(DRIVE_MS / 2);
    await shot(page, `${robot}-course`);
    await page.waitForTimeout(DRIVE_MS / 2);
    await page.keyboard.up('KeyW');
    const stats = await page.evaluate(() => window.__app!.stats());
    await page.waitForTimeout(500);
    const end = await robotState(page);

    const forward = (end.x - start.x) * Math.cos(start.heading) + (end.y - start.y) * Math.sin(start.heading);
    const rate = stats.simSeconds / stats.wallSeconds;
    const fps = stats.frames / stats.wallSeconds;
    const summary =
      `${robot}: loaded in ${loadS.toFixed(1)} s; walked ${forward.toFixed(2)} m forward in ${stats.simSeconds.toFixed(2)} ` +
      `simulated s over ${stats.wallSeconds.toFixed(2)} wall s = ${rate.toFixed(2)} sim-s per wall-s ` +
      `(${fps.toFixed(1)} fps, graphics quality level ${stats.quality})`;
    console.log(summary);
    testInfo.annotations.push({ type: 'performance', description: summary });

    expect(end.fallen).toBe(false);
    expect(forward).toBeGreaterThan(0.5);
    const view = await page.evaluate(() => window.__app!.lessonView());
    expect(view?.status).toContain('Falls: 0');

    // Tablet sizes: nothing may spill off the side of the screen.
    for (const [w, h] of [
      [1024, 768],
      [820, 1180],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow at ${w}x${h}`).toBeLessThanOrEqual(0);
      await shot(page, `${robot}-course-${w}x${h}`);
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    // The other lessons.
    await openLesson(page, 'meet');
    await page.locator('.lesson-card [data-action="next"]').click();
    await page.waitForTimeout(1000);
    await shot(page, `${robot}-meet`);

    await openLesson(page, 'push');
    await page.locator('.lesson-card [data-action="begin"]').click();
    await page.waitForTimeout(1500);
    await expect(page.locator('.lesson-card')).toBeHidden();
    await shot(page, `${robot}-push`);

    await openLesson(page, 'lab');
    await expect(page.locator('.lab')).toBeVisible();
    // Sliders work from the keyboard: 14 steps of 0.05 take friction from 1.0 to 0.3.
    await page.locator('#knob-friction').focus();
    for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#knob-friction')).toHaveValue('0.3');
    expect(await page.evaluate(() => window.__sim!.knobs.friction)).toBeCloseTo(0.3);
    await page.waitForTimeout(1000);
    await shot(page, `${robot}-lab`);
    await page.getByRole('button', { name: 'Finish lab & see stars' }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, `${robot}-result`);
    await page.getByRole('button', { name: 'All lessons' }).click();
    await expect(page.locator('#app')).toHaveAttribute('data-screen', 'home');

    if (robot === 'g1') {
      await openLesson(page, 'course');
      await page.keyboard.press('KeyX');
      await expect(page.locator('dialog[open]')).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, 'explain');
      await page.keyboard.press('Escape');
      await page.keyboard.press('KeyH');
      await expect(page.locator('dialog[open]')).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, 'help');
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
    }

    expect(errors, errors.join('\n')).toEqual([]);
  });
}
