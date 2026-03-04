/**
 * Google Sheets integration - Sync bidirectionnelle
 */
const { google } = require('googleapis');
const config = require('./config');

let sheetsClient = null;

async function init() {
  if (!config.GOOGLE_CREDENTIALS) {
    console.log('Google Sheets non configure (GOOGLE_CREDENTIALS manquant)');
    return false;
  }

  try {
    const credentials = JSON.parse(config.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    await ensureSheetTabs();
    console.log('Google Sheets connecte');
    return true;
  } catch (error) {
    console.error('Erreur init Google Sheets:', error.message);
    return false;
  }
}

async function ensureSheetTabs() {
  if (!sheetsClient) return;

  try {
    const response = await sheetsClient.spreadsheets.get({
      spreadsheetId: config.GOOGLE_SHEET_ID,
    });

    const existingSheets = response.data.sheets.map(s => s.properties.title);
    const requiredSheets = {
      'Listings': ['Date', 'Heure', 'Joueur', 'Slug', 'Rarete', 'Prix_Min_EUR', 'Nb_Listings', 'Card_Slug'],
      'Prix_Timeline': ['Timestamp', 'Joueur', 'Slug', 'Rarete', 'Prix_Min', 'Prix_Median', 'Nb_Listings'],
      'Ventes': ['Date', 'Joueur', 'Slug', 'Rarete', 'Saison', 'Serial', 'Prix_EUR', 'Type', 'Acheteur', 'Vendeur'],
      'Encheres': ['Date', 'Joueur', 'Slug', 'Rarete', 'Bid_Actuel', 'Nb_Bids', 'Fin', 'Statut'],
      'Portfolio': ['Joueur', 'Slug', 'Rarete', 'Saison', 'Serial', 'Prix_Achat', 'Date_Achat', 'Valeur_Actuelle', 'P&L'],
      'EV_History': ['GW', 'Ligue', 'EV_Base', 'EV_Ajuste', 'Participants', 'Cash_Pool', 'Meilleure_Ligue'],
    };

    for (const [sheetName, headers] of Object.entries(requiredSheets)) {
      if (!existingSheets.includes(sheetName)) {
        await sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId: config.GOOGLE_SHEET_ID,
          resource: {
            requests: [{ addSheet: { properties: { title: sheetName } } }],
          },
        });

        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: config.GOOGLE_SHEET_ID,
          range: sheetName + '!A1',
          valueInputOption: 'RAW',
          resource: { values: [headers] },
        });

        console.log('Onglet cree: ' + sheetName);
      }
    }
  } catch (error) {
    console.error('Erreur creation onglets:', error.message);
  }
}

async function appendRows(sheetName, rows) {
  if (!sheetsClient || rows.length === 0) return;

  try {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: sheetName + '!A:Z',
      valueInputOption: 'USER_ENTERED',
      resource: { values: rows },
    });
  } catch (error) {
    console.error('Erreur ecriture ' + sheetName + ':', error.message);
  }
}

async function getSheetData(sheetName, range) {
  if (!sheetsClient) return [];

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: sheetName + '!' + range,
    });
    return response.data.values || [];
  } catch (error) {
    console.error('Erreur lecture ' + sheetName + ':', error.message);
    return [];
  }
}

function isConnected() {
  return sheetsClient !== null;
}

module.exports = { init, appendRows, getSheetData, isConnected };
