/**
 * ============================================================
 *     SORARE TRACKER PRO - PPATCH Edition v3.0
 *     Performances, Marche, Encheres, EV & Opportunites
 *     Persistance SQLite + Discord + Google Sheets
 * ============================================================
 */

const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes } = require('discord.js');
const config = require('./src/config');
const db = require('./src/db');
const sheets = require('./src/sheets');
const { createBrowser } = require('./src/scraper/browser');
const { scrapePlayerListings, scrapeClubListings, scrapeSalesHistory, scrapeMarketSearch } = require('./src/scraper/market');
const { scrapeAuctions } = require('./src/scraper/auctions');
const { detectSecondaryOpportunities, detectAuctionOpportunities } = require('./src/scraper/opportunities');
const { scrapeAllPlayerScores, scrapePlayerScoreHistory } = require('./src/scraper/scores');
const ev = require('./src/ev/calculator');
const discordCommands = require('./src/discord/commands');
const { createHandler } = require('./src/discord/handlers');
const { createRouter } = require('./src/server/routes');

// ============================================================
//                    STATE
// ============================================================

const seenListings = new Set();

const stats = {
  lastScan: null,
  lastAuctionScan: null,
  totalScans: 0,
  alertsSent: 0,
  errors: 0,
};

// ============================================================
//                    DISCORD BOT
// ============================================================

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

async function registerDiscordCommands() {
  if (!config.DISCORD_TOKEN || !config.DISCORD_CLIENT_ID) {
    console.log('Discord non configure (DISCORD_TOKEN ou DISCORD_CLIENT_ID manquant)');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

  try {
    console.log('Enregistrement des commandes Discord...');
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body: discordCommands });
    console.log('Commandes Discord enregistrees (' + discordCommands.length + ' commandes)');
  } catch (error) {
    console.error('Erreur enregistrement commandes:', error);
  }
}

async function sendDiscordAlert(embed) {
  if (!config.DISCORD_CHANNEL_ID) return;

  try {
    const channel = await discordClient.channels.fetch(config.DISCORD_CHANNEL_ID);
    if (channel) {
      await channel.send({ embeds: [embed] });
      stats.alertsSent++;
    }
  } catch (error) {
    console.error('Erreur envoi Discord:', error.message);
  }
}

// ============================================================
//                    SCAN MARCHE
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scanMarket() {
  console.log('=== SCAN MARCHE === ' + new Date().toLocaleTimeString('fr-FR'));
  stats.lastScan = new Date();
  stats.totalScans++;

  let browser;
  const now = new Date();
  const timestamp = now.toISOString();
  const sheetRows = [];

  try {
    browser = await createBrowser();
    const watchlist = db.getWatchlist();

    // Scan clubs
    for (const club of watchlist.clubs) {
      console.log('Club: ' + club.name + ' (' + club.rarity + ')');
      const listings = await scrapeClubListings(browser, club.slug, club.rarity);
      console.log('  -> ' + listings.length + ' listings');

      for (const listing of listings) {
        const listingId = 'club-' + listing.slug;
        if (seenListings.has(listingId)) continue;
        seenListings.add(listingId);

        const shouldAlert = !club.max_price || (listing.price && listing.price <= club.max_price);
        if (shouldAlert) {
          const embed = new EmbedBuilder()
            .setTitle(club.max_price ? 'ALERTE PRIX !' : 'NOUVEAU LISTING')
            .setDescription((listing.playerName || 'Carte') + ' - ' + club.name)
            .setColor(club.max_price ? 0x00FF00 : 0x7C3AED)
            .addFields(
              { name: 'Prix', value: listing.price ? listing.price + ' E' : 'N/A', inline: true },
              { name: 'Rarete', value: club.rarity.toUpperCase(), inline: true },
              { name: 'Club', value: club.name, inline: true },
            )
            .setURL(listing.url)
            .setTimestamp()
            .setFooter({ text: 'Sorare Tracker Pro' });

          if (club.max_price) {
            embed.addFields({ name: 'Ton seuil', value: club.max_price + ' E', inline: true });
          }

          await sendDiscordAlert(embed);
        }
      }

      await sleep(2000);
    }

    // Scan players
    for (const player of watchlist.players) {
      console.log('Joueur: ' + player.name + ' (' + player.rarity + ')');
      const listings = await scrapePlayerListings(browser, player.slug, player.rarity);
      console.log('  -> ' + listings.length + ' listings');

      const prices = listings.map(l => l.price).filter(p => p !== null);
      const sortedPrices = [...prices].sort((a, b) => a - b);
      const minPrice = prices.length > 0 ? Math.min(...prices) : null;
      const medianPrice = sortedPrices.length > 0 ? sortedPrices[Math.floor(sortedPrices.length / 2)] : null;
      const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

      // Save to SQLite
      if (listings.length > 0) {
        db.addPriceHistory(player.slug, player.rarity, minPrice, medianPrice, avgPrice, listings.length);
        sheetRows.push([timestamp, player.name, player.slug, player.rarity, minPrice, medianPrice, listings.length]);
      }

      // Check alerts
      for (const listing of listings) {
        const listingId = 'player-' + listing.slug;
        if (seenListings.has(listingId)) continue;
        seenListings.add(listingId);

        const shouldAlert = !player.max_price || (listing.price && listing.price <= player.max_price);
        if (shouldAlert) {
          const embed = new EmbedBuilder()
            .setTitle(player.max_price ? 'ALERTE PRIX !' : 'NOUVEAU LISTING')
            .setDescription(player.name)
            .setColor(player.max_price ? 0x00FF00 : 0x3B82F6)
            .addFields(
              { name: 'Prix', value: listing.price ? listing.price + ' E' : 'N/A', inline: true },
              { name: 'Rarete', value: player.rarity.toUpperCase(), inline: true },
            )
            .setURL(listing.url)
            .setTimestamp()
            .setFooter({ text: 'Sorare Tracker Pro' });

          if (player.max_price) {
            embed.addFields(
              { name: 'Ton seuil', value: player.max_price + ' E', inline: true },
              { name: 'Economie', value: (player.max_price - listing.price).toFixed(2) + ' E', inline: true },
            );
          }

          await sendDiscordAlert(embed);
        }
      }

      await sleep(2000);
    }

    // Write to Google Sheets
    if (sheets.isConnected() && sheetRows.length > 0) {
      await sheets.appendRows('Prix_Timeline', sheetRows);
    }

    // Detect opportunities
    const opps = detectSecondaryOpportunities();
    if (opps.length > 0) {
      console.log('  ' + opps.length + ' opportunites detectees');

      // Send Discord alert for new opportunities
      const unnotified = db.getUnnotifiedOpportunities();
      if (unnotified.length > 0) {
        const embed = new EmbedBuilder()
          .setTitle('Nouvelles Opportunites (' + unnotified.length + ')')
          .setColor(0x22C55E)
          .setDescription(unnotified.slice(0, 5).map(o => '**' + (o.player_name || o.slug) + '** - ' + o.details).join('\n\n'))
          .setTimestamp()
          .setFooter({ text: 'Sorare Tracker Pro' });

        await sendDiscordAlert(embed);
        db.markOpportunitiesNotified(unnotified.map(o => o.id));
      }
    }

    console.log('Scan termine. ' + seenListings.size + ' listings en memoire.');

  } catch (error) {
    console.error('Erreur scan:', error.message);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }
}

// ============================================================
//                    SCAN ENCHERES
// ============================================================

async function scanAuctions() {
  console.log('=== SCAN ENCHERES === ' + new Date().toLocaleTimeString('fr-FR'));
  stats.lastAuctionScan = new Date();

  let browser;
  const sheetRows = [];

  try {
    browser = await createBrowser();

    for (const rarity of ['super_rare', 'rare', 'unique']) {
      const auctions = await scrapeAuctions(browser, rarity);

      for (const auction of auctions) {
        db.upsertAuction({
          cardSlug: auction.cardSlug,
          playerName: auction.playerName,
          playerSlug: auction.playerSlug,
          rarity,
          currentBid: auction.currentBid,
          minBid: auction.currentBid,
          nbBids: auction.nbBids,
          endTime: auction.endTime,
          status: 'active',
          url: auction.url,
        });

        sheetRows.push([
          new Date().toLocaleDateString('fr-FR'),
          auction.playerName,
          auction.playerSlug,
          rarity,
          auction.currentBid,
          auction.nbBids,
          auction.endTime || '',
          'active',
        ]);
      }

      await sleep(3000);
    }

    // Write to Google Sheets
    if (sheets.isConnected() && sheetRows.length > 0) {
      await sheets.appendRows('Encheres', sheetRows);
    }

    // Detect auction opportunities
    const opps = detectAuctionOpportunities();
    if (opps.length > 0) {
      console.log('  ' + opps.length + ' opportunites encheres detectees');

      const unnotified = db.getUnnotifiedOpportunities();
      const auctionOpps = unnotified.filter(o => o.opportunity_type.startsWith('auction'));
      if (auctionOpps.length > 0) {
        const embed = new EmbedBuilder()
          .setTitle('Alertes Encheres (' + auctionOpps.length + ')')
          .setColor(0xEAB308)
          .setDescription(auctionOpps.slice(0, 5).map(o => '**' + (o.player_name || o.slug) + '** - ' + o.details).join('\n\n'))
          .setTimestamp()
          .setFooter({ text: 'Sorare Tracker Pro' });

        await sendDiscordAlert(embed);
        db.markOpportunitiesNotified(auctionOpps.map(o => o.id));
      }
    }

    console.log('Scan encheres termine.');

  } catch (error) {
    console.error('Erreur scan encheres:', error.message);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }
}

// ============================================================
//                    SCAN HISTORIQUE VENTES
// ============================================================

async function scanSalesHistory() {
  console.log('=== SCAN VENTES === ' + new Date().toLocaleTimeString('fr-FR'));

  let browser;
  const sheetRows = [];

  try {
    browser = await createBrowser();
    const watchlist = db.getWatchlist();

    for (const player of watchlist.players) {
      console.log('Historique: ' + player.name);
      const sales = await scrapeSalesHistory(browser, player.slug, player.rarity);
      console.log('  -> ' + sales.length + ' ventes trouvees');

      for (const sale of sales) {
        const result = db.addSale({
          slug: player.slug,
          playerName: sale.playerName || player.name,
          rarity: player.rarity,
          price: sale.price,
          saleType: sale.type || 'secondary',
          saleDate: sale.saleDate || new Date().toISOString(),
        });

        if (result.changes > 0) {
          sheetRows.push([
            sale.saleDate || new Date().toLocaleDateString('fr-FR'),
            player.name,
            player.slug,
            player.rarity,
            '', '', sale.price, sale.type || 'secondary', '', '',
          ]);
        }
      }

      await sleep(3000);
    }

    if (sheets.isConnected() && sheetRows.length > 0) {
      await sheets.appendRows('Ventes', sheetRows);
      console.log('  ' + sheetRows.length + ' ventes sauvegardees dans Google Sheets');
    }

  } catch (error) {
    console.error('Erreur scan ventes:', error.message);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }
}

// ============================================================
//                    SCAN SCORES SO5
// ============================================================

async function scanScores() {
  console.log('=== SCAN SCORES === ' + new Date().toLocaleTimeString('fr-FR'));

  let browser;

  try {
    browser = await createBrowser();
    const watchlist = db.getWatchlist();
    const portfolio = db.getPortfolio();

    // Combiner tous les joueurs uniques (watchlist + portfolio)
    const playerMap = new Map();
    for (const p of watchlist.players) {
      playerMap.set(p.slug + '-' + p.rarity, { slug: p.slug, name: p.name, rarity: p.rarity });
    }
    for (const p of portfolio) {
      const key = p.player_slug + '-' + p.rarity;
      if (!playerMap.has(key)) {
        playerMap.set(key, { slug: p.player_slug, name: p.player_name, rarity: p.rarity });
      }
    }

    const players = Array.from(playerMap.values());
    console.log('  ' + players.length + ' joueurs a scanner');

    const scores = await scrapeAllPlayerScores(browser, players);

    for (const score of scores) {
      db.upsertPlayerScore({
        slug: score.slug,
        playerName: score.playerName,
        rarity: score.rarity,
        lastScore: score.lastScore,
        avgL5: score.avgL5,
        avgL15: score.avgL15,
        avgL40: score.avgL40,
        gamesPlayed: score.gamesPlayed,
        dnp: 0,
        decisiveScore: null,
        allAroundScore: null,
      });
    }

    // Scrape historique pour les 3 premiers joueurs (eviter trop de requetes)
    const topPlayers = players.slice(0, 3);
    for (const player of topPlayers) {
      const history = await scrapePlayerScoreHistory(browser, player.slug);
      for (let i = 0; i < history.length; i++) {
        db.addScoreHistory({
          slug: player.slug,
          playerName: player.name,
          rarity: player.rarity,
          gwNumber: history.length - i,
          score: history[i].score,
          decisive: null,
          allAround: null,
          played: history[i].played,
          matchDate: history[i].matchDate,
          opponent: history[i].opponent,
          competition: history[i].competition,
        });
      }
      await sleep(2000);
    }

    console.log('Scan scores termine. ' + scores.length + ' joueurs mis a jour.');

  } catch (error) {
    console.error('Erreur scan scores:', error.message);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }
}

// Import player sales (used by Discord command)
async function importPlayerSales(playerSlug, rarity) {
  let browser;
  let imported = 0;

  try {
    browser = await createBrowser();
    const sales = await scrapeSalesHistory(browser, playerSlug, rarity);
    const playerName = playerSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    for (const sale of sales) {
      const result = db.addSale({
        slug: playerSlug,
        playerName: sale.playerName || playerName,
        rarity,
        price: sale.price,
        saleType: sale.type || 'secondary',
        saleDate: sale.saleDate || new Date().toISOString(),
      });
      if (result.changes > 0) imported++;
    }

    return { imported, total: sales.length };
  } finally {
    if (browser) await browser.close();
  }
}

// Live market search
async function liveMarketSearch(query, rarity) {
  let browser;
  try {
    browser = await createBrowser();
    const results = await scrapeMarketSearch(browser, query, rarity);

    // Sauvegarder en DB les resultats pour les retrouver dans la recherche locale
    for (const r of results) {
      if (r.currentPrice !== null) {
        db.addPriceHistory(r.slug, r.rarity, r.currentPrice, r.currentPrice, r.currentPrice, 1);
      }
    }

    return results;
  } finally {
    if (browser) await browser.close();
  }
}

// Expose globally for Discord handler
global.importPlayerSales = importPlayerSales;
global.triggerScan = () => scanMarket();
global.liveMarketSearch = liveMarketSearch;

// ============================================================
//                    DEMARRAGE
// ============================================================

async function start() {
  console.log('========================================');
  console.log('  SORARE TRACKER PRO v3.0');
  console.log('  Performances | Marche | Encheres | EV');
  console.log('========================================');

  // Init database
  db.init();

  const watchlist = db.getWatchlist();
  console.log('Clubs surveilles    : ' + watchlist.clubs.length);
  console.log('Joueurs surveilles  : ' + watchlist.players.length);
  console.log('Portfolio           : ' + db.getPortfolio().length + ' cartes');
  console.log('Scan marche         : toutes les ' + (config.SCAN_INTERVAL_MS / 60000).toFixed(0) + ' min');
  console.log('Scan encheres       : toutes les ' + (config.AUCTION_SCAN_INTERVAL_MS / 60000).toFixed(0) + ' min');
  console.log('Scan scores         : toutes les ' + (config.SCORES_SCAN_INTERVAL_MS / 60000).toFixed(0) + ' min');
  console.log('Proxy NordVPN       : ' + (config.NORDVPN_USER ? 'Active' : 'Non configure'));
  console.log('Discord             : ' + (config.DISCORD_TOKEN ? 'Configure' : 'Non configure'));
  console.log('Google Sheets       : ' + (config.GOOGLE_CREDENTIALS ? 'Configure' : 'Non configure'));

  // Calculate initial EV
  const latestGW = db.getLatestGameweek();
  if (latestGW && latestGW.gw) {
    const evResults = ev.calculateAllEV(latestGW.gw);
    if (evResults.length > 0) {
      console.log('Meilleure ligue     : ' + evResults[0].league + ' (EV: ' + evResults[0].evAdjusted.toFixed(1) + 'E)');
    }
  }

  console.log('========================================');

  // Init Google Sheets
  await sheets.init();

  // Start Express server
  const app = express();
  app.use(createRouter(stats));
  app.listen(config.PORT, () => {
    console.log('Dashboard demarre sur le port ' + config.PORT);
  });

  // Start Discord bot
  if (config.DISCORD_TOKEN) {
    await registerDiscordCommands();

    const handler = createHandler(scanMarket, scanAuctions, stats);
    discordClient.on('interactionCreate', handler);

    await discordClient.login(config.DISCORD_TOKEN);
    console.log('Bot Discord connecte');
  }

  // Schedule scans
  setTimeout(scanMarket, 10000);
  setInterval(scanMarket, config.SCAN_INTERVAL_MS);

  setTimeout(scanAuctions, 30000);
  setInterval(scanAuctions, config.AUCTION_SCAN_INTERVAL_MS);

  setTimeout(scanSalesHistory, 60000);
  setInterval(scanSalesHistory, config.SALES_SCAN_INTERVAL_MS);

  setTimeout(scanScores, 90000);
  setInterval(scanScores, config.SCORES_SCAN_INTERVAL_MS);
}

start().catch(console.error);
