/**
 * Détecteur d'opportunités de marché
 * Analyse les listings vs historique de ventes pour trouver les bonnes affaires
 */
const db = require('../db');

/**
 * Détecte les opportunités sur le marché secondaire
 * Critères:
 * - Prix listing < prix moyen des ventes récentes (30j)
 * - Prix listing < prix floor historique
 * - Volume de ventes suffisant
 */
function detectSecondaryOpportunities() {
  const watchlist = db.getWatchlist();
  const opportunities = [];

  // Désactiver les anciennes opportunités
  db.deactivateOldOpportunities();

  for (const item of [...watchlist.players, ...watchlist.clubs]) {
    const slug = item.slug;
    const rarity = item.rarity;

    const latestPrice = db.getLatestPrice(slug, rarity);
    if (!latestPrice || !latestPrice.min_price) continue;

    const currentFloor = latestPrice.min_price;

    // Prix moyen des ventes sur 30 jours
    const avgSale = db.getAvgSalePrice(slug, rarity, 30);
    if (avgSale && avgSale.avg_price && avgSale.count >= 2) {
      const discountPct = ((avgSale.avg_price - currentFloor) / avgSale.avg_price) * 100;

      if (discountPct > 10) {
        const score = discountPct * Math.log(avgSale.count + 1);
        opportunities.push({
          slug,
          playerName: item.name,
          rarity,
          type: 'undervalued_vs_avg',
          currentPrice: currentFloor,
          targetPrice: avgSale.avg_price,
          avgSalePrice: avgSale.avg_price,
          discountPct,
          score,
          details: 'Floor ' + currentFloor.toFixed(0) + 'E vs moyenne ventes ' + avgSale.avg_price.toFixed(0) + 'E (-' + discountPct.toFixed(0) + '%, ' + avgSale.count + ' ventes)',
        });
      }
    }

    // Comparaison avec le floor historique sur 7 jours
    const priceHistory7d = db.getPriceHistory(slug, rarity, 7);
    if (priceHistory7d.length >= 3) {
      const prices = priceHistory7d.map(p => p.min_price).filter(p => p != null);
      const avg7d = prices.reduce((a, b) => a + b, 0) / prices.length;
      const min7d = Math.min(...prices);

      if (currentFloor <= min7d && currentFloor < avg7d * 0.9) {
        const discountPct = ((avg7d - currentFloor) / avg7d) * 100;
        const score = discountPct * 2;

        opportunities.push({
          slug,
          playerName: item.name,
          rarity,
          type: 'floor_dip',
          currentPrice: currentFloor,
          targetPrice: avg7d,
          avgSalePrice: avg7d,
          discountPct,
          score,
          details: 'Nouveau floor ' + currentFloor.toFixed(0) + 'E, plus bas des 7 derniers jours (moy: ' + avg7d.toFixed(0) + 'E)',
        });
      }
    }

    // Détection de prix anormalement bas (< 2 ecarts-types)
    const priceHistory30d = db.getPriceHistory(slug, rarity, 30);
    if (priceHistory30d.length >= 5) {
      const prices = priceHistory30d.map(p => p.min_price).filter(p => p != null);
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const stdDev = Math.sqrt(prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length);

      if (currentFloor < mean - 2 * stdDev && stdDev > 0) {
        const discountPct = ((mean - currentFloor) / mean) * 100;
        const score = discountPct * 3;

        opportunities.push({
          slug,
          playerName: item.name,
          rarity,
          type: 'statistical_anomaly',
          currentPrice: currentFloor,
          targetPrice: mean,
          avgSalePrice: mean,
          discountPct,
          score,
          details: 'Prix anormalement bas! ' + currentFloor.toFixed(0) + 'E vs moyenne 30j ' + mean.toFixed(0) + 'E (>2 ecarts-types)',
        });
      }
    }
  }

  // Sauvegarder les opportunités
  for (const opp of opportunities) {
    db.addOpportunity(opp);
  }

  return opportunities;
}

/**
 * Détecte les opportunités sur les enchères
 */
function detectAuctionOpportunities() {
  const auctions = db.getActiveAuctions();
  const alerts = db.getAuctionAlerts();
  const opportunities = [];

  for (const auction of auctions) {
    if (!auction.player_slug) continue;

    // Vérifier si le prix est inférieur aux seuils d'alerte
    for (const alert of alerts) {
      if (auction.player_slug === alert.slug && auction.rarity === alert.rarity) {
        if (auction.current_bid && auction.current_bid <= alert.max_bid) {
          opportunities.push({
            slug: auction.player_slug,
            playerName: auction.player_name,
            rarity: auction.rarity,
            type: 'auction_below_threshold',
            currentPrice: auction.current_bid,
            targetPrice: alert.max_bid,
            avgSalePrice: null,
            discountPct: ((alert.max_bid - auction.current_bid) / alert.max_bid) * 100,
            score: 100,
            details: 'Enchere ' + auction.current_bid.toFixed(0) + 'E < seuil ' + alert.max_bid.toFixed(0) + 'E (' + auction.nb_bids + ' bids, fin: ' + (auction.end_time || 'N/A') + ')',
          });
        }
      }
    }

    // Comparer enchère vs prix marché secondaire
    const latestPrice = db.getLatestPrice(auction.player_slug, auction.rarity);
    if (latestPrice && latestPrice.min_price && auction.current_bid) {
      const discount = ((latestPrice.min_price - auction.current_bid) / latestPrice.min_price) * 100;
      if (discount > 15) {
        opportunities.push({
          slug: auction.player_slug,
          playerName: auction.player_name,
          rarity: auction.rarity,
          type: 'auction_vs_market',
          currentPrice: auction.current_bid,
          targetPrice: latestPrice.min_price,
          avgSalePrice: latestPrice.min_price,
          discountPct: discount,
          score: discount * 1.5,
          details: 'Enchere ' + auction.current_bid.toFixed(0) + 'E vs floor marche ' + latestPrice.min_price.toFixed(0) + 'E (-' + discount.toFixed(0) + '%)',
        });
      }
    }
  }

  for (const opp of opportunities) {
    db.addOpportunity(opp);
  }

  return opportunities;
}

module.exports = { detectSecondaryOpportunities, detectAuctionOpportunities };
