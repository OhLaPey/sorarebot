/**
 * Scraper marché secondaire - Listings joueurs et clubs
 */
const { createPage } = require('./browser');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapePlayerListings(browser, playerSlug, rarity) {
  const page = await createPage(browser);
  const searchName = playerSlug.replace(/-/g, '+');

  const rarityMap = {
    'super_rare': 'super_rare',
    'rare': 'rare',
    'unique': 'unique',
    'limited': 'limited',
  };
  const sorareRarity = rarityMap[rarity] || rarity;

  const url = 'https://sorarescore.com/player-stats?gameweek=0&sort_column=price&sort_direction=asc&rarity=' + sorareRarity + '&price_type=current_sale&search=' + searchName;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);
    await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
    await sleep(2000);

    const result = await page.evaluate(() => {
      const prices = [];
      const players = [];
      const rows = document.querySelectorAll('tr');

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 6) return;

        let priceCell = null;
        let playerName = '';

        const firstCell = cells[0];
        if (firstCell) {
          playerName = (firstCell.textContent || '').toLowerCase().trim();
        }

        cells.forEach(cell => {
          const text = cell.textContent || '';
          if (text.includes('\u20AC') && !text.includes('N/A')) {
            const match = text.match(/(\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{1,2})?)\s*\u20AC/);
            if (match) {
              const priceStr = match[1].replace(/[\s,]/g, '').replace(',', '.');
              const price = parseFloat(priceStr);
              if (price > 0 && price < 100000) {
                priceCell = price;
              }
            }
          }
        });

        if (priceCell !== null) {
          prices.push(priceCell);
          players.push(playerName);
        }
      });

      return { prices, players, rowCount: rows.length };
    });

    await page.close();

    if (result.prices.length > 0) {
      const sortedPrices = [...result.prices].sort((a, b) => a - b);
      console.log('  SorareScore: ' + sortedPrices.slice(0, 5).map(p => p.toFixed(0) + '\u20AC').join(', '));

      return sortedPrices.map((price, i) => ({
        slug: playerSlug + '-' + rarity + '-' + i,
        price,
        playerName: result.players[i] || playerSlug,
        url: 'https://sorare.com/fr/football/players/' + playerSlug,
      }));
    }

    console.log('  SorareScore: pas de prix (rows: ' + result.rowCount + ')');
    return [];

  } catch (error) {
    console.log('  SorareScore erreur: ' + error.message.substring(0, 50));
    try { await page.close(); } catch (e) {}
    return [];
  }
}

async function scrapeClubListings(browser, clubSlug, rarity) {
  const page = await createPage(browser);

  const clubName = clubSlug.replace('-', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('+');
  const url = 'https://sorare.com/fr/football/market/shop/manager-sales?rarity=' + rarity + '&club=' + clubName + '%7C' + clubSlug;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('a[href*="/cards/"]', { timeout: 10000 }).catch(() => {});

    const listings = await page.evaluate(() => {
      const cards = [];

      document.querySelectorAll('a[href*="/cards/"]').forEach(el => {
        const href = el.getAttribute('href');
        if (!href || !href.includes('/cards/')) return;

        const cardSlug = href.split('/cards/')[1]?.split('?')[0];
        if (!cardSlug) return;

        const text = el.textContent || '';
        const priceMatch = text.match(/(\d+[\s,.]?\d*)\s*[E$\u20AC]/i);

        let price = null;
        if (priceMatch) {
          price = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.'));
        }

        const playerNameEl = el.querySelector('[class*="player"], [class*="Player"], [class*="name"], [class*="Name"]');
        const playerName = playerNameEl?.textContent?.trim() || cardSlug.split('-').slice(0, -1).join(' ');

        if (cardSlug && !cards.find(c => c.slug === cardSlug)) {
          cards.push({
            slug: cardSlug,
            playerName,
            price,
            url: 'https://sorare.com' + href,
          });
        }
      });

      return cards;
    });

    await page.close();
    return listings;

  } catch (error) {
    console.error('Erreur scraping club ' + clubSlug + ':', error.message);
    try { await page.close(); } catch (e) {}
    return [];
  }
}

async function scrapeSalesHistory(browser, playerSlug, rarity) {
  const page = await createPage(browser);

  const searchName = playerSlug.replace(/-/g, '+');
  const rarityMap = { 'super_rare': 'super_rare', 'rare': 'rare', 'unique': 'unique', 'limited': 'limited' };
  const sorareRarity = rarityMap[rarity] || rarity;

  // Utiliser SorareScore pour l'historique des ventes
  const url = 'https://sorarescore.com/player-stats?gameweek=0&sort_column=price&sort_direction=asc&rarity=' + sorareRarity + '&price_type=last_sale&search=' + searchName;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
    await sleep(2000);

    const result = await page.evaluate(() => {
      const sales = [];
      const rows = document.querySelectorAll('tr');

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) return;

        let price = null;
        let playerName = '';
        let saleDate = null;

        const firstCell = cells[0];
        if (firstCell) {
          playerName = (firstCell.textContent || '').trim();
        }

        cells.forEach(cell => {
          const text = cell.textContent || '';

          // Extraire le prix
          if (text.includes('\u20AC') && !text.includes('N/A')) {
            const match = text.match(/(\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{1,2})?)\s*\u20AC/);
            if (match) {
              const priceStr = match[1].replace(/[\s,]/g, '').replace(',', '.');
              const p = parseFloat(priceStr);
              if (p > 0 && p < 100000) {
                price = p;
              }
            }
          }

          // Extraire la date
          const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
          if (dateMatch) {
            saleDate = dateMatch[1];
          }
        });

        if (price !== null) {
          sales.push({ playerName, price, saleDate: saleDate || new Date().toISOString().split('T')[0], type: 'secondary' });
        }
      });

      return sales;
    });

    await page.close();
    console.log('  Ventes SorareScore: ' + result.length + ' trouvees');
    return result;

  } catch (error) {
    console.log('  SorareScore ventes erreur: ' + error.message.substring(0, 50));
    try { await page.close(); } catch (e) {}
    return [];
  }
}

module.exports = { scrapePlayerListings, scrapeClubListings, scrapeSalesHistory };
