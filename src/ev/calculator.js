/**
 * Calculateur EV (Expected Value) automatisé
 * Logique extraite du fichier Excel sorare_SR_tracker.xlsx
 */
const db = require('../db');

/**
 * Calcule le cash pool total d'une ligue à partir de la config rewards
 */
function calculateCashPool(league) {
  const rewards = db.getRewardsConfig().filter(r => r.league === league);
  let total = 0;
  for (const r of rewards) {
    const nbPlaces = r.place_to - r.place_from + 1;
    total += r.reward * nbPlaces;
  }
  return total;
}

/**
 * Calcule l'EV de base pour une ligue donnée avec N participants
 * EV = Cash Pool Total / Nombre de participants
 */
function calculateBaseEV(league, participants) {
  if (!participants || participants <= 0) return null;
  const cashPool = calculateCashPool(league);
  return cashPool / participants;
}

/**
 * Calcule l'EV ajusté avec le multiplicateur d'edge personnel
 */
function calculateAdjustedEV(league, participants) {
  const baseEV = calculateBaseEV(league, participants);
  if (baseEV === null) return null;

  const edges = db.getUserEdge();
  const edge = edges.find(e => e.league === league);
  const multiplier = edge ? edge.edge_multiplier : 1.0;

  return baseEV * multiplier;
}

/**
 * Calcule les EV pour toutes les ligues d'une GW donnée
 */
function calculateAllEV(gwNumber) {
  const gwData = db.getGameweekData(gwNumber);
  if (gwData.length === 0) return [];

  const results = [];
  const edges = db.getUserEdge();

  for (const gw of gwData) {
    const cashPool = calculateCashPool(gw.league);
    const baseEV = gw.participants > 0 ? cashPool / gw.participants : 0;
    const edge = edges.find(e => e.league === gw.league);
    const multiplier = edge ? edge.edge_multiplier : 1.0;
    const adjustedEV = baseEV * multiplier;

    results.push({
      league: gw.league,
      participants: gw.participants,
      cashPool,
      evBase: baseEV,
      evAdjusted: adjustedEV,
      edgeMultiplier: multiplier,
    });
  }

  // Trier par EV ajusté décroissant
  results.sort((a, b) => b.evAdjusted - a.evAdjusted);

  // Identifier la meilleure ligue
  const bestLeague = results.length > 0 ? results[0].league : null;

  // Sauvegarder dans l'historique
  for (const r of results) {
    db.addEVHistory(gwNumber, r.league, r.evBase, r.evAdjusted, r.participants, r.cashPool, bestLeague);
  }

  return results;
}

/**
 * Récupère le résumé EV actuel (dernière GW enregistrée)
 */
function getCurrentEVSummary() {
  const latestGW = db.getLatestGameweek();
  if (!latestGW || !latestGW.gw) return null;

  const evData = db.getLatestEV();
  if (evData.length === 0) {
    // Calculer si pas encore fait
    const results = calculateAllEV(latestGW.gw);
    return {
      gwNumber: latestGW.gw,
      leagues: results,
      bestLeague: results.length > 0 ? results[0].league : null,
    };
  }

  return {
    gwNumber: latestGW.gw,
    leagues: evData.map(ev => ({
      league: ev.league,
      participants: ev.participants,
      cashPool: ev.total_cash_pool,
      evBase: ev.ev_base,
      evAdjusted: ev.ev_adjusted,
    })),
    bestLeague: evData.length > 0 ? evData[0].league : null,
  };
}

/**
 * Analyse la tendance des participants pour une ligue
 */
function getParticipantsTrend(league, lastN) {
  const allGW = db.getGameweekData();
  const leagueData = allGW.filter(g => g.league === league).sort((a, b) => a.gw_number - b.gw_number);

  if (leagueData.length < 2) return { trend: 0, direction: 'stable' };

  const recent = leagueData.slice(-(lastN || 5));
  const first = recent[0].participants;
  const last = recent[recent.length - 1].participants;

  const trend = ((last - first) / first) * 100;
  const direction = trend > 5 ? 'up' : trend < -5 ? 'down' : 'stable';

  return {
    trend: trend.toFixed(1),
    direction,
    first,
    last,
    dataPoints: recent,
  };
}

/**
 * Recommandation de la meilleure ligue à jouer
 */
function getBestLeagueRecommendation() {
  const summary = getCurrentEVSummary();
  if (!summary) return null;

  const edges = db.getUserEdge();
  const recommendations = [];

  for (const league of summary.leagues) {
    const trend = getParticipantsTrend(league.league, 5);
    const edge = edges.find(e => e.league === league.league);

    recommendations.push({
      league: league.league,
      evAdjusted: league.evAdjusted,
      evBase: league.evBase,
      participants: league.participants,
      participantsTrend: trend.direction,
      participantsTrendPct: trend.trend,
      edge: edge ? edge.edge_multiplier : 1.0,
      score: league.evAdjusted * (trend.direction === 'down' ? 1.1 : trend.direction === 'up' ? 0.9 : 1.0),
    });
  }

  recommendations.sort((a, b) => b.score - a.score);
  return recommendations;
}

module.exports = {
  calculateCashPool,
  calculateBaseEV,
  calculateAdjustedEV,
  calculateAllEV,
  getCurrentEVSummary,
  getParticipantsTrend,
  getBestLeagueRecommendation,
};
