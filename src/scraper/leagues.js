/**
 * Classification des clubs par ligue / region.
 *
 * Objectif : reperer les rumeurs de joueurs qui QUITTENT une ligue "tremplin"
 * (MLS, J.League, K League) pour rejoindre l'Europe -- c'est la ou une carte
 * Sorare peut prendre le plus de valeur, et c'est le moins surveille.
 *
 * La page sorarescore.com/transfer-rumors ne fournit AUCUNE info de pays/ligue,
 * uniquement le nom du club. On matche donc sur des mots-cles dans le nom.
 *
 * >>> Ces listes sont editables a la main : ajoute/retire des clubs librement. <<<
 */

// Ligues "source" qui nous interessent en priorite (depart -> Europe)
const SOURCE_LEAGUES = ['MLS', 'J_LEAGUE', 'K_LEAGUE'];

// Libelles + emoji par region (affichage Discord)
const REGION_LABEL = {
  MLS: 'MLS (USA/Canada)',
  J_LEAGUE: 'J.League (Japon)',
  K_LEAGUE: 'K League (Coree)',
  SAUDI: 'Saudi Pro League',
  LIGA_MX: 'Liga MX (Mexique)',
  BRAZIL: 'Bresil',
  CHINA: 'Chinese Super League',
  EUROPE: 'Europe',
};

const REGION_FLAG = {
  MLS: '🇺🇸',       // 🇺🇸
  J_LEAGUE: '🇯🇵',  // 🇯🇵
  K_LEAGUE: '🇰🇷',  // 🇰🇷
  SAUDI: '🇸🇦',     // 🇸🇦
  LIGA_MX: '🇲🇽',   // 🇲🇽
  BRAZIL: '🇧🇷',    // 🇧🇷
  CHINA: '🇨🇳',     // 🇨🇳
  EUROPE: '🇪🇺',    // 🇪🇺
};

// Mots-cles par region. Match par sous-chaine sur le nom normalise (sans accents, minuscule).
const LEAGUE_KEYWORDS = {
  MLS: [
    'atlanta united', 'austin fc', 'charlotte fc', 'chicago fire', 'fc cincinnati',
    'colorado rapids', 'columbus crew', 'dc united', 'd.c. united', 'fc dallas',
    'houston dynamo', 'sporting kansas city', 'sporting kc', 'la galaxy',
    'los angeles galaxy', 'los angeles fc', 'lafc', 'inter miami', 'minnesota united',
    'cf montreal', 'montreal impact', 'nashville sc', 'new england revolution',
    'new york city', 'new york red bulls', 'ny red bulls', 'orlando city',
    'philadelphia union', 'portland timbers', 'real salt lake', 'san diego fc',
    'san jose earthquakes', 'seattle sounders', 'st. louis city', 'st louis city',
    'saint louis city', 'toronto fc', 'vancouver whitecaps',
  ],
  J_LEAGUE: [
    'kashima antlers', 'urawa red', 'kashiwa reysol', 'fc tokyo', 'kawasaki frontale',
    'yokohama f. marinos', 'yokohama f marinos', 'yokohama fc', 'shonan bellmare',
    'nagoya grampus', 'kyoto sanga', 'gamba osaka', 'cerezo osaka', 'vissel kobe',
    'sanfrecce hiroshima', 'avispa fukuoka', 'sagan tosu', 'consadole sapporo',
    'hokkaido consadole', 'albirex niigata', 'machida zelvia', 'fc machida',
    'tokyo verdy', 'tokyo verdi', 'jubilo iwata', 'fagiano okayama', 'shimizu s-pulse',
    'oita trinita', 'vegalta sendai', 'montedio yamagata', 'v-varen nagasaki',
    'ventforet kofu', 'omiya ardija', 'jef united', 'tokushima vortis',
    'renofa yamaguchi', 'blaublitz akita', 'roasso kumamoto', 'mito hollyhock',
  ],
  K_LEAGUE: [
    'ulsan', 'jeonbuk', 'pohang steelers', 'fc seoul', 'suwon samsung', 'suwon fc',
    'incheon united', 'daegu fc', 'gangwon', 'gwangju', 'jeju', 'gimcheon sangmu',
    'daejeon hana', 'daejeon citizen', 'seongnam', 'busan ipark', 'anyang',
    'cheonan', 'gimpo', 'bucheon', 'ansan greeners', 'seoul e-land',
    'chungnam asan', 'gyeongnam', 'jeonnam dragons',
  ],
  // Destinations NON-europeennes courantes (pour classer la cible d'un transfert)
  SAUDI: [
    'al-hilal', 'al hilal', 'al-nassr', 'al nassr', 'al-ittihad', 'al ittihad',
    'al-ahli', 'al ahli', 'al-ettifaq', 'al ettifaq', 'al-shabab', 'al shabab',
    'al-taawoun', 'al-fateh', 'al-riyadh', 'al-qadsiah', 'al-khaleej', 'damac',
    'al-wehda', 'al-fayha', 'al-raed', 'al-hazem', 'al-okhdood', 'neom sc',
  ],
  LIGA_MX: [
    'club america', 'chivas', 'guadalajara', 'cruz azul', 'pumas unam', 'unam',
    'tigres uanl', 'monterrey', 'rayados', 'toluca', 'club leon', 'pachuca',
    'santos laguna', 'atlas', 'tijuana', 'club tijuana', 'necaxa', 'queretaro',
    'puebla', 'mazatlan', 'fc juarez', 'atletico san luis', 'san luis',
  ],
  BRAZIL: [
    'flamengo', 'palmeiras', 'corinthians', 'sao paulo', 'santos fc',
    'fluminense', 'botafogo', 'vasco', 'gremio', 'internacional', 'atletico mineiro',
    'cruzeiro', 'bahia', 'fortaleza', 'red bull bragantino', 'athletico paranaense',
    'juventude', 'vitoria', 'ceara sc', 'mirassol',
  ],
  CHINA: [
    'shanghai port', 'shanghai shenhua', 'beijing guoan', 'shandong taishan',
    'guangzhou', 'wuhan three towns', 'chengdu rongcheng', 'zhejiang', 'henan',
    'tianjin', 'changchun yatai', 'qingdao', 'dalian',
  ],
};

function normalize(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordre de priorite : d'abord les ligues source, puis les autres regions non-euro.
const CHECK_ORDER = ['MLS', 'J_LEAGUE', 'K_LEAGUE', 'SAUDI', 'LIGA_MX', 'BRAZIL', 'CHINA'];

/**
 * Retourne la region d'un club a partir de son nom.
 * Tout ce qui n'est pas explicitement reconnu comme non-europeen est classe 'EUROPE'
 * (heuristique : on prefere ne rien rater cote depart, quitte a marquer la
 * destination comme "probable Europe").
 */
function classifyClub(name) {
  const n = normalize(name);
  if (!n) return 'EUROPE';
  for (const region of CHECK_ORDER) {
    if (LEAGUE_KEYWORDS[region].some(kw => n.includes(kw))) {
      return region;
    }
  }
  return 'EUROPE';
}

module.exports = {
  SOURCE_LEAGUES,
  REGION_LABEL,
  REGION_FLAG,
  LEAGUE_KEYWORDS,
  classifyClub,
  normalize,
};
