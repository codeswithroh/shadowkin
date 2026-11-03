import { join } from 'node:path';
export default async function run({ page, frame, workspaceRoot }) {
  const t = frame ?? page;
  const out = (n) => join(workspaceRoot, 'scripts', 'out', n);
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await t.evaluate(() => location.reload());
  await page.waitForTimeout(3500);
  const box = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  await page.mouse.move(box.width * 0.45, box.height * 0.35);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out('land-hero.png') });
  const ids = ['how', 'kin', 'daily', 'play'];
  for (const id of ids) {
    await t.evaluate((id) => document.getElementById(id).scrollIntoView({ behavior: 'instant' }), id);
    await page.waitForTimeout(1300);
    if (id === 'kin') { const c = await t.locator('.kin-card').nth(4).boundingBox(); await page.mouse.move(c.x + c.width/2, c.y + 100); await page.waitForTimeout(1000); }
    if (id === 'play') { const c = await t.locator('#playground').boundingBox(); await page.mouse.move(c.x + c.width/2, c.y + c.height/2); await page.waitForTimeout(1200); }
    await page.screenshot({ path: out(`land-${id}.png`) });
  }
  const info = await t.evaluate(() => ({ w: innerWidth, sw: document.getElementById('landing').scrollWidth, h: document.getElementById('landing').scrollHeight }));
  return { logs, info };
}
