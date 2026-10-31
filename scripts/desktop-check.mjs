// Desktop smoke test for the shadow loop. Run with:
//   npx @iwsdk/cli browser run scripts/desktop-check.mjs
// Moves the simulated hand, switches poses, and reports matcher scores and
// creature spawns, plus a screenshot per step in scripts/out/.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export default async function run({ page, frame, workspaceRoot }) {
  const target = frame ?? page;
  const outDir = join(workspaceRoot, 'scripts', 'out');
  mkdirSync(outDir, { recursive: true });
  const state = () => target.evaluate(() => window.__shadowkin.state());
  const report = {};

  report.selfTest = await target.evaluate(() => window.__shadowkin.selfTest());

  const box = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  await page.mouse.move(box.width * 0.5, box.height * 0.45);
  // The app lives in an iframe; click once so key presses reach it.
  await page.mouse.click(box.width * 0.5, box.height * 0.45);

  // Wrong pose first (open hand vs. whatever target is up), then the right one.
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  report.openHand = await state();
  await page.screenshot({ path: join(outDir, '1-open-hand.png') });

  const first = report.openHand.target;
  const order = ['starfish', 'rabbit', 'stag', 'crab'];
  await page.keyboard.press(String(order.indexOf(first) + 1));
  await page.waitForTimeout(500);
  report.matching = await state();
  await page.screenshot({ path: join(outDir, '2-matching.png') });
  await page.waitForTimeout(1200);
  report.afterHold = await state();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, '3-creature.png') });

  // Match every remaining target in turn.
  for (let i = 0; i < 3; i++) {
    const s = await state();
    await page.keyboard.press(String(order.indexOf(s.target) + 1));
    await page.mouse.move(box.width * (0.3 + i * 0.2), box.height * 0.45);
    await page.waitForTimeout(2600);
  }
  report.final = await state();
  await page.screenshot({ path: join(outDir, '4-all.png') });
  return report;
}
