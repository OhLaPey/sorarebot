/**
 * Handlers des commandes Discord
 */
const { EmbedBuilder } = require('discord.js');
const db = require('../db');
const ev = require('../ev/calculator');
const { REGION_LABEL, REGION_FLAG } = require('../scraper/leagues');

function createHandler(scanMarketFn, scanAuctionsFn, botStats) {
  return async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    try {
      switch (commandName) {
        case 'watchlist': {
          const wl = db.getWatchlist();
          const embed = new EmbedBuilder()
            .setTitle('Watchlist Active')
            .setColor(0x7C3AED)
            .addFields(
              {
                name: 'Clubs',
                value: wl.clubs.length > 0
                  ? wl.clubs.map(c => '- ' + c.name + ' (' + c.rarity + ')' + (c.max_price ? ' - Max: ' + c.max_price + 'E' : '')).join('\n')
                  : 'Aucun club surveille',
              },
              {
                name: 'Joueurs',
                value: wl.players.length > 0
                  ? wl.players.map(p => '- ' + p.name + ' (' + p.rarity + ')' + (p.max_price ? ' - Max: ' + p.max_price + 'E' : '')).join('\n')
                  : 'Aucun joueur surveille',
              }
            )
            .setFooter({ text: (wl.clubs.length + wl.players.length) + ' surveillances actives' });

          await interaction.reply({ embeds: [embed] });
          break;
        }

        case 'addplayer': {
          const slug = options.getString('slug');
          const rarity = options.getString('rarity');
          const maxPrice = options.getNumber('maxprice');
          const name = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          db.addToWatchlist(slug, name, 'player', rarity, maxPrice);
          await interaction.reply(name + ' (' + rarity + ') ajoute a la watchlist !' + (maxPrice ? ' Alerte si < ' + maxPrice + 'E' : ''));
          break;
        }

        case 'removeplayer': {
          const slug = options.getString('slug');
          db.removeFromWatchlist(slug, 'player');
          await interaction.reply(slug + ' retire de la watchlist');
          break;
        }

        case 'setprice': {
          const slug = options.getString('slug');
          const maxPrice = options.getNumber('maxprice');
          db.updateMaxPrice(slug, 'player', maxPrice);
          await interaction.reply('Seuil de prix pour ' + slug + ' defini a ' + maxPrice + 'E');
          break;
        }

        case 'stats': {
          const wl = db.getWatchlist();
          const portfolioStats = db.getPortfolioStats();
          const activeAuctions = db.getActiveAuctions();

          const embed = new EmbedBuilder()
            .setTitle('Statistiques du Bot')
            .setColor(0x3B82F6)
            .addFields(
              { name: 'Dernier scan', value: botStats.lastScan ? botStats.lastScan.toLocaleString('fr-FR') : 'Jamais', inline: true },
              { name: 'Total scans', value: botStats.totalScans.toString(), inline: true },
              { name: 'Alertes envoyees', value: botStats.alertsSent.toString(), inline: true },
              { name: 'Erreurs', value: botStats.errors.toString(), inline: true },
              { name: 'Watchlist', value: (wl.players.length + wl.clubs.length) + ' items', inline: true },
              { name: 'Portfolio', value: portfolioStats.active.count + ' cartes', inline: true },
              { name: 'Encheres actives', value: activeAuctions.length.toString(), inline: true },
              { name: 'Investissement', value: portfolioStats.active.total_invested.toFixed(0) + 'E', inline: true },
              { name: 'P&L realise', value: (portfolioStats.sold.total_pnl >= 0 ? '+' : '') + portfolioStats.sold.total_pnl.toFixed(0) + 'E', inline: true },
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed] });
          break;
        }

        case 'scan': {
          await interaction.reply('Scan en cours...');
          await scanMarketFn();
          await interaction.followUp('Scan termine !');
          break;
        }

        case 'prix': {
          const joueurSlug = options.getString('joueur');
          await interaction.deferReply();

          const wl = db.getWatchlist();
          const player = wl.players.find(p => p.slug === joueurSlug);
          if (!player) {
            await interaction.editReply('Joueur non trouve dans la watchlist.');
            return;
          }

          const latest = db.getLatestPrice(joueurSlug, player.rarity);
          if (!latest) {
            await interaction.editReply('Pas encore de donnees pour ' + player.name);
            return;
          }

          const history7d = db.getPriceHistory(joueurSlug, player.rarity, 7);
          const prices7d = history7d.map(h => h.min_price).filter(p => p != null);

          let trend = 0;
          if (history7d.length > 1) {
            const oldPrice = history7d[0].min_price;
            const newPrice = latest.min_price;
            if (oldPrice && newPrice) {
              trend = ((newPrice - oldPrice) / oldPrice) * 100;
            }
          }

          const trendEmoji = trend > 0 ? '\uD83D\uDCC8' : trend < 0 ? '\uD83D\uDCC9' : '\u27A1\uFE0F';
          const min7d = prices7d.length > 0 ? Math.min(...prices7d) : null;
          const max7d = prices7d.length > 0 ? Math.max(...prices7d) : null;

          const avgSale = db.getAvgSalePrice(joueurSlug, player.rarity, 30);

          const embed = new EmbedBuilder()
            .setTitle(trendEmoji + ' ' + player.name)
            .setColor(trend > 0 ? 0xEF4444 : trend < 0 ? 0x22C55E : 0x6B7280)
            .addFields(
              { name: 'Floor actuel', value: latest.min_price ? latest.min_price.toFixed(0) + ' E' : 'N/A', inline: true },
              { name: 'Tendance 7j', value: (trend > 0 ? '+' : '') + trend.toFixed(1) + '%', inline: true },
              { name: 'Listings', value: (latest.nb_listings || 0).toString(), inline: true },
              { name: 'Min 7j', value: min7d ? min7d.toFixed(0) + ' E' : 'N/A', inline: true },
              { name: 'Max 7j', value: max7d ? max7d.toFixed(0) + ' E' : 'N/A', inline: true },
              { name: 'Moy ventes 30j', value: avgSale && avgSale.avg_price ? avgSale.avg_price.toFixed(0) + ' E (' + avgSale.count + ' ventes)' : 'N/A', inline: true },
            )
            .setFooter({ text: 'MAJ: ' + new Date(latest.timestamp).toLocaleString('fr-FR') });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'historique': {
          const joueurSlug = options.getString('joueur');
          const periode = parseInt(options.getString('periode') || '30');
          await interaction.deferReply();

          const wl = db.getWatchlist();
          const player = wl.players.find(p => p.slug === joueurSlug);
          if (!player) {
            await interaction.editReply('Joueur non trouve dans la watchlist.');
            return;
          }

          const history = db.getPriceHistory(joueurSlug, player.rarity, periode);
          const sales = db.getSales(joueurSlug, player.rarity, periode);

          if (history.length < 2 && sales.length < 2) {
            await interaction.editReply('Pas assez de donnees. Attends quelques scans.');
            return;
          }

          const listingData = history.map(h => ({ x: h.timestamp, y: h.min_price }));
          const salesData = sales.map(s => ({ x: s.sale_date, y: s.price }));

          const chartConfig = {
            type: 'line',
            data: {
              datasets: [
                {
                  label: 'Floor Price',
                  data: listingData,
                  borderColor: '#F97316',
                  backgroundColor: 'rgba(249, 115, 22, 0.1)',
                  fill: true, tension: 0.4, pointRadius: 2,
                },
                {
                  label: 'Ventes',
                  data: salesData,
                  borderColor: '#8B5CF6',
                  backgroundColor: '#8B5CF6',
                  pointRadius: 6, showLine: false,
                }
              ]
            },
            options: {
              responsive: true,
              plugins: {
                legend: { labels: { color: '#fff' } },
                title: { display: true, text: player.name + ' - ' + player.rarity.toUpperCase() + ' (' + periode + 'j)', color: '#fff', font: { size: 16 } }
              },
              scales: {
                x: { type: 'time', time: { unit: periode > 60 ? 'week' : 'day' }, ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.1)' } }
              }
            }
          };

          const chartUrl = 'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(chartConfig)) + '&backgroundColor=%231a1a2e&width=600&height=400';

          const embed = new EmbedBuilder()
            .setTitle('Historique - ' + player.name)
            .setColor(0x7C3AED)
            .setImage(chartUrl)
            .setDescription('\uD83D\uDFE0 Floor price | \uD83D\uDFE3 Ventes realisees')
            .setFooter({ text: 'Periode: ' + periode + ' jours' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'marche': {
          await interaction.deferReply();
          const wl = db.getWatchlist();
          const fields = [];

          for (const player of wl.players) {
            const latest = db.getLatestPrice(player.slug, player.rarity);
            if (latest && latest.min_price) {
              const history = db.getPriceHistory(player.slug, player.rarity, 1);
              let trend = 0;
              if (history.length > 1) {
                const prev = history[history.length - 2];
                if (prev && prev.min_price) {
                  trend = ((latest.min_price - prev.min_price) / prev.min_price) * 100;
                }
              }
              const trendEmoji = trend > 0 ? '\uD83D\uDCC8' : trend < 0 ? '\uD83D\uDCC9' : '\u27A1\uFE0F';
              fields.push({
                name: trendEmoji + ' ' + player.name,
                value: latest.min_price.toFixed(0) + ' E | ' + (latest.nb_listings || 0) + ' listings',
                inline: true,
              });
            } else {
              fields.push({ name: '\u2753 ' + player.name, value: 'Pas de donnees', inline: true });
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

        // === NOUVELLES COMMANDES ===

        case 'ev': {
          await interaction.deferReply();
          const gwNum = options.getInteger('gw');

          let summary;
          if (gwNum) {
            const results = ev.calculateAllEV(gwNum);
            summary = { gwNumber: gwNum, leagues: results, bestLeague: results.length > 0 ? results[0].league : null };
          } else {
            summary = ev.getCurrentEVSummary();
          }

          if (!summary || summary.leagues.length === 0) {
            await interaction.editReply('Pas de donnees EV. Utilise /gw pour enregistrer les participants.');
            return;
          }

          const evFields = summary.leagues.map(l => ({
            name: (l.league === summary.bestLeague ? '\u2B50 ' : '') + l.league,
            value: 'EV: ' + (l.evBase || 0).toFixed(1) + 'E' +
              (l.evAdjusted && l.evAdjusted !== l.evBase ? ' (ajuste: ' + l.evAdjusted.toFixed(1) + 'E)' : '') +
              '\n' + (l.participants || 0) + ' participants | Pool: ' + (l.cashPool || 0).toFixed(0) + 'E',
            inline: true,
          }));

          const embed = new EmbedBuilder()
            .setTitle('Expected Value - GW ' + summary.gwNumber)
            .setColor(0x22C55E)
            .addFields(evFields)
            .setFooter({ text: '\u2B50 = Meilleure ligue | Edge applique' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'gw': {
          const gwNum = options.getInteger('numero');
          const league = options.getString('ligue');
          const participants = options.getInteger('participants');

          db.addGameweekData(gwNum, league, participants);
          const results = ev.calculateAllEV(gwNum);
          const bestLeague = results.length > 0 ? results[0] : null;

          await interaction.reply(
            'GW ' + gwNum + ' - ' + league + ': ' + participants + ' participants enregistres.\n' +
            (bestLeague ? 'Meilleure ligue: ' + bestLeague.league + ' (EV ajuste: ' + bestLeague.evAdjusted.toFixed(1) + 'E)' : '')
          );
          break;
        }

        case 'edge': {
          const league = options.getString('ligue');
          const multiplier = options.getNumber('multiplier');

          db.setUserEdge(league, multiplier);

          const guide = multiplier < 0.9 ? 'Desavantage' :
            multiplier < 1.1 ? 'Neutre' :
            multiplier < 1.3 ? 'Tu suis la ligue' :
            multiplier < 1.5 ? 'Tu connais bien les compos' : 'Expert';

          await interaction.reply('Edge pour ' + league + ' defini a x' + multiplier.toFixed(1) + ' (' + guide + ')');
          break;
        }

        case 'portfolio': {
          await interaction.deferReply();
          const portfolio = db.getPortfolioWithValues();
          const stats = db.getPortfolioStats();

          if (portfolio.length === 0) {
            await interaction.editReply('Portfolio vide. Utilise /addcard pour ajouter des cartes.');
            return;
          }

          const fields = portfolio.slice(0, 15).map(card => {
            const currentVal = card.latest_floor || card.current_value || card.buy_price;
            const pnl = currentVal - (card.buy_price || 0);
            const pnlPct = card.buy_price ? ((pnl / card.buy_price) * 100).toFixed(0) : '?';
            const pnlEmoji = pnl > 0 ? '\uD83D\uDFE2' : pnl < 0 ? '\uD83D\uDD34' : '\u26AA';

            return {
              name: pnlEmoji + ' ' + (card.player_name || card.player_slug),
              value: 'Achat: ' + (card.buy_price || '?') + 'E | Valeur: ' + (currentVal ? currentVal.toFixed(0) : '?') + 'E\n' +
                'P&L: ' + (pnl >= 0 ? '+' : '') + pnl.toFixed(0) + 'E (' + pnlPct + '%) | ' + card.rarity,
              inline: true,
            };
          });

          let unrealizedPnL = 0;
          for (const card of portfolio) {
            const val = card.latest_floor || card.current_value || card.buy_price || 0;
            unrealizedPnL += val - (card.buy_price || 0);
          }

          const embed = new EmbedBuilder()
            .setTitle('Portfolio (' + portfolio.length + ' cartes)')
            .setColor(unrealizedPnL >= 0 ? 0x22C55E : 0xEF4444)
            .addFields(fields)
            .addFields(
              { name: '\u2500\u2500\u2500 RESUME \u2500\u2500\u2500', value: '\u200B' },
              { name: 'Investissement', value: stats.active.total_invested.toFixed(0) + 'E', inline: true },
              { name: 'P&L non realise', value: (unrealizedPnL >= 0 ? '+' : '') + unrealizedPnL.toFixed(0) + 'E', inline: true },
              { name: 'P&L realise', value: (stats.sold.total_pnl >= 0 ? '+' : '') + stats.sold.total_pnl.toFixed(0) + 'E (' + stats.sold.count + ' ventes)', inline: true },
            )
            .setFooter({ text: 'Valeurs basees sur le floor price actuel' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'addcard': {
          const joueur = options.getString('joueur');
          const rarity = options.getString('rarity');
          const prix = options.getNumber('prix');
          const type = options.getString('type') || 'market';
          const name = joueur.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          db.addToPortfolio({
            cardSlug: joueur + '-' + rarity + '-' + Date.now(),
            playerSlug: joueur,
            playerName: name,
            rarity,
            buyPrice: prix,
            buyDate: new Date().toISOString(),
            buyType: type,
          });

          await interaction.reply(name + ' (' + rarity + ') ajoute au portfolio pour ' + prix + 'E (' + type + ')');
          break;
        }

        case 'sellcard': {
          const joueur = options.getString('joueur');
          const prix = options.getNumber('prix');

          const portfolio = db.getPortfolio();
          const card = portfolio.find(c => c.player_slug === joueur && !c.sold);

          if (!card) {
            await interaction.reply('Carte non trouvee dans le portfolio.');
            return;
          }

          db.sellFromPortfolio(card.card_slug, prix, new Date().toISOString());
          const pnl = prix - (card.buy_price || 0);

          await interaction.reply(
            (card.player_name || joueur) + ' vendue pour ' + prix + 'E. ' +
            'P&L: ' + (pnl >= 0 ? '+' : '') + pnl.toFixed(0) + 'E (' +
            (card.buy_price ? ((pnl / card.buy_price) * 100).toFixed(0) + '%' : '?%') + ')'
          );
          break;
        }

        case 'encheres': {
          await interaction.deferReply();
          const rarity = options.getString('rarity');
          const auctions = db.getActiveAuctions(rarity);

          if (auctions.length === 0) {
            await interaction.editReply('Aucune enchere active' + (rarity ? ' pour ' + rarity : '') + '. Attends le prochain scan.');
            return;
          }

          const fields = auctions.slice(0, 15).map(a => ({
            name: (a.player_name || a.player_slug || 'Carte'),
            value: 'Bid: ' + (a.current_bid || '?') + 'E | ' + (a.nb_bids || 0) + ' bids\n' +
              'Fin: ' + (a.end_time ? new Date(a.end_time).toLocaleString('fr-FR') : '?') + '\n' +
              a.rarity.toUpperCase(),
            inline: true,
          }));

          const embed = new EmbedBuilder()
            .setTitle('Encheres en cours' + (rarity ? ' - ' + rarity.toUpperCase() : ''))
            .setColor(0xEAB308)
            .addFields(fields)
            .setFooter({ text: auctions.length + ' encheres actives' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'alertenchere': {
          const joueur = options.getString('joueur');
          const rarity = options.getString('rarity');
          const maxBid = options.getNumber('maxbid');

          db.setAuctionAlert(joueur, rarity, maxBid);
          const name = joueur.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          await interaction.reply('Alerte enchere configuree: ' + name + ' (' + rarity + ') - Max bid: ' + maxBid + 'E');
          break;
        }

        case 'opportunites': {
          await interaction.deferReply();
          const opps = db.getActiveOpportunities();

          if (opps.length === 0) {
            await interaction.editReply('Aucune opportunite detectee pour le moment.');
            return;
          }

          const fields = opps.slice(0, 12).map(o => {
            const typeEmoji = {
              'undervalued_vs_avg': '\uD83D\uDCB0',
              'floor_dip': '\uD83D\uDCC9',
              'statistical_anomaly': '\u26A0\uFE0F',
              'auction_below_threshold': '\uD83D\uDD14',
              'auction_vs_market': '\uD83C\uDFAF',
            }[o.opportunity_type] || '\uD83D\uDCA1';

            return {
              name: typeEmoji + ' ' + (o.player_name || o.slug) + ' (' + o.rarity + ')',
              value: o.details + '\nScore: ' + o.score.toFixed(0),
              inline: false,
            };
          });

          const embed = new EmbedBuilder()
            .setTitle('Opportunites de Marche')
            .setColor(0x22C55E)
            .addFields(fields)
            .setFooter({ text: opps.length + ' opportunites actives' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'mercato': {
          await interaction.deferReply();
          const ligue = options.getString('ligue');
          const rumors = db.getRecentRumors(15, ligue);

          if (rumors.length === 0) {
            await interaction.editReply('Aucune rumeur enregistree pour le moment' +
              (ligue ? ' (' + (REGION_LABEL[ligue] || ligue) + ')' : '') +
              '. Le prochain scan mercato la remplira.');
            return;
          }

          const fields = rumors.map(r => {
            const flag = REGION_FLAG[r.source_league] || '';
            const star = r.in_watchlist ? '⭐ ' : '';
            const dest = r.to_europe ? '🇪🇺 Europe' : (REGION_FLAG[r.target_region] || '') + ' ' + (REGION_LABEL[r.target_region] || r.target_region);
            const prob = r.probability != null ? r.probability + '%' : 'n/a';
            const mv = r.market_value
              ? (r.market_value >= 1000000 ? (r.market_value / 1000000).toFixed(1) + 'M€' : Math.round(r.market_value / 1000) + 'k€')
              : 'N/A';
            return {
              name: star + (r.player_name || '?') + ' (' + (r.role || '?') + ', ' + (r.age != null ? r.age + ' ans' : '?') + ')',
              value: flag + ' ' + r.current_club + '  →  ' + dest + ' · ' + r.target_club + '\n' +
                'Valeur: ' + mv + ' | Proba: ' + prob + ' | ' + (r.rumor_date || ''),
              inline: false,
            };
          });

          const embed = new EmbedBuilder()
            .setTitle('Rumeurs Mercato' + (ligue ? ' - ' + (REGION_LABEL[ligue] || ligue) : ' (MLS / J.League / K League)'))
            .setColor(0x0EA5E9)
            .addFields(fields.slice(0, 15))
            .setFooter({ text: rumors.length + ' rumeurs · ⭐ = watchlist/portfolio · source: sorarescore.com' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'recommandation': {
          await interaction.deferReply();
          const recs = ev.getBestLeagueRecommendation();

          if (!recs || recs.length === 0) {
            await interaction.editReply('Pas assez de donnees. Utilise /gw pour enregistrer des participants.');
            return;
          }

          const fields = recs.map((r, i) => {
            const medal = i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : '\u2022';
            const trendArrow = r.participantsTrend === 'up' ? '\u2197\uFE0F' : r.participantsTrend === 'down' ? '\u2198\uFE0F' : '\u27A1\uFE0F';

            return {
              name: medal + ' ' + r.league,
              value: 'EV ajuste: ' + r.evAdjusted.toFixed(1) + 'E\n' +
                r.participants + ' participants ' + trendArrow + ' (' + r.participantsTrendPct + '%)\n' +
                'Edge: x' + r.edge.toFixed(1) + ' | Score: ' + r.score.toFixed(1),
              inline: true,
            };
          });

          const embed = new EmbedBuilder()
            .setTitle('Recommandation - Meilleure Ligue')
            .setColor(0xEAB308)
            .setDescription('Classement base sur EV ajuste + tendance participants')
            .addFields(fields)
            .setFooter({ text: 'Ajuste ton edge avec /edge pour affiner' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'rewards': {
          const league = options.getString('ligue');
          const rewards = db.getRewardsConfig();
          const filtered = league ? rewards.filter(r => r.league === league) : rewards;

          if (filtered.length === 0) {
            await interaction.reply('Aucune config de rewards trouvee.');
            return;
          }

          // Group by league
          const grouped = {};
          for (const r of filtered) {
            if (!grouped[r.league]) grouped[r.league] = [];
            grouped[r.league].push(r);
          }

          const fields = [];
          for (const [leagueName, rws] of Object.entries(grouped)) {
            const detail = rws.map(r => {
              const placeLabel = r.place_from === r.place_to ? r.place_from + 'e' : r.place_from + '-' + r.place_to + 'e';
              return placeLabel + ': ' + r.reward + 'E';
            }).join(' | ');

            const totalPool = rws.reduce((sum, r) => sum + r.reward * (r.place_to - r.place_from + 1), 0);

            fields.push({
              name: leagueName + ' (' + totalPool + 'E)',
              value: detail,
              inline: false,
            });
          }

          const embed = new EmbedBuilder()
            .setTitle('Configuration Rewards')
            .setColor(0xEAB308)
            .addFields(fields.slice(0, 15))
            .setFooter({ text: 'Modifiable via le dashboard web' });

          await interaction.reply({ embeds: [embed] });
          break;
        }

        case 'import': {
          const joueurSlug = options.getString('joueur');
          const rarete = options.getString('rarete') || 'super_rare';
          await interaction.deferReply();
          await interaction.editReply('Import en cours pour ' + joueurSlug + ' (' + rarete + ')... Cela peut prendre 30 secondes.');

          // L'import sera gere par le main process
          // On signal juste que c'est en cours
          if (typeof global.importPlayerSales === 'function') {
            try {
              const result = await global.importPlayerSales(joueurSlug, rarete);
              const embed = new EmbedBuilder()
                .setTitle('Import termine')
                .setColor(0x22C55E)
                .addFields(
                  { name: 'Joueur', value: joueurSlug, inline: true },
                  { name: 'Rarete', value: rarete.toUpperCase(), inline: true },
                  { name: 'Ventes importees', value: (result.imported || 0).toString(), inline: true },
                );
              await interaction.followUp({ embeds: [embed] });
            } catch (error) {
              await interaction.followUp('Erreur: ' + error.message);
            }
          } else {
            await interaction.followUp('Fonction d\'import non disponible.');
          }
          break;
        }
      }
    } catch (error) {
      console.error('Erreur commande Discord:', error);
      const reply = { content: 'Une erreur est survenue: ' + error.message };
      if (interaction.deferred) {
        await interaction.editReply(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  };
}

module.exports = { createHandler };
