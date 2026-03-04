/**
 * Dashboard web complet avec graphiques et gestion
 */
const db = require('../db');
const ev = require('../ev/calculator');

function generateDashboardHTML(botStats) {
  const wl = db.getWatchlist();
  const portfolio = db.getPortfolioWithValues();
  const portfolioStats = db.getPortfolioStats();
  const evSummary = ev.getCurrentEVSummary();
  const opportunities = db.getActiveOpportunities();
  const auctions = db.getActiveAuctions();
  const auctionAlerts = db.getAuctionAlerts();

  // Calculate unrealized P&L
  let unrealizedPnL = 0;
  let totalCurrentValue = 0;
  for (const card of portfolio) {
    const val = card.latest_floor || card.current_value || card.buy_price || 0;
    totalCurrentValue += val;
    unrealizedPnL += val - (card.buy_price || 0);
  }

  // Player rows for watchlist
  const playersHtml = wl.players.map(p => {
    const latest = db.getLatestPrice(p.slug, p.rarity);
    const priceDisplay = latest && latest.min_price ? latest.min_price.toFixed(0) + ' E' : '';
    return '<div class="list-item">' +
      '<div class="item-info">' +
        '<span class="item-name">' + p.name + '</span>' +
        '<span class="badge ' + p.rarity + '">' + p.rarity.replace('_', ' ') + '</span>' +
        (priceDisplay ? '<span class="current-price">' + priceDisplay + '</span>' : '') +
      '</div>' +
      '<div class="item-actions">' +
        '<input type="number" class="price-input" data-slug="' + p.slug + '" data-type="player" value="' + (p.max_price || '') + '" placeholder="Max E">' +
        '<button class="btn-sm danger" onclick="removeItem(\'' + p.slug + '\',\'player\')">X</button>' +
      '</div>' +
    '</div>';
  }).join('');

  const clubsHtml = wl.clubs.map(c => {
    return '<div class="list-item club">' +
      '<div class="item-info">' +
        '<span class="item-name">' + c.name + '</span>' +
        '<span class="badge ' + c.rarity + '">' + c.rarity.replace('_', ' ') + '</span>' +
      '</div>' +
      '<div class="item-actions">' +
        '<input type="number" class="price-input" data-slug="' + c.slug + '" data-type="club" value="' + (c.max_price || '') + '" placeholder="Max E">' +
        '<button class="btn-sm danger" onclick="removeItem(\'' + c.slug + '\',\'club\')">X</button>' +
      '</div>' +
    '</div>';
  }).join('');

  // Portfolio rows
  const portfolioHtml = portfolio.map(card => {
    const currentVal = card.latest_floor || card.current_value || card.buy_price || 0;
    const pnl = currentVal - (card.buy_price || 0);
    const pnlPct = card.buy_price ? ((pnl / card.buy_price) * 100).toFixed(0) : '?';
    const pnlClass = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '';

    return '<div class="list-item">' +
      '<div class="item-info">' +
        '<span class="item-name">' + (card.player_name || card.player_slug) + '</span>' +
        '<span class="badge ' + card.rarity + '">' + card.rarity.replace('_', ' ') + '</span>' +
        '<span class="detail">Achat: ' + (card.buy_price || '?') + 'E</span>' +
        '<span class="current-price">' + currentVal.toFixed(0) + ' E</span>' +
        '<span class="pnl ' + pnlClass + '">' + (pnl >= 0 ? '+' : '') + pnl.toFixed(0) + 'E (' + pnlPct + '%)</span>' +
      '</div>' +
      '<div class="item-actions">' +
        '<button class="btn-sm" onclick="sellCard(\'' + card.card_slug + '\')">Vendre</button>' +
      '</div>' +
    '</div>';
  }).join('');

  // EV table
  let evHtml = '';
  if (evSummary && evSummary.leagues.length > 0) {
    evHtml = evSummary.leagues.map(l => {
      const isBest = l.league === evSummary.bestLeague;
      return '<tr class="' + (isBest ? 'best-league' : '') + '">' +
        '<td>' + (isBest ? '\u2B50 ' : '') + l.league + '</td>' +
        '<td>' + (l.participants || 0) + '</td>' +
        '<td>' + (l.cashPool || 0).toFixed(0) + ' E</td>' +
        '<td>' + (l.evBase || 0).toFixed(1) + ' E</td>' +
        '<td class="ev-adjusted">' + (l.evAdjusted || 0).toFixed(1) + ' E</td>' +
      '</tr>';
    }).join('');
  }

  // Opportunities
  const oppsHtml = opportunities.slice(0, 10).map(o => {
    const typeLabel = {
      'undervalued_vs_avg': 'Sous-evalue',
      'floor_dip': 'Floor bas',
      'statistical_anomaly': 'Anomalie',
      'auction_below_threshold': 'Enchere',
      'auction_vs_market': 'Enchere vs Marche',
    }[o.opportunity_type] || o.opportunity_type;

    return '<div class="opp-item">' +
      '<div class="opp-header">' +
        '<span class="opp-name">' + (o.player_name || o.slug) + '</span>' +
        '<span class="badge">' + typeLabel + '</span>' +
        '<span class="opp-score">Score: ' + o.score.toFixed(0) + '</span>' +
      '</div>' +
      '<div class="opp-detail">' + o.details + '</div>' +
    '</div>';
  }).join('');

  // Auctions
  const auctionsHtml = auctions.slice(0, 10).map(a => {
    return '<div class="list-item">' +
      '<div class="item-info">' +
        '<span class="item-name">' + (a.player_name || a.card_slug) + '</span>' +
        '<span class="badge ' + a.rarity + '">' + a.rarity.replace('_', ' ') + '</span>' +
        '<span class="current-price">' + (a.current_bid || '?') + ' E</span>' +
        '<span class="detail">' + (a.nb_bids || 0) + ' bids</span>' +
      '</div>' +
    '</div>';
  }).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sorare Tracker Pro</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f0f23;min-height:100vh;color:#e0e0e0}
.container{max-width:1200px;margin:0 auto;padding:15px}
header{text-align:center;padding:20px 0;border-bottom:1px solid #1e1e3a;margin-bottom:20px}
header h1{font-size:1.8rem;background:linear-gradient(135deg,#7c3aed,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
header p{color:#888;margin-top:5px;font-size:0.9rem}

.tabs{display:flex;gap:5px;margin-bottom:20px;flex-wrap:wrap}
.tab{padding:10px 18px;border-radius:8px;border:none;background:#1a1a2e;color:#aaa;cursor:pointer;font-size:0.9rem;font-weight:600;transition:all 0.2s}
.tab.active{background:#7c3aed;color:#fff}
.tab:hover{background:#2a2a4e;color:#fff}

.tab-content{display:none}
.tab-content.active{display:block}

.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:25px}
.stat{background:#1a1a2e;border-radius:12px;padding:18px;text-align:center;border:1px solid #2a2a4e}
.stat .value{font-size:1.6rem;font-weight:bold;color:#7c3aed}
.stat .value.positive{color:#22c55e}
.stat .value.negative{color:#ef4444}
.stat .label{font-size:0.8rem;color:#888;margin-top:4px}

.section{background:#1a1a2e;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #2a2a4e}
.section h2{font-size:1.2rem;margin-bottom:15px;color:#fff}

.add-form{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;margin-bottom:15px}
@media(max-width:640px){.add-form{grid-template-columns:1fr}}

input,select,button{padding:10px 14px;border-radius:8px;border:1px solid #2a2a4e;font-size:0.9rem}
input,select{background:#0f0f23;color:#e0e0e0}
input::placeholder{color:#555}
input:focus,select:focus{outline:none;border-color:#7c3aed}
button{background:#7c3aed;color:#fff;cursor:pointer;font-weight:600;border:none;transition:all 0.15s}
button:hover{background:#6d28d9}
button.danger{background:#dc2626}
button.danger:hover{background:#b91c1c}

.btn-sm{padding:6px 12px;font-size:0.8rem}
.btn-full{width:100%;padding:14px;font-size:1rem;margin-top:8px}

.list-item{display:flex;align-items:center;justify-content:space-between;background:#0f0f23;padding:12px 16px;border-radius:8px;margin-bottom:6px;flex-wrap:wrap;gap:8px}
.list-item.club{border-left:3px solid #eab308}
.item-info{display:flex;align-items:center;gap:10px;flex:1;flex-wrap:wrap}
.item-name{font-weight:600;font-size:0.95rem}
.item-actions{display:flex;align-items:center;gap:8px}
.price-input{width:90px;text-align:center}

.badge{padding:3px 8px;border-radius:12px;font-size:0.7rem;text-transform:uppercase;font-weight:600;background:#7c3aed}
.badge.unique{background:#eab308;color:#000}
.badge.rare{background:#3b82f6}
.badge.super_rare{background:#7c3aed}
.badge.limited{background:#22c55e;color:#000}

.current-price{color:#22c55e;font-weight:bold}
.detail{color:#888;font-size:0.85rem}
.pnl{font-weight:bold;font-size:0.85rem}
.pnl.positive{color:#22c55e}
.pnl.negative{color:#ef4444}

table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #2a2a4e;font-size:0.9rem}
th{color:#888;font-weight:600;font-size:0.8rem;text-transform:uppercase}
tr.best-league{background:rgba(124,58,237,0.15)}
.ev-adjusted{color:#22c55e;font-weight:bold}

.opp-item{background:#0f0f23;border-radius:8px;padding:14px;margin-bottom:8px;border-left:3px solid #22c55e}
.opp-header{display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap}
.opp-name{font-weight:600}
.opp-score{color:#eab308;font-size:0.85rem;margin-left:auto}
.opp-detail{color:#aaa;font-size:0.85rem}

.gw-form{display:grid;grid-template-columns:1fr 2fr 1fr auto;gap:8px;margin-bottom:15px}
@media(max-width:640px){.gw-form{grid-template-columns:1fr}}

.empty{text-align:center;padding:30px;color:#555}
.link{color:#7c3aed;text-decoration:none}
.link:hover{text-decoration:underline}
.toast{position:fixed;bottom:20px;right:20px;background:#22c55e;color:#fff;padding:12px 22px;border-radius:8px;font-weight:600;transform:translateY(80px);opacity:0;transition:all 0.3s;z-index:999}
.toast.show{transform:translateY(0);opacity:1}
.toast.error{background:#dc2626}
.last-scan{text-align:center;color:#555;font-size:0.85rem;margin-top:10px}
</style>
</head>
<body>
<div class="container">
<header>
<h1>Sorare Tracker Pro</h1>
<p>Suivi performances, marche & opportunites</p>
</header>

<div class="stats-grid">
<div class="stat"><div class="value">${wl.players.length + wl.clubs.length}</div><div class="label">Watchlist</div></div>
<div class="stat"><div class="value">${portfolio.length}</div><div class="label">Portfolio</div></div>
<div class="stat"><div class="value ${unrealizedPnL >= 0 ? 'positive' : 'negative'}">${(unrealizedPnL >= 0 ? '+' : '') + unrealizedPnL.toFixed(0)}E</div><div class="label">P&L non realise</div></div>
<div class="stat"><div class="value ${portfolioStats.sold.total_pnl >= 0 ? 'positive' : 'negative'}">${(portfolioStats.sold.total_pnl >= 0 ? '+' : '') + portfolioStats.sold.total_pnl.toFixed(0)}E</div><div class="label">P&L realise</div></div>
<div class="stat"><div class="value">${botStats.totalScans}</div><div class="label">Scans</div></div>
<div class="stat"><div class="value">${opportunities.length}</div><div class="label">Opportunites</div></div>
<div class="stat"><div class="value">${auctions.length}</div><div class="label">Encheres</div></div>
<div class="stat"><div class="value">${botStats.alertsSent}</div><div class="label">Alertes</div></div>
</div>

<div class="tabs">
<button class="tab active" onclick="showTab('marche')">Marche</button>
<button class="tab" onclick="showTab('portfolio')">Portfolio</button>
<button class="tab" onclick="showTab('ev')">EV & Ligues</button>
<button class="tab" onclick="showTab('encheres')">Encheres</button>
<button class="tab" onclick="showTab('opportunites')">Opportunites</button>
<button class="tab" onclick="showTab('config')">Config</button>
</div>

<!-- MARCHE TAB -->
<div id="tab-marche" class="tab-content active">
<div class="section">
<h2>Joueurs surveilles</h2>
<div class="add-form">
<input type="text" id="player-slug" placeholder="Slug du joueur (ex: bradley-barcola)">
<select id="player-rarity"><option value="super_rare">Super Rare</option><option value="rare">Rare</option><option value="unique">Unique</option></select>
<input type="number" id="player-maxprice" placeholder="Prix max E">
<button onclick="addPlayer()">Ajouter</button>
</div>
<div id="player-list">${playersHtml || '<div class="empty">Aucun joueur surveille</div>'}</div>
</div>

<div class="section">
<h2>Clubs surveilles</h2>
<div class="add-form">
<input type="text" id="club-slug" placeholder="Slug du club">
<select id="club-rarity"><option value="unique">Unique</option><option value="super_rare">Super Rare</option><option value="rare">Rare</option></select>
<input type="number" id="club-maxprice" placeholder="Prix max E">
<button onclick="addClub()">Ajouter</button>
</div>
<div id="club-list">${clubsHtml || '<div class="empty">Aucun club surveille</div>'}</div>
</div>

<div class="section">
<button class="btn-full" onclick="triggerScan()">Lancer un scan maintenant</button>
<p class="last-scan">Dernier scan: ${botStats.lastScan ? new Date(botStats.lastScan).toLocaleString('fr-FR') : '-'}</p>
</div>
</div>

<!-- PORTFOLIO TAB -->
<div id="tab-portfolio" class="tab-content">
<div class="section">
<h2>Mon Portfolio</h2>
<div class="add-form">
<input type="text" id="card-slug" placeholder="Slug du joueur">
<select id="card-rarity"><option value="super_rare">Super Rare</option><option value="rare">Rare</option><option value="unique">Unique</option></select>
<input type="number" id="card-price" placeholder="Prix achat E">
<button onclick="addCard()">Ajouter</button>
</div>
<div class="stats-grid" style="margin-bottom:15px">
<div class="stat"><div class="value">${portfolioStats.active.total_invested.toFixed(0)}E</div><div class="label">Investissement</div></div>
<div class="stat"><div class="value ${unrealizedPnL >= 0 ? 'positive' : 'negative'}">${(unrealizedPnL >= 0 ? '+' : '') + unrealizedPnL.toFixed(0)}E</div><div class="label">P&L latent</div></div>
<div class="stat"><div class="value">${totalCurrentValue.toFixed(0)}E</div><div class="label">Valeur totale</div></div>
<div class="stat"><div class="value ${portfolioStats.sold.total_pnl >= 0 ? 'positive' : 'negative'}">${(portfolioStats.sold.total_pnl >= 0 ? '+' : '') + portfolioStats.sold.total_pnl.toFixed(0)}E</div><div class="label">P&L realise (${portfolioStats.sold.count} ventes)</div></div>
</div>
${portfolioHtml || '<div class="empty">Portfolio vide. Ajoute des cartes ci-dessus.</div>'}
</div>
</div>

<!-- EV TAB -->
<div id="tab-ev" class="tab-content">
<div class="section">
<h2>Expected Value par Ligue${evSummary ? ' - GW ' + evSummary.gwNumber : ''}</h2>
<div class="gw-form">
<input type="number" id="gw-number" placeholder="N° GW">
<select id="gw-league">
<option value="Ligue 1">Ligue 1</option><option value="Premier League">Premier League</option>
<option value="LaLiga">LaLiga</option><option value="Bundesliga">Bundesliga</option>
<option value="Eredivisie">Eredivisie</option><option value="Jupiler Pro">Jupiler Pro</option>
<option value="Challenger">Challenger</option><option value="Contender">Contender</option>
</select>
<input type="number" id="gw-participants" placeholder="Participants">
<button onclick="addGW()">Enregistrer</button>
</div>
<table>
<thead><tr><th>Ligue</th><th>Participants</th><th>Cash Pool</th><th>EV Base</th><th>EV Ajuste</th></tr></thead>
<tbody>${evHtml || '<tr><td colspan="5" class="empty">Pas de donnees EV</td></tr>'}</tbody>
</table>
</div>

<div class="section">
<h2>Edge Personnel</h2>
<p style="color:#888;font-size:0.85rem;margin-bottom:10px">0.8=desavantage | 1.0=neutre | 1.2=tu suis | 1.3=tu connais les compos | 1.5+=expert</p>
<div class="gw-form">
<div></div>
<select id="edge-league">
<option value="Ligue 1">Ligue 1</option><option value="Premier League">Premier League</option>
<option value="LaLiga">LaLiga</option><option value="Bundesliga">Bundesliga</option>
<option value="Eredivisie">Eredivisie</option><option value="Jupiler Pro">Jupiler Pro</option>
</select>
<input type="number" id="edge-value" placeholder="Ex: 1.3" step="0.1" min="0.5" max="3">
<button onclick="setEdge()">Sauver</button>
</div>
</div>
</div>

<!-- ENCHERES TAB -->
<div id="tab-encheres" class="tab-content">
<div class="section">
<h2>Encheres en cours</h2>
${auctionsHtml || '<div class="empty">Aucune enchere detectee. Attends le prochain scan.</div>'}
</div>
<div class="section">
<h2>Alertes Encheres</h2>
<div class="add-form">
<input type="text" id="alert-slug" placeholder="Slug du joueur">
<select id="alert-rarity"><option value="super_rare">Super Rare</option><option value="rare">Rare</option><option value="unique">Unique</option></select>
<input type="number" id="alert-maxbid" placeholder="Bid max E">
<button onclick="addAuctionAlert()">Configurer alerte</button>
</div>
${auctionAlerts.map(a => '<div class="list-item"><div class="item-info"><span class="item-name">' + a.slug + '</span><span class="badge ' + a.rarity + '">' + a.rarity.replace('_',' ') + '</span><span class="detail">Max: ' + a.max_bid + 'E</span></div></div>').join('') || '<div class="empty">Aucune alerte configuree</div>'}
</div>
</div>

<!-- OPPORTUNITES TAB -->
<div id="tab-opportunites" class="tab-content">
<div class="section">
<h2>Opportunites detectees</h2>
${oppsHtml || '<div class="empty">Aucune opportunite detectee pour le moment.</div>'}
</div>
</div>

<!-- CONFIG TAB -->
<div id="tab-config" class="tab-content">
<div class="section">
<h2>Informations</h2>
<p style="margin-bottom:8px"><strong>Base de donnees:</strong> SQLite (persistant)</p>
<p style="margin-bottom:8px"><strong>Google Sheets:</strong> <a class="link" href="https://docs.google.com/spreadsheets/d/${require('../config').GOOGLE_SHEET_ID}" target="_blank">Ouvrir</a></p>
<p style="margin-bottom:8px"><strong>Intervalle scan marche:</strong> ${(require('../config').SCAN_INTERVAL_MS / 60000).toFixed(0)} min</p>
<p style="margin-bottom:8px"><strong>Intervalle scan encheres:</strong> ${(require('../config').AUCTION_SCAN_INTERVAL_MS / 60000).toFixed(0)} min</p>
<p style="margin-bottom:8px"><strong>Proxy:</strong> ${require('../config').NORDVPN_USER ? 'Active (' + require('../config').NORDVPN_SERVER + ')' : 'Non configure'}</p>
</div>
</div>

</div>

<div class="toast" id="toast"></div>

<script>
function showTab(t){document.querySelectorAll('.tab-content').forEach(e=>e.classList.remove('active'));document.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));document.getElementById('tab-'+t).classList.add('active');event.target.classList.add('active')}
function toast(m,e){var t=document.getElementById('toast');t.textContent=m;t.className='toast show'+(e?' error':'');setTimeout(function(){t.className='toast'},3000)}
function api(m,u,b){return fetch(u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}).then(r=>{if(!r.ok)throw new Error('Erreur');return r.json()})}

function addPlayer(){var s=document.getElementById('player-slug').value.trim();var r=document.getElementById('player-rarity').value;var p=document.getElementById('player-maxprice').value;if(!s){toast('Entre un slug',true);return}api('POST','/api/watchlist/player',{slug:s,rarity:r,maxPrice:p?parseFloat(p):null}).then(()=>{toast('Joueur ajoute!');location.reload()}).catch(()=>toast('Erreur',true))}
function addClub(){var s=document.getElementById('club-slug').value.trim();var r=document.getElementById('club-rarity').value;var p=document.getElementById('club-maxprice').value;if(!s){toast('Entre un slug',true);return}api('POST','/api/watchlist/club',{slug:s,rarity:r,maxPrice:p?parseFloat(p):null}).then(()=>{toast('Club ajoute!');location.reload()}).catch(()=>toast('Erreur',true))}
function removeItem(s,t){if(!confirm('Supprimer?'))return;api('DELETE','/api/watchlist/'+t+'/'+s).then(()=>{toast('Supprime');location.reload()}).catch(()=>toast('Erreur',true))}

function addCard(){var s=document.getElementById('card-slug').value.trim();var r=document.getElementById('card-rarity').value;var p=document.getElementById('card-price').value;if(!s||!p){toast('Remplis tous les champs',true);return}api('POST','/api/portfolio',{playerSlug:s,rarity:r,buyPrice:parseFloat(p)}).then(()=>{toast('Carte ajoutee!');location.reload()}).catch(()=>toast('Erreur',true))}
function sellCard(cs){var p=prompt('Prix de vente (EUR):');if(!p)return;api('POST','/api/portfolio/sell',{cardSlug:cs,sellPrice:parseFloat(p)}).then(()=>{toast('Carte vendue!');location.reload()}).catch(()=>toast('Erreur',true))}

function addGW(){var n=document.getElementById('gw-number').value;var l=document.getElementById('gw-league').value;var p=document.getElementById('gw-participants').value;if(!n||!p){toast('Remplis GW et participants',true);return}api('POST','/api/gameweek',{gwNumber:parseInt(n),league:l,participants:parseInt(p)}).then(()=>{toast('GW enregistree!');location.reload()}).catch(()=>toast('Erreur',true))}
function setEdge(){var l=document.getElementById('edge-league').value;var v=document.getElementById('edge-value').value;if(!v){toast('Entre une valeur',true);return}api('POST','/api/edge',{league:l,multiplier:parseFloat(v)}).then(()=>{toast('Edge sauvegarde!');location.reload()}).catch(()=>toast('Erreur',true))}

function addAuctionAlert(){var s=document.getElementById('alert-slug').value.trim();var r=document.getElementById('alert-rarity').value;var m=document.getElementById('alert-maxbid').value;if(!s||!m){toast('Remplis tous les champs',true);return}api('POST','/api/auction-alert',{slug:s,rarity:r,maxBid:parseFloat(m)}).then(()=>{toast('Alerte configuree!');location.reload()}).catch(()=>toast('Erreur',true))}

function triggerScan(){toast('Scan en cours...');api('POST','/api/scan').then(()=>setTimeout(()=>location.reload(),5000)).catch(()=>toast('Erreur',true))}

document.querySelectorAll('.price-input').forEach(function(input){input.addEventListener('change',function(){var s=this.dataset.slug;var t=this.dataset.type;var p=this.value;api('PUT','/api/watchlist/'+t+'/'+s+'/price',{maxPrice:p?parseFloat(p):null}).then(()=>toast('Prix mis a jour')).catch(()=>toast('Erreur',true))})})
</script>
</body>
</html>`;
}

module.exports = { generateDashboardHTML };
