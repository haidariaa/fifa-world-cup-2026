/*
 * generate-data.js
 * Builds data/worldcup2026.js (window.WC_DATA) from compact source arrays.
 * Run:  node tools/generate-data.js
 *
 * Source of truth for fixtures/venues/results: official FIFA 2026 schedule +
 * ESPN match results through Match 44 (group stage, as of 2026-06-23).
 * Knockout team slots are placeholders until groups conclude.
 */
const fs = require('fs');
const path = require('path');

// ---- Venues ---------------------------------------------------------------
// city -> { venue, country (ISO2 for flag), tz label }
const VENUES = {
  'Mexico City':     { venue: 'Estadio Azteca',          country: 'mx', region: 'Mexico City, Mexico' },
  'Zapopan':         { venue: 'Estadio Akron',           country: 'mx', region: 'Guadalajara, Mexico' },
  'Guadalupe':       { venue: 'Estadio BBVA',            country: 'mx', region: 'Monterrey, Mexico' },
  'Toronto':         { venue: 'BMO Field',               country: 'ca', region: 'Toronto, Canada' },
  'Vancouver':       { venue: 'BC Place',                country: 'ca', region: 'Vancouver, Canada' },
  'Inglewood':       { venue: 'SoFi Stadium',            country: 'us', region: 'Los Angeles, USA' },
  'Santa Clara':     { venue: "Levi's Stadium",          country: 'us', region: 'San Francisco Bay Area, USA' },
  'East Rutherford': { venue: 'MetLife Stadium',         country: 'us', region: 'New York / New Jersey, USA' },
  'Foxborough':      { venue: 'Gillette Stadium',        country: 'us', region: 'Boston, USA' },
  'Houston':         { venue: 'NRG Stadium',             country: 'us', region: 'Houston, USA' },
  'Arlington':       { venue: 'AT&T Stadium',            country: 'us', region: 'Dallas, USA' },
  'Philadelphia':    { venue: 'Lincoln Financial Field', country: 'us', region: 'Philadelphia, USA' },
  'Atlanta':         { venue: 'Mercedes-Benz Stadium',   country: 'us', region: 'Atlanta, USA' },
  'Seattle':         { venue: 'Lumen Field',             country: 'us', region: 'Seattle, USA' },
  'Miami Gardens':   { venue: 'Hard Rock Stadium',       country: 'us', region: 'Miami, USA' },
  'Kansas City':     { venue: 'Arrowhead Stadium',       country: 'us', region: 'Kansas City, USA' },
};

// ---- Teams ----------------------------------------------------------------
// name -> ISO2 (or gb-eng/gb-sct) for flagcdn
const TEAMS = {
  'Mexico': 'mx', 'South Africa': 'za', 'South Korea': 'kr', 'Czechia': 'cz',
  'Canada': 'ca', 'Bosnia and Herzegovina': 'ba', 'Qatar': 'qa', 'Switzerland': 'ch',
  'Brazil': 'br', 'Morocco': 'ma', 'Haiti': 'ht', 'Scotland': 'gb-sct',
  'United States': 'us', 'Paraguay': 'py', 'Australia': 'au', 'Türkiye': 'tr',
  'Germany': 'de', 'Curaçao': 'cw', 'Ivory Coast': 'ci', 'Ecuador': 'ec',
  'Netherlands': 'nl', 'Japan': 'jp', 'Sweden': 'se', 'Tunisia': 'tn',
  'Belgium': 'be', 'Egypt': 'eg', 'Iran': 'ir', 'New Zealand': 'nz',
  'Spain': 'es', 'Cape Verde': 'cv', 'Saudi Arabia': 'sa', 'Uruguay': 'uy',
  'France': 'fr', 'Senegal': 'sn', 'Iraq': 'iq', 'Norway': 'no',
  'Argentina': 'ar', 'Algeria': 'dz', 'Austria': 'at', 'Jordan': 'jo',
  'Portugal': 'pt', 'DR Congo': 'cd', 'Uzbekistan': 'uz', 'Colombia': 'co',
  'England': 'gb-eng', 'Croatia': 'hr', 'Ghana': 'gh', 'Panama': 'pa',
};

// ---- Groups (official A–L) ------------------------------------------------
const GROUPS = {
  A: ['Mexico', 'South Africa', 'South Korea', 'Czechia'],
  B: ['Canada', 'Bosnia and Herzegovina', 'Qatar', 'Switzerland'],
  C: ['Brazil', 'Morocco', 'Haiti', 'Scotland'],
  D: ['United States', 'Paraguay', 'Australia', 'Türkiye'],
  E: ['Germany', 'Curaçao', 'Ivory Coast', 'Ecuador'],
  F: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'],
  G: ['Belgium', 'Egypt', 'Iran', 'New Zealand'],
  H: ['Spain', 'Cape Verde', 'Saudi Arabia', 'Uruguay'],
  I: ['France', 'Senegal', 'Iraq', 'Norway'],
  J: ['Argentina', 'Algeria', 'Austria', 'Jordan'],
  K: ['Portugal', 'DR Congo', 'Uzbekistan', 'Colombia'],
  L: ['England', 'Croatia', 'Ghana', 'Panama'],
};

// ---- Group-stage matches --------------------------------------------------
// [id, group, date, timeET(24h), city, home, away, homeScore|null, awayScore|null]
const GROUP_MATCHES = [
  [1,  'A', '2026-06-11', '12:00', 'Mexico City',     'Mexico', 'South Africa', 2, 0],
  [2,  'A', '2026-06-11', '15:00', 'Zapopan',         'South Korea', 'Czechia', 2, 1],
  [3,  'B', '2026-06-12', '18:00', 'Toronto',         'Canada', 'Bosnia and Herzegovina', 1, 1],
  [4,  'D', '2026-06-12', '21:00', 'Inglewood',       'United States', 'Paraguay', 4, 1],
  [5,  'B', '2026-06-13', '15:00', 'Santa Clara',     'Qatar', 'Switzerland', 1, 1],
  [6,  'C', '2026-06-13', '18:00', 'East Rutherford', 'Brazil', 'Morocco', 1, 1],
  [7,  'C', '2026-06-13', '13:00', 'Foxborough',      'Haiti', 'Scotland', 0, 1],
  [8,  'D', '2026-06-13', '21:00', 'Vancouver',       'Australia', 'Türkiye', 2, 0],
  [9,  'E', '2026-06-14', '14:00', 'Houston',         'Germany', 'Curaçao', 7, 1],
  [10, 'F', '2026-06-14', '17:00', 'Arlington',       'Netherlands', 'Japan', 2, 2],
  [11, 'E', '2026-06-14', '13:00', 'Philadelphia',    'Ivory Coast', 'Ecuador', 1, 0],
  [12, 'F', '2026-06-14', '20:00', 'Guadalupe',       'Sweden', 'Tunisia', 5, 1],
  [13, 'H', '2026-06-15', '12:00', 'Atlanta',         'Spain', 'Cape Verde', 0, 0],
  [14, 'G', '2026-06-15', '15:00', 'Seattle',         'Belgium', 'Egypt', 1, 1],
  [15, 'H', '2026-06-15', '18:00', 'Miami Gardens',   'Saudi Arabia', 'Uruguay', 1, 1],
  [16, 'G', '2026-06-15', '21:00', 'Inglewood',       'Iran', 'New Zealand', 2, 2],
  [17, 'I', '2026-06-16', '18:00', 'East Rutherford', 'France', 'Senegal', 3, 1],
  [18, 'I', '2026-06-16', '13:00', 'Foxborough',      'Iraq', 'Norway', 1, 4],
  [19, 'J', '2026-06-16', '15:00', 'Kansas City',     'Argentina', 'Algeria', 3, 0],
  [20, 'J', '2026-06-16', '21:00', 'Santa Clara',     'Austria', 'Jordan', 3, 1],
  [21, 'K', '2026-06-17', '14:00', 'Houston',         'Portugal', 'DR Congo', 1, 1],
  [22, 'L', '2026-06-17', '16:00', 'Arlington',       'England', 'Croatia', 4, 2],
  [23, 'L', '2026-06-17', '18:00', 'Toronto',         'Ghana', 'Panama', 1, 0],
  [24, 'K', '2026-06-17', '21:00', 'Mexico City',     'Uzbekistan', 'Colombia', 1, 3],
  [25, 'A', '2026-06-18', '12:00', 'Atlanta',         'Czechia', 'South Africa', 1, 1],
  [26, 'B', '2026-06-18', '15:00', 'Inglewood',       'Switzerland', 'Bosnia and Herzegovina', 4, 1],
  [27, 'B', '2026-06-18', '18:00', 'Vancouver',       'Canada', 'Qatar', 6, 0],
  [28, 'A', '2026-06-18', '21:00', 'Zapopan',         'Mexico', 'South Korea', 1, 0],
  [29, 'D', '2026-06-19', '18:00', 'Seattle',         'United States', 'Australia', 2, 0],
  [30, 'C', '2026-06-19', '15:00', 'Foxborough',      'Scotland', 'Morocco', 0, 1],
  [31, 'C', '2026-06-19', '13:00', 'Philadelphia',    'Brazil', 'Haiti', 3, 0],
  [32, 'D', '2026-06-19', '21:00', 'Santa Clara',     'Türkiye', 'Paraguay', 0, 1],
  [33, 'F', '2026-06-20', '14:00', 'Houston',         'Netherlands', 'Sweden', 5, 1],
  [34, 'E', '2026-06-20', '16:00', 'Toronto',         'Germany', 'Ivory Coast', 2, 1],
  [35, 'E', '2026-06-20', '15:00', 'Kansas City',     'Ecuador', 'Curaçao', 0, 0],
  [36, 'F', '2026-06-20', '20:00', 'Guadalupe',       'Tunisia', 'Japan', 0, 4],
  [37, 'H', '2026-06-21', '12:00', 'Atlanta',         'Spain', 'Saudi Arabia', 4, 0],
  [38, 'G', '2026-06-21', '15:00', 'Inglewood',       'Belgium', 'Iran', 0, 0],
  [39, 'H', '2026-06-21', '18:00', 'Miami Gardens',   'Uruguay', 'Cape Verde', 2, 2],
  [40, 'G', '2026-06-21', '21:00', 'Vancouver',       'New Zealand', 'Egypt', 1, 3],
  [41, 'J', '2026-06-22', '17:00', 'Arlington',       'Argentina', 'Austria', 2, 0],
  [42, 'I', '2026-06-22', '13:00', 'Philadelphia',    'France', 'Iraq', 3, 0],
  [43, 'I', '2026-06-22', '18:00', 'East Rutherford', 'Norway', 'Senegal', 3, 2],
  [44, 'J', '2026-06-22', '21:00', 'Santa Clara',     'Jordan', 'Algeria', 1, 2],
  // ---- Upcoming (no scores yet) ----
  [45, 'K', '2026-06-23', '13:00', 'Houston',         'Portugal', 'Uzbekistan', 5, 0],
  [46, 'L', '2026-06-23', '16:00', 'Foxborough',      'England', 'Ghana', null, null],
  [47, 'L', '2026-06-23', '19:00', 'Toronto',         'Panama', 'Croatia', null, null],
  [48, 'K', '2026-06-23', '22:00', 'Zapopan',         'Colombia', 'DR Congo', null, null],
  [49, 'B', '2026-06-24', '15:00', 'Vancouver',       'Switzerland', 'Canada', null, null],
  [50, 'B', '2026-06-24', '15:00', 'Seattle',         'Bosnia and Herzegovina', 'Qatar', null, null],
  [51, 'C', '2026-06-24', '18:00', 'Miami Gardens',   'Scotland', 'Brazil', null, null],
  [52, 'C', '2026-06-24', '18:00', 'Atlanta',         'Morocco', 'Haiti', null, null],
  [53, 'A', '2026-06-24', '21:00', 'Mexico City',     'Czechia', 'Mexico', null, null],
  [54, 'A', '2026-06-24', '21:00', 'Guadalupe',       'South Africa', 'South Korea', null, null],
  [55, 'E', '2026-06-25', '16:00', 'East Rutherford', 'Ecuador', 'Germany', null, null],
  [56, 'E', '2026-06-25', '16:00', 'Philadelphia',    'Curaçao', 'Ivory Coast', null, null],
  [57, 'F', '2026-06-25', '19:00', 'Arlington',       'Japan', 'Sweden', null, null],
  [58, 'F', '2026-06-25', '19:00', 'Kansas City',     'Tunisia', 'Netherlands', null, null],
  [59, 'D', '2026-06-25', '22:00', 'Inglewood',       'Türkiye', 'United States', null, null],
  [60, 'D', '2026-06-25', '22:00', 'Santa Clara',     'Paraguay', 'Australia', null, null],
  [61, 'I', '2026-06-26', '15:00', 'Foxborough',      'Norway', 'France', null, null],
  [62, 'I', '2026-06-26', '15:00', 'Toronto',         'Senegal', 'Iraq', null, null],
  [63, 'H', '2026-06-26', '20:00', 'Houston',         'Cape Verde', 'Saudi Arabia', null, null],
  [64, 'H', '2026-06-26', '20:00', 'Zapopan',         'Uruguay', 'Spain', null, null],
  [65, 'G', '2026-06-26', '23:00', 'Seattle',         'Egypt', 'Iran', null, null],
  [66, 'G', '2026-06-26', '23:00', 'Vancouver',       'New Zealand', 'Belgium', null, null],
  [67, 'L', '2026-06-27', '17:00', 'East Rutherford', 'Panama', 'England', null, null],
  [68, 'L', '2026-06-27', '17:00', 'Philadelphia',    'Croatia', 'Ghana', null, null],
  [69, 'K', '2026-06-27', '19:30', 'Miami Gardens',   'Colombia', 'Portugal', null, null],
  [70, 'K', '2026-06-27', '19:30', 'Atlanta',         'DR Congo', 'Uzbekistan', null, null],
  [71, 'J', '2026-06-27', '22:00', 'Kansas City',     'Algeria', 'Austria', null, null],
  [72, 'J', '2026-06-27', '22:00', 'Arlington',       'Jordan', 'Argentina', null, null],
];

// ---- Knockout matches -----------------------------------------------------
// [id, round, date, timeET, city, homeSlot, awaySlot]
// Slots use codes: 1X=winner group X, 2X=runner-up group X, W## / L## = winner/loser of match ##,
// 3(...) = best third-placed from the listed groups.
// Bracket structure (slots + winner/loser feeders) mirrors FIFA's official 2026 schedule exactly
// (match numbers 73-104). The Round-of-16+ feeders are NOT sequential — e.g. match 73's winner
// meets match 75's winner in R16 #90.
const KO_MATCHES = [
  // Round of 32
  [73 , 'R32',  '2026-06-28',  '15:00',  'Inglewood',         '2A',                    '2B'],
  [74 , 'R32',  '2026-06-29',  '16:30',  'Foxborough',        '1E',                    '3(A/B/C/D/F)'],
  [75 , 'R32',  '2026-06-30',  '21:00',  'Guadalupe',         '1F',                    '2C'],
  [76 , 'R32',  '2026-06-29',  '13:00',  'Houston',           '1C',                    '2F'],
  [77 , 'R32',  '2026-06-30',  '17:00',  'East Rutherford',   '1I',                    '3(C/D/F/G/H)'],
  [78 , 'R32',  '2026-06-30',  '13:00',  'Arlington',         '2E',                    '2I'],
  [79 , 'R32',  '2026-07-01',  '21:00',  'Mexico City',       '1A',                    '3(C/E/F/H/I)'],
  [80 , 'R32',  '2026-07-01',  '12:00',  'Atlanta',           '1L',                    '3(E/H/I/J/K)'],
  [81 , 'R32',  '2026-07-02',  '20:00',  'Santa Clara',       '1D',                    '3(B/E/F/I/J)'],
  [82 , 'R32',  '2026-07-01',  '16:00',  'Seattle',           '1G',                    '3(A/E/H/I/J)'],
  [83 , 'R32',  '2026-07-02',  '19:00',  'Toronto',           '2K',                    '2L'],
  [84 , 'R32',  '2026-07-02',  '15:00',  'Inglewood',         '1H',                    '2J'],
  [85 , 'R32',  '2026-07-03',  '23:00',  'Vancouver',         '1B',                    '3(E/F/G/I/J)'],
  [86 , 'R32',  '2026-07-03',  '18:00',  'Miami Gardens',     '1J',                    '2H'],
  [87 , 'R32',  '2026-07-04',  '21:30',  'Kansas City',       '1K',                    '3(D/E/I/J/L)'],
  [88 , 'R32',  '2026-07-03',  '14:00',  'Arlington',         '2D',                    '2G'],
  // Round of 16
  [89 , 'R16',  '2026-07-04',  '17:00',  'Philadelphia',      'W74',                   'W77'],
  [90 , 'R16',  '2026-07-04',  '13:00',  'Houston',           'W73',                   'W75'],
  [91 , 'R16',  '2026-07-05',  '16:00',  'East Rutherford',   'W76',                   'W78'],
  [92 , 'R16',  '2026-07-06',  '20:00',  'Mexico City',       'W79',                   'W80'],
  [93 , 'R16',  '2026-07-06',  '15:00',  'Arlington',         'W83',                   'W84'],
  [94 , 'R16',  '2026-07-07',  '20:00',  'Seattle',           'W81',                   'W82'],
  [95 , 'R16',  '2026-07-07',  '12:00',  'Atlanta',           'W86',                   'W88'],
  [96 , 'R16',  '2026-07-07',  '16:00',  'Vancouver',         'W85',                   'W87'],
  // Quarterfinals
  [97 , 'QF',   '2026-07-09',  '16:00',  'Foxborough',        'W89',                   'W90'],
  [98 , 'QF',   '2026-07-10',  '15:00',  'Inglewood',         'W93',                   'W94'],
  [99 , 'QF',   '2026-07-11',  '17:00',  'Miami Gardens',     'W91',                   'W92'],
  [100, 'QF',   '2026-07-12',  '21:00',  'Kansas City',       'W95',                   'W96'],
  // Semifinals
  [101, 'SF',   '2026-07-14',  '15:00',  'Arlington',         'W97',                   'W98'],
  [102, 'SF',   '2026-07-15',  '15:00',  'Atlanta',           'W99',                   'W100'],
  // Third place + Final
  [103, '3P',   '2026-07-18',  '17:00',  'Miami Gardens',     'L101',                  'L102'],
  [104, 'F',    '2026-07-19',  '15:00',  'East Rutherford',   'W101',                  'W102'],
];

// ---- Build ----------------------------------------------------------------
function venueOf(city) {
  const v = VENUES[city];
  if (!v) throw new Error('Unknown city: ' + city);
  return v;
}

const matches = [];

for (const [id, group, date, time, city, home, away, hs, as] of GROUP_MATCHES) {
  const v = venueOf(city);
  matches.push({
    id, round: 'group', group, date, time,
    city, venue: v.venue, region: v.region,
    home, away,
    homeScore: hs, awayScore: as,
    status: hs === null ? 'scheduled' : 'finished',
  });
}

for (const [id, round, date, time, city, homeSlot, awaySlot] of KO_MATCHES) {
  const v = venueOf(city);
  matches.push({
    id, round, group: null, date, time,
    city, venue: v.venue, region: v.region,
    homeSlot, awaySlot,
    home: null, away: null,
    homeScore: null, awayScore: null,
    status: 'scheduled',
  });
}

const ROUND_META = {
  group: { label: 'Group Stage', short: 'Group' },
  R32:   { label: 'Round of 32', short: 'R32' },
  R16:   { label: 'Round of 16', short: 'R16' },
  QF:    { label: 'Quarter-finals', short: 'QF' },
  SF:    { label: 'Semi-finals', short: 'SF' },
  '3P':  { label: 'Third-place Play-off', short: '3rd' },
  F:     { label: 'Final', short: 'Final' },
};

const data = {
  meta: {
    name: 'FIFA World Cup 2026',
    hosts: ['Canada', 'Mexico', 'United States'],
    teamsCount: 48,
    groupsCount: 12,
    matchesCount: matches.length,
    firstMatch: '2026-06-11',
    finalDate: '2026-07-19',
    timezoneNote: 'All kick-off times shown in US Eastern Time (ET).',
    generatedNote: 'Results accurate through Match 45 (2026-06-23). Use Refresh for live updates.',
  },
  teams: TEAMS,
  venues: VENUES,
  groups: GROUPS,
  roundMeta: ROUND_META,
  matches,
};

const outDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'worldcup2026.js');
const banner = '/* AUTO-GENERATED by tools/generate-data.js — do not edit by hand. */\n';
fs.writeFileSync(outFile, banner + 'window.WC_DATA = ' + JSON.stringify(data, null, 2) + ';\n');
console.log('Wrote', outFile, '—', matches.length, 'matches,',
  Object.keys(TEAMS).length, 'teams,', Object.keys(GROUPS).length, 'groups.');
