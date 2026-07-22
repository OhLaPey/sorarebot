/**
 * Commandes Discord slash - Définitions
 */
const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Affiche la liste des surveillances actives'),

  new SlashCommandBuilder()
    .setName('addplayer')
    .setDescription('Ajouter un joueur a surveiller')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur (ex: bradley-barcola)').setRequired(true))
    .addStringOption(opt => opt.setName('rarity').setDescription('Rarete').setRequired(true).addChoices(
      { name: 'Super Rare', value: 'super_rare' },
      { name: 'Rare', value: 'rare' },
      { name: 'Unique', value: 'unique' },
    ))
    .addNumberOption(opt => opt.setName('maxprice').setDescription('Prix max en EUR (optionnel)')),

  new SlashCommandBuilder()
    .setName('removeplayer')
    .setDescription('Retirer un joueur de la surveillance')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setprice')
    .setDescription('Definir un seuil de prix pour un joueur')
    .addStringOption(opt => opt.setName('slug').setDescription('Slug du joueur').setRequired(true))
    .addNumberOption(opt => opt.setName('maxprice').setDescription('Prix max en EUR').setRequired(true)),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Affiche les statistiques du bot'),

  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Lancer un scan immediat'),

  new SlashCommandBuilder()
    .setName('prix')
    .setDescription('Affiche le prix actuel et la tendance d\'un joueur')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true)),

  new SlashCommandBuilder()
    .setName('historique')
    .setDescription('Affiche l\'historique des prix avec graphique')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true))
    .addStringOption(opt => opt.setName('periode').setDescription('Periode').addChoices(
      { name: '1 semaine', value: '7' },
      { name: '1 mois', value: '30' },
      { name: '3 mois', value: '90' },
      { name: '6 mois', value: '180' },
    )),

  new SlashCommandBuilder()
    .setName('marche')
    .setDescription('Resume de tous les listings surveilles'),

  new SlashCommandBuilder()
    .setName('import')
    .setDescription('Importer l\'historique des ventes d\'un joueur')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true))
    .addStringOption(opt => opt.setName('rarete').setDescription('Rarete').addChoices(
      { name: 'Super Rare', value: 'super_rare' },
      { name: 'Rare', value: 'rare' },
      { name: 'Unique', value: 'unique' },
    )),

  // === NOUVELLES COMMANDES ===

  new SlashCommandBuilder()
    .setName('ev')
    .setDescription('Affiche l\'Expected Value par ligue')
    .addIntegerOption(opt => opt.setName('gw').setDescription('Numero de gameweek (defaut: derniere)')),

  new SlashCommandBuilder()
    .setName('gw')
    .setDescription('Enregistrer les participants d\'une gameweek')
    .addIntegerOption(opt => opt.setName('numero').setDescription('Numero de la GW').setRequired(true))
    .addStringOption(opt => opt.setName('ligue').setDescription('Ligue').setRequired(true).addChoices(
      { name: 'Ligue 1', value: 'Ligue 1' },
      { name: 'Premier League', value: 'Premier League' },
      { name: 'LaLiga', value: 'LaLiga' },
      { name: 'Bundesliga', value: 'Bundesliga' },
      { name: 'Eredivisie', value: 'Eredivisie' },
      { name: 'Jupiler Pro', value: 'Jupiler Pro' },
      { name: 'Challenger', value: 'Challenger' },
      { name: 'Contender', value: 'Contender' },
    ))
    .addIntegerOption(opt => opt.setName('participants').setDescription('Nombre de participants').setRequired(true)),

  new SlashCommandBuilder()
    .setName('edge')
    .setDescription('Definir ton edge personnel pour une ligue')
    .addStringOption(opt => opt.setName('ligue').setDescription('Ligue').setRequired(true).addChoices(
      { name: 'Ligue 1', value: 'Ligue 1' },
      { name: 'Premier League', value: 'Premier League' },
      { name: 'LaLiga', value: 'LaLiga' },
      { name: 'Bundesliga', value: 'Bundesliga' },
      { name: 'Eredivisie', value: 'Eredivisie' },
      { name: 'Jupiler Pro', value: 'Jupiler Pro' },
      { name: 'Challenger', value: 'Challenger' },
      { name: 'Contender', value: 'Contender' },
    ))
    .addNumberOption(opt => opt.setName('multiplier').setDescription('Multiplicateur (1.0=neutre, 1.3=+30%)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('portfolio')
    .setDescription('Affiche ton portfolio avec P&L'),

  new SlashCommandBuilder()
    .setName('addcard')
    .setDescription('Ajouter une carte a ton portfolio')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true))
    .addStringOption(opt => opt.setName('rarity').setDescription('Rarete').setRequired(true).addChoices(
      { name: 'Super Rare', value: 'super_rare' },
      { name: 'Rare', value: 'rare' },
      { name: 'Unique', value: 'unique' },
    ))
    .addNumberOption(opt => opt.setName('prix').setDescription('Prix d\'achat en EUR').setRequired(true))
    .addStringOption(opt => opt.setName('type').setDescription('Type d\'achat').addChoices(
      { name: 'Enchere', value: 'auction' },
      { name: 'Marche', value: 'market' },
      { name: 'Trade', value: 'trade' },
    )),

  new SlashCommandBuilder()
    .setName('sellcard')
    .setDescription('Marquer une carte comme vendue')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true))
    .addNumberOption(opt => opt.setName('prix').setDescription('Prix de vente en EUR').setRequired(true)),

  new SlashCommandBuilder()
    .setName('encheres')
    .setDescription('Affiche les encheres en cours')
    .addStringOption(opt => opt.setName('rarity').setDescription('Filtrer par rarete').addChoices(
      { name: 'Super Rare', value: 'super_rare' },
      { name: 'Rare', value: 'rare' },
      { name: 'Unique', value: 'unique' },
    )),

  new SlashCommandBuilder()
    .setName('alertenchere')
    .setDescription('Definir un seuil d\'alerte pour les encheres')
    .addStringOption(opt => opt.setName('joueur').setDescription('Slug du joueur').setRequired(true))
    .addStringOption(opt => opt.setName('rarity').setDescription('Rarete').setRequired(true).addChoices(
      { name: 'Super Rare', value: 'super_rare' },
      { name: 'Rare', value: 'rare' },
      { name: 'Unique', value: 'unique' },
    ))
    .addNumberOption(opt => opt.setName('maxbid').setDescription('Bid max en EUR').setRequired(true)),

  new SlashCommandBuilder()
    .setName('opportunites')
    .setDescription('Affiche les opportunites de marche detectees'),

  new SlashCommandBuilder()
    .setName('mercato')
    .setDescription('Dernieres rumeurs de transfert (MLS / J.League / K League -> Europe)')
    .addStringOption(opt => opt.setName('ligue').setDescription('Filtrer par ligue de depart').addChoices(
      { name: 'MLS', value: 'MLS' },
      { name: 'J.League', value: 'J_LEAGUE' },
      { name: 'K League', value: 'K_LEAGUE' },
    )),

  new SlashCommandBuilder()
    .setName('recommandation')
    .setDescription('Recommandation de la meilleure ligue a jouer'),

  new SlashCommandBuilder()
    .setName('rewards')
    .setDescription('Affiche la configuration des rewards par ligue')
    .addStringOption(opt => opt.setName('ligue').setDescription('Ligue specifique').addChoices(
      { name: 'Ligue 1', value: 'Ligue 1' },
      { name: 'Premier League', value: 'Premier League' },
      { name: 'LaLiga', value: 'LaLiga' },
      { name: 'Bundesliga', value: 'Bundesliga' },
      { name: 'Eredivisie', value: 'Eredivisie' },
      { name: 'Jupiler Pro', value: 'Jupiler Pro' },
    )),
].map(cmd => cmd.toJSON());

module.exports = commands;
