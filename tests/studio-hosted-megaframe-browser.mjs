import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
import {runFixtureAcceptance} from './studio-staging-synthetic-auth.mjs';

const origin = 'https://branchline-staging.github.io';
const backend = 'https://rlfdvmiqkbitetatxkju.supabase.co';
const title = 'Browser staging frame ' + randomBytes(6).toString('hex');

async function openStudio(browser, account, studio = 'MegaFrame') {
  const context = await browser.newContext({serviceWorkers:'block'});
  // The disposable password is entered only on the exact isolated site.
  await context.route('**/*', route => {
    const destination = new URL(route.request().url());
    return [origin, backend].includes(destination.origin) ||
      ['about:', 'blob:', 'data:'].includes(destination.protocol)
      ? route.continue() : route.abort();
  });
  const sales = await context.newPage();
  await sales.goto(origin + '/sales-tracker/?acceptance=' + randomBytes(6).toString('hex'));
  await sales.getByRole('button',{name:'Open Sales Tracker demo'}).click();
  await sales.getByText('BRANCHLINE · DEMO DATA',{exact:true}).waitFor();
  await sales.locator('[data-live-page="apps"]').click();
  const frameLink = sales.getByRole('link',{name:/^Open MegaFrame Studio/});
  const flyerLink = sales.getByRole('link',{name:/^Open (?:Mega)?Flyer Studio/});
  const ptgLink = sales.getByRole('link',{name:/^Open Price Tag Generator/});
  for (const link of [frameLink, flyerLink, ptgLink]) {
    assert.equal(new URL(await link.getAttribute('href')).origin, origin);
  }
  const [page] = await Promise.all([
    sales.waitForEvent('popup'),
    (studio === 'MegaFrame' ? frameLink : flyerLink).click()
  ]);
  await page.waitForURL(url => url.origin === origin && url.pathname === '/');
  await page.locator('[name=branchCode]').fill('STG001');
  await page.locator('[name=username]').fill(account.email.split('@')[0]);
  await page.locator('[name=password]').fill(account.password);
  await page.getByRole('button',{name:'Sign in to staging'}).click();
  await page.getByText('Signed in to staging. Choose a Studio.').waitFor();
  await page.getByRole('button',{name:'Open '+studio}).click();
  const route = studio === 'MegaFrame' ? '/megaframe-studio/studio/' : '/flyer-studio/studio/';
  await page.waitForURL(url => url.origin === origin && url.pathname === route);
  const editor = page.frameLocator('#mount iframe');
  if (studio === 'MegaFrame') {
    await editor.locator('#startupChoiceDialog[open]').waitFor({timeout:45000});
  } else {
    await editor.getByText('Flyer Status: Draft',{exact:true}).waitFor({timeout:45000});
  }
  console.log('PASS: Sales Tracker sample workspace → staging PTG sign-in → ' + studio);
  return {context,page,editor};
}

async function downloadProject(page, card) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button',{name:'Backup',exact:true}).click()
  ]);
  const snapshot = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(snapshot.format, 'MegaFrameProjectV1');
  assert.equal(snapshot.payload.photos.length, 1);
  return snapshot.payload.photos[0].data;
}

await runFixtureAcceptance({
  ...process.env,
  STUDIO_STAGING_ISSUER_ORIGIN: origin
}, createClient, async account => {
  const browser = await chromium.launch();
  try {
    const flyer = await openStudio(browser, account, 'MegaFlyer');
    await flyer.context.close();
    const first = await openStudio(browser, account);
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
    await first.editor.locator('#openProjects').click();
    const sourceCard = first.editor.locator('#projectList .savedProjectCard').filter({hasText:title});
    const sourcePhoto = await downloadProject(first.page, sourceCard);
    assert.match(sourcePhoto, /^data:image\/png;base64,/);
    await first.editor.locator('#closeSavedProjects').click();
    await first.page.locator('#cloudRefresh').click();
    await first.page.locator('#cloudLocalProject option').filter({hasText:title}).waitFor({state:'attached'});
    await first.page.locator('#cloudLocalProject').selectOption({label:title});
    await first.page.locator('#cloudBackup').click();
    await first.page.getByText(/Encrypted backup saved/).waitFor();
    console.log('PASS: actual staging browser saved the encrypted MegaFrame backup');
    await first.context.close();

    const other = await openStudio(browser, account);
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
    assert.equal(await downloadProject(other.page, card), sourcePhoto,
      'Restored project must contain the identical synthetic image');
    await card.getByRole('button',{name:'Open',exact:true}).click();
    await other.editor.locator('#actionModalConfirm').click();
    await other.editor.locator('#savedProjectsDialog').waitFor({state:'hidden'});
    assert.match(await other.editor.locator('#photoCount').textContent(), /1 photo/i);
    console.log('PASS: restored the same named MegaFrame project and synthetic photo in a fresh browser context');
    await other.editor.locator('#pinNav button[data-panel="0"]').click();
    await other.editor.locator('#openFrameLibrary').click();
    await other.editor.locator('#frameLibGrid .frameLibCard').first()
      .getByRole('button',{name:'Open frame'}).click();
    await other.editor.locator('#frameLibrary').waitFor({state:'hidden'});
    await other.editor.locator('#pinNav button[data-panel="5"]').click();
    await other.editor.locator('#exportType').selectOption('image/png');
    const [exported] = await Promise.all([
      other.page.waitForEvent('download',{timeout:45000}),
      other.editor.locator('#downloadOne').click()
    ]);
    const pngOutput = await readFile(await exported.path());
    assert.equal(pngOutput.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    const width = pngOutput.readUInt32BE(16);
    const height = pngOutput.readUInt32BE(20);
    assert.ok(width >= 200 && height >= 200, 'Expected a usable PNG export');
    console.log(`PASS: actual staging MegaFrame exported the restored project as PNG (${width} × ${height})`);
  } finally {
    await browser.close();
  }
});