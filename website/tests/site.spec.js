import {test,expect} from '@playwright/test';
for (const lang of ['zh','en']) {
  for (const width of [320,390,768,1440]) {
    test(`${lang} layout and content at ${width}px`,async({page})=>{
      const errors=[];const requests=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
      await page.setViewportSize({width,height:900});
      await page.goto(lang==='en'?'./en/':'./');
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('link[rel=stylesheet]')).toHaveAttribute('href',/style\.[a-f0-9]{12}\.css$/);
      await expect(page.locator('script[src]')).toHaveAttribute('src',/app\.[a-f0-9]{12}\.js$/);
      await expect(page.locator('html')).toHaveAttribute('lang',lang==='en'?'en':'zh-CN');
      const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,inner:innerWidth}));
      if(dimensions.scroll>dimensions.inner) console.log('overflow',await page.locator('body *').evaluateAll(nodes=>nodes.map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).filter(e=>e.right>innerWidth+1)));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.inner);
      await expect.poll(()=>page.locator('.hero-screen img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
      for (const tab of await page.getByRole('tab').all()) {
        await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');
        await expect(page.getByRole('tabpanel')).toBeVisible();
        await page.getByRole('tabpanel').locator('img').scrollIntoViewIfNeeded();
        await expect.poll(()=>page.getByRole('tabpanel').locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
      }
      await page.getByRole('tab').first().click();
      await page.locator('h1').scrollIntoViewIfNeeded();
      if(width===390||width===1440) await page.screenshot({path:`test-results/${lang}-${width}-full.png`,fullPage:true});
      expect(errors).toEqual([]);
      expect(requests.filter(u=>!u.startsWith('http://127.0.0.1:8787/'))).toEqual([]);
    });
  }
}
test('keyboard tabs, image dialog, repeat use, and language navigation',async({page})=>{
  await page.goto('./');
  const first=page.getByRole('tab').first();await first.focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab').nth(1)).toBeFocused();await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('End');await expect(page.getByRole('tab').last()).toBeFocused();
  await page.keyboard.press('Home');await expect(first).toBeFocused();
  for(let i=0;i<2;i++){
    const opener=page.getByRole('tabpanel').locator('[data-zoom]');await opener.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const close=page.locator('.dialog-close');
    const dialogRect=await page.getByRole('dialog').boundingBox();
    const closeRect=await close.boundingBox();
    expect(closeRect.y).toBeGreaterThanOrEqual(dialogRect.y);
    await expect(close).toBeInViewport();
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(opener).toBeFocused();
  }
  await page.locator('.language').click();await expect(page).toHaveURL(/\/ArcFlow\/en\/$/);
  await page.goBack();await expect(page).toHaveURL(/\/ArcFlow\/$/);
  await page.goForward();await expect(page.locator('html')).toHaveAttribute('lang','en');
});
test('reduced motion and no-JavaScript baseline',async({browser})=>{
  const context=await browser.newContext({reducedMotion:'reduce'});const page=await context.newPage();await page.goto('http://127.0.0.1:8787/ArcFlow/');
  expect(await page.locator('.floating-label').first().evaluate(e=>getComputedStyle(e).animationName)).toBe('none');await context.close();
  const noJS=await browser.newContext({javaScriptEnabled:false});const fallback=await noJS.newPage();await fallback.goto('http://127.0.0.1:8787/ArcFlow/');
  await expect(fallback.locator('h1')).toBeVisible();await expect(fallback.locator('.scenario-panel')).toHaveCount(4);
  for(const panel of await fallback.locator('.scenario-panel').all()) await expect(panel).toBeVisible();await noJS.close();
});
