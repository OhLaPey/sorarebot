/**
 * Veille mercato via sorarescore.com/transfer-rumors
 *
 * La page est rendue cote serveur (PHP) : un simple GET renvoie tout le tableau
 * des rumeurs en HTML. Pas besoin de Puppeteer, pas de login, pas de Cloudflare.
 * On parse avec cheerio.
 *
 * Priorite : les joueurs qui QUITTENT la MLS / la J.League / la K League
 * (voir src/scraper/leagues.js) -- typiquement un depart vers l'Europe qui fait
 * grimper la valeur de la carte Sorare.
 */

const cheerio = require('cheerio');
const config = require('./../config');
const { classifyClub, SOURCE_LEAGUES } = require('./leagues');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function toNumber(str) {
  if (!str) return null;
  const digits = str.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

function parseProbability(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,3})\s*%/);
  return m ? parseInt(m[1], 10) : null;
}

function slugFromUrl(url, kind) {
  if (!url) return null;
  const m = url.match(new RegExp('/' + kind + '/([a-z0-9-]+)', 'i'));
  return m ? m[1] : null;
}

/**
 * Recupere et parse toutes les rumeurs de la page.
 * Retourne un tableau d'objets rumeur enrichis de leur classification.
 */
async function fetchTransferRumors() {
  const url = config.SORARESCORE_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.MERCATO_FETCH_TIMEOUT_MS);

  let html;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' depuis ' + url);
    }
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  return parseRumorsHtml(html);
}

/**
 * Parse le HTML du tableau des rumeurs (separe pour pouvoir tester hors-ligne).
 */
function parseRumorsHtml(html) {
  const $ = cheerio.load(html);
  const rumors = [];

  $('table tbody tr, table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 9) return; // ligne d'en-tete ou incomplete

    const date = $(tds[0]).text().trim();

    const playerCell = $(tds[1]);
    const playerUrl = playerCell.find('a').attr('href') || '';
    const playerName = (playerCell.find('.fw-semibold').first().text() || playerCell.text())
      .replace(/\s+/g, ' ')
      .trim();
    const playerSlug = slugFromUrl(playerUrl, 'player');

    const age = toNumber($(tds[2]).text());
    const role = $(tds[3]).text().trim();
    const marketValueRaw = $(tds[5]).text().trim();
    const probabilityRaw = $(tds[6]).text().trim();

    const curCell = $(tds[7]);
    const tgtCell = $(tds[8]);
    const currentClub = {
      name: (curCell.find('span').last().text() || curCell.text()).replace(/\s+/g, ' ').trim(),
      slug: slugFromUrl(curCell.find('a').attr('href') || '', 'team'),
    };
    const targetClub = {
      name: (tgtCell.find('span').last().text() || tgtCell.text()).replace(/\s+/g, ' ').trim(),
      slug: slugFromUrl(tgtCell.find('a').attr('href') || '', 'team'),
    };

    if (!currentClub.name || !targetClub.name) return;

    const sourceRegion = classifyClub(currentClub.name);
    const targetRegion = classifyClub(targetClub.name);

    rumors.push({
      date,
      playerName,
      playerSlug,
      playerUrl,
      age,
      role,
      marketValueRaw,
      marketValue: toNumber(marketValueRaw),
      probabilityRaw,
      probability: parseProbability(probabilityRaw),
      currentClub,
      targetClub,
      sourceRegion,
      targetRegion,
      fromSourceLeague: SOURCE_LEAGUES.includes(sourceRegion),
      toEurope: targetRegion === 'EUROPE',
    });
  });

  return rumors;
}

/**
 * Cle de deduplication stable pour une rumeur.
 */
function rumorKey(r) {
  return [
    r.date,
    r.playerSlug || r.playerName,
    r.currentClub.slug || r.currentClub.name,
    r.targetClub.slug || r.targetClub.name,
  ].join('|');
}

/**
 * Applique les filtres de veille configures.
 *   - depart d'une ligue source (MLS / J / K)
 *   - proba minimale (les rumeurs sans proga "-" passent si le seuil est 0)
 *   - option "Europe uniquement"
 */
function filterRumors(rumors, opts = {}) {
  const minProb = opts.minProbability || 0;
  const europeOnly = !!opts.europeOnly;

  return rumors.filter(r => {
    if (!r.fromSourceLeague) return false;
    if (europeOnly && !r.toEurope) return false;
    if (minProb > 0 && (r.probability === null || r.probability < minProb)) return false;
    return true;
  });
}

module.exports = {
  fetchTransferRumors,
  parseRumorsHtml,
  filterRumors,
  rumorKey,
};
