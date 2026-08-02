import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/USER/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');

import { mkdirSync } from 'fs';
import path from 'path';

const BASE = 'http://localhost:3001';
const SHOTS = 'd:/betting/screenshots';
try { mkdirSync(SHOTS, { recursive: true }); } catch {}

const log = (msg) => console.log(`[verify] ${msg}`);

async function shot(page, name) {
  const p = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  log(`  Screenshot → ${name}.png`);
}

const browser = await chromium.launch({ headless: true });

// ── Helper: login ──────────────────────────────────────────────────────────────
async function doLogin(page, label = '') {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  // Wait for React to hydrate the form
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.fill('input[type="email"]', 'tawsifislam10@gmail.com');
  await page.fill('input[type="password"]', 'Admin@12345');
  await shot(page, `${label}login-filled`);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL(`${BASE}/lobby`, { timeout: 10000 });
    log(`  ${label}Login → /lobby ✅`);
    return true;
  } catch {
    const errEl = await page.locator('.text-red-400').first().textContent().catch(() => '');
    log(`  ${label}Login FAILED: "${errEl}"`);
    await shot(page, `${label}login-error`);
    return false;
  }
}

// ── 1. DESKTOP (1280×800) ─────────────────────────────────────────────────────
log('=== DESKTOP (1280×800) ===');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const deskErrs = [];
page.on('console', m => { if (m.type() === 'error') deskErrs.push(m.text()); });
page.on('pageerror', e => deskErrs.push(e.message));

// 1a. Login page
log('1. Login page');
await page.goto(`${BASE}/login`, { waitUntil: 'load' });
await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15000 });
await shot(page, '01-login');

const loginOk = await doLogin(page, 'desktop-');

// 1b. Lobby
log('2. Lobby');
await page.goto(`${BASE}/lobby`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await shot(page, '02-lobby-desktop');
const cardCount = await page.locator('button.group').count();
log(`  Game cards: ${cardCount}`);

// 1c. Click first game
if (cardCount > 0) {
  const gameName = await page.locator('button.group p.truncate').first().textContent().catch(() => '?');
  log(`  Clicking: "${gameName}"`);
  await page.locator('button.group').first().click();
  await page.waitForTimeout(3000);
  await shot(page, '03-game-loading');
  log(`  Game URL: ${page.url()}`);
  await page.goto(`${BASE}/lobby`, { waitUntil: 'load' });
}

// 1d. Wallet
log('3. Wallet');
await page.goto(`${BASE}/wallet`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await shot(page, '04-wallet-desktop');
const balance = await page.locator('p.text-4xl').first().textContent().catch(() => '—');
log(`  Balance shown: "${balance}"`);

// 1e. Profile
log('4. Profile');
await page.goto(`${BASE}/profile`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await shot(page, '05-profile-desktop');

// 1f. Admin
log('5. Admin');
await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
await page.waitForTimeout(2000);
const adminUrl = page.url();
await shot(page, '06-admin-dashboard');
log(`  Admin URL: ${adminUrl}`);

// Admin sub-pages
for (const sub of ['payments', 'games', 'users', 'audit', 'bonuses', 'reports']) {
  await page.goto(`${BASE}/admin/${sub}`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await shot(page, `07-admin-${sub}`);
  log(`  /admin/${sub} → ${page.url()}`);
}

if (deskErrs.length) {
  log(`Desktop console errors (${deskErrs.length}):`);
  deskErrs.slice(0, 10).forEach(e => log(`  ⚠️  ${e.slice(0, 150)}`));
} else {
  log('Desktop: no console errors ✅');
}
await ctx.close();

// ── 2. MOBILE (375×812) ───────────────────────────────────────────────────────
log('\n=== MOBILE (375×812) ===');
const mCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
const mPage = await mCtx.newPage();
const mobErrs = [];
mPage.on('console', m => { if (m.type() === 'error') mobErrs.push(m.text()); });
mPage.on('pageerror', e => mobErrs.push(e.message));

// Login
log('1. Mobile login');
await mPage.goto(`${BASE}/login`, { waitUntil: 'load' });
await mPage.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15000 });
await shot(mPage, '08-mobile-login');
await mPage.fill('input[type="email"]', 'tawsifislam10@gmail.com');
await mPage.fill('input[type="password"]', 'Admin@12345');
await mPage.click('button[type="submit"]');
try {
  await mPage.waitForURL(`${BASE}/lobby`, { timeout: 10000 });
  log('  Mobile login ✅');
} catch {
  log('  Mobile login FAILED');
}

// Mobile lobby — check layout
log('2. Mobile lobby');
await mPage.goto(`${BASE}/lobby`, { waitUntil: 'load' });
await mPage.waitForTimeout(1500);
await shot(mPage, '09-mobile-lobby');

const desktopSidebar = await mPage.locator('div.hidden.md\\:flex').isVisible().catch(() => false);
const mobileNav = await mPage.locator('nav.fixed.bottom-0').isVisible().catch(() => false);
log(`  Desktop sidebar hidden on mobile: ${!desktopSidebar} ${!desktopSidebar ? '✅' : '❌'}`);
log(`  MobileNav visible: ${mobileNav} ${mobileNav ? '✅' : '❌'}`);

const firstCard = await mPage.locator('button.group').first().boundingBox().catch(() => null);
if (firstCard) {
  const twoCol = firstCard.width > 140 && firstCard.width < 200;
  log(`  Card width: ${firstCard.width.toFixed(0)}px — 2-col grid: ${twoCol ? '✅' : '❌'}`);
}

// Category tabs overflow-x-auto
const tabs = await mPage.locator('div.overflow-x-auto button').count();
log(`  Category tabs: ${tabs}`);

// Mobile wallet — check stacking
log('3. Mobile wallet');
await mPage.goto(`${BASE}/wallet`, { waitUntil: 'load' });
await mPage.waitForTimeout(1500);
await shot(mPage, '10-mobile-wallet');

const depositCard = await mPage.locator('div.grid.gap-4 > div').first().boundingBox().catch(() => null);
if (depositCard) {
  const isFullWidth = depositCard.width > 300;
  log(`  Deposit card width: ${depositCard.width.toFixed(0)}px — stacked: ${isFullWidth ? '✅' : '❌'}`);
}

// Check transaction table scrollable
const tableWrap = await mPage.locator('div.overflow-x-auto').count();
log(`  overflow-x-auto wrappers: ${tableWrap} ${tableWrap > 0 ? '✅' : '⚠️'}`);

// Mobile admin — hamburger
log('4. Mobile admin');
await mPage.goto(`${BASE}/admin`, { waitUntil: 'load' });
await mPage.waitForTimeout(1500);
await shot(mPage, '11-mobile-admin');

const hamburger = mPage.locator('button[aria-label="Open menu"]');
const hamVisible = await hamburger.isVisible().catch(() => false);
log(`  Hamburger button: ${hamVisible ? '✅' : '❌'}`);

if (hamVisible) {
  await hamburger.click();
  await mPage.waitForTimeout(400);
  await shot(mPage, '12-mobile-admin-drawer-open');
  const sidebarOpen = await mPage.locator('div.translate-x-0').isVisible().catch(() => false);
  log(`  Drawer opens: ${sidebarOpen ? '✅' : '❌'}`);
  // Close
  await mPage.locator('.fixed.inset-0.z-30').click().catch(() => {});
  await mPage.waitForTimeout(300);
}

// Mobile game shell — check fullscreen overlay
log('5. Mobile game → full-screen overlay');
await mPage.goto(`${BASE}/lobby`, { waitUntil: 'load' });
await mPage.waitForTimeout(1000);
const mCards = await mPage.locator('button.group').count();
if (mCards > 0) {
  await mPage.locator('button.group').first().click();
  await mPage.waitForTimeout(2500);
  await shot(mPage, '13-mobile-game');
  // The game should be fixed inset-0 z-[60] overlaying MobileNav
  const gameOverlay = await mPage.locator('div.fixed.inset-0').count();
  log(`  Game fixed overlay divs: ${gameOverlay} ${gameOverlay > 0 ? '✅' : '❌'}`);
  const mNavDuringGame = await mPage.locator('nav.fixed.bottom-0').isVisible().catch(() => false);
  log(`  MobileNav covered by game overlay: ${!mNavDuringGame ? '✅' : '⚠️ nav still visible'}`);
}

if (mobErrs.length) {
  log(`\nMobile console errors (${mobErrs.length}):`);
  mobErrs.slice(0, 10).forEach(e => log(`  ⚠️  ${e.slice(0, 150)}`));
} else {
  log('\nMobile: no console errors ✅');
}

await mCtx.close();
await browser.close();

log('\n=== DONE ===');
log(`Screenshots saved to: ${SHOTS}`);
