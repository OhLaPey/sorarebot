/**
 * ============================================================
 *          SORARE PRICE ALERT BOT - PPATCH Edition
 *          Avec tracking des prix et Google Sheets
 * ============================================================
 */

const express = require('express');
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const https = require('https');

// ============================================================
//                    CONFIGURATION
// ============================================================

const config = {
  PORT: process.env.PORT || 3000,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  NORDVPN_USER: process.env.NORDVPN_USER,
  NORDVPN_PASS: process.env.NORDVPN_PASS,
  NORDVPN_SERVER: process.env.NORDVPN_SERVER || 'fr751.nordvpn.com',
  NORDVPN_PORT: 1080,
  SCAN_INTERVAL_MS: 5 * 60 * 1000,
  GOOGLE_CREDENTIALS: process.env.GOOGLE_CREDENTIALS,
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '1l4fRJjsajGOQ4jYDdAcL7i9x5gtaG8e11KXRksw6AXI',
};

// ============================================================
//                 WATCHLIST
// ============================================================

let watchlist = {
  clubs: [
    { 
      slug: 'toulouse-toulouse', 
      name: 'Toulouse FC', 
      rarity: 'unique',
      maxPrice: null
    },
  ],
  players: [
    { slug: 'dominik-greif', name: 'Dominik Greif', rarity: 'super_rare', maxPrice: null },
    { slug: 'berke-ozer', name: 'Berke Ozer', rarity: 'super_rare', maxPrice: null },
    { slug: 'mike-penders', name: 'Mike Penders', rarity: 'super_rare', maxPrice: null },
    { slug: 'brice-samba', name: 'Brice Samba', rarity: 'super_rare', maxPrice: null },
  ],
};

const seenListings = new Set();

let stats = {
  lastScan: null,
  totalScans: 0,
  alertsSent: 0,
  errors: 0,
};

// Cache pour les données de prix (en mémoire)
let priceHistory = {};
let salesHistory = {};

// ============================================================
//                    GOOGLE SHEETS
// ============================================================

let sheetsClient = null;

async function initGoogleSheets() {
  if (!config.GOOGLE_CREDENTIALS) {
    console.log('Google Sheets non configure (GOOGLE_CREDENTIALS manquant)');
    return false;
  }

  try {
    const credentials = JSON.parse(config.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    sheetsClient = google.sheets({ version: 'v4', auth });
    
    // Vérifier/créer les onglets nécessaires
    await ensureSheetTabs();
    
    console.log('Google Sheets connecte');
    return true;
  } catch (error) {
    console.error('Erreur init Google Sheets:', error.message);
    return false;
  }
}

async function ensureSheetTabs() {
  if (!sheetsClient) return;

  try {
    const response = await sheetsClient.spreadsheets.get({
      spreadsheetId: config.GOOGLE_SHEET_ID,
    });

    const existingSheets = response.data.sheets.map(s => s.properties.title);
    const requiredSheets = ['Listings', 'Prix_Timeline', 'Ventes'];

    for (const sheetName of requiredSheets) {
      if (!existingSheets.includes(sheetName)) {
        await sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: config.GOOGLE_SHEET_ID,
          resource: {
            requests: [{
              addSheet: {
                properties: { title: sheetName }
              }
            }]
          }
        });
        console.log('Onglet cree: ' + sheetName);

        // Ajouter les headers
        const headers = getHeadersForSheet(sheetName);
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: config.GOOGLE_SHEET_ID,
          range: sheetName + '!A1',
          valueInputOption: 'RAW',
          resource: { values: [headers] }
        });
      }
    }
  } catch (error) {
    console.error('Erreur creation onglets:', error.message);
  }
}

function getHeadersForSheet(sheetName) {
  switch (sheetName) {
    case 'Listings':
      return ['Date', 'Heure', 'Joueur', 'Slug', 'Rarete', 'Prix_Min_EUR', 'Nb_Listings', 'Card_Slug'];
    case 'Prix_Timeline':
      return ['Timestamp', 'Joueur', 'Slug', 'Rarete', 'Prix_Min', 'Prix_Median', 'Nb_Listings'];
    case 'Ventes':
      return ['Date', 'Joueur', 'Slug', 'Rarete', 'Saison', 'Serial', 'Prix_EUR', 'Type', 'Acheteur', 'Vendeur'];
    default:
      return [];
  }
}

async function appendToSheet(sheetName, rows) {
  if (!sheetsClient || rows.length === 0) return;

  try {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: sheetName + '!A:Z',
      valueInputOption: 'USER_ENTERED',
      resource: { values: rows }
    });
  } catch (error) {
    console.error('Erreur ecriture ' + sheetName + ':', error.message);
  }
}

async function getSheetData(sheetName, range) {
  if (!sheetsClient) return [];

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: sheetName + '!' + range,
    });
    return response.data.values || [];
  } catch (error) {
    console.error('Erreur lecture ' + sheetName + ':', error.message);
    return [];
  }
}

// ============================================================
//                    DISCORD BOT
// ============================================================

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Affiche la liste des surveillances actives'),
  
  new SlashCommandBuilder()
    .setName('addplayer')
    .setDescription('Ajouter un joueur a surveiller')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur (ex: bradley-barcola)').setRequired(true))
    .addStringOption(opt => opt.setName('rarity').setDescription('Rarete').setRequired(true).addChoices(
      { name: 'Super Rare', value: 'super_rare' },
      { name: 'Rare', value: 'rare' },
      { name: 'Unique', value: 'unique' },
    ))
    .addNumberOption(opt => opt.setName('maxprice').setDescription('Prix max en EUR (optionnel)')),
  
  new SlashCommandBuilder()
    .setName('removeplayer')
    .setDescription('Retirer un joueur de la surveillance')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('setprice')
    .setDescription('Definir un seuil de prix pour un joueur')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur').setRequired(true))
    .addNumberOption(opt => opt.setName('maxprice').setDescription('Prix max en EUR').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Affiche les statistiques du bot'),
  
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Lancer un scan immediat'),

  new SlashCommandBuilder()
    .setName('prix')
    .setDescription('Affiche le prix actuel et la tendance d\'un joueur')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true)),

  new SlashCommandBuilder()
    .setName('historique')
    .setDescription('Affiche l\'historique des prix avec graphique')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true))
    .addStringOption(opt => opt.setName('periode').setDescription('Periode').addChoices(
      { name: '1 semaine', value: '7' },
      { name: '1 mois', value: '30' },
      { name: '3 mois', value: '90' },
      { name: '6 mois', value: '180' },
      { name: '1 an', value: '365' },
    )),

  new SlashCommandBuilder()
    .setName('marche')
    .setDescription('Resume de tous les listings surveilles'),

  new SlashCommandBuilder()
    .setName('import')
    .setDescription('Importer l\'historique des ventes d\'un joueur depuis Sorare')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true))
    .addStringOption(opt => opt.setName('rarete').setDescription('Rarete').addChoices(
      { name: 'Super Rare', value: 'super_rare' },
      { name: 'Rare', value: 'rare' },
      { name: 'Unique', value: 'unique' },
    )),

  new SlashCommandBuilder()
    .setName('importall')
    .setDescription('Importer l\'historique des ventes de tous les joueurs de la watchlist'),
].map(cmd => cmd.toJSON());

async function registerDiscordCommands() {
  if (!config.DISCORD_TOKEN || !config.DISCORD_CLIENT_ID) {
    console.log('Discord non configure (DISCORD_TOKEN ou DISCORD_CLIENT_ID manquant)');
    return;
  }
  
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  
  try {
    console.log('Enregistrement des commandes Discord...');
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body: commands });
    console.log('Commandes Discord enregistrees');
  } catch (error) {
    console.error('Erreur enregistrement commandes:', error);
  }
}

discordClient.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  
  const { commandName, options } = interaction;
  
  try {
    switch (commandName) {
      case 'watchlist': {
        const embed = new EmbedBuilder()
          .setTitle('Watchlist Active')
          .setColor(0x7C3AED)
          .addFields(
            {
              name: 'Clubs',
              value: watchlist.clubs.length > 0 
                ? watchlist.clubs.map(c => '- ' + c.name + ' (' + c.rarity + ')' + (c.maxPrice ? ' - Max: ' + c.maxPrice + 'E' : '')).join('\n')
                : 'Aucun club surveille',
            },
            {
              name: 'Joueurs',
              value: watchlist.players.length > 0
                ? watchlist.players.map(p => '- ' + p.name + ' (' + p.rarity + ')' + (p.maxPrice ? ' - Max: ' + p.maxPrice + 'E' : '')).join('\n')
                : 'Aucun joueur surveille',
            }
          )
          .setFooter({ text: (watchlist.clubs.length + watchlist.players.length) + ' surveillances actives' });
        
        await interaction.reply({ embeds: [embed] });
        break;
      }
      
      case 'addplayer': {
        const slug = options.getString('slug');
        const rarity = options.getString('rarity');
        const maxPrice = options.getNumber('maxprice');
        
        if (watchlist.players.find(p => p.slug === slug && p.rarity === rarity)) {
          await interaction.reply(slug + ' (' + rarity + ') est deja dans la watchlist !');
          return;
        }
        
        watchlist.players.push({
          slug,
          name: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          rarity,
          maxPrice: maxPrice || null,
        });
        
        await interaction.reply(slug + ' (' + rarity + ') ajoute a la watchlist !' + (maxPrice ? ' Alerte si < ' + maxPrice + 'E' : ''));
        break;
      }
      
      case 'removeplayer': {
        const slug = options.getString('slug');
        const before = watchlist.players.length;
        watchlist.players = watchlist.players.filter(p => p.slug !== slug);
        
        if (watchlist.players.length < before) {
          await interaction.reply(slug + ' retire de la watchlist');
        } else {
          await interaction.reply(slug + ' n etait pas dans la watchlist');
        }
        break;
      }
      
      case 'setprice': {
        const slug = options.getString('slug');
        const maxPrice = options.getNumber('maxprice');
        
        const player = watchlist.players.find(p => p.slug === slug);
        if (player) {
          player.maxPrice = maxPrice;
          await interaction.reply('Seuil de prix pour ' + player.name + ' defini a ' + maxPrice + 'E');
        } else {
          await interaction.reply(slug + ' n est pas dans la watchlist. Utilise /addplayer d abord.');
        }
        break;
      }
      
      case 'stats': {
        const embed = new EmbedBuilder()
          .setTitle('Statistiques du Bot')
          .setColor(0x3B82F6)
          .addFields(
            { name: 'Dernier scan', value: stats.lastScan ? stats.lastScan.toLocaleString('fr-FR') : 'Jamais', inline: true },
            { name: 'Total scans', value: stats.totalScans.toString(), inline: true },
            { name: 'Alertes envoyees', value: stats.alertsSent.toString(), inline: true },
            { name: 'Erreurs', value: stats.errors.toString(), inline: true },
            { name: 'Listings vus', value: seenListings.size.toString(), inline: true },
            { name: 'Intervalle', value: (config.SCAN_INTERVAL_MS / 1000 / 60) + ' min', inline: true },
          )
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        break;
      }
      
      case 'scan': {
        await interaction.reply('Scan en cours...');
        await scanMarket();
        await interaction.followUp('Scan termine !');
        break;
      }

      case 'prix': {
        const joueurSlug = options.getString('joueur');
        await interaction.deferReply();
        
        const player = watchlist.players.find(p => p.slug === joueurSlug);
        if (!player) {
          await interaction.editReply('Joueur non trouve dans la watchlist. Ajoute-le d\'abord avec /addplayer');
          return;
        }

        const key = joueurSlug + '_' + player.rarity;
        const history = priceHistory[key] || [];

        if (history.length === 0) {
          await interaction.editReply('Pas encore de donnees pour ' + player.name + '. Attends le prochain scan.');
          return;
        }

        const latest = history[history.length - 1];
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const last7Days = history.filter(h => new Date(h.timestamp).getTime() > weekAgo);

        let trend = 0;
        let trendEmoji = '➡️';
        if (last7Days.length > 1) {
          const oldPrice = last7Days[0].price;
          const newPrice = latest.price;
          if (oldPrice && newPrice) {
            trend = ((newPrice - oldPrice) / oldPrice) * 100;
            trendEmoji = trend > 0 ? '📈' : trend < 0 ? '📉' : '➡️';
          }
        }

        const prices = last7Days.map(h => h.price).filter(p => p !== null);
        const min7d = prices.length > 0 ? Math.min(...prices) : null;
        const max7d = prices.length > 0 ? Math.max(...prices) : null;

        const embed = new EmbedBuilder()
          .setTitle(trendEmoji + ' ' + player.name)
          .setColor(trend > 0 ? 0xEF4444 : trend < 0 ? 0x22C55E : 0x6B7280)
          .addFields(
            { name: 'Prix actuel', value: latest.price ? latest.price + ' E' : 'N/A', inline: true },
            { name: 'Tendance 7j', value: (trend > 0 ? '+' : '') + trend.toFixed(1) + '%', inline: true },
            { name: 'Listings', value: (latest.nbListings || 0).toString(), inline: true },
            { name: 'Min 7j', value: min7d ? min7d + ' E' : 'N/A', inline: true },
            { name: 'Max 7j', value: max7d ? max7d + ' E' : 'N/A', inline: true },
            { name: 'Rarete', value: player.rarity.toUpperCase(), inline: true },
          )
          .setFooter({ text: 'Derniere MAJ: ' + new Date(latest.timestamp).toLocaleString('fr-FR') });

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'historique': {
        const joueurSlug = options.getString('joueur');
        const periode = parseInt(options.getString('periode') || '30');
        
        await interaction.deferReply();
        
        const player = watchlist.players.find(p => p.slug === joueurSlug);
        if (!player) {
          await interaction.editReply('Joueur non trouve dans la watchlist.');
          return;
        }

        const key = joueurSlug + '_' + player.rarity;
        const history = priceHistory[key] || [];
        const sales = salesHistory[key] || [];

        const cutoff = Date.now() - periode * 24 * 60 * 60 * 1000;
        const filteredHistory = history.filter(h => new Date(h.timestamp).getTime() > cutoff);
        const filteredSales = sales.filter(s => new Date(s.date).getTime() > cutoff);

        if (filteredHistory.length < 2 && filteredSales.length < 2) {
          await interaction.editReply('Pas assez de donnees pour generer le graphique. Attends quelques scans.');
          return;
        }

        // Générer l'URL du graphique avec QuickChart
        const listingData = filteredHistory.map(h => ({
          x: h.timestamp,
          y: h.price
        }));

        const salesData = filteredSales.map(s => ({
          x: s.date,
          y: s.price
        }));

        const chartConfig = {
          type: 'line',
          data: {
            datasets: [
              {
                label: 'Floor Price (Listings)',
                data: listingData,
                borderColor: '#F97316',
                backgroundColor: 'rgba(249, 115, 22, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 2,
              },
              {
                label: 'Ventes',
                data: salesData,
                borderColor: '#8B5CF6',
                backgroundColor: '#8B5CF6',
                pointRadius: 6,
                showLine: false,
              }
            ]
          },
          options: {
            responsive: true,
            plugins: {
              legend: { labels: { color: '#fff' } },
              title: {
                display: true,
                text: player.name + ' - ' + player.rarity.toUpperCase() + ' (' + periode + 'j)',
                color: '#fff',
                font: { size: 16 }
              }
            },
            scales: {
              x: {
                type: 'time',
                time: { unit: periode > 60 ? 'week' : 'day' },
                ticks: { color: '#888' },
                grid: { color: 'rgba(255,255,255,0.1)' }
              },
              y: {
                ticks: { color: '#888' },
                grid: { color: 'rgba(255,255,255,0.1)' }
              }
            }
          }
        };

        const chartUrl = 'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(chartConfig)) + '&backgroundColor=%231a1a2e&width=600&height=400';

        const embed = new EmbedBuilder()
          .setTitle('Historique - ' + player.name)
          .setColor(0x7C3AED)
          .setImage(chartUrl)
          .setDescription('🟠 Courbe orange = Floor price des listings\n🟣 Points violets = Ventes realisees')
          .setFooter({ text: 'Periode: ' + periode + ' jours' });

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'marche': {
        await interaction.deferReply();
        
        const fields = [];
        
        for (const player of watchlist.players) {
          const key = player.slug + '_' + player.rarity;
          const history = priceHistory[key] || [];
          
          if (history.length > 0) {
            const latest = history[history.length - 1];
            let trend = 0;
            if (history.length > 1) {
              const prev = history[history.length - 2];
              if (prev.price && latest.price) {
                trend = ((latest.price - prev.price) / prev.price) * 100;
              }
            }
            const trendEmoji = trend > 0 ? '📈' : trend < 0 ? '📉' : '➡️';
            
            fields.push({
              name: trendEmoji + ' ' + player.name,
              value: (latest.price || 'N/A') + ' E | ' + (latest.nbListings || 0) + ' listings',
              inline: true,
            });
          } else {
            fields.push({
              name: '❓ ' + player.name,
              value: 'Pas de donnees',
              inline: true,
            });
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('Resume du Marche')
          .setColor(0x7C3AED)
          .addFields(fields.length > 0 ? fields : [{ name: 'Aucune donnee', value: 'Attends le prochain scan' }])
          .setFooter({ text: 'MAJ: ' + new Date().toLocaleString('fr-FR') });

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case 'import': {
        const joueurSlug = options.getString('joueur');
        const rarete = options.getString('rarete') || 'super_rare';
        
        await interaction.deferReply();
        await interaction.editReply('Import en cours pour ' + joueurSlug + ' (' + rarete + ')... Cela peut prendre 30 secondes.');
        
        try {
          const result = await importPlayerSalesHistory(joueurSlug, rarete);
          
          const embed = new EmbedBuilder()
            .setTitle('Import termine')
            .setColor(0x22C55E)
            .addFields(
              { name: 'Joueur', value: joueurSlug, inline: true },
              { name: 'Rarete', value: rarete.toUpperCase(), inline: true },
              { name: 'Ventes importees', value: result.imported.toString(), inline: true },
              { name: 'Deja existantes', value: result.skipped.toString(), inline: true },
            )
            .setFooter({ text: 'Donnees sauvegardees dans Google Sheets' });
          
          await interaction.followUp({ embeds: [embed] });
        } catch (error) {
          console.error('Erreur import:', error);
          await interaction.followUp('Erreur lors de l\'import: ' + error.message);
        }
        break;
      }

      case 'importall': {
        await interaction.deferReply();
        await interaction.editReply('Import de tous les joueurs de la watchlist en cours... Cela peut prendre plusieurs minutes.');
        
        let totalImported = 0;
        let totalSkipped = 0;
        const results = [];
        
        for (const player of watchlist.players) {
          try {
            await interaction.editReply('Import en cours: ' + player.name + ' (' + player.rarity + ')...');
            const result = await importPlayerSalesHistory(player.slug, player.rarity);
            totalImported += result.imported;
            totalSkipped += result.skipped;
            results.push({ name: player.name, imported: result.imported, skipped: result.skipped, success: true });
          } catch (error) {
            console.error('Erreur import ' + player.slug + ':', error);
            results.push({ name: player.name, imported: 0, skipped: 0, success: false });
          }
          
          // Pause entre chaque joueur pour eviter le rate limiting
          await sleep(3000);
        }
        
        const embed = new EmbedBuilder()
          .setTitle('Import termine')
          .setColor(0x22C55E)
          .setDescription(results.map(r => 
            (r.success ? '✅' : '❌') + ' ' + r.name + ': ' + r.imported + ' ventes'
          ).join('\n'))
          .addFields(
            { name: 'Total importe', value: totalImported.toString(), inline: true },
            { name: 'Deja existantes', value: totalSkipped.toString(), inline: true },
          )
          .setFooter({ text: 'Donnees sauvegardees dans Google Sheets' });
        
        await interaction.followUp({ embeds: [embed] });
        break;
      }
    }
  } catch (error) {
    console.error('Erreur commande Discord:', error);
    const reply = { content: 'Une erreur est survenue' };
    if (interaction.deferred) {
      await interaction.editReply(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

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
//                    SCRAPING SORARE
// ============================================================

async function createBrowser() {
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  
  if (!executablePath) {
    const { execSync } = require('child_process');
    try {
      executablePath = execSync('which chromium || which chromium-browser || which google-chrome').toString().trim();
      console.log('Chromium trouve: ' + executablePath);
    } catch (e) {
      console.log('Chromium non trouve via which, utilisation du defaut Puppeteer');
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

async function scrapePlayerListings(browser, playerSlug, rarity) {
  const page = await browser.newPage();
  
  if (config.NORDVPN_USER && config.NORDVPN_PASS) {
    await page.authenticate({
      username: config.NORDVPN_USER,
      password: config.NORDVPN_PASS,
    });
  }
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1400, height: 900 });
  
  const url = 'https://sorare.com/fr/football/players/' + playerSlug + '/cards?s=Lowest+Price&rarity=' + rarity + '&sale=true';
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(4000);
    
    // Extraire les prix directement du HTML avec plusieurs methodes
    const listings = await page.evaluate(() => {
      const cards = [];
      const seenPrices = new Set();
      
      // Methode 1: Chercher les liens vers les cartes
      document.querySelectorAll('a[href*="/cards/"]').forEach(el => {
        const href = el.getAttribute('href');
        if (!href || !href.includes('/cards/')) return;
        
        const cardSlug = href.split('/cards/')[1]?.split('?')[0];
        if (!cardSlug) return;
        
        // Chercher le prix dans l'element ou ses parents
        let text = el.textContent || '';
        let parent = el.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          text += ' ' + (parent.textContent || '');
          parent = parent.parentElement;
        }
        
        // Patterns de prix: "123,45 €" ou "123.45 €" ou "€123.45" ou "123 €"
        const pricePatterns = [
          /(\d{1,3}(?:[\s,]\d{3})*(?:[,.]\d{1,2})?)\s*€/,
          /€\s*(\d{1,3}(?:[\s,]\d{3})*(?:[,.]\d{1,2})?)/,
          /(\d+(?:[,.]\d{1,2})?)\s*EUR/i,
        ];
        
        let price = null;
        for (const pattern of pricePatterns) {
          const match = text.match(pattern);
          if (match) {
            let priceStr = match[1].replace(/\s/g, '').replace(',', '.');
            price = parseFloat(priceStr);
            if (!isNaN(price) && price > 0) break;
          }
        }
        
        if (cardSlug && !cards.find(c => c.slug === cardSlug)) {
          cards.push({
            slug: cardSlug,
            price: price,
            url: 'https://sorare.com' + href,
          });
        }
      });
      
      // Methode 2: Chercher tous les elements avec des prix
      if (cards.every(c => c.price === null)) {
        const allText = document.body.innerText;
        const priceMatches = allText.match(/(\d{1,3}(?:[\s,]\d{3})*(?:[,.]\d{1,2})?)\s*€/g) || [];
        
        priceMatches.forEach((match, i) => {
          const priceStr = match.replace(/[€\s]/g, '').replace(',', '.');
          const price = parseFloat(priceStr);
          if (!isNaN(price) && price > 10 && price < 50000 && !seenPrices.has(price)) {
            seenPrices.add(price);
            if (cards[i]) {
              cards[i].price = price;
            }
          }
        });
      }
      
      return cards;
    });
    
    // Si toujours pas de prix, essayer d'intercepter les requetes API
    if (listings.every(l => l.price === null)) {
      // Recuperer les prix depuis le contenu de la page
      const pageContent = await page.content();
      const priceRegex = /"price":\s*"?(\d+(?:\.\d+)?)"?/g;
      const eurRegex = /"eur":\s*"?(\d+(?:\.\d+)?)"?/g;
      
      let match;
      let idx = 0;
      
      while ((match = eurRegex.exec(pageContent)) !== null && idx < listings.length) {
        const price = parseFloat(match[1]);
        if (!isNaN(price) && price > 0) {
          listings[idx].price = price;
          idx++;
        }
      }
    }
    
    await page.close();
    
    // Filtrer les listings sans prix et trier par prix
    const validListings = listings.filter(l => l.price !== null && l.price > 0);
    validListings.sort((a, b) => a.price - b.price);
    
    if (validListings.length > 0) {
      console.log('  Prix trouves: ' + validListings.map(l => l.price + '€').join(', '));
    }
    
    return validListings.length > 0 ? validListings : listings;
    
  } catch (error) {
    console.error('Erreur scraping ' + playerSlug + ':', error.message);
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
        const priceMatch = text.match(/(\d+[\s,.]?\d*)\s*[E$]/i);
        
        let price = null;
        if (priceMatch) {
          price = parseFloat(priceMatch[1].replace(/\s/g, '').replace(',', '.'));
        }
        
        const playerNameEl = el.querySelector('[class*="player"], [class*="Player"], [class*="name"], [class*="Name"]');
        const playerName = playerNameEl?.textContent?.trim() || cardSlug.split('-').slice(0, -1).join(' ');
        
        if (cardSlug && !cards.find(c => c.slug === cardSlug)) {
          cards.push({
            slug: cardSlug,
            playerName: playerName,
            price: price,
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
    await page.close();
    return [];
  }
}

async function scrapeSalesHistory(browser, playerSlug, rarity) {
  // Utiliser l'API GraphQL directement
  try {
    const { listings, sales } = await getSalesHistoryFromAPI(playerSlug, rarity);
    
    if (sales.length > 0) {
      console.log('  API GraphQL: ' + sales.length + ' ventes trouvees');
      return sales;
    }
  } catch (error) {
    console.log('  Erreur API: ' + error.message);
  }
  
  // Pas de fallback - l'API est notre seule source fiable
  return [];
}

async function importPlayerSalesHistory(playerSlug, rarity) {
  console.log('Import historique: ' + playerSlug + ' (' + rarity + ')');
  
  let browser;
  let imported = 0;
  let skipped = 0;
  const salesRows = [];
  
  try {
    browser = await createBrowser();
    
    const sales = await scrapeSalesHistory(browser, playerSlug, rarity);
    console.log('  -> ' + sales.length + ' ventes trouvees sur Sorare');
    
    const key = playerSlug + '_' + rarity;
    if (!salesHistory[key]) salesHistory[key] = [];
    
    const playerName = playerSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    for (const sale of sales) {
      // Verifier si la vente existe deja
      const exists = salesHistory[key].find(s => 
        Math.abs(new Date(s.date).getTime() - new Date(sale.date).getTime()) < 86400000 && // Meme jour
        s.price === sale.price &&
        s.type === sale.type
      );
      
      if (!exists) {
        salesHistory[key].push({
          price: sale.price,
          type: sale.type,
          date: sale.date,
          season: sale.season,
          serial: sale.serial,
        });
        
        salesRows.push([
          new Date(sale.date).toLocaleDateString('fr-FR'),
          playerName,
          playerSlug,
          rarity,
          sale.season,
          sale.serial,
          sale.price,
          sale.type,
          sale.buyer,
          sale.seller,
        ]);
        
        imported++;
      } else {
        skipped++;
      }
    }
    
    // Ecrire dans Google Sheets
    if (sheetsClient && salesRows.length > 0) {
      await appendToSheet('Ventes', salesRows);
      console.log('  -> ' + imported + ' ventes sauvegardees dans Google Sheets');
    }
    
    return { imported, skipped };
    
  } catch (error) {
    console.error('Erreur import:', error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

// ============================================================
//                    LOGIQUE DE SCAN
// ============================================================

async function scanMarket() {
  console.log('Demarrage du scan... ' + new Date().toLocaleTimeString('fr-FR'));
  stats.lastScan = new Date();
  stats.totalScans++;
  
  let browser;
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR');
  const timeStr = now.toLocaleTimeString('fr-FR');
  const timestamp = now.toISOString();
  
  const priceTimelineRows = [];
  
  try {
    browser = await createBrowser();
    
    for (const club of watchlist.clubs) {
      console.log('Club: ' + club.name + ' (' + club.rarity + ')');
      
      const listings = await scrapeClubListings(browser, club.slug, club.rarity);
      console.log('  -> ' + listings.length + ' listings trouves');
      
      for (const listing of listings) {
        const listingId = 'club-' + listing.slug;
        
        if (seenListings.has(listingId)) continue;
        seenListings.add(listingId);
        
        const shouldAlert = !club.maxPrice || (listing.price && listing.price <= club.maxPrice);
        
        if (shouldAlert) {
          const embed = new EmbedBuilder()
            .setTitle(club.maxPrice ? 'ALERTE PRIX !' : 'NOUVEAU LISTING')
            .setDescription((listing.playerName || 'Carte') + ' - ' + club.name)
            .setColor(club.maxPrice ? 0x00FF00 : 0x7C3AED)
            .addFields(
              { name: 'Prix', value: listing.price ? listing.price + ' E' : 'N/A', inline: true },
              { name: 'Rarete', value: club.rarity.toUpperCase(), inline: true },
              { name: 'Club', value: club.name, inline: true },
            )
            .setURL(listing.url)
            .setTimestamp()
            .setFooter({ text: 'Sorare Alert Bot' });
          
          if (club.maxPrice) {
            embed.addFields({ name: 'Ton seuil', value: club.maxPrice + ' E', inline: true });
          }
          
          await sendDiscordAlert(embed);
          console.log('  Alerte envoyee: ' + (listing.playerName || listing.slug));
        }
      }
      
      await sleep(2000);
    }
    
    for (const player of watchlist.players) {
      console.log('Joueur: ' + player.name + ' (' + player.rarity + ')');
      
      const listings = await scrapePlayerListings(browser, player.slug, player.rarity);
      console.log('  -> ' + listings.length + ' listings trouves');
      
      // Calculer les stats de prix
      const prices = listings.map(l => l.price).filter(p => p !== null);
      const minPrice = prices.length > 0 ? Math.min(...prices) : null;
      const sortedPrices = [...prices].sort((a, b) => a - b);
      const medianPrice = sortedPrices.length > 0 ? sortedPrices[Math.floor(sortedPrices.length / 2)] : null;
      
      // Sauvegarder dans l'historique en memoire
      const key = player.slug + '_' + player.rarity;
      if (!priceHistory[key]) priceHistory[key] = [];
      priceHistory[key].push({
        timestamp,
        price: minPrice,
        median: medianPrice,
        nbListings: listings.length,
      });
      
      // Garder seulement les 30 derniers jours en memoire
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      priceHistory[key] = priceHistory[key].filter(h => new Date(h.timestamp).getTime() > cutoff);
      
      // Preparer pour Google Sheets
      if (listings.length > 0) {
        priceTimelineRows.push([timestamp, player.name, player.slug, player.rarity, minPrice, medianPrice, listings.length]);
      }
      
      for (const listing of listings) {
        const listingId = 'player-' + listing.slug;
        
        if (seenListings.has(listingId)) continue;
        seenListings.add(listingId);
        
        const shouldAlert = !player.maxPrice || (listing.price && listing.price <= player.maxPrice);
        
        if (shouldAlert) {
          const embed = new EmbedBuilder()
            .setTitle(player.maxPrice ? 'ALERTE PRIX !' : 'NOUVEAU LISTING')
            .setDescription(player.name)
            .setColor(player.maxPrice ? 0x00FF00 : 0x3B82F6)
            .addFields(
              { name: 'Prix', value: listing.price ? listing.price + ' E' : 'N/A', inline: true },
              { name: 'Rarete', value: player.rarity.toUpperCase(), inline: true },
            )
            .setURL(listing.url)
            .setTimestamp()
            .setFooter({ text: 'Sorare Alert Bot' });
          
          if (player.maxPrice) {
            embed.addFields(
              { name: 'Ton seuil', value: player.maxPrice + ' E', inline: true },
              { name: 'Economie', value: (player.maxPrice - listing.price).toFixed(2) + ' E', inline: true },
            );
          }
          
          await sendDiscordAlert(embed);
          console.log('  Alerte envoyee: ' + player.name + ' a ' + listing.price + ' E');
        }
      }
      
      await sleep(2000);
    }
    
    // Ecrire dans Google Sheets
    if (sheetsClient && priceTimelineRows.length > 0) {
      await appendToSheet('Prix_Timeline', priceTimelineRows);
      console.log('  Google Sheets mis a jour');
    }
    
    console.log('Scan termine. ' + seenListings.size + ' listings en memoire.');
    
  } catch (error) {
    console.error('Erreur scan:', error.message);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }
}

async function scanSalesHistory() {
  console.log('Scan historique des ventes...');
  
  let browser;
  const salesRows = [];
  
  try {
    browser = await createBrowser();
    
    for (const player of watchlist.players) {
      console.log('Historique: ' + player.name);
      
      const sales = await scrapeSalesHistory(browser, player.slug, player.rarity);
      console.log('  -> ' + sales.length + ' ventes trouvees');
      
      const key = player.slug + '_' + player.rarity;
      if (!salesHistory[key]) salesHistory[key] = [];
      
      for (const sale of sales) {
        const exists = salesHistory[key].find(s => 
          s.date === sale.date && s.price === sale.price
        );
        
        if (!exists) {
          salesHistory[key].push(sale);
          salesRows.push([
            new Date(sale.date).toLocaleDateString('fr-FR'),
            player.name,
            player.slug,
            player.rarity,
            '',
            '',
            sale.price,
            sale.type,
            '',
            '',
          ]);
        }
      }
      
      await sleep(3000);
    }
    
    if (sheetsClient && salesRows.length > 0) {
      await appendToSheet('Ventes', salesRows);
      console.log('Historique ventes sauvegarde');
    }
    
  } catch (error) {
    console.error('Erreur scan historique:', error.message);
  } finally {
    if (browser) await browser.close();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//                    SORARE GRAPHQL API
// ============================================================

async function graphqlQuery(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    
    const options = {
      hostname: 'api.sorare.com',
      port: 443,
      path: '/federation/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'SorareAlertBot/2.0',
        'Accept': 'application/json',
      },
    };
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.errors) {
            console.log('  API Erreur:', JSON.stringify(json.errors).substring(0, 200));
          }
          resolve(json);
        } catch (e) {
          console.log('  API Response brute:', body.substring(0, 300));
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getPlayerSlugFromName(playerName) {
  const query = `
    query SearchPlayer($input: String!) {
      football {
        players(search: $input, first: 5) {
          nodes {
            slug
            displayName
          }
        }
      }
    }
  `;
  
  try {
    const result = await graphqlQuery(query, { input: playerName });
    if (result.data?.football?.players?.nodes?.length > 0) {
      return result.data.football.players.nodes[0].slug;
    }
    return null;
  } catch (error) {
    console.error('Erreur recherche joueur:', error.message);
    return null;
  }
}

async function getSalesHistoryFromAPI(playerSlug, rarity) {
  // L'API publique ne donne pas l'historique complet des ventes
  // On retourne un tableau vide - les ventes seront trackees au fil du temps
  console.log('  Note: Historique ventes non disponible via API publique');
  return { listings: [], sales: [] };
}

async function getTransferHistory(playerSlug, rarity) {
  // Requete pour obtenir les cartes en vente d'un joueur
  const query = `
    query GetPlayerCards($slug: String!) {
      football {
        player(slug: $slug) {
          displayName
          slug
        }
      }
      tokens {
        liveSingleSaleOffers(first: 50) {
          nodes {
            price
            anyCards {
              slug
              name
              rarityTyped
              anyPlayer {
                slug
                displayName
              }
            }
          }
        }
      }
    }
  `;
  
  try {
    const result = await graphqlQuery(query, { slug: playerSlug });
    
    const playerName = result.data?.football?.player?.displayName || playerSlug;
    const offers = result.data?.tokens?.liveSingleSaleOffers?.nodes || [];
    
    // Filtrer pour ce joueur et cette rarete
    const listings = [];
    const rarityMap = {
      'super_rare': 'SUPER_RARE',
      'rare': 'RARE',
      'unique': 'UNIQUE',
      'limited': 'LIMITED',
    };
    const targetRarity = rarityMap[rarity] || rarity.toUpperCase();
    
    for (const offer of offers) {
      for (const card of (offer.anyCards || [])) {
        const cardPlayerSlug = card.anyPlayer?.slug;
        const cardRarity = card.rarityTyped;
        
        if (cardPlayerSlug === playerSlug && cardRarity === targetRarity) {
          listings.push({
            slug: card.slug,
            price: offer.price ? parseFloat(offer.price) / 1e18 : null, // Convertir wei en ETH
            url: 'https://sorare.com/fr/football/cards/' + card.slug,
          });
        }
      }
    }
    
    console.log('  API: Offres filtrees: ' + listings.length + ' pour ' + playerSlug);
    return { listings, playerName };
    
  } catch (error) {
    console.error('  Erreur API transfers:', error.message);
    return { listings: [], playerName: '' };
  }
}

// ============================================================
//                    SERVEUR EXPRESS
// ============================================================

const app = express();
app.use(express.json());

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
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

app.get('/api/prices/:slug', (req, res) => {
  const slug = req.params.slug;
  const player = watchlist.players.find(p => p.slug === slug);
  
  if (!player) {
    return res.status(404).json({ error: 'Joueur non trouve' });
  }
  
  const key = slug + '_' + player.rarity;
  const history = priceHistory[key] || [];
  
  res.json({
    player: player.name,
    rarity: player.rarity,
    history: history,
  });
});

// Dashboard HTML
app.get('/', (req, res) => {
  const playersHtml = watchlist.players.map(p => {
    const key = p.slug + '_' + p.rarity;
    const history = priceHistory[key] || [];
    const latest = history.length > 0 ? history[history.length - 1] : null;
    
    return '<div class="player-item">' +
      '<div class="player-info">' +
        '<span class="player-name">' + p.name + '</span>' +
        '<span class="player-rarity ' + p.rarity + '">' + p.rarity.replace('_', ' ') + '</span>' +
        (latest && latest.price ? '<span class="current-price">' + latest.price + ' E</span>' : '') +
      '</div>' +
      '<div class="player-actions">' +
        '<input type="number" class="price-input" data-slug="' + p.slug + '" data-type="player" value="' + (p.maxPrice || '') + '" placeholder="Max E">' +
        '<button class="btn-small danger" data-slug="' + p.slug + '" data-type="player">X</button>' +
      '</div>' +
    '</div>';
  }).join('');

  const clubsHtml = watchlist.clubs.map(c => {
    return '<div class="player-item club-item">' +
      '<div class="player-info">' +
        '<span class="player-name">' + c.name + '</span>' +
        '<span class="player-rarity ' + c.rarity + '">' + c.rarity.replace('_', ' ') + '</span>' +
      '</div>' +
      '<div class="player-actions">' +
        '<input type="number" class="price-input" data-slug="' + c.slug + '" data-type="club" value="' + (c.maxPrice || '') + '" placeholder="Max E">' +
        '<button class="btn-small danger" data-slug="' + c.slug + '" data-type="club">X</button>' +
      '</div>' +
    '</div>';
  }).join('');

  const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Sorare Alert Bot</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);min-height:100vh;color:#fff;padding:20px}.container{max-width:1000px;margin:0 auto}header{text-align:center;margin-bottom:30px}header h1{font-size:2rem;margin-bottom:10px}header h1 span{color:#7c3aed}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin-bottom:30px}.stat-card{background:rgba(255,255,255,0.1);border-radius:12px;padding:20px;text-align:center}.stat-card .value{font-size:2rem;font-weight:bold;color:#7c3aed}.stat-card .label{font-size:0.85rem;color:#aaa;margin-top:5px}.section{background:rgba(255,255,255,0.05);border-radius:16px;padding:25px;margin-bottom:25px}.section h2{font-size:1.3rem;margin-bottom:20px}.add-form{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;margin-bottom:20px}@media(max-width:600px){.add-form{grid-template-columns:1fr}}input,select,button{padding:12px 16px;border-radius:8px;border:none;font-size:1rem}input,select{background:rgba(255,255,255,0.1);color:#fff}input::placeholder{color:#888}input:focus,select:focus{outline:2px solid #7c3aed}button{background:#7c3aed;color:#fff;cursor:pointer;font-weight:600;transition:all 0.2s}button:hover{background:#6d28d9}button.danger{background:#dc2626}button.danger:hover{background:#b91c1c}.player-list{display:flex;flex-direction:column;gap:10px}.player-item{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.08);padding:15px 20px;border-radius:10px;flex-wrap:wrap;gap:10px}.player-info{display:flex;align-items:center;gap:15px;flex:1}.player-name{font-weight:600;font-size:1.1rem}.player-rarity{background:#7c3aed;padding:4px 10px;border-radius:20px;font-size:0.75rem;text-transform:uppercase}.player-rarity.unique{background:#eab308;color:#000}.player-rarity.rare{background:#3b82f6}.current-price{color:#22c55e;font-weight:bold;margin-left:10px}.player-actions{display:flex;align-items:center;gap:10px}.price-input{width:100px;text-align:center}.btn-small{padding:8px 12px;font-size:0.85rem}.empty-state{text-align:center;padding:40px;color:#888}.toast{position:fixed;bottom:20px;right:20px;background:#22c55e;color:#fff;padding:15px 25px;border-radius:10px;font-weight:600;transform:translateY(100px);opacity:0;transition:all 0.3s}.toast.show{transform:translateY(0);opacity:1}.toast.error{background:#dc2626}.scan-btn{width:100%;padding:15px;font-size:1.1rem;margin-top:10px}.last-scan{text-align:center;color:#888;font-size:0.9rem;margin-top:15px}.club-item{border-left:4px solid #eab308}.sheets-link{display:inline-block;margin-top:10px;color:#7c3aed;text-decoration:none}.sheets-link:hover{text-decoration:underline}</style></head><body><div class="container"><header><h1>Sorare <span>Alert Bot</span></h1><p>Dashboard de gestion des alertes</p><a class="sheets-link" href="https://docs.google.com/spreadsheets/d/' + config.GOOGLE_SHEET_ID + '" target="_blank">Voir Google Sheets</a></header><div class="stats-grid"><div class="stat-card"><div class="value">' + watchlist.players.length + '</div><div class="label">Joueurs suivis</div></div><div class="stat-card"><div class="value">' + watchlist.clubs.length + '</div><div class="label">Clubs suivis</div></div><div class="stat-card"><div class="value">' + stats.totalScans + '</div><div class="label">Scans totaux</div></div><div class="stat-card"><div class="value">' + stats.alertsSent + '</div><div class="label">Alertes envoyees</div></div></div><div class="section"><h2>Joueurs surveilles</h2><div class="add-form"><input type="text" id="player-slug" placeholder="Slug du joueur (ex: bradley-barcola)"><select id="player-rarity"><option value="super_rare">Super Rare</option><option value="rare">Rare</option><option value="unique">Unique</option></select><input type="number" id="player-maxprice" placeholder="Prix max E"><button id="add-player-btn">Ajouter</button></div><div class="player-list" id="player-list">' + (playersHtml || '<div class="empty-state">Aucun joueur surveille</div>') + '</div></div><div class="section"><h2>Clubs surveilles</h2><div class="add-form"><input type="text" id="club-slug" placeholder="Slug du club (ex: toulouse-toulouse)"><select id="club-rarity"><option value="unique">Unique</option><option value="super_rare">Super Rare</option><option value="rare">Rare</option></select><input type="number" id="club-maxprice" placeholder="Prix max E"><button id="add-club-btn">Ajouter</button></div><div class="player-list" id="club-list">' + (clubsHtml || '<div class="empty-state">Aucun club surveille</div>') + '</div></div><div class="section"><h2>Actions</h2><button class="scan-btn" id="scan-btn">Lancer un scan maintenant</button><p class="last-scan" id="last-scan">Dernier scan : ' + (stats.lastScan ? new Date(stats.lastScan).toLocaleString('fr-FR') : '-') + '</p></div></div><div class="toast" id="toast"></div><script>function showToast(m,e){var t=document.getElementById("toast");t.textContent=m;t.className="toast show"+(e?" error":"");setTimeout(function(){t.className="toast"},3000)}document.getElementById("add-player-btn").addEventListener("click",function(){var s=document.getElementById("player-slug").value.trim();var r=document.getElementById("player-rarity").value;var p=document.getElementById("player-maxprice").value;if(!s){showToast("Entre un slug",true);return}fetch("/watchlist/player",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:s,rarity:r,maxPrice:p?parseFloat(p):null})}).then(function(res){if(res.ok){showToast("Joueur ajoute!");location.reload()}else{showToast("Erreur",true)}})});document.getElementById("add-club-btn").addEventListener("click",function(){var s=document.getElementById("club-slug").value.trim();var r=document.getElementById("club-rarity").value;var p=document.getElementById("club-maxprice").value;if(!s){showToast("Entre un slug",true);return}fetch("/watchlist/club",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:s,rarity:r,maxPrice:p?parseFloat(p):null})}).then(function(res){if(res.ok){showToast("Club ajoute!");location.reload()}else{showToast("Erreur",true)}})});document.getElementById("scan-btn").addEventListener("click",function(){showToast("Scan en cours...");fetch("/scan",{method:"POST"}).then(function(){setTimeout(function(){location.reload()},5000)})});document.querySelectorAll(".btn-small.danger").forEach(function(btn){btn.addEventListener("click",function(){var s=this.dataset.slug;var t=this.dataset.type;if(!confirm("Supprimer?")){return}fetch("/watchlist/"+t+"/"+s,{method:"DELETE"}).then(function(res){if(res.ok){showToast("Supprime");location.reload()}})})});document.querySelectorAll(".price-input").forEach(function(input){input.addEventListener("change",function(){var s=this.dataset.slug;var t=this.dataset.type;var p=this.value;fetch("/watchlist/"+t+"/"+s+"/price",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({maxPrice:p?parseFloat(p):null})}).then(function(res){if(res.ok){showToast("Prix mis a jour")}})})})</script></body></html>';

  res.send(html);
});

// API watchlist
app.get('/watchlist', (req, res) => res.json(watchlist));

app.post('/watchlist/player', (req, res) => {
  const { slug, name, rarity, maxPrice } = req.body;
  if (!slug || !rarity) return res.status(400).json({ error: 'slug et rarity requis' });
  
  if (watchlist.players.find(p => p.slug === slug && p.rarity === rarity)) {
    return res.status(400).json({ error: 'Joueur deja dans la watchlist' });
  }
  
  watchlist.players.push({
    slug,
    name: name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    rarity,
    maxPrice: maxPrice || null,
  });
  
  console.log('Joueur ajoute: ' + slug + ' (' + rarity + ')');
  res.json({ success: true, watchlist });
});

app.delete('/watchlist/player/:slug', (req, res) => {
  const before = watchlist.players.length;
  watchlist.players = watchlist.players.filter(p => p.slug !== req.params.slug);
  console.log('Joueur retire: ' + req.params.slug);
  res.json({ success: true, removed: watchlist.players.length < before, watchlist });
});

app.put('/watchlist/player/:slug/price', (req, res) => {
  const { maxPrice } = req.body;
  const player = watchlist.players.find(p => p.slug === req.params.slug);
  
  if (player) {
    player.maxPrice = maxPrice;
    console.log('Prix mis a jour: ' + player.name + ' -> ' + maxPrice + ' E');
    res.json({ success: true, player });
  } else {
    res.status(404).json({ error: 'Joueur non trouve' });
  }
});

app.post('/watchlist/club', (req, res) => {
  const { slug, name, rarity, maxPrice } = req.body;
  if (!slug || !rarity) return res.status(400).json({ error: 'slug et rarity requis' });
  
  if (watchlist.clubs.find(c => c.slug === slug && c.rarity === rarity)) {
    return res.status(400).json({ error: 'Club deja dans la watchlist' });
  }
  
  watchlist.clubs.push({
    slug,
    name: name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    rarity,
    maxPrice: maxPrice || null,
  });
  
  console.log('Club ajoute: ' + slug + ' (' + rarity + ')');
  res.json({ success: true, watchlist });
});

app.delete('/watchlist/club/:slug', (req, res) => {
  const before = watchlist.clubs.length;
  watchlist.clubs = watchlist.clubs.filter(c => c.slug !== req.params.slug);
  console.log('Club retire: ' + req.params.slug);
  res.json({ success: true, removed: watchlist.clubs.length < before, watchlist });
});

app.put('/watchlist/club/:slug/price', (req, res) => {
  const { maxPrice } = req.body;
  const club = watchlist.clubs.find(c => c.slug === req.params.slug);
  
  if (club) {
    club.maxPrice = maxPrice;
    console.log('Prix club mis a jour: ' + club.name + ' -> ' + maxPrice + ' E');
    res.json({ success: true, club });
  } else {
    res.status(404).json({ error: 'Club non trouve' });
  }
});

app.post('/scan', async (req, res) => {
  res.json({ message: 'Scan lance' });
  await scanMarket();
});

// ============================================================
//                    DEMARRAGE
// ============================================================

async function start() {
  console.log('========================================');
  console.log('  SORARE PRICE ALERT BOT');
  console.log('  Avec tracking des prix');
  console.log('========================================');
  console.log('Clubs surveilles    : ' + watchlist.clubs.length);
  console.log('Joueurs surveilles  : ' + watchlist.players.length);
  console.log('Intervalle scan     : ' + (config.SCAN_INTERVAL_MS / 1000 / 60) + ' minutes');
  console.log('Proxy NordVPN       : ' + (config.NORDVPN_USER ? 'Active' : 'Non configure'));
  console.log('Discord             : ' + (config.DISCORD_TOKEN ? 'Configure' : 'Non configure'));
  console.log('Google Sheets       : ' + (config.GOOGLE_CREDENTIALS ? 'Configure' : 'Non configure'));
  console.log('========================================');
  
  await initGoogleSheets();
  
  app.listen(config.PORT, () => {
    console.log('Serveur demarre sur le port ' + config.PORT);
  });
  
  if (config.DISCORD_TOKEN) {
    await registerDiscordCommands();
    await discordClient.login(config.DISCORD_TOKEN);
    console.log('Bot Discord connecte');
  }
  
  setTimeout(scanMarket, 10000);
  setInterval(scanMarket, config.SCAN_INTERVAL_MS);
  
  // Scan historique des ventes toutes les 6 heures
  setTimeout(scanSalesHistory, 60000);
  setInterval(scanSalesHistory, 6 * 60 * 60 * 1000);
}

start().catch(console.error);
