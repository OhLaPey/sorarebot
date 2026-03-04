/**
 * Scraper marché primaire - Enchères Sorare
 */
const { createPage } = require('./browser');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeAuctions(browser, rarity) {
  const page = await createPage(browser);

  const rarityParam = rarity || 'super_rare';
  const url = 'https://sorare.com/fr/football/market/shop/new-cards?rarity=' + rarityParam;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(5000);

    // Attendre que les cartes chargent
    await page.waitForSelector('a[href*="/cards/"]', { timeout: 15000 }).catch(() => {});
    await sleep(3000);

    const auctions = await page.evaluate(() => {
      const results = [];

      document.querySelectorAll('a[href*="/cards/"]').forEach(el => {
        const href = el.getAttribute('href');
        if (!href || !href.includes('/cards/')) return;

        const cardSlug = href.split('/cards/')[1]?.split('?')[0];
        if (!cardSlug) return;

        const text = el.textContent || '';

        // Extraire le prix/bid actuel
        let currentBid = null;
        const priceMatch = text.match(/(\d+[\s,.]?\d*)\s*(?:E|\u20AC|ETH)/i);
        if (priceMatch) {
          currentBid = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.'));
        }

        // Extraire le nombre de bids
        let nbBids = 0;
        const bidsMatch = text.match(/(\d+)\s*(?:bid|enchere|offre)/i);
        if (bidsMatch) {
          nbBids = parseInt(bidsMatch[1]);
        }

        // Extraire le temps restant
        let endTime = null;
        const timeMatch = text.match(/(\d+)\s*(?:h|min|s)/i);
        if (timeMatch) {
          const value = parseInt(timeMatch[1]);
          const unit = timeMatch[0].replace(/\d+\s*/, '').toLowerCase();
          const now = Date.now();
          if (unit.startsWith('h')) {
            endTime = new Date(now + value * 3600000).toISOString();
          } else if (unit.startsWith('min')) {
            endTime = new Date(now + value * 60000).toISOString();
          } else {
            endTime = new Date(now + value * 1000).toISOString();
          }
        }

        // Extraire le nom du joueur
        const nameEl = el.querySelector('[class*="player"], [class*="Player"], [class*="name"], [class*="Name"]');
        const playerName = nameEl?.textContent?.trim() || '';

        // Extraire le slug du joueur depuis le card slug
        const parts = cardSlug.split('-');
        const playerSlug = parts.length > 2 ? parts.slice(0, -2).join('-') : parts.join('-');

        if (cardSlug && !results.find(r => r.cardSlug === cardSlug)) {
          results.push({
            cardSlug,
            playerName: playerName || playerSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            playerSlug,
            currentBid,
            nbBids,
            endTime,
            url: 'https://sorare.com' + href,
          });
        }
      });

      return results;
    });

    await page.close();
    console.log('  Encheres ' + rarityParam + ': ' + auctions.length + ' trouvees');
    return auctions;

  } catch (error) {
    console.error('Erreur scraping encheres:', error.message);
    try { await page.close(); } catch (e) {}
    return [];
  }
}

async function scrapeAuctionDetails(browser, auctionUrl) {
  const page = await createPage(browser);

  try {
    await page.goto(auctionUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(4000);

    const details = await page.evaluate(() => {
      const text = document.body.textContent || '';
      const result = {};

      // Prix actuel
      const priceMatch = text.match(/(\d+[\s,.]?\d*)\s*(?:E|\u20AC)/i);
      if (priceMatch) {
        result.currentBid = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.'));
      }

      // Nombre de bids
      const bidsMatch = text.match(/(\d+)\s*(?:bid|enchere|offre)/i);
      if (bidsMatch) {
        result.nbBids = parseInt(bidsMatch[1]);
      }

      // Historique de prix de la carte
      const historyPrices = [];
      const allPrices = text.match(/(\d+[\s,.]?\d*)\s*(?:E|\u20AC)/gi);
      if (allPrices) {
        allPrices.forEach(p => {
          const val = parseFloat(p.replace(/[^\d.]/g, ''));
          if (val > 0 && val < 100000) historyPrices.push(val);
        });
      }
      result.historicPrices = historyPrices;

      return result;
    });

    await page.close();
    return details;

  } catch (error) {
    console.error('Erreur details enchere:', error.message);
    try { await page.close(); } catch (e) {}
    return null;
  }
}

module.exports = { scrapeAuctions, scrapeAuctionDetails };
