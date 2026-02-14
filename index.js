/**
 * ============================================================
 *          🚨 SORARE PRICE ALERT BOT - PPATCH Edition 🚨
 * ============================================================
 * 
 * Surveille le marché Sorare et envoie des alertes Discord :
 * - Nouveaux listings de joueurs/clubs suivis
 * - Alertes quand prix < seuil défini
 * 
 * Stack : Node.js + Puppeteer + Proxy NordVPN + Discord
 * Hébergement : Render
 * 
 * ============================================================
 */

const express = require('express');
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');

// ============================================================
//                    CONFIGURATION
// ============================================================

const config = {
  // Render
  PORT: process.env.PORT || 3000,
  
  // Discord
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  
  // NordVPN Proxy SOCKS5
  NORDVPN_USER: process.env.NORDVPN_USER,
  NORDVPN_PASS: process.env.NORDVPN_PASS,
  NORDVPN_SERVER: process.env.NORDVPN_SERVER || 'fr751.nordvpn.com',
  NORDVPN_PORT: 1080,
  
  // Scan
  SCAN_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
};

// ============================================================
//                 WATCHLIST (tes surveillances)
// ============================================================

let watchlist = {
  // Clubs entiers à surveiller (toutes les cartes du club)
  clubs: [
    { 
      slug: 'toulouse-toulouse', 
      name: 'Toulouse FC', 
      rarity: 'unique',
      maxPrice: null  // null = alerte sur tout nouveau listing
    },
  ],
  
  // Joueurs spécifiques à surveiller
  players: [
    { slug: 'dominik-greif', name: 'Dominik Greif', rarity: 'super_rare', maxPrice: null },
    { slug: 'berke-ozer', name: 'Berke Özer', rarity: 'super_rare', maxPrice: null },
    { slug: 'mike-penders', name: 'Mike Penders', rarity: 'super_rare', maxPrice: null },
    { slug: 'brice-samba', name: 'Brice Samba', rarity: 'super_rare', maxPrice: null },
  ],
};

// Stockage des listings déjà vus (pour éviter les doublons)
const seenListings = new Set();

// Stats
let stats = {
  lastScan: null,
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

// Commandes slash Discord
const commands = [
  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Affiche la liste des surveillances actives'),
  
  new SlashCommandBuilder()
    .setName('addplayer')
    .setDescription('Ajouter un joueur à surveiller')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur (ex: bradley-barcola)').setRequired(true))
    .addStringOption(opt => opt.setName('rarity').setDescription('Rareté').setRequired(true).addChoices(
      { name: 'Super Rare', value: 'super_rare' },
      { name: 'Rare', value: 'rare' },
      { name: 'Unique', value: 'unique' },
    ))
    .addNumberOption(opt => opt.setName('maxprice').setDescription('Prix max en $ (optionnel)')),
  
  new SlashCommandBuilder()
    .setName('removeplayer')
    .setDescription('Retirer un joueur de la surveillance')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('setprice')
    .setDescription('Définir un seuil de prix pour un joueur')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur').setRequired(true))
    .addNumberOption(opt => opt.setName('maxprice').setDescription('Prix max en $').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Affiche les statistiques du bot'),
  
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Lancer un scan immédiat'),
].map(cmd => cmd.toJSON());

// Enregistrer les commandes Discord
async function registerDiscordCommands() {
  if (!config.DISCORD_TOKEN || !config.DISCORD_CLIENT_ID) {
    console.log('⚠️ Discord non configuré (DISCORD_TOKEN ou DISCORD_CLIENT_ID manquant)');
    return;
  }
  
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  
  try {
    console.log('📝 Enregistrement des commandes Discord...');
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body: commands });
    console.log('✅ Commandes Discord enregistrées');
  } catch (error) {
    console.error('❌ Erreur enregistrement commandes:', error);
  }
}

// Gérer les commandes Discord
discordClient.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  
  const { commandName, options } = interaction;
  
  try {
    switch (commandName) {
      case 'watchlist': {
        const embed = new EmbedBuilder()
          .setTitle('👀 Watchlist Active')
          .setColor(0x7C3AED)
          .addFields(
            {
              name: '🏟️ Clubs',
              value: watchlist.clubs.length > 0 
                ? watchlist.clubs.map(c => `• **${c.name}** (${c.rarity})${c.maxPrice ? ` - Max: $${c.maxPrice}` : ''}`).join('\n')
                : 'Aucun club surveillé',
            },
            {
              name: '⚽ Joueurs',
              value: watchlist.players.length > 0
                ? watchlist.players.map(p => `• **${p.name}** (${p.rarity})${p.maxPrice ? ` - Max: $${p.maxPrice}` : ''}`).join('\n')
                : 'Aucun joueur surveillé',
            }
          )
          .setFooter({ text: `${watchlist.clubs.length + watchlist.players.length} surveillances actives` });
        
        await interaction.reply({ embeds: [embed] });
        break;
      }
      
      case 'addplayer': {
        const slug = options.getString('slug');
        const rarity = options.getString('rarity');
        const maxPrice = options.getNumber('maxprice');
        
        // Vérifier si déjà présent
        if (watchlist.players.find(p => p.slug === slug && p.rarity === rarity)) {
          await interaction.reply(`⚠️ **${slug}** (${rarity}) est déjà dans la watchlist !`);
          return;
        }
        
        watchlist.players.push({
          slug,
          name: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          rarity,
          maxPrice: maxPrice || null,
        });
        
        await interaction.reply(`✅ **${slug}** (${rarity}) ajouté à la watchlist !${maxPrice ? ` Alerte si < $${maxPrice}` : ''}`);
        break;
      }
      
      case 'removeplayer': {
        const slug = options.getString('slug');
        const before = watchlist.players.length;
        watchlist.players = watchlist.players.filter(p => p.slug !== slug);
        
        if (watchlist.players.length < before) {
          await interaction.reply(`✅ **${slug}** retiré de la watchlist`);
        } else {
          await interaction.reply(`⚠️ **${slug}** n'était pas dans la watchlist`);
        }
        break;
      }
      
      case 'setprice': {
        const slug = options.getString('slug');
        const maxPrice = options.getNumber('maxprice');
        
        const player = watchlist.players.find(p => p.slug === slug);
        if (player) {
          player.maxPrice = maxPrice;
          await interaction.reply(`✅ Seuil de prix pour **${player.name}** défini à **$${maxPrice}**`);
        } else {
          await interaction.reply(`⚠️ **${slug}** n'est pas dans la watchlist. Utilise \`/addplayer\` d'abord.`);
        }
        break;
      }
      
      case 'stats': {
        const embed = new EmbedBuilder()
          .setTitle('📊 Statistiques du Bot')
          .setColor(0x3B82F6)
          .addFields(
            { name: '🔍 Dernier scan', value: stats.lastScan ? stats.lastScan.toLocaleString('fr-FR') : 'Jamais', inline: true },
            { name: '📈 Total scans', value: stats.totalScans.toString(), inline: true },
            { name: '🚨 Alertes envoyées', value: stats.alertsSent.toString(), inline: true },
            { name: '❌ Erreurs', value: stats.errors.toString(), inline: true },
            { name: '👀 Listings vus', value: seenListings.size.toString(), inline: true },
            { name: '⏱️ Intervalle', value: `${config.SCAN_INTERVAL_MS / 1000 / 60} min`, inline: true },
          )
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        break;
      }
      
      case 'scan': {
        await interaction.reply('🔍 Scan en cours...');
        await scanMarket();
        await interaction.followUp('✅ Scan terminé !');
        break;
      }
    }
  } catch (error) {
    console.error('Erreur commande Discord:', error);
    await interaction.reply('❌ Une erreur est survenue').catch(() => {});
  }
});

// Envoyer une alerte Discord
async function sendDiscordAlert(embed) {
  if (!config.DISCORD_CHANNEL_ID) return;
  
  try {
    const channel = await discordClient.channels.fetch(config.DISCORD_CHANNEL_ID);
    if (channel) {
      await channel.send({ embeds: [embed] });
      stats.alertsSent++;
    }
  } catch (error) {
    console.error('❌ Erreur envoi Discord:', error.message);
  }
}

// ============================================================
//                    SCRAPING SORARE
// ============================================================

async function createBrowser() {
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  };
  
  // Ajouter le proxy NordVPN si configuré
  if (config.NORDVPN_USER && config.NORDVPN_PASS) {
    launchOptions.args.push(`--proxy-server=socks5://${config.NORDVPN_SERVER}:${config.NORDVPN_PORT}`);
    console.log(`🔒 Proxy NordVPN activé: ${config.NORDVPN_SERVER}`);
  }
  
  return await puppeteer.launch(launchOptions);
}

async function scrapePlayerListings(browser, playerSlug, rarity) {
  const page = await browser.newPage();
  
  // Auth proxy si NordVPN configuré
  if (config.NORDVPN_USER && config.NORDVPN_PASS) {
    await page.authenticate({
      username: config.NORDVPN_USER,
      password: config.NORDVPN_PASS,
    });
  }
  
  // User agent réaliste
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  const url = `https://sorare.com/fr/football/players/${playerSlug}/cards?s=Lowest+Price&rarity=${rarity}&sale=true`;
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Attendre que les cartes se chargent
    await page.waitForSelector('[data-testid="card-item"], [class*="CardItem"], a[href*="/cards/"]', { timeout: 10000 }).catch(() => {});
    
    // Extraire les listings
    const listings = await page.evaluate(() => {
      const cards = [];
      
      // Chercher les liens de cartes avec prix
      document.querySelectorAll('a[href*="/cards/"]').forEach(el => {
        const href = el.getAttribute('href');
        if (!href || !href.includes('/cards/')) return;
        
        // Extraire le slug de la carte
        const cardSlug = href.split('/cards/')[1]?.split('?')[0];
        if (!cardSlug) return;
        
        // Chercher le prix dans l'élément ou ses enfants
        const text = el.textContent || '';
        const priceMatch = text.match(/[\$€]?\s*(\d+[.,]?\d*)\s*(€|\$|ETH)?/);
        
        // Chercher aussi dans les attributs data
        const priceEl = el.querySelector('[class*="price"], [class*="Price"], [data-price]');
        
        let price = null;
        if (priceMatch) {
          price = parseFloat(priceMatch[1].replace(',', '.'));
        }
        
        if (cardSlug && !cards.find(c => c.slug === cardSlug)) {
          cards.push({
            slug: cardSlug,
            price: price,
            url: `https://sorare.com${href}`,
          });
        }
      });
      
      return cards;
    });
    
    await page.close();
    return listings;
    
  } catch (error) {
    console.error(`  ❌ Erreur scraping ${playerSlug}:`, error.message);
    await page.close();
    return [];
  }
}

async function scrapeClubListings(browser, clubSlug, rarity) {
  const page = await browser.newPage();
  
  if (config.NORDVPN_USER && config.NORDVPN_PASS) {
    await page.authenticate({
      username: config.NORDVPN_USER,
      password: config.NORDVPN_PASS,
    });
  }
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // URL du marché filtrée par club
  const clubName = clubSlug.replace('-', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('+');
  const url = `https://sorare.com/fr/football/market/shop/manager-sales?rarity=${rarity}&club=${clubName}%7C${clubSlug}`;
  
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
        const priceMatch = text.match(/(\d+[.,]?\d*)\s*(€|\$)/);
        
        let price = null;
        if (priceMatch) {
          price = parseFloat(priceMatch[1].replace(',', '.'));
        }
        
        // Essayer d'extraire le nom du joueur
        const playerNameEl = el.querySelector('[class*="player"], [class*="Player"], [class*="name"], [class*="Name"]');
        const playerName = playerNameEl?.textContent?.trim() || cardSlug.split('-').slice(0, -1).join(' ');
        
        if (cardSlug && !cards.find(c => c.slug === cardSlug)) {
          cards.push({
            slug: cardSlug,
            playerName: playerName,
            price: price,
            url: `https://sorare.com${href}`,
          });
        }
      });
      
      return cards;
    });
    
    await page.close();
    return listings;
    
  } catch (error) {
    console.error(`  ❌ Erreur scraping club ${clubSlug}:`, error.message);
    await page.close();
    return [];
  }
}

// ============================================================
//                    LOGIQUE DE SCAN
// ============================================================

async function scanMarket() {
  console.log(`\n🔍 [${new Date().toLocaleTimeString('fr-FR')}] Démarrage du scan...`);
  stats.lastScan = new Date();
  stats.totalScans++;
  
  let browser;
  
  try {
    browser = await createBrowser();
    
    // 1. Scanner les clubs
    for (const club of watchlist.clubs) {
      console.log(`  📍 Club: ${club.name} (${club.rarity})`);
      
      const listings = await scrapeClubListings(browser, club.slug, club.rarity);
      console.log(`     → ${listings.length} listings trouvés`);
      
      for (const listing of listings) {
        const listingId = `club-${listing.slug}`;
        
        if (seenListings.has(listingId)) continue;
        seenListings.add(listingId);
        
        // Vérifier les conditions d'alerte
        const shouldAlert = !club.maxPrice || (listing.price && listing.price <= club.maxPrice);
        
        if (shouldAlert) {
          const embed = new EmbedBuilder()
            .setTitle(club.maxPrice ? '🚨 ALERTE PRIX !' : '📢 NOUVEAU LISTING')
            .setDescription(`**${listing.playerName || 'Carte'}** - ${club.name}`)
            .setColor(club.maxPrice ? 0x00FF00 : 0x7C3AED)
            .addFields(
              { name: '💰 Prix', value: listing.price ? `$${listing.price}` : 'N/A', inline: true },
              { name: '🃏 Rareté', value: club.rarity.toUpperCase(), inline: true },
              { name: '🏟️ Club', value: club.name, inline: true },
            )
            .setURL(listing.url)
            .setTimestamp()
            .setFooter({ text: 'Sorare Alert Bot • Clique pour voir' });
          
          if (club.maxPrice) {
            embed.addFields({ name: '🎯 Ton seuil', value: `$${club.maxPrice}`, inline: true });
          }
          
          await sendDiscordAlert(embed);
          console.log(`     🚨 Alerte envoyée: ${listing.playerName || listing.slug}`);
        }
      }
      
      // Pause entre chaque requête
      await sleep(2000);
    }
    
    // 2. Scanner les joueurs
    for (const player of watchlist.players) {
      console.log(`  ⚽ Joueur: ${player.name} (${player.rarity})`);
      
      const listings = await scrapePlayerListings(browser, player.slug, player.rarity);
      console.log(`     → ${listings.length} listings trouvés`);
      
      for (const listing of listings) {
        const listingId = `player-${listing.slug}`;
        
        if (seenListings.has(listingId)) continue;
        seenListings.add(listingId);
        
        const shouldAlert = !player.maxPrice || (listing.price && listing.price <= player.maxPrice);
        
        if (shouldAlert) {
          const embed = new EmbedBuilder()
            .setTitle(player.maxPrice ? '🚨 ALERTE PRIX !' : '📢 NOUVEAU LISTING')
            .setDescription(`**${player.name}**`)
            .setColor(player.maxPrice ? 0x00FF00 : 0x3B82F6)
            .addFields(
              { name: '💰 Prix', value: listing.price ? `$${listing.price}` : 'N/A', inline: true },
              { name: '🃏 Rareté', value: player.rarity.toUpperCase(), inline: true },
            )
            .setURL(listing.url)
            .setTimestamp()
            .setFooter({ text: 'Sorare Alert Bot • Clique pour acheter' });
          
          if (player.maxPrice) {
            embed.addFields(
              { name: '🎯 Ton seuil', value: `$${player.maxPrice}`, inline: true },
              { name: '📉 Économie', value: `$${(player.maxPrice - listing.price).toFixed(2)}`, inline: true },
            );
          }
          
          await sendDiscordAlert(embed);
          console.log(`     🚨 Alerte envoyée: ${player.name} à $${listing.price}`);
        }
      }
      
      await sleep(2000);
    }
    
    console.log(`✅ Scan terminé. ${seenListings.size} listings en mémoire.\n`);
    
  } catch (error) {
    console.error('❌ Erreur scan:', error.message);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//                    SERVEUR EXPRESS
// ============================================================

const app = express();
app.use(express.json());

// Health check pour Render
app.get('/api/status', (req, res) => {
  res.json({
    status: '🟢 running',
    lastScan: stats.lastScan,
    totalScans: stats.totalScans,
    alertsSent: stats.alertsSent,
    watchlist: {
      clubs: watchlist.clubs.length,
      players: watchlist.players.length,
    },
    seenListings: seenListings.size,
  });
});

// ============================================================
//                    DASHBOARD HTML
// ============================================================

const dashboardHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🚨 Sorare Alert Bot - Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #fff;
      padding: 20px;
    }
    
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    
    header {
      text-align: center;
      margin-bottom: 30px;
    }
    
    header h1 {
      font-size: 2rem;
      margin-bottom: 10px;
    }
    
    header h1 span {
      color: #7c3aed;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    
    .stat-card {
      background: rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    
    .stat-card .value {
      font-size: 2rem;
      font-weight: bold;
      color: #7c3aed;
    }
    
    .stat-card .label {
      font-size: 0.85rem;
      color: #aaa;
      margin-top: 5px;
    }
    
    .section {
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      padding: 25px;
      margin-bottom: 25px;
    }
    
    .section h2 {
      font-size: 1.3rem;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .add-form {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr auto;
      gap: 10px;
      margin-bottom: 20px;
    }
    
    @media (max-width: 600px) {
      .add-form {
        grid-template-columns: 1fr;
      }
    }
    
    input, select, button {
      padding: 12px 16px;
      border-radius: 8px;
      border: none;
      font-size: 1rem;
    }
    
    input, select {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    
    input::placeholder {
      color: #888;
    }
    
    input:focus, select:focus {
      outline: 2px solid #7c3aed;
    }
    
    button {
      background: #7c3aed;
      color: #fff;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    }
    
    button:hover {
      background: #6d28d9;
      transform: translateY(-1px);
    }
    
    button.danger {
      background: #dc2626;
    }
    
    button.danger:hover {
      background: #b91c1c;
    }
    
    button.secondary {
      background: rgba(255,255,255,0.2);
    }
    
    .player-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    .player-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255,255,255,0.08);
      padding: 15px 20px;
      border-radius: 10px;
      flex-wrap: wrap;
      gap: 10px;
    }
    
    .player-info {
      display: flex;
      align-items: center;
      gap: 15px;
      flex: 1;
    }
    
    .player-name {
      font-weight: 600;
      font-size: 1.1rem;
    }
    
    .player-rarity {
      background: #7c3aed;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 0.75rem;
      text-transform: uppercase;
    }
    
    .player-rarity.unique {
      background: #eab308;
      color: #000;
    }
    
    .player-rarity.rare {
      background: #3b82f6;
    }
    
    .player-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .price-input {
      width: 100px;
      text-align: center;
    }
    
    .btn-small {
      padding: 8px 12px;
      font-size: 0.85rem;
    }
    
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #888;
    }
    
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #22c55e;
      color: #fff;
      padding: 15px 25px;
      border-radius: 10px;
      font-weight: 600;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
    }
    
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    
    .toast.error {
      background: #dc2626;
    }
    
    .scan-btn {
      width: 100%;
      padding: 15px;
      font-size: 1.1rem;
      margin-top: 10px;
    }
    
    .last-scan {
      text-align: center;
      color: #888;
      font-size: 0.9rem;
      margin-top: 15px;
    }
    
    .club-item {
      border-left: 4px solid #eab308;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🚨 Sorare <span>Alert Bot</span></h1>
      <p>Dashboard de gestion des alertes</p>
    </header>
    
    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="value" id="stat-players">-</div>
        <div class="label">Joueurs suivis</div>
      </div>
      <div class="stat-card">
        <div class="value" id="stat-clubs">-</div>
        <div class="label">Clubs suivis</div>
      </div>
      <div class="stat-card">
        <div class="value" id="stat-scans">-</div>
        <div class="label">Scans totaux</div>
      </div>
      <div class="stat-card">
        <div class="value" id="stat-alerts">-</div>
        <div class="label">Alertes envoyées</div>
      </div>
    </div>
    
    <!-- Joueurs -->
    <div class="section">
      <h2>⚽ Joueurs surveillés</h2>
      
      <div class="add-form">
        <input type="text" id="player-slug" placeholder="Slug du joueur (ex: bradley-barcola)">
        <select id="player-rarity">
          <option value="super_rare">Super Rare</option>
          <option value="rare">Rare</option>
          <option value="unique">Unique</option>
        </select>
        <input type="number" id="player-maxprice" placeholder="Prix max $">
        <button onclick="addPlayer()">➕ Ajouter</button>
      </div>
      
      <div class="player-list" id="player-list">
        <div class="empty-state">Chargement...</div>
      </div>
    </div>
    
    <!-- Clubs -->
    <div class="section">
      <h2>🏟️ Clubs surveillés</h2>
      
      <div class="add-form">
        <input type="text" id="club-slug" placeholder="Slug du club (ex: toulouse-toulouse)">
        <select id="club-rarity">
          <option value="unique">Unique</option>
          <option value="super_rare">Super Rare</option>
          <option value="rare">Rare</option>
        </select>
        <input type="number" id="club-maxprice" placeholder="Prix max $">
        <button onclick="addClub()">➕ Ajouter</button>
      </div>
      
      <div class="player-list" id="club-list">
        <div class="empty-state">Chargement...</div>
      </div>
    </div>
    
    <!-- Actions -->
    <div class="section">
      <h2>🔧 Actions</h2>
      <button class="scan-btn" onclick="triggerScan()">🔍 Lancer un scan maintenant</button>
      <p class="last-scan" id="last-scan">Dernier scan : -</p>
    </div>
  </div>
  
  <div class="toast" id="toast"></div>
  
  <script>
    // Charger les données
    async function loadData() {
      try {
        const [statusRes, watchlistRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/watchlist')
        ]);
        
        const status = await statusRes.json();
        const watchlist = await watchlistRes.json();
        
        // Stats
        document.getElementById('stat-players').textContent = watchlist.players?.length || 0;
        document.getElementById('stat-clubs').textContent = watchlist.clubs?.length || 0;
        document.getElementById('stat-scans').textContent = status.totalScans || 0;
        document.getElementById('stat-alerts').textContent = status.alertsSent || 0;
        
        // Dernier scan
        if (status.lastScan) {
          const date = new Date(status.lastScan);
          document.getElementById('last-scan').textContent = 'Dernier scan : ' + date.toLocaleString('fr-FR');
        }
        
        // Liste joueurs
        renderPlayers(watchlist.players || []);
        
        // Liste clubs
        renderClubs(watchlist.clubs || []);
        
      } catch (err) {
        console.error('Erreur chargement:', err);
        showToast('Erreur de chargement', true);
      }
    }
    
    function renderPlayers(players) {
      const container = document.getElementById('player-list');
      
      if (players.length === 0) {
        container.innerHTML = '<div class="empty-state">Aucun joueur surveillé</div>';
        return;
      }
      
      container.innerHTML = players.map(p => \`
        <div class="player-item">
          <div class="player-info">
            <span class="player-name">\${p.name}</span>
            <span class="player-rarity \${p.rarity}">\${p.rarity.replace('_', ' ')}</span>
          </div>
          <div class="player-actions">
            <input type="number" class="price-input" id="price-\${p.slug}" 
                   value="\${p.maxPrice || ''}" placeholder="Max $"
                   onchange="updatePrice('\${p.slug}', this.value)">
            <button class="btn-small danger" onclick="removePlayer('\${p.slug}')">🗑️</button>
          </div>
        </div>
      \`).join('');
    }
    
    function renderClubs(clubs) {
      const container = document.getElementById('club-list');
      
      if (clubs.length === 0) {
        container.innerHTML = '<div class="empty-state">Aucun club surveillé</div>';
        return;
      }
      
      container.innerHTML = clubs.map(c => \`
        <div class="player-item club-item">
          <div class="player-info">
            <span class="player-name">\${c.name}</span>
            <span class="player-rarity \${c.rarity}">\${c.rarity.replace('_', ' ')}</span>
          </div>
          <div class="player-actions">
            <input type="number" class="price-input" id="club-price-\${c.slug}" 
                   value="\${c.maxPrice || ''}" placeholder="Max $"
                   onchange="updateClubPrice('\${c.slug}', this.value)">
            <button class="btn-small danger" onclick="removeClub('\${c.slug}')">🗑️</button>
          </div>
        </div>
      \`).join('');
    }
    
    async function addPlayer() {
      const slug = document.getElementById('player-slug').value.trim();
      const rarity = document.getElementById('player-rarity').value;
      const maxPrice = document.getElementById('player-maxprice').value;
      
      if (!slug) {
        showToast('Entre un slug de joueur', true);
        return;
      }
      
      try {
        const res = await fetch('/watchlist/player', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, rarity, maxPrice: maxPrice ? parseFloat(maxPrice) : null })
        });
        
        if (res.ok) {
          showToast('Joueur ajouté !');
          document.getElementById('player-slug').value = '';
          document.getElementById('player-maxprice').value = '';
          loadData();
        } else {
          showToast('Erreur ajout', true);
        }
      } catch (err) {
        showToast('Erreur réseau', true);
      }
    }
    
    async function addClub() {
      const slug = document.getElementById('club-slug').value.trim();
      const rarity = document.getElementById('club-rarity').value;
      const maxPrice = document.getElementById('club-maxprice').value;
      
      if (!slug) {
        showToast('Entre un slug de club', true);
        return;
      }
      
      try {
        const res = await fetch('/watchlist/club', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, rarity, maxPrice: maxPrice ? parseFloat(maxPrice) : null })
        });
        
        if (res.ok) {
          showToast('Club ajouté !');
          document.getElementById('club-slug').value = '';
          document.getElementById('club-maxprice').value = '';
          loadData();
        } else {
          showToast('Erreur ajout', true);
        }
      } catch (err) {
        showToast('Erreur réseau', true);
      }
    }
    
    async function removePlayer(slug) {
      if (!confirm('Supprimer ce joueur de la watchlist ?')) return;
      
      try {
        const res = await fetch('/watchlist/player/' + slug, { method: 'DELETE' });
        if (res.ok) {
          showToast('Joueur supprimé');
          loadData();
        }
      } catch (err) {
        showToast('Erreur suppression', true);
      }
    }
    
    async function removeClub(slug) {
      if (!confirm('Supprimer ce club de la watchlist ?')) return;
      
      try {
        const res = await fetch('/watchlist/club/' + slug, { method: 'DELETE' });
        if (res.ok) {
          showToast('Club supprimé');
          loadData();
        }
      } catch (err) {
        showToast('Erreur suppression', true);
      }
    }
    
    async function updatePrice(slug, price) {
      try {
        const res = await fetch('/watchlist/player/' + slug + '/price', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxPrice: price ? parseFloat(price) : null })
        });
        
        if (res.ok) {
          showToast('Prix mis à jour');
        }
      } catch (err) {
        showToast('Erreur mise à jour', true);
      }
    }
    
    async function updateClubPrice(slug, price) {
      try {
        const res = await fetch('/watchlist/club/' + slug + '/price', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxPrice: price ? parseFloat(price) : null })
        });
        
        if (res.ok) {
          showToast('Prix mis à jour');
        }
      } catch (err) {
        showToast('Erreur mise à jour', true);
      }
    }
    
    async function triggerScan() {
      showToast('Scan en cours...');
      try {
        await fetch('/scan', { method: 'POST' });
        setTimeout(loadData, 3000);
      } catch (err) {
        showToast('Erreur scan', true);
      }
    }
    
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(() => toast.className = 'toast', 3000);
    }
    
    // Charger au démarrage
    loadData();
    
    // Refresh toutes les 30 secondes
    setInterval(loadData, 30000);
  </script>
</body>
</html>
`;

// Route Dashboard
app.get('/', (req, res) => {
  res.send(dashboardHTML);
});

// API pour gérer la watchlist
app.get('/watchlist', (req, res) => res.json(watchlist));

// === JOUEURS ===
app.post('/watchlist/player', (req, res) => {
  const { slug, name, rarity, maxPrice } = req.body;
  if (!slug || !rarity) return res.status(400).json({ error: 'slug et rarity requis' });
  
  // Vérifier si déjà présent
  if (watchlist.players.find(p => p.slug === slug && p.rarity === rarity)) {
    return res.status(400).json({ error: 'Joueur déjà dans la watchlist' });
  }
  
  watchlist.players.push({
    slug,
    name: name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    rarity,
    maxPrice: maxPrice || null,
  });
  
  console.log(\`➕ Joueur ajouté: \${slug} (\${rarity})\`);
  res.json({ success: true, watchlist });
});

app.delete('/watchlist/player/:slug', (req, res) => {
  const before = watchlist.players.length;
  watchlist.players = watchlist.players.filter(p => p.slug !== req.params.slug);
  console.log(\`🗑️ Joueur retiré: \${req.params.slug}\`);
  res.json({ success: true, removed: watchlist.players.length < before, watchlist });
});

app.put('/watchlist/player/:slug/price', (req, res) => {
  const { maxPrice } = req.body;
  const player = watchlist.players.find(p => p.slug === req.params.slug);
  
  if (player) {
    player.maxPrice = maxPrice;
    console.log(\`💰 Prix mis à jour: \${player.name} → $\${maxPrice}\`);
    res.json({ success: true, player });
  } else {
    res.status(404).json({ error: 'Joueur non trouvé' });
  }
});

// === CLUBS ===
app.post('/watchlist/club', (req, res) => {
  const { slug, name, rarity, maxPrice } = req.body;
  if (!slug || !rarity) return res.status(400).json({ error: 'slug et rarity requis' });
  
  // Vérifier si déjà présent
  if (watchlist.clubs.find(c => c.slug === slug && c.rarity === rarity)) {
    return res.status(400).json({ error: 'Club déjà dans la watchlist' });
  }
  
  watchlist.clubs.push({
    slug,
    name: name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    rarity,
    maxPrice: maxPrice || null,
  });
  
  console.log(\`➕ Club ajouté: \${slug} (\${rarity})\`);
  res.json({ success: true, watchlist });
});

app.delete('/watchlist/club/:slug', (req, res) => {
  const before = watchlist.clubs.length;
  watchlist.clubs = watchlist.clubs.filter(c => c.slug !== req.params.slug);
  console.log(\`🗑️ Club retiré: \${req.params.slug}\`);
  res.json({ success: true, removed: watchlist.clubs.length < before, watchlist });
});

app.put('/watchlist/club/:slug/price', (req, res) => {
  const { maxPrice } = req.body;
  const club = watchlist.clubs.find(c => c.slug === req.params.slug);
  
  if (club) {
    club.maxPrice = maxPrice;
    console.log(\`💰 Prix club mis à jour: \${club.name} → $\${maxPrice}\`);
    res.json({ success: true, club });
  } else {
    res.status(404).json({ error: 'Club non trouvé' });
  }
});

// Lancer un scan manuel
app.post('/scan', async (req, res) => {
  res.json({ message: 'Scan lancé' });
  await scanMarket();
});

// ============================================================
//                    DÉMARRAGE
// ============================================================

async function start() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║        🚨 SORARE PRICE ALERT BOT - PPATCH Edition 🚨       ║
╠════════════════════════════════════════════════════════════╣
║  Clubs surveillés    : ${watchlist.clubs.length.toString().padEnd(33)}║
║  Joueurs surveillés  : ${watchlist.players.length.toString().padEnd(33)}║
║  Intervalle scan     : ${(config.SCAN_INTERVAL_MS / 1000 / 60 + ' minutes').padEnd(33)}║
║  Proxy NordVPN       : ${(config.NORDVPN_USER ? '✅ Activé' : '❌ Non configuré').padEnd(33)}║
║  Discord             : ${(config.DISCORD_TOKEN ? '✅ Connecté' : '❌ Non configuré').padEnd(33)}║
╚════════════════════════════════════════════════════════════╝
  `);
  
  // Démarrer le serveur Express
  app.listen(config.PORT, () => {
    console.log(`🌐 Serveur démarré sur le port ${config.PORT}`);
  });
  
  // Connecter Discord
  if (config.DISCORD_TOKEN) {
    await registerDiscordCommands();
    await discordClient.login(config.DISCORD_TOKEN);
    console.log('🤖 Bot Discord connecté');
  }
  
  // Premier scan après 10 secondes
  setTimeout(scanMarket, 10000);
  
  // Scans réguliers
  setInterval(scanMarket, config.SCAN_INTERVAL_MS);
}

start().catch(console.error);
