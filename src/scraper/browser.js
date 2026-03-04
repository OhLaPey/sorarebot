/**
 * Browser factory pour Puppeteer avec support proxy
 */
const puppeteer = require('puppeteer');
const config = require('../config');

async function createBrowser() {
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  if (!executablePath) {
    const { execSync } = require('child_process');
    try {
      executablePath = execSync('which chromium || which chromium-browser || which google-chrome').toString().trim();
    } catch (e) {
      executablePath = undefined;
    }
  }

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
    ],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  if (config.NORDVPN_USER && config.NORDVPN_PASS) {
    launchOptions.args.push('--proxy-server=socks5://' + config.NORDVPN_SERVER + ':' + config.NORDVPN_PORT);
    console.log('Proxy NordVPN active: ' + config.NORDVPN_SERVER);
  }

  return await puppeteer.launch(launchOptions);
}

async function createPage(browser) {
  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1400, height: 900 });

  if (config.NORDVPN_USER && config.NORDVPN_PASS) {
    await page.authenticate({
      username: config.NORDVPN_USER,
      password: config.NORDVPN_PASS,
    });
  }

  return page;
}

module.exports = { createBrowser, createPage };
