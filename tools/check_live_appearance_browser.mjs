/** Browser regression for semantic TV tags and actual theme/config modules.
 * Optional YTARK_LIVE_DOM / YTARK_FRONTEND_CSS accept locally captured public
 * frontend files. Captures are not shipped. No sign-in or account access.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=new URL('../work/appearance-live/',import.meta.url);
await mkdir(output,{recursive:true});
const bundle=fileURLToPath(new URL('theme.js',output));
execFileSync(process.execPath,[`${root}/TizenTube/mods/node_modules/rollup/dist/bin/rollup`,
 'tests/browser/live-theme-entry.js','--file',bundle,'--format','iife'],{cwd:`${root}/TizenTube/mods`,stdio:'pipe'});
const {chromium}=process.env.PLAYWRIGHT_MODULE_PATH?await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href):await import('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 let html=await readFile(process.env.YTARK_LIVE_DOM||new URL('../TizenTube/mods/tests/browser/semantic-tv.html',import.meta.url),'utf8');
 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<link\b[^>]*>/gi,'').replace(/<meta\b[^>]*http-equiv[^>]*>/gi,'');
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.abort());
 await page.goto('http://ytark-fixture.test');
 if(process.env.YTARK_FRONTEND_CSS)await page.addStyleTag({content:await readFile(process.env.YTARK_FRONTEND_CSS,'utf8')});
 await page.addScriptTag({content:await readFile(bundle,'utf8')});
 const read=()=>page.evaluate(()=>{
  const css=s=>getComputedStyle(document.querySelector(s));
  return {background:css('#container').backgroundColor,guide:css('ytlr-guide-response').backgroundColor,
   search:css('ytlr-text-box').backgroundColor,stage:css('yt-unified-overlay-stage').backgroundColor,
   browse:css('ytlr-tv-browse-renderer').backgroundColor,status:window.ytarkAppearanceTest.themeStatus()};
 });
 const before=await read();assert.equal(before.background,'rgb(15, 15, 15)');
 await page.screenshot({path:fileURLToPath(new URL('off.png',output))});
 // Native frontend setting commands may carry string booleans.
 await page.evaluate(()=>window.ytarkAppearanceTest.configWrite('oledBlack','true'));
 await page.waitForTimeout(60);const oled=await read();
 assert.equal(oled.background,'rgb(0, 0, 0)');assert.equal(oled.stage,'rgba(0, 0, 0, 0)');
 assert.notEqual(oled.browse,'rgb(241, 241, 241)','ancestor focus classes never paint an entire page white');
 await page.evaluate(()=>window.ytarkAppearanceTest.configWrite('liquidGlass',true));
 await page.waitForTimeout(60);const glass=await read();
 assert.equal(glass.guide,'rgba(24, 28, 36, 0.9)');assert.equal(glass.search,'rgba(24, 28, 36, 0.9)');
 assert.equal(glass.stage,'rgba(0, 0, 0, 0)');
 await page.screenshot({path:fileURLToPath(new URL('on.png',output))});
 const managed=glass.status.live.managedNodes;
 await page.evaluate(()=>{
  for(let i=0;i<20;i++){const node=document.querySelector('ytlr-guide-response');const clone=node.cloneNode(true);node.replaceWith(clone);}
 });
 await page.waitForTimeout(80);assert.ok((await read()).status.live.managedNodes<=managed);
 await page.evaluate(()=>{window.ytarkAppearanceTest.configWrite('oledBlack',false);window.ytarkAppearanceTest.configWrite('liquidGlass',false);});
 await page.waitForTimeout(60);const restored=await read();
 assert.equal(restored.background,before.background);assert.equal(restored.search,before.search);
 assert.equal(restored.guide,before.guide);assert.equal(restored.status.live.managedNodes,0);
 console.log('PASS: semantic TV tags, obfuscated classes, native setting normalization, true-black background, visible glass, transparent fullscreen stages, bounded route replacement and opt-out restoration.');
}finally{await browser.close();}
