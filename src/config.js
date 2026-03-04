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
};
