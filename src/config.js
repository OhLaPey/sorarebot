/**
 * Configuration centralisée du bot Sorare
 */
module.exports = {
  PORT: process.env.PORT || 3000,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  NORDVPN_USER: process.env.NORDVPN_USER,
  NORDVPN_PASS: process.env.NORDVPN_PASS,
  NORDVPN_SERVER: process.env.NORDVPN_SERVER || 'fr751.nordvpn.com',
  NORDVPN_PORT: 1080,
  SCAN_INTERVAL_MS: parseInt(process.env.SCAN_INTERVAL_MS) || 5 * 60 * 1000,
  AUCTION_SCAN_INTERVAL_MS: parseInt(process.env.AUCTION_SCAN_INTERVAL_MS) || 10 * 60 * 1000,
  SALES_SCAN_INTERVAL_MS: parseInt(process.env.SALES_SCAN_INTERVAL_MS) || 6 * 60 * 60 * 1000,
  GOOGLE_CREDENTIALS: process.env.GOOGLE_CREDENTIALS,
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '1l4fRJjsajGOQ4jYDdAcL7i9x5gtaG8e11KXRksw6AXI',
  DB_PATH: process.env.DB_PATH || './data/sorare.db',

  // === Veille mercato (sorarescore.com/transfer-rumors) ===
  // Active/desactive le scan des rumeurs de transfert
  MERCATO_ENABLED: process.env.MERCATO_ENABLED !== 'false',
  SORARESCORE_URL: process.env.SORARESCORE_URL || 'https://sorarescore.com/transfer-rumors',
  // Donnee quotidienne : inutile de marteler, 2h par defaut
  MERCATO_SCAN_INTERVAL_MS: parseInt(process.env.MERCATO_SCAN_INTERVAL_MS) || 2 * 60 * 60 * 1000,
  MERCATO_FETCH_TIMEOUT_MS: parseInt(process.env.MERCATO_FETCH_TIMEOUT_MS) || 20000,
  // Seuil de probabilite minimum (0 = tout, y compris les rumeurs sans proba)
  MERCATO_MIN_PROBABILITY: parseInt(process.env.MERCATO_MIN_PROBABILITY) || 0,
  // true = n'alerter que les departs vers l'Europe ; false = tous les departs des ligues source
  MERCATO_EUROPE_ONLY: process.env.MERCATO_EUROPE_ONLY === 'true',
};
