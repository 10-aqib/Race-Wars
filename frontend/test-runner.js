import { chromium } from 'playwright';

(async () => {
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Navigate to the game with debug enabled
    await page.goto('http://localhost:5173/?debug=1');
    console.log('[TEST] Navigated to game.');

    // Wait for loading screen to disappear
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 30000 });
    console.log('[TEST] Home screen loaded.');
    
    // Test A - HOME
    await page.waitForTimeout(2000);
    const hasDebug = await page.locator('#debug-hud').count();
    if (hasDebug > 0) {
      let debugText = await page.locator('#debug-hud').innerText();
      console.log('[TEST A] Home debug HUD:\n', debugText);
    }
    
    // Click RACE
    await page.click('#nav-race');
    await page.waitForTimeout(500);
    
    // Click TIME RACE
    await page.click('#mode-time-race');
    console.log('[TEST] Clicked Time Race. Waiting for countdown...');

    // Wait for countdown to finish (3, 2, 1, GO -> ~4 seconds)
    await page.waitForTimeout(5000);
    
    // Read initial Z
    if (hasDebug > 0) {
      let debugText = await page.locator('#debug-hud').innerText();
      console.log('[TEST D] Race started debug HUD (Initial):\n', debugText);
    }

    // Hold W for 5 seconds
    console.log('[TEST D] Holding W...');
    await page.keyboard.down('w');
    await page.waitForTimeout(5000);
    await page.keyboard.up('w');
    
    // Read final Z
    if (hasDebug > 0) {
      let debugText = await page.locator('#debug-hud').innerText();
      console.log('[TEST D] After 5s W debug HUD (Final):\n', debugText);
    }
    
    await browser.close();
    console.log('[TEST] Finished.');
  } catch (err) {
    console.error('[TEST] Error:', err);
    process.exit(1);
  }
})();
