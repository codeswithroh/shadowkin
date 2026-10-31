import { join } from 'node:path';
export default async function run({ page, frame, workspaceRoot }) {
  const t = frame ?? page;
  await page.mouse.click(400, 360);
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(workspaceRoot, 'scripts', 'out', 'inspect.png') });
  return t.evaluate(() => window.__shadowkin.shapes());
}
