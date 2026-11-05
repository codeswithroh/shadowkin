// Close look at the live shadow in the desktop preview, one shot per shape
// with an empty wall. Run with: npx @iwsdk/cli browser run scripts/hand-shots.mjs
import { join } from 'node:path';

export default async function run({ page, frame, workspaceRoot }) {
  const target = frame ?? page;
  const shot = (name) => page.screenshot({ path: join(workspaceRoot, 'scripts', 'out', name) });
  await target.evaluate(() => location.reload());
  // Let the old page go first, or the wait below passes on it.
  await page.waitForTimeout(2500);
  await target.waitForFunction(() => window.__shadowkin?.state, null, { timeout: 20000 });
  await target.evaluate(() => window.__shadowkin.wipe());
  const box = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  await target.locator('#desktop').click();
  await page.mouse.move(box.width * 0.42, box.height * 0.42);
  // The tutorial asks for Starfish, so every other shape can be held without being born.
  for (const [key, name] of [['0', 'open'], ['2', 'rabbit'], ['3', 'crab'], ['5', 'wolf'], ['4', 'stag'], ['6', 'butterfly']]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(500);
    await shot(`hand-${name}.png`);
  }
  return target.evaluate(() => window.__shadowkin.state().creatures);
}
