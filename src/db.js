/**
 * SQLite Database - Persistance des données Sorare
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let db;

function init() {
  const dbDir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  seedDefaultData();
  console.log('Base de donnees SQLite initialisee: ' + config.DB_PATH);
  return db;
}

function createTables() {
  db.exec(`
    -- Watchlist joueurs et clubs
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('player', 'club')),
      rarity TEXT NOT NULL,
      max_price REAL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(slug, rarity, type)
    );

    -- Historique des prix (listings)
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      rarity TEXT NOT NULL,
      min_price REAL,
      median_price REAL,
      avg_price REAL,
      nb_listings INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    -- Historique des ventes
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      player_name TEXT,
      rarity TEXT NOT NULL,
      price REAL NOT NULL,
      sale_type TEXT,
      season TEXT,
      serial INTEGER,
      buyer TEXT,
      seller TEXT,
      card_slug TEXT,
      sale_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(slug, rarity, price, sale_date, card_slug)
    );

    -- Enchères (marché primaire)
    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_slug TEXT NOT NULL,
      player_name TEXT,
      player_slug TEXT,
      rarity TEXT NOT NULL,
      current_bid REAL,
      min_bid REAL,
      nb_bids INTEGER DEFAULT 0,
      end_time TEXT,
      status TEXT DEFAULT 'active',
      season TEXT,
      serial INTEGER,
      url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(card_slug)
    );

    -- Seuils d'enchères automatiques
    CREATE TABLE IF NOT EXISTS auction_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      rarity TEXT NOT NULL,
      max_bid REAL NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(slug, rarity)
    );

    -- Portfolio (cartes possédées)
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_slug TEXT NOT NULL UNIQUE,
      player_slug TEXT NOT NULL,
      player_name TEXT,
      rarity TEXT NOT NULL,
      season TEXT,
      serial INTEGER,
      buy_price REAL,
      buy_date TEXT,
      buy_type TEXT,
      current_value REAL,
      last_value_update TEXT,
      sold INTEGER DEFAULT 0,
      sell_price REAL,
      sell_date TEXT,
      notes TEXT
    );

    -- Données par gameweek (participants par ligue)
    CREATE TABLE IF NOT EXISTS gameweek_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gw_number INTEGER NOT NULL,
      gw_date TEXT,
      league TEXT NOT NULL,
      participants INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(gw_number, league)
    );

    -- Configuration des rewards par ligue
    CREATE TABLE IF NOT EXISTS rewards_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league TEXT NOT NULL,
      place_from INTEGER NOT NULL,
      place_to INTEGER NOT NULL,
      reward REAL NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(league, place_from, place_to)
    );

    -- Edge personnel par ligue
    CREATE TABLE IF NOT EXISTS user_edge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league TEXT NOT NULL UNIQUE,
      edge_multiplier REAL DEFAULT 1.0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Historique EV calculé
    CREATE TABLE IF NOT EXISTS ev_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gw_number INTEGER NOT NULL,
      league TEXT NOT NULL,
      ev_base REAL,
      ev_adjusted REAL,
      participants INTEGER,
      total_cash_pool REAL,
      best_league TEXT,
      calculated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(gw_number, league)
    );

    -- Opportunités détectées
    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      player_name TEXT,
      rarity TEXT NOT NULL,
      opportunity_type TEXT NOT NULL,
      current_price REAL,
      target_price REAL,
      avg_sale_price REAL,
      discount_pct REAL,
      score REAL,
      details TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      notified INTEGER DEFAULT 0
    );

    -- Index pour les performances
    CREATE INDEX IF NOT EXISTS idx_price_history_slug ON price_history(slug, rarity);
    CREATE INDEX IF NOT EXISTS idx_price_history_ts ON price_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sales_slug ON sales(slug, rarity);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
    CREATE INDEX IF NOT EXISTS idx_auctions_player ON auctions(player_slug);
    CREATE INDEX IF NOT EXISTS idx_portfolio_player ON portfolio(player_slug);
    CREATE INDEX IF NOT EXISTS idx_ev_history_gw ON ev_history(gw_number);
    CREATE INDEX IF NOT EXISTS idx_opportunities_active ON opportunities(active, notified);
  `);
}

function seedDefaultData() {
  // Seed rewards config from Excel data if table is empty
  const count = db.prepare('SELECT COUNT(*) as c FROM rewards_config').get();
  if (count.c === 0) {
    const rewards = [
      // [league, place_from, place_to, reward_per_place]
      ['Ligue 1', 1, 1, 4000], ['Ligue 1', 2, 2, 2000], ['Ligue 1', 3, 3, 1000],
      ['Ligue 1', 4, 4, 600], ['Ligue 1', 5, 5, 500], ['Ligue 1', 6, 10, 400],
      ['Ligue 1', 11, 15, 300], ['Ligue 1', 16, 20, 150],

      ['Premier League', 1, 1, 5000], ['Premier League', 2, 2, 2500], ['Premier League', 3, 3, 1200],
      ['Premier League', 4, 4, 800], ['Premier League', 5, 5, 600], ['Premier League', 6, 10, 500],
      ['Premier League', 11, 15, 400], ['Premier League', 16, 20, 200], ['Premier League', 21, 25, 100],

      ['LaLiga', 1, 1, 4000], ['LaLiga', 2, 2, 2000], ['LaLiga', 3, 3, 1000],
      ['LaLiga', 4, 4, 600], ['LaLiga', 5, 5, 500], ['LaLiga', 6, 10, 400],
      ['LaLiga', 11, 15, 300], ['LaLiga', 16, 20, 150], ['LaLiga', 21, 25, 75],

      ['Bundesliga', 1, 1, 4000], ['Bundesliga', 2, 2, 2000], ['Bundesliga', 3, 3, 1000],
      ['Bundesliga', 4, 4, 600], ['Bundesliga', 5, 5, 500], ['Bundesliga', 6, 10, 400],
      ['Bundesliga', 11, 15, 300], ['Bundesliga', 16, 20, 150],

      ['Eredivisie', 1, 1, 2500], ['Eredivisie', 2, 2, 1200], ['Eredivisie', 3, 3, 600],
      ['Eredivisie', 4, 4, 400], ['Eredivisie', 5, 5, 300], ['Eredivisie', 6, 10, 150],
      ['Eredivisie', 11, 15, 100], ['Eredivisie', 16, 20, 70],

      ['Jupiler Pro', 1, 1, 2000], ['Jupiler Pro', 2, 2, 1000], ['Jupiler Pro', 3, 3, 500],
      ['Jupiler Pro', 4, 4, 300], ['Jupiler Pro', 5, 5, 200], ['Jupiler Pro', 6, 10, 120],
      ['Jupiler Pro', 11, 15, 70], ['Jupiler Pro', 16, 20, 50],

      ['Challenger', 1, 1, 1875], ['Challenger', 2, 2, 900], ['Challenger', 3, 3, 450],
      ['Challenger', 4, 4, 300], ['Challenger', 5, 5, 225], ['Challenger', 6, 10, 100],
      ['Challenger', 11, 15, 75], ['Challenger', 16, 20, 50],

      ['Contender', 1, 1, 1500], ['Contender', 2, 2, 750], ['Contender', 3, 3, 375],
      ['Contender', 4, 4, 225], ['Contender', 5, 5, 150], ['Contender', 6, 10, 90],
      ['Contender', 11, 15, 50], ['Contender', 16, 20, 35], ['Contender', 21, 25, 25],
    ];

    const insert = db.prepare('INSERT OR IGNORE INTO rewards_config (league, place_from, place_to, reward) VALUES (?, ?, ?, ?)');
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insert.run(...row);
    });
    insertMany(rewards);
    console.log('Rewards config importee depuis Excel');
  }

  // Seed user edge
  const edgeCount = db.prepare('SELECT COUNT(*) as c FROM user_edge').get();
  if (edgeCount.c === 0) {
    const edges = [
      ['Ligue 1', 1.3], ['Premier League', 1.0], ['LaLiga', 1.0],
      ['Bundesliga', 1.0], ['Eredivisie', 1.1], ['Jupiler Pro', 1.1],
      ['Challenger', 1.0], ['Contender', 1.0],
    ];
    const insertEdge = db.prepare('INSERT OR IGNORE INTO user_edge (league, edge_multiplier) VALUES (?, ?)');
    const insertEdges = db.transaction((rows) => {
      for (const row of rows) insertEdge.run(...row);
    });
    insertEdges(edges);
    console.log('Edge personnel importe depuis Excel');
  }

  // Seed historical GW data from Excel
  const gwCount = db.prepare('SELECT COUNT(*) as c FROM gameweek_data').get();
  if (gwCount.c === 0) {
    const gwData = [
      [1, 'Ligue 1', 67], [1, 'Premier League', 103], [1, 'LaLiga', 83], [1, 'Eredivisie', 97], [1, 'Jupiler Pro', 113],
      [3, 'Ligue 1', 118], [3, 'Premier League', 155], [3, 'LaLiga', 146], [3, 'Bundesliga', 75], [3, 'Eredivisie', 80], [3, 'Jupiler Pro', 75],
      [5, 'Ligue 1', 122], [5, 'Premier League', 168], [5, 'LaLiga', 156], [5, 'Bundesliga', 135], [5, 'Eredivisie', 99], [5, 'Jupiler Pro', 137],
      [9, 'Ligue 1', 148], [9, 'Premier League', 185], [9, 'LaLiga', 189], [9, 'Bundesliga', 157], [9, 'Eredivisie', 121], [9, 'Jupiler Pro', 147],
      [11, 'Ligue 1', 162], [11, 'Premier League', 205], [11, 'LaLiga', 197], [11, 'Bundesliga', 169], [11, 'Eredivisie', 127], [11, 'Jupiler Pro', 144],
      [13, 'Ligue 1', 184], [13, 'Premier League', 223], [13, 'LaLiga', 224], [13, 'Bundesliga', 189], [13, 'Eredivisie', 141], [13, 'Jupiler Pro', 145],
      [15, 'Ligue 1', 188], [15, 'Premier League', 230], [15, 'LaLiga', 230], [15, 'Bundesliga', 196], [15, 'Eredivisie', 148], [15, 'Jupiler Pro', 145],
      [19, 'Ligue 1', 202], [19, 'Premier League', 239], [19, 'LaLiga', 259], [19, 'Bundesliga', 211], [19, 'Eredivisie', 155], [19, 'Jupiler Pro', 154],
      [21, 'Ligue 1', 210], [21, 'Premier League', 248], [21, 'LaLiga', 251], [21, 'Bundesliga', 213], [21, 'Eredivisie', 154], [21, 'Jupiler Pro', 155],
      [23, 'Ligue 1', 205], [23, 'Premier League', 256], [23, 'LaLiga', 255], [23, 'Bundesliga', 215], [23, 'Eredivisie', 160], [23, 'Jupiler Pro', 154],
      [25, 'Ligue 1', 212], [25, 'Premier League', 262], [25, 'LaLiga', 256], [25, 'Bundesliga', 231], [25, 'Eredivisie', 173], [25, 'Jupiler Pro', 162],
      [29, 'Ligue 1', 217], [29, 'Premier League', 274], [29, 'LaLiga', 273], [29, 'Bundesliga', 238], [29, 'Eredivisie', 180], [29, 'Jupiler Pro', 164],
      [31, 'Ligue 1', 222], [31, 'Premier League', 285], [31, 'LaLiga', 282], [31, 'Bundesliga', 242], [31, 'Eredivisie', 184], [31, 'Jupiler Pro', 168],
      [33, 'Ligue 1', 226], [33, 'Premier League', 294], [33, 'LaLiga', 285], [33, 'Bundesliga', 241], [33, 'Eredivisie', 185], [33, 'Jupiler Pro', 165],
      [35, 'Ligue 1', 234], [35, 'Premier League', 300], [35, 'LaLiga', 272], [35, 'Bundesliga', 247], [35, 'Eredivisie', 165], [35, 'Jupiler Pro', 171],
      [45, 'Ligue 1', 248], [45, 'Premier League', 325], [45, 'LaLiga', 288], [45, 'Bundesliga', 272], [45, 'Eredivisie', 218], [45, 'Jupiler Pro', 189],
      [47, 'Ligue 1', 251], [47, 'Premier League', 326], [47, 'LaLiga', 297], [47, 'Bundesliga', 273], [47, 'Eredivisie', 192], [47, 'Jupiler Pro', 188],
    ];

    const insertGW = db.prepare('INSERT OR IGNORE INTO gameweek_data (gw_number, league, participants) VALUES (?, ?, ?)');
    const insertGWs = db.transaction((rows) => {
      for (const row of rows) insertGW.run(...row);
    });
    insertGWs(gwData);
    console.log('Historique GW importe depuis Excel');
  }

  // Seed default watchlist
  const wlCount = db.prepare('SELECT COUNT(*) as c FROM watchlist').get();
  if (wlCount.c === 0) {
    const items = [
      ['toulouse-toulouse', 'Toulouse FC', 'club', 'unique'],
      ['dominik-greif', 'Dominik Greif', 'player', 'super_rare'],
      ['berke-ozer', 'Berke Ozer', 'player', 'super_rare'],
      ['mike-penders', 'Mike Penders', 'player', 'super_rare'],
      ['brice-samba', 'Brice Samba', 'player', 'super_rare'],
    ];
    const insertWL = db.prepare('INSERT OR IGNORE INTO watchlist (slug, name, type, rarity) VALUES (?, ?, ?, ?)');
    const insertWLs = db.transaction((rows) => {
      for (const row of rows) insertWL.run(...row);
    });
    insertWLs(items);
    console.log('Watchlist par defaut importee');
  }
}

// ============================================================
//                    QUERY HELPERS
// ============================================================

// Watchlist
function getWatchlist() {
  return {
    players: db.prepare('SELECT * FROM watchlist WHERE type = ? AND active = 1').all('player'),
    clubs: db.prepare('SELECT * FROM watchlist WHERE type = ? AND active = 1').all('club'),
  };
}

function addToWatchlist(slug, name, type, rarity, maxPrice) {
  return db.prepare(
    'INSERT OR REPLACE INTO watchlist (slug, name, type, rarity, max_price, active) VALUES (?, ?, ?, ?, ?, 1)'
  ).run(slug, name, type, rarity, maxPrice || null);
}

function removeFromWatchlist(slug, type) {
  return db.prepare('UPDATE watchlist SET active = 0 WHERE slug = ? AND type = ?').run(slug, type);
}

function updateMaxPrice(slug, type, maxPrice) {
  return db.prepare('UPDATE watchlist SET max_price = ? WHERE slug = ? AND type = ?').run(maxPrice, slug, type);
}

// Price History
function addPriceHistory(slug, rarity, minPrice, medianPrice, avgPrice, nbListings) {
  return db.prepare(
    'INSERT INTO price_history (slug, rarity, min_price, median_price, avg_price, nb_listings) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(slug, rarity, minPrice, medianPrice, avgPrice, nbListings);
}

function getPriceHistory(slug, rarity, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(
    'SELECT * FROM price_history WHERE slug = ? AND rarity = ? AND timestamp > ? ORDER BY timestamp ASC'
  ).all(slug, rarity, cutoff);
}

function getLatestPrice(slug, rarity) {
  return db.prepare(
    'SELECT * FROM price_history WHERE slug = ? AND rarity = ? ORDER BY timestamp DESC LIMIT 1'
  ).get(slug, rarity);
}

// Sales
function addSale(data) {
  return db.prepare(`
    INSERT OR IGNORE INTO sales (slug, player_name, rarity, price, sale_type, season, serial, buyer, seller, card_slug, sale_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.slug, data.playerName, data.rarity, data.price, data.saleType, data.season, data.serial, data.buyer, data.seller, data.cardSlug, data.saleDate);
}

function getSales(slug, rarity, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(
    'SELECT * FROM sales WHERE slug = ? AND rarity = ? AND sale_date > ? ORDER BY sale_date ASC'
  ).all(slug, rarity, cutoff);
}

function getAvgSalePrice(slug, rarity, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(
    'SELECT AVG(price) as avg_price, COUNT(*) as count FROM sales WHERE slug = ? AND rarity = ? AND sale_date > ?'
  ).get(slug, rarity, cutoff);
  return result;
}

// Auctions
function upsertAuction(data) {
  return db.prepare(`
    INSERT INTO auctions (card_slug, player_name, player_slug, rarity, current_bid, min_bid, nb_bids, end_time, status, season, serial, url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(card_slug) DO UPDATE SET
      current_bid = excluded.current_bid,
      nb_bids = excluded.nb_bids,
      end_time = excluded.end_time,
      status = excluded.status,
      updated_at = datetime('now')
  `).run(data.cardSlug, data.playerName, data.playerSlug, data.rarity, data.currentBid, data.minBid, data.nbBids, data.endTime, data.status || 'active', data.season, data.serial, data.url);
}

function getActiveAuctions(rarity) {
  if (rarity) {
    return db.prepare('SELECT * FROM auctions WHERE status = ? AND rarity = ? ORDER BY end_time ASC').all('active', rarity);
  }
  return db.prepare('SELECT * FROM auctions WHERE status = ? ORDER BY end_time ASC').all('active');
}

function getAuctionAlerts() {
  return db.prepare('SELECT * FROM auction_alerts WHERE active = 1').all();
}

function setAuctionAlert(slug, rarity, maxBid) {
  return db.prepare(
    'INSERT OR REPLACE INTO auction_alerts (slug, rarity, max_bid, active) VALUES (?, ?, ?, 1)'
  ).run(slug, rarity, maxBid);
}

// Portfolio
function addToPortfolio(data) {
  return db.prepare(`
    INSERT OR REPLACE INTO portfolio (card_slug, player_slug, player_name, rarity, season, serial, buy_price, buy_date, buy_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.cardSlug, data.playerSlug, data.playerName, data.rarity, data.season, data.serial, data.buyPrice, data.buyDate, data.buyType, data.notes);
}

function getPortfolio() {
  return db.prepare('SELECT * FROM portfolio WHERE sold = 0 ORDER BY player_name').all();
}

function getPortfolioWithValues() {
  return db.prepare(`
    SELECT p.*,
      (SELECT ph.min_price FROM price_history ph WHERE ph.slug = p.player_slug AND ph.rarity = p.rarity ORDER BY ph.timestamp DESC LIMIT 1) as latest_floor
    FROM portfolio p WHERE p.sold = 0 ORDER BY p.player_name
  `).all();
}

function sellFromPortfolio(cardSlug, sellPrice, sellDate) {
  return db.prepare(
    'UPDATE portfolio SET sold = 1, sell_price = ?, sell_date = ? WHERE card_slug = ?'
  ).run(sellPrice, sellDate, cardSlug);
}

function getPortfolioStats() {
  const active = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(buy_price), 0) as total_invested FROM portfolio WHERE sold = 0
  `).get();
  const sold = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(sell_price - buy_price), 0) as total_pnl,
           COALESCE(SUM(buy_price), 0) as total_cost, COALESCE(SUM(sell_price), 0) as total_revenue
    FROM portfolio WHERE sold = 1
  `).get();
  return { active, sold };
}

// Gameweek & EV
function addGameweekData(gwNumber, league, participants, gwDate) {
  return db.prepare(
    'INSERT OR REPLACE INTO gameweek_data (gw_number, league, participants, gw_date) VALUES (?, ?, ?, ?)'
  ).run(gwNumber, league, participants, gwDate || null);
}

function getGameweekData(gwNumber) {
  if (gwNumber) {
    return db.prepare('SELECT * FROM gameweek_data WHERE gw_number = ?').all(gwNumber);
  }
  return db.prepare('SELECT * FROM gameweek_data ORDER BY gw_number ASC, league ASC').all();
}

function getLatestGameweek() {
  return db.prepare('SELECT MAX(gw_number) as gw FROM gameweek_data').get();
}

function getRewardsConfig() {
  return db.prepare('SELECT * FROM rewards_config ORDER BY league, place_from').all();
}

function updateRewardsConfig(league, placeFrom, placeTo, reward) {
  return db.prepare(
    'INSERT OR REPLACE INTO rewards_config (league, place_from, place_to, reward) VALUES (?, ?, ?, ?)'
  ).run(league, placeFrom, placeTo, reward);
}

function getUserEdge() {
  return db.prepare('SELECT * FROM user_edge ORDER BY league').all();
}

function setUserEdge(league, multiplier) {
  return db.prepare(
    'INSERT OR REPLACE INTO user_edge (league, edge_multiplier, updated_at) VALUES (?, ?, datetime(\'now\'))'
  ).run(league, multiplier);
}

function addEVHistory(gwNumber, league, evBase, evAdjusted, participants, totalCashPool, bestLeague) {
  return db.prepare(
    'INSERT OR REPLACE INTO ev_history (gw_number, league, ev_base, ev_adjusted, participants, total_cash_pool, best_league) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(gwNumber, league, evBase, evAdjusted, participants, totalCashPool, bestLeague);
}

function getEVHistory(league, limit) {
  if (league) {
    return db.prepare('SELECT * FROM ev_history WHERE league = ? ORDER BY gw_number DESC LIMIT ?').all(league, limit || 50);
  }
  return db.prepare('SELECT * FROM ev_history ORDER BY gw_number DESC, league LIMIT ?').all(limit || 200);
}

function getLatestEV() {
  const latestGW = db.prepare('SELECT MAX(gw_number) as gw FROM ev_history').get();
  if (!latestGW || !latestGW.gw) return [];
  return db.prepare('SELECT * FROM ev_history WHERE gw_number = ? ORDER BY ev_adjusted DESC').all(latestGW.gw);
}

// Opportunities
function addOpportunity(data) {
  return db.prepare(`
    INSERT INTO opportunities (slug, player_name, rarity, opportunity_type, current_price, target_price, avg_sale_price, discount_pct, score, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.slug, data.playerName, data.rarity, data.type, data.currentPrice, data.targetPrice, data.avgSalePrice, data.discountPct, data.score, data.details);
}

function getActiveOpportunities() {
  return db.prepare('SELECT * FROM opportunities WHERE active = 1 ORDER BY score DESC LIMIT 20').all();
}

function getUnnotifiedOpportunities() {
  return db.prepare('SELECT * FROM opportunities WHERE active = 1 AND notified = 0 ORDER BY score DESC').all();
}

function markOpportunitiesNotified(ids) {
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare('UPDATE opportunities SET notified = 1 WHERE id IN (' + placeholders + ')').run(...ids);
}

function deactivateOldOpportunities() {
  return db.prepare("UPDATE opportunities SET active = 0 WHERE created_at < datetime('now', '-24 hours')").run();
}

function getDb() {
  return db;
}

module.exports = {
  init, getDb,
  getWatchlist, addToWatchlist, removeFromWatchlist, updateMaxPrice,
  addPriceHistory, getPriceHistory, getLatestPrice,
  addSale, getSales, getAvgSalePrice,
  upsertAuction, getActiveAuctions, getAuctionAlerts, setAuctionAlert,
  addToPortfolio, getPortfolio, getPortfolioWithValues, sellFromPortfolio, getPortfolioStats,
  addGameweekData, getGameweekData, getLatestGameweek,
  getRewardsConfig, updateRewardsConfig,
  getUserEdge, setUserEdge,
  addEVHistory, getEVHistory, getLatestEV,
  addOpportunity, getActiveOpportunities, getUnnotifiedOpportunities, markOpportunitiesNotified, deactivateOldOpportunities,
};
