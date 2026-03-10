/**
 * Scraper scores SO5 - SorareScore
 * Recupere les scores L5, L15, L40 et historique match par match
 */
const { createPage } = require('./browser');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scrape les scores SO5 d'un joueur depuis SorareScore
 * Page: /player-stats avec tri par score
 */
async function scrapePlayerScores(browser, playerSlug, rarity) {
  const page = await createPage(browser);
  const searchName = playerSlug.replace(/-/g, '+');

  const rarityMap = {
    'super_rare': 'super_rare',
    'rare': 'rare',
    'unique': 'unique',
    'limited': 'limited',
  };
  const sorareRarity = rarityMap[rarity] || rarity;

  const url = 'https://sorarescore.com/player-stats?gameweek=0&sort_column=score&sort_direction=desc&rarity=' + sorareRarity + '&search=' + searchName;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);
    await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
    await sleep(2000);

    const result = await page.evaluate(() => {
      const players = [];
      const rows = document.querySelectorAll('tbody tr, table tr');

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) return;

        const data = {
          playerName: '',
          lastScore: null,
          avgL5: null,
          avgL15: null,
          avgL40: null,
          gamesPlayed: null,
          price: null,
        };

        // Extraire le nom du joueur (premiere colonne)
        const firstCell = cells[0];
        if (firstCell) {
          data.playerName = (firstCell.textContent || '').trim();
        }

        // Parcourir les colonnes pour trouver les scores
        // SorareScore affiche : Joueur | Score | L5 | L15 | L40 | Prix | etc.
        const allTexts = [];
        cells.forEach((cell, idx) => {
          const text = (cell.textContent || '').trim();
          allTexts.push({ text, idx });
        });

        // Extraire les valeurs numeriques (scores entre 0 et 150)
        const numericValues = [];
        cells.forEach((cell, idx) => {
          if (idx === 0) return; // skip name
          const text = (cell.textContent || '').trim();

          // Score value (number between 0 and 150)
          const scoreMatch = text.match(/^(\d{1,3}(?:[.,]\d{1,2})?)$/);
          if (scoreMatch) {
            const val = parseFloat(scoreMatch[1].replace(',', '.'));
            if (val >= 0 && val <= 150) {
              numericValues.push({ value: val, idx });
            }
          }

          // L5 value from .l5-value or similar
          const l5El = cell.querySelector('.l5-value, [class*="l5"]');
          if (l5El) {
            const l5Match = (l5El.textContent || '').trim().match(/(\d{1,3}(?:[.,]\d{1,2})?)/);
            if (l5Match) {
              const val = parseFloat(l5Match[1].replace(',', '.'));
              if (val >= 0 && val <= 150) {
                numericValues.push({ value: val, idx, isL5: true });
              }
            }
          }

          // Price (contains currency)
          if (text.includes('\u20AC') || text.includes('ETH')) {
            const priceMatch = text.match(/(\d{1,3}(?:[,.\s]\d{3})*(?:[,.]\d{1,2})?)/);
            if (priceMatch) {
              data.price = parseFloat(priceMatch[1].replace(/[\s,]/g, '').replace(',', '.'));
            }
          }

          // Games played (usually a small integer, often with "GP" or "/")
          const gpMatch = text.match(/^(\d{1,2})$/);
          if (gpMatch && parseInt(gpMatch[1]) <= 40) {
            // Could be games played if not a score
          }
        });

        // Assign scores based on position
        // Typical order after name: Score/L5, L15, L40, GP, Price
        if (numericValues.length >= 1) data.lastScore = numericValues[0].value;
        if (numericValues.length >= 2) data.avgL5 = numericValues[1].value;
        if (numericValues.length >= 3) data.avgL15 = numericValues[2].value;
        if (numericValues.length >= 4) data.avgL40 = numericValues[3].value;

        // Also try to find L5 specifically tagged
        const l5Tagged = numericValues.find(v => v.isL5);
        if (l5Tagged) {
          data.avgL5 = l5Tagged.value;
        }

        if (data.playerName && (data.lastScore !== null || data.avgL5 !== null)) {
          players.push(data);
        }
      });

      return players;
    });

    await page.close();

    if (result.length > 0) {
      console.log('  Scores SorareScore: ' + result.length + ' joueurs');
      return result;
    }

    console.log('  Scores SorareScore: aucun resultat');
    return [];

  } catch (error) {
    console.log('  Scores erreur: ' + error.message.substring(0, 50));
    try { await page.close(); } catch (e) {}
    return [];
  }
}

/**
 * Scrape l'historique des scores d'un joueur (page individuelle)
 * Page: /player/{slug}
 */
async function scrapePlayerScoreHistory(browser, playerSlug) {
  const page = await createPage(browser);
  const url = 'https://sorarescore.com/player/' + playerSlug;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);
    await page.waitForSelector('table, [class*="score"], [class*="game"]', { timeout: 10000 }).catch(() => {});
    await sleep(2000);

    const result = await page.evaluate(() => {
      const scores = [];

      // Try to find score/game history table or list
      const rows = document.querySelectorAll('table tr, [class*="game-row"], [class*="match"]');

      rows.forEach(row => {
        const cells = row.querySelectorAll('td, [class*="cell"], [class*="col"]');
        if (cells.length < 2) return;

        const data = {
          score: null,
          opponent: '',
          matchDate: '',
          competition: '',
          played: 1,
        };

        cells.forEach(cell => {
          const text = (cell.textContent || '').trim();

          // Score (number 0-150)
          const scoreMatch = text.match(/^(\d{1,3}(?:[.,]\d{1,2})?)$/);
          if (scoreMatch && data.score === null) {
            const val = parseFloat(scoreMatch[1].replace(',', '.'));
            if (val >= 0 && val <= 150) {
              data.score = val;
            }
          }

          // DNP
          if (text === 'DNP' || text === '-' || text.toLowerCase() === 'did not play') {
            data.played = 0;
            data.score = 0;
          }

          // Date
          const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
          if (dateMatch) {
            data.matchDate = dateMatch[1];
          }

          // Opponent (text with team name)
          if (text.length > 2 && text.length < 40 && !scoreMatch && !dateMatch && !text.includes('DNP')) {
            if (!data.opponent) {
              data.opponent = text;
            } else if (!data.competition) {
              data.competition = text;
            }
          }
        });

        if (data.score !== null || data.played === 0) {
          scores.push(data);
        }
      });

      return scores;
    });

    await page.close();

    if (result.length > 0) {
      console.log('  Historique scores: ' + result.length + ' matchs');
    }
    return result;

  } catch (error) {
    console.log('  Historique scores erreur: ' + error.message.substring(0, 50));
    try { await page.close(); } catch (e) {}
    return [];
  }
}

/**
 * Scrape les scores de tous les joueurs du portfolio et watchlist
 */
async function scrapeAllPlayerScores(browser, players) {
  const allScores = [];

  for (const player of players) {
    console.log('Score: ' + player.name + ' (' + player.rarity + ')');
    const scores = await scrapePlayerScores(browser, player.slug, player.rarity);

    // Trouver le joueur dans les resultats
    const searchSlug = player.slug.replace(/-/g, ' ').toLowerCase();
    const match = scores.find(s => {
      const scoreName = s.playerName.toLowerCase();
      return scoreName.includes(searchSlug) || searchSlug.includes(scoreName);
    }) || scores[0]; // fallback au premier resultat si recherche exacte

    if (match) {
      allScores.push({
        slug: player.slug,
        playerName: match.playerName || player.name,
        rarity: player.rarity,
        lastScore: match.lastScore,
        avgL5: match.avgL5,
        avgL15: match.avgL15,
        avgL40: match.avgL40,
        gamesPlayed: match.gamesPlayed,
        price: match.price,
      });
    }

    await sleep(2000);
  }

  return allScores;
}

module.exports = { scrapePlayerScores, scrapePlayerScoreHistory, scrapeAllPlayerScores };
