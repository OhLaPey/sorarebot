# Sorare Tracker Pro - PPATCH Edition v3.0

Dashboard complet pour gerer ton activite Sorare : suivi de marche, analyse de performance, gestion de portfolio, calcul d'EV, encheres et opportunites. Heberge sur Railway.app, accessible 24h/24.

---

## Fonctionnalites

### Vue d'ensemble
- KPIs temps reel : portfolio, P&L latent/realise, meilleure ligue, watchlist, opportunites, encheres
- Graphique EV par ligue et P&L portfolio
- Opportunites recentes et encheres actives

### Jouer
- Compositeur de lineup visuel (terrain avec 5 slots : Gardien, Defenseur, Milieu, Attaquant, Extra)
- Enregistrement des resultats GW : classement, score, reward, participants
- KPIs : GW jouees, rewards gagnes, rang moyen, meilleur resultat
- Graphiques : rewards par ligue + evolution des scores
- Historique des resultats avec medailles or/argent/bronze
- Filtre par ligue

### Marche des transferts
- Recherche par nom de joueur, rarete, fourchette de prix
- Tous les listings avec prix floor et nombre de listings
- Actions rapides : + Watch (ajout watchlist) et + Portfolio (ajout portfolio)
- Ventes recentes : historique avec joueur, prix, date, type de vente
- Histogramme distribution des prix

### Rentabilite
- Profit net total = Trading P&L + Rewards
- ROI global sur l'ensemble des depenses
- P&L mensuel empile (trading + rewards) en bar chart
- Repartition par rarete en donut chart
- Top 5 meilleurs et pires trades avec %
- Historique complet de toutes les ventes realisees

### EV & Ligues
- EV Base = Cash Pool / Participants
- EV Ajuste = EV Base x Edge personnel
- Edge configurable par ligue (multiplicateur)
- Historique EV par gameweek

### Portfolio
- Ajout de cartes (slug + rarete + prix + type achat)
- Suivi du floor price automatique a chaque scan
- P&L latent (valeur actuelle - prix d'achat)
- Enregistrement des ventes avec calcul P&L realise

### Watchlist & Encheres
- Watchlist joueurs et clubs avec seuil de prix
- Suivi temps reel des encheres actives
- Alertes Discord quand un prix passe sous le seuil
- Detection automatique d'opportunites (decotes, anomalies)

### Alertes Discord
- Notification nouveau listing
- Alerte prix sous seuil
- Opportunites de marche detectees
- Alertes encheres sous budget

---

## Deploiement sur Railway

### Etape 1 : Creer le Bot Discord

1. Va sur https://discord.com/developers/applications
2. **"New Application"** -> Nomme-la "Sorare Alert"
3. Menu **"Bot"** -> **"Reset Token"** -> Copie le **Token**
4. Active :
   - Presence Intent
   - Server Members Intent
   - Message Content Intent
5. Menu **"OAuth2"** -> **"URL Generator"**
   - Scope: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`
6. Copie l'URL et invite le bot sur ton serveur
7. Note l'**Application ID** (= Client ID)

### Etape 2 : Recuperer le Channel ID Discord

1. Active le **Mode Developpeur** dans Discord : Parametres -> Avances -> Mode developpeur
2. Clic droit sur le salon -> **"Copier l'identifiant"**

### Etape 3 : Deployer sur Railway

1. Va sur https://railway.app et connecte-toi avec GitHub
2. **New Project** -> **Deploy from GitHub repo**
3. Selectionne ce repo
4. Va dans **Variables** et ajoute :

| Variable | Valeur |
|----------|--------|
| `DISCORD_TOKEN` | Le token de ton bot Discord |
| `DISCORD_CLIENT_ID` | L'Application ID du bot |
| `DISCORD_CHANNEL_ID` | L'ID du salon pour les alertes |
| `PORT` | `3000` |

5. **Optionnel - Proxy NordVPN** (recommande) :

| Variable | Valeur |
|----------|--------|
| `NORDVPN_USER` | Ton username NordVPN SOCKS5 |
| `NORDVPN_PASS` | Ton password NordVPN SOCKS5 |
| `NORDVPN_SERVER` | `fr751.nordvpn.com` |

6. **Optionnel - Google Sheets** :

| Variable | Valeur |
|----------|--------|
| `GOOGLE_CREDENTIALS` | JSON de ton service account Google |
| `GOOGLE_SHEET_ID` | ID de ta Google Sheet |

7. Railway deploie automatiquement a chaque push !

### Etape 4 : Acceder au Dashboard

1. Dans Railway, va dans **Settings** -> **Networking**
2. Clique **"Generate Domain"**
3. Ton dashboard sera sur `https://xxx.up.railway.app`
4. Il est accessible 24h/24, auto-restart en cas de crash

---

## Commandes Discord

| Commande | Description |
|----------|-------------|
| `/watchlist` | Voir les joueurs/clubs surveilles |
| `/addplayer slug rarity maxprice` | Ajouter un joueur a la watchlist |
| `/removeplayer slug` | Retirer un joueur |
| `/setprice slug maxprice` | Definir un seuil de prix |
| `/portfolio` | Afficher le portfolio avec P&L |
| `/acheter slug rarity prix type` | Ajouter une carte au portfolio |
| `/vendre joueur prix` | Enregistrer une vente |
| `/opportunites` | Afficher les opportunites detectees |
| `/import joueur rarete` | Importer l'historique de ventes |
| `/scan` | Lancer un scan immediat |
| `/stats` | Statistiques du bot |

---

## Trouver le slug d'un joueur

Dans l'URL Sorare :
```
https://sorare.com/fr/football/players/bradley-barcola/cards
                                      ^^^^^^^^^^^^^^^^
                                      C'est le slug !
```

---

## Architecture technique

```
sorarebot/
  index.js              # Point d'entree principal
  railway.json           # Config Railway (auto-restart, nixpacks)
  nixpacks.toml          # Build config (Chromium, Node 20)
  public/
    index.html           # Dashboard SPA complet (11 onglets)
  src/
    config.js            # Variables d'environnement
    db.js                # SQLite : tables, queries, seed data
    sheets.js            # Integration Google Sheets
    server/
      routes.js          # API Express (20+ routes)
      dashboard.js       # Dashboard legacy (non utilise)
    scraper/
      browser.js         # Puppeteer factory avec proxy
      market.js          # Scraping listings et ventes
      auctions.js        # Scraping encheres
      opportunities.js   # Detection automatique d'opportunites
    ev/
      calculator.js      # Calcul EV par ligue
    discord/
      commands.js        # Definition des slash commands
      handlers.js        # Handlers des commandes Discord
```

### Scans automatiques

| Scan | Intervalle | Description |
|------|-----------|-------------|
| Marche | 5 min | Prix, listings, alertes, opportunites |
| Encheres | 10 min | Encheres actives, alertes bid |
| Ventes | 6h | Historique des ventes |

### Base de donnees SQLite

Tables : `watchlist`, `price_history`, `sales`, `auctions`, `auction_alerts`, `portfolio`, `gameweek_data`, `rewards_config`, `user_edge`, `ev_history`, `opportunities`, `lineups`, `gw_results`, `market_searches`

### API REST

| Route | Description |
|-------|-------------|
| `GET /api/status` | Statut du bot |
| `GET /api/watchlist` | Watchlist |
| `GET /api/portfolio` | Portfolio + P&L |
| `GET /api/ev` | EV actuel par ligue |
| `GET /api/auctions` | Encheres actives |
| `GET /api/opportunities` | Opportunites detectees |
| `GET /api/play/stats` | Stats de jeu |
| `GET /api/play/results` | Historique resultats GW |
| `GET /api/market/listings` | Listings marche |
| `GET /api/market/recent-sales` | Ventes recentes |
| `GET /api/profitability` | Rentabilite complete |
| `POST /api/play/lineup` | Sauvegarder une lineup |
| `POST /api/play/result` | Enregistrer un resultat |
| `POST /api/scan` | Lancer un scan |

---

## Notes importantes

1. **Premier scan** : au demarrage, le bot enregistre les listings existants. Les alertes commencent au 2eme scan.
2. **Proxy NordVPN** : recommande pour eviter les blocages IP par Sorare.
3. **Persistance** : SQLite dans `./data/sorare.db`. Sur Railway, les donnees persistent entre les redemarrages.
4. **Auto-refresh** : le dashboard se rafraichit toutes les 30 secondes.
5. **Documentation** : accessible dans l'onglet Documentation du dashboard.

---

MIT - Fait pour PPATCH
