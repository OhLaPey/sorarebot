# 🚨 Sorare Price Alert Bot

Bot qui surveille le marché Sorare et t'envoie des alertes Discord quand :
- Un nouveau listing apparaît pour tes joueurs/clubs suivis
- Un prix passe sous ton seuil défini

## 📋 Surveillances configurées par défaut

### Clubs
| Club | Rareté |
|------|--------|
| Toulouse FC | Unique |

### Joueurs
| Joueur | Rareté |
|--------|--------|
| Dominik Greif | Super Rare |
| Berke Özer | Super Rare |
| Mike Penders | Super Rare |
| Brice Samba | Super Rare |

---

## 🚀 Déploiement sur Railway

### Étape 1 : Créer le Bot Discord

1. Va sur https://discord.com/developers/applications
2. Clique **"New Application"** → Nomme-la "Sorare Alert"
3. Menu **"Bot"** à gauche → **"Reset Token"** → Copie le **Token**
4. Active ces options (en bas) :
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Menu **"OAuth2"** → **"URL Generator"**
   - Scope: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`
6. Copie l'URL générée et ouvre-la pour inviter le bot sur ton serveur
7. Note l'**Application ID** dans "General Information" (= Client ID)

### Étape 2 : Récupérer le Channel ID Discord

1. Dans Discord, active le **Mode Développeur** :
   - Paramètres → Avancés → Mode développeur ✅
2. Clic droit sur le salon où tu veux les alertes → **"Copier l'identifiant"**

### Étape 3 : Déployer sur Railway

1. Va sur https://railway.app et connecte-toi avec GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Sélectionne ce repo
4. Va dans **Variables** et ajoute :

| Variable | Valeur |
|----------|--------|
| `DISCORD_TOKEN` | Le token de ton bot Discord |
| `DISCORD_CLIENT_ID` | L'Application ID du bot |
| `DISCORD_CHANNEL_ID` | L'ID du salon pour les alertes |
| `PORT` | `3000` |

5. **Optionnel - Proxy NordVPN** (recommandé) :

| Variable | Valeur |
|----------|--------|
| `NORDVPN_USER` | Ton username NordVPN SOCKS5 |
| `NORDVPN_PASS` | Ton password NordVPN SOCKS5 |
| `NORDVPN_SERVER` | `fr751.nordvpn.com` |

6. Railway déploie automatiquement !

### Étape 4 : Accéder au Dashboard

1. Dans Railway, va dans **Settings** → **Networking**
2. Clique **"Generate Domain"**
3. Ton dashboard sera sur `https://xxx.up.railway.app`

---

## 💻 Dashboard Web

Accède à ton dashboard sur l'URL Railway pour :
- ➕ Ajouter/supprimer des joueurs et clubs
- 💰 Définir des seuils de prix
- 📊 Voir les stats (scans, alertes)
- 🔍 Lancer un scan manuel

---

## 💬 Commandes Discord

| Commande | Description |
|----------|-------------|
| `/watchlist` | Voir les joueurs/clubs surveillés |
| `/addplayer slug:xxx rarity:super_rare maxprice:150` | Ajouter un joueur |
| `/removeplayer slug:xxx` | Retirer un joueur |
| `/setprice slug:xxx maxprice:80` | Définir un seuil de prix |
| `/stats` | Voir les stats du bot |
| `/scan` | Lancer un scan immédiat |

---

## 🔧 Trouver le slug d'un joueur

Dans l'URL Sorare :
```
https://sorare.com/fr/football/players/bradley-barcola/cards
                                      ^^^^^^^^^^^^^^^^
                                      C'est le slug !
```

---

## ⚠️ Notes importantes

1. **Premier scan** : Au démarrage, le bot enregistre les listings existants. Les alertes commencent au 2ème scan.

2. **Scan toutes les 5 min** : Configurable dans le code si besoin.

3. **Proxy NordVPN** : Recommandé pour éviter les blocages IP par Sorare.

---

## 📝 License

MIT - Fait avec 💜 pour PPATCH
