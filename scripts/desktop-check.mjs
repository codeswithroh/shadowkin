// Desktop smoke test for the full loop. Run with:
//   npx @iwsdk/cli browser run scripts/desktop-check.mjs
// Starts from a fresh save, goes through the landing page, makes the tutorial
// shape, today's shadow and every unlock in turn (including the two-hand
// butterfly), checks creatures react, then reloads to check they persist.
// Screenshots land in scripts/out/.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ORDER = ['starfish', 'rabbit', 'crab', 'stag', 'wolf', 'butterfly'];

export default async function run({ page, frame, workspaceRoot }) {
  const target = frame ?? page;
  const outDir = join(workspaceRoot, 'scripts', 'out');
  mkdirSync(outDir, { recursive: true });
  const state = () => target.evaluate(() => window.__shadowkin.state());
  const shot = (name) => page.screenshot({ path: join(outDir, name) });
  const report = { steps: [] };
  const ready = () => target.waitForFunction(() => window.__shadowkin?.state, null, { timeout: 20000 });

  // Fresh start.
  await ready();
  await target.evaluate(() => window.__shadowkin.wipe());
  await page.waitForTimeout(500);
  await shot('0-landing.png');

  report.selfTest = await target.evaluate(() => window.__shadowkin.selfTest());

  const box = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  await target.locator('#desktop').click();
  await page.mouse.move(box.width * 0.5, box.height * 0.45);
  await page.waitForTimeout(400);

  await page.keyboard.press('0');
  await page.waitForTimeout(700);
  report.openHand = await state();
  await shot('1-open-hand.png');

  // Match whatever is asked, eight times: tutorial, daily, unlocks, free play.
  for (let i = 0; i < 8; i++) {
    const s = await state();
    await page.keyboard.press(String(ORDER.indexOf(s.target) + 1));
    await page.mouse.move(box.width * (0.35 + (i % 3) * 0.15), box.height * 0.45);
    await page.waitForTimeout(600);
    const mid = await state();
    if (i < 3) await shot(`2-matching-${i}-${s.target}.png`);
    await page.waitForTimeout(1900);
    const after = await state();
    report.steps.push({ asked: s.target, daily: s.daily, isNew: s.isNew, scoreMid: mid.score, creatures: after.creatures, banner: mid.banner || after.banner });
  }
  await shot('3-menagerie.png');

  // Sweep the shadow fast across the wall: kin should scatter.
  await page.keyboard.press('1');
  for (let k = 0; k < 6; k++) {
    await page.mouse.move(box.width * (0.2 + (k % 2) * 0.6), box.height * 0.45, { steps: 3 });
    await page.waitForTimeout(90);
  }
  report.afterSweep = await state();

  // Wolf shadow: everyone but wolves runs.
  await page.keyboard.press(String(ORDER.indexOf('wolf') + 1));
  await page.mouse.move(box.width * 0.5, box.height * 0.45);
  await page.waitForTimeout(900);
  report.wolf = await state();
  await shot('4-wolf.png');

  // Persistence: reload and the kin are still there.
  report.saved = (await target.evaluate(() => window.__shadowkin.save())).creatures.length;
  await target.evaluate(() => location.reload());
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const ok = await target.evaluate(() => !!window.__shadowkin?.state).catch(() => false);
    if (ok) break;
  }
  await target.locator('#desktop').click();
  await page.waitForTimeout(800);
  report.afterReload = await state();
  await shot('5-after-reload.png');
  return report;
}
