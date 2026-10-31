import { join } from 'node:path';
export default async function run({ page, frame, workspaceRoot }) {
  const t = frame ?? page;
  await page.waitForTimeout(300);
  return t.evaluate(() => ({ state: window.__shadowkin.state(), hands: window.__shadowkin.shapes().hands }));
}
