import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
import {runFixtureAcceptance} from './studio-staging-synthetic-auth.mjs';

const origin = 'https://branchline-staging.github.io';
const backend = 'https://rlfdvmiqkbitetatxkju.supabase.co';
const title = 'Browser staging frame ' + randomBytes(6).toString('hex');

async function openFrame(browser, account) {
  const context = await browser.newContext({serviceWorkers:'block'});
  // The disposable password is entered only on the exact isolated site.
  await context.route('**/*', route => {
    const destination = new URL(route.request().url());
    return [origin, backend].includes(destination.origin) ||
      ['about:', 'blob:', 'data:'].includes(destination.protocol)
      ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin + '/?acceptance=' + randomBytes(6).toString('hex'));
  assert.equal(new URL(page.url()).origin, origin);
  await page.locator('[name=branchCode]').fill('STG001');
  await page.locator('[name=username]').fill(account.email.split('@')[0]);
  await page.locator('[name=password]').fill(account.password);
  await page.getByRole('button',{name:'Sign in to staging'}).click();
  await page.getByText('Signed in to staging. Choose a Studio.').waitFor();
  await page.getByRole('button',{name:'Open MegaFrame'}).click();
  await page.waitForURL(url => url.origin === origin && url.pathname === '/megaframe-studio/studio/');
  const editor = page.frameLocator('#mount iframe');
  await editor.locator('#startupChoiceDialog[open]').waitFor({timeout:45000});
  return {context,page,editor};
}

await runFixtureAcceptance({
  ...process.env,
  STUDIO_STAGING_ISSUER_ORIGIN: origin
}, createClient, async account => {
  const browser = await chromium.launch();
  try {
    const first = await openFrame(browser, account);
    await first.editor.getByRole('button',{name:/Create New Project/}).click();
    const dataUrl = await first.page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#2557dd';
      ctx.fillRect(0, 0, 64, 64);
      return canvas.toDataURL('image/png');
    });
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    await first.editor.locator('#photosInput').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
    await first.editor.locator('#photoCount').filter({hasText:/1 photo/i}).waitFor({state:'attached'});
    await first.editor.locator('#pinNav button[data-panel="0"]').click();
    await first.editor.locator('#saveProject').click();
    await first.editor.locator('#actionModalInput').fill(title);
    await first.editor.locator('#actionModalConfirm').click();
    await first.editor.locator('#projectSaveStatus').getByText(title,{exact:false}).waitFor();
    await first.page.locator('#cloudRefresh').click();
    await first.page.locator('#cloudLocalProject option').filter({hasText:title}).waitFor({state:'attached'});
    await first.page.locator('#cloudLocalProject').selectOption({label:title});
    await first.page.locator('#cloudBackup').click();
    await first.page.getByText(/Encrypted backup saved/).waitFor();
    console.log('PASS: actual staging browser saved the encrypted MegaFrame backup');
    await first.context.close();

    const other = await openFrame(browser, account);
    await other.page.locator('#cloudRefresh').click();
    assert.equal(await other.page.locator('#cloudLocalProject option').count(), 0,
      'Fresh browser context must have no local projects before restore');
    const remote = other.page.locator('#cloudRemoteProject');
    await remote.locator('option').filter({hasText:/./}).first().waitFor({state:'attached'});
    await remote.selectOption({index:0});
    await other.page.locator('#cloudRestore').click();
    await other.page.getByText(/Encrypted project retrieved/).waitFor();
    await other.editor.locator('#retrieveStartupProject').click();
    const card = other.editor.locator('#projectList .savedProjectCard').filter({hasText:title});
    await card.getByRole('button',{name:'Open',exact:true}).click();
    await other.editor.locator('#photoCount').filter({hasText:/1 photo/i}).waitFor({state:'attached'});
    console.log('PASS: restored the same named MegaFrame project and synthetic photo in a fresh browser context');
  } finally {
    await browser.close();
  }
});