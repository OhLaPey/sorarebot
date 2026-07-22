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
const { scrapePlayerListings, scrapeClubListings, scrapeSalesHistory } = require('./src/scraper/market');
const { scrapeAuctions } = require('./src/scraper/auctions');
const { detectSecondaryOpportunities, detectAuctionOpportunities } = require('./src/scraper/opportunities');
const { fetchTransferRumors, filterRumors, rumorKey } = require('./src/scraper/mercato');
const { REGION_LABEL, REGION_FLAG } = require('./src/scraper/leagues');
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
//                    SCAN MERCATO (Rumeurs transferts)
// ============================================================

// Un joueur est-il deja surveille (watchlist ou portfolio) ?
function matchesWatchlist(rumor, watchPlayers, portfolioSlugs) {
  const slug = (rumor.playerSlug || '').toLowerCase();
  const name = (rumor.playerName || '').toLowerCase();
  const inWatch = watchPlayers.some(p =>
    (slug && p.slug && slug === p.slug.toLowerCase()) ||
    (name && p.name && name.includes(p.name.toLowerCase().split(' ').pop()))
  );
  const inPortfolio = slug && portfolioSlugs.has(slug);
  return inWatch || inPortfolio;
}

async function scanMercato() {
  if (!config.MERCATO_ENABLED) return;

  console.log('=== SCAN MERCATO === ' + new Date().toLocaleTimeString('fr-FR'));

  try {
    const rumors = await fetchTransferRumors();
    console.log('  ' + rumors.length + ' rumeurs recuperees');

    const targeted = filterRumors(rumors, {
      minProbability: config.MERCATO_MIN_PROBABILITY,
      europeOnly: config.MERCATO_EUROPE_ONLY,
    });
    console.log('  ' + targeted.length + ' rumeurs ciblees (MLS/J.League/K League' +
      (config.MERCATO_EUROPE_ONLY ? ' -> Europe' : '') + ')');

    // Contexte watchlist / portfolio pour prioriser
    const watchlist = db.getWatchlist();
    const portfolioSlugs = new Set(db.getPortfolio().map(c => (c.player_slug || '').toLowerCase()));

    // Insertion + dedup
    let newCount = 0;
    for (const r of targeted) {
      const inWatchlist = matchesWatchlist(r, watchlist.players, portfolioSlugs);
      const isNew = db.insertTransferRumor({
        rumorKey: rumorKey(r),
        playerName: r.playerName,
        playerSlug: r.playerSlug,
        age: r.age,
        role: r.role,
        marketValue: r.marketValue,
        probability: r.probability,
        currentClub: r.currentClub.name,
        currentClubSlug: r.currentClub.slug,
        sourceLeague: r.sourceRegion,
        targetClub: r.targetClub.name,
        targetClubSlug: r.targetClub.slug,
        targetRegion: r.targetRegion,
        toEurope: r.toEurope,
        inWatchlist,
        rumorDate: r.date,
      });
      if (isNew) newCount++;
    }
    console.log('  ' + newCount + ' nouvelles rumeurs');

    // Alertes Discord pour les nouvelles rumeurs non notifiees
    const unnotified = db.getUnnotifiedRumors();
    if (unnotified.length > 0) {
      // Une alerte prioritaire par rumeur touchant la watchlist/portfolio
      const priority = unnotified.filter(r => r.in_watchlist);
      for (const r of priority) {
        await sendDiscordAlert(buildMercatoEmbed(r, true));
      }

      // Les autres regroupees en un seul embed (max 10)
      const others = unnotified.filter(r => !r.in_watchlist).slice(0, 10);
      if (others.length > 0) {
        const embed = new EmbedBuilder()
          .setTitle('Mercato : departs MLS / J.League / K League (' + others.length + ')')
          .setColor(0x0EA5E9)
          .setDescription(others.map(r => {
            const flag = REGION_FLAG[r.source_league] || '';
            const dest = r.to_europe ? '🇪🇺 Europe' : (REGION_FLAG[r.target_region] || '') + ' ' + (REGION_LABEL[r.target_region] || r.target_region);
            const prob = r.probability != null ? ' · ' + r.probability + '%' : '';
            const mv = r.market_value ? ' · ' + formatValue(r.market_value) : '';
            return '**' + (r.player_name || '?') + '** (' + (r.role || '?') + ')' + mv + prob + '\n' +
              flag + ' ' + r.current_club + '  →  ' + dest + ' · ' + r.target_club;
          }).join('\n\n'))
          .setFooter({ text: 'Source: sorarescore.com' })
          .setTimestamp();
        await sendDiscordAlert(embed);
      }

      db.markRumorsNotified(unnotified.map(r => r.id));
    }

    console.log('Scan mercato termine.');
  } catch (error) {
    console.error('Erreur scan mercato:', error.message);
    stats.errors++;
  }
}

function formatValue(v) {
  if (!v) return 'N/A';
  if (v >= 1000000) return (v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1) + 'M€';
  if (v >= 1000) return Math.round(v / 1000) + 'k€';
  return v + '€';
}

function buildMercatoEmbed(r, priority) {
  const flag = REGION_FLAG[r.source_league] || '';
  const destLabel = r.to_europe
    ? '🇪🇺 Europe'
    : (REGION_FLAG[r.target_region] || '') + ' ' + (REGION_LABEL[r.target_region] || r.target_region);

  const embed = new EmbedBuilder()
    .setTitle((priority ? '⭐ ' : '') + 'Rumeur mercato : ' + (r.player_name || '?'))
    .setColor(priority ? 0xF59E0B : r.to_europe ? 0x22C55E : 0x0EA5E9)
    .addFields(
      { name: 'Depart', value: flag + ' ' + r.current_club + '\n' + (REGION_LABEL[r.source_league] || r.source_league), inline: true },
      { name: 'Destination', value: destLabel + '\n' + r.target_club, inline: true },
      { name: 'Poste / Age', value: (r.role || '?') + ' · ' + (r.age != null ? r.age + ' ans' : '?'), inline: true },
      { name: 'Valeur marche', value: formatValue(r.market_value), inline: true },
      { name: 'Probabilite', value: r.probability != null ? r.probability + '%' : 'Non evaluee', inline: true },
    )
    .setFooter({ text: 'Source: sorarescore.com' + (priority ? ' · dans ta watchlist/portfolio' : '') })
    .setTimestamp();

  if (r.player_slug) {
    embed.setURL('https://sorarescore.com/player/' + r.player_slug);
  }
  return embed;
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

// Expose globally for Discord handler
global.importPlayerSales = importPlayerSales;
global.triggerScan = () => scanMarket();
global.triggerMercatoScan = () => scanMercato();

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
  console.log('Scan mercato        : ' + (config.MERCATO_ENABLED ? 'toutes les ' + (config.MERCATO_SCAN_INTERVAL_MS / 3600000).toFixed(0) + 'h (MLS/J.League/K League' + (config.MERCATO_EUROPE_ONLY ? ' -> Europe' : '') + ')' : 'Desactive'));
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

  if (config.MERCATO_ENABLED) {
    setTimeout(scanMercato, 20000);
    setInterval(scanMercato, config.MERCATO_SCAN_INTERVAL_MS);
  }
}

start().catch(console.error);
