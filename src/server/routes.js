/**
 * Routes API Express
 */
const express = require('express');
const path = require('path');
const db = require('../db');
const ev = require('../ev/calculator');

function createRouter(botStats) {
  const router = express.Router();
  router.use(express.json());

  // Serve static dashboard from public/
  router.use(express.static(path.join(__dirname, '../../public')));

  // Fallback to index.html for SPA
  router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  // Status
  router.get('/api/status', (req, res) => {
    const wl = db.getWatchlist();
    const portfolioStats = db.getPortfolioStats();
    res.json({
      status: 'running',
      lastScan: botStats.lastScan,
      totalScans: botStats.totalScans,
      alertsSent: botStats.alertsSent,
      watchlist: { clubs: wl.clubs.length, players: wl.players.length },
      portfolio: portfolioStats,
    });
  });

  // === WATCHLIST ===

  router.get('/api/watchlist', (req, res) => res.json(db.getWatchlist()));

  router.post('/api/watchlist/player', (req, res) => {
    const { slug, name, rarity, maxPrice } = req.body;
    if (!slug || !rarity) return res.status(400).json({ error: 'slug et rarity requis' });
    const playerName = name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    db.addToWatchlist(slug, playerName, 'player', rarity, maxPrice);
    res.json({ success: true });
  });

  router.post('/api/watchlist/club', (req, res) => {
    const { slug, name, rarity, maxPrice } = req.body;
    if (!slug || !rarity) return res.status(400).json({ error: 'slug et rarity requis' });
    const clubName = name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    db.addToWatchlist(slug, clubName, 'club', rarity, maxPrice);
    res.json({ success: true });
  });

  router.delete('/api/watchlist/:type/:slug', (req, res) => {
    db.removeFromWatchlist(req.params.slug, req.params.type);
    res.json({ success: true });
  });

  router.put('/api/watchlist/:type/:slug/price', (req, res) => {
    const { maxPrice } = req.body;
    db.updateMaxPrice(req.params.slug, req.params.type, maxPrice);
    res.json({ success: true });
  });

  // === PRICES ===

  router.get('/api/prices/:slug', (req, res) => {
    const { slug } = req.params;
    const rarity = req.query.rarity || 'super_rare';
    const days = parseInt(req.query.days) || 30;
    const history = db.getPriceHistory(slug, rarity, days);
    const latest = db.getLatestPrice(slug, rarity);
    const sales = db.getSales(slug, rarity, days);
    const avgSale = db.getAvgSalePrice(slug, rarity, days);
    res.json({ slug, rarity, history, latest, sales, avgSale });
  });

  // === PORTFOLIO ===

  router.get('/api/portfolio', (req, res) => {
    const portfolio = db.getPortfolioWithValues();
    const stats = db.getPortfolioStats();
    res.json({ portfolio, stats });
  });

  router.post('/api/portfolio', (req, res) => {
    const { playerSlug, rarity, buyPrice, buyType, season, serial, notes } = req.body;
    if (!playerSlug || !rarity) return res.status(400).json({ error: 'playerSlug et rarity requis' });
    const name = playerSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    db.addToPortfolio({
      cardSlug: playerSlug + '-' + rarity + '-' + Date.now(),
      playerSlug,
      playerName: name,
      rarity,
      season: season || null,
      serial: serial || null,
      buyPrice: buyPrice || 0,
      buyDate: new Date().toISOString(),
      buyType: buyType || 'market',
      notes: notes || null,
    });
    res.json({ success: true });
  });

  router.post('/api/portfolio/sell', (req, res) => {
    const { cardSlug, sellPrice } = req.body;
    if (!cardSlug || sellPrice === undefined) return res.status(400).json({ error: 'cardSlug et sellPrice requis' });
    db.sellFromPortfolio(cardSlug, sellPrice, new Date().toISOString());
    res.json({ success: true });
  });

  // === GAMEWEEK & EV ===

  router.get('/api/ev', (req, res) => {
    const gwNum = req.query.gw ? parseInt(req.query.gw) : null;
    if (gwNum) {
      const results = ev.calculateAllEV(gwNum);
      res.json({ gwNumber: gwNum, leagues: results });
    } else {
      const summary = ev.getCurrentEVSummary();
      res.json(summary);
    }
  });

  router.get('/api/ev/recommendation', (req, res) => {
    const recs = ev.getBestLeagueRecommendation();
    res.json(recs || []);
  });

  router.get('/api/ev/history', (req, res) => {
    const league = req.query.league;
    const limit = parseInt(req.query.limit) || 50;
    res.json(db.getEVHistory(league, limit));
  });

  router.post('/api/gameweek', (req, res) => {
    const { gwNumber, league, participants } = req.body;
    if (!gwNumber || !league || !participants) return res.status(400).json({ error: 'gwNumber, league et participants requis' });
    db.addGameweekData(gwNumber, league, participants);
    const results = ev.calculateAllEV(gwNumber);
    res.json({ success: true, ev: results });
  });

  router.get('/api/gameweek', (req, res) => {
    const gwNum = req.query.gw ? parseInt(req.query.gw) : null;
    res.json(db.getGameweekData(gwNum));
  });

  // === EDGE ===

  router.get('/api/edge', (req, res) => {
    res.json(db.getUserEdge());
  });

  router.post('/api/edge', (req, res) => {
    const { league, multiplier } = req.body;
    if (!league || multiplier === undefined) return res.status(400).json({ error: 'league et multiplier requis' });
    db.setUserEdge(league, multiplier);
    res.json({ success: true });
  });

  // === REWARDS CONFIG ===

  router.get('/api/rewards', (req, res) => {
    res.json(db.getRewardsConfig());
  });

  router.post('/api/rewards', (req, res) => {
    const { league, placeFrom, placeTo, reward } = req.body;
    if (!league || !placeFrom || !placeTo || reward === undefined) return res.status(400).json({ error: 'Parametres manquants' });
    db.updateRewardsConfig(league, placeFrom, placeTo, reward);
    res.json({ success: true });
  });

  // === AUCTIONS ===

  router.get('/api/auctions', (req, res) => {
    const rarity = req.query.rarity;
    res.json(db.getActiveAuctions(rarity));
  });

  router.get('/api/auction-alerts', (req, res) => {
    res.json(db.getAuctionAlerts());
  });

  router.post('/api/auction-alert', (req, res) => {
    const { slug, rarity, maxBid } = req.body;
    if (!slug || !rarity || !maxBid) return res.status(400).json({ error: 'slug, rarity et maxBid requis' });
    db.setAuctionAlert(slug, rarity, maxBid);
    res.json({ success: true });
  });

  // === OPPORTUNITIES ===

  router.get('/api/opportunities', (req, res) => {
    res.json(db.getActiveOpportunities());
  });

  // === MERCATO (rumeurs de transfert) ===

  router.get('/api/mercato', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const league = req.query.league || null;
    res.json(db.getRecentRumors(limit, league));
  });

  router.post('/api/mercato/scan', (req, res) => {
    res.json({ message: 'Scan mercato lance' });
    if (typeof global.triggerMercatoScan === 'function') {
      global.triggerMercatoScan();
    }
  });

  // === JOUER (Play) ===

  router.get('/api/play/stats', (req, res) => {
    res.json(db.getPlayStats());
  });

  router.get('/api/play/results', (req, res) => {
    const league = req.query.league;
    const limit = parseInt(req.query.limit) || 50;
    if (league) {
      res.json(db.getGWResultsByLeague(league, limit));
    } else {
      res.json(db.getGWResults(limit));
    }
  });

  router.post('/api/play/result', (req, res) => {
    const { gwNumber, league, rank, totalScore, rewardEarned, participants } = req.body;
    if (!gwNumber || !league) return res.status(400).json({ error: 'gwNumber et league requis' });
    db.saveGWResult({ gwNumber, league, rank, totalScore, rewardEarned: rewardEarned || 0, participants });
    res.json({ success: true });
  });

  router.get('/api/play/lineups', (req, res) => {
    const gw = req.query.gw ? parseInt(req.query.gw) : null;
    res.json(db.getLineups(gw));
  });

  router.post('/api/play/lineup', (req, res) => {
    const { gwNumber, league, cardSlugs } = req.body;
    if (!gwNumber || !league) return res.status(400).json({ error: 'gwNumber et league requis' });
    db.saveLineup(gwNumber, league, cardSlugs || [], 'submitted');
    res.json({ success: true });
  });

  // === MARCHE DES TRANSFERTS ===

  router.get('/api/market/listings', (req, res) => {
    const { query, rarity, minPrice, maxPrice } = req.query;
    if (query || rarity || minPrice || maxPrice) {
      res.json(db.searchMarket(query, rarity, minPrice ? parseFloat(minPrice) : null, maxPrice ? parseFloat(maxPrice) : null));
    } else {
      res.json(db.getAllListedPlayers());
    }
  });

  router.get('/api/market/recent-sales', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(db.getRecentSales(limit));
  });

  // === RENTABILITE ===

  router.get('/api/profitability', (req, res) => {
    res.json(db.getProfitabilityOverview());
  });

  // === SCAN TRIGGER ===

  router.post('/api/scan', (req, res) => {
    res.json({ message: 'Scan lance' });
    if (typeof global.triggerScan === 'function') {
      global.triggerScan();
    }
  });

  // Legacy routes compatibility
  router.get('/watchlist', (req, res) => res.json(db.getWatchlist()));
  router.post('/watchlist/player', (req, res) => {
    const { slug, name, rarity, maxPrice } = req.body;
    if (!slug || !rarity) return res.status(400).json({ error: 'slug et rarity requis' });
    const playerName = name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    db.addToWatchlist(slug, playerName, 'player', rarity, maxPrice);
    res.json({ success: true, watchlist: db.getWatchlist() });
  });
  router.delete('/watchlist/player/:slug', (req, res) => {
    db.removeFromWatchlist(req.params.slug, 'player');
    res.json({ success: true, watchlist: db.getWatchlist() });
  });
  router.put('/watchlist/player/:slug/price', (req, res) => {
    db.updateMaxPrice(req.params.slug, 'player', req.body.maxPrice);
    res.json({ success: true });
  });
  router.post('/watchlist/club', (req, res) => {
    const { slug, name, rarity, maxPrice } = req.body;
    if (!slug || !rarity) return res.status(400).json({ error: 'slug et rarity requis' });
    const clubName = name || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    db.addToWatchlist(slug, clubName, 'club', rarity, maxPrice);
    res.json({ success: true, watchlist: db.getWatchlist() });
  });
  router.delete('/watchlist/club/:slug', (req, res) => {
    db.removeFromWatchlist(req.params.slug, 'club');
    res.json({ success: true, watchlist: db.getWatchlist() });
  });
  router.put('/watchlist/club/:slug/price', (req, res) => {
    db.updateMaxPrice(req.params.slug, 'club', req.body.maxPrice);
    res.json({ success: true });
  });
  router.post('/scan', async (req, res) => {
    res.json({ message: 'Scan lance' });
    if (typeof global.triggerScan === 'function') global.triggerScan();
  });

  return router;
}

module.exports = { createRouter };
