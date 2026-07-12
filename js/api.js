/* api.js — live score refresh.
   Primary provider: FIFA's own data API (api.fifa.com/v3) — same feed fifa.com uses,
     CORS-open, returns real WC2026 results. Undocumented/unofficial + behind Akamai
     bot protection, so it can occasionally throttle; we fall back automatically.
   Fallback provider: TheSportsDB free API (documented, developer-friendly).
   Both fall back to bundled data if unreachable. */
(function (WC) {
  'use strict';

  WC.api = WC.api || {};

  // ---- Config (override at runtime, e.g. WC.api.config.provider = 'sdb') ----
  WC.api.config = {
    provider: 'fifa',          // 'fifa' (primary) | 'sdb' (fallback) — refresh tries both anyway
    fifa: {
      base: 'https://api.fifa.com/api/v3',
      competition: '17',       // FIFA World Cup
      season: '285023',        // 2026 edition
    },
    sdb: {
      base: 'https://www.thesportsdb.com/api/v1/json',
      key: '3',                // free public test key
      leagueId: '4429',        // "FIFA World Cup"
      season: '2026',
    },
  };

  // Map provider/team-name variants -> our canonical names (WC_DATA.teams keys).
  const ALIASES = {
    'usa': 'United States', 'united states': 'United States', 'united states of america': 'United States',
    'korea republic': 'South Korea', 'south korea': 'South Korea', 'korea, republic of': 'South Korea',
    'czech republic': 'Czechia', 'czechia': 'Czechia',
    'turkey': 'Türkiye', 'turkiye': 'Türkiye', 'türkiye': 'Türkiye',
    "cote d'ivoire": 'Ivory Coast', 'cote divoire': 'Ivory Coast', 'ivory coast': 'Ivory Coast',
    'curacao': 'Curaçao', 'curaçao': 'Curaçao',
    'dr congo': 'DR Congo', 'congo dr': 'DR Congo', 'democratic republic of the congo': 'DR Congo',
    'iran': 'Iran', 'ir iran': 'Iran',
    'cape verde': 'Cape Verde', 'cabo verde': 'Cape Verde',
    'bosnia and herzegovina': 'Bosnia and Herzegovina', 'bosnia': 'Bosnia and Herzegovina',
    'saudi arabia': 'Saudi Arabia', 'ksa': 'Saudi Arabia',
  };

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
      .replace(/[^a-z ]/g, '').trim();
  }

  // Build a lookup from normalized canonical name -> canonical name.
  const canonByNorm = {};
  Object.keys(WC.data.teams).forEach(function (t) { canonByNorm[norm(t)] = t; });
  Object.keys(ALIASES).forEach(function (k) { canonByNorm[norm(k)] = ALIASES[k]; });

  function canonical(name) {
    const n = norm(name);
    return canonByNorm[n] || null;
  }

  // Normalize a knockout slot label to a canonical key, or null if it's not a
  // group-position / best-third slot. Handles our "3(B/E/F/I/J)" and FIFA's "3BEFIJ".
  function koSlotKey(s) {
    s = String(s || '').trim().toUpperCase();
    let m;
    if ((m = s.match(/^([12])([A-L])$/))) return m[1] + m[2];          // 1A, 2B…
    if (/^3[(A-L/)]+$/.test(s)) {                                       // 3(B/E/F/I/J) or 3BEFIJ
      const letters = (s.match(/[A-L]/g) || []).sort().join('');
      return letters ? '3' + letters : null;
    }
    return null;                                                       // W##, L##, group-internal A1… → ignore
  }
  WC.api.koSlotKey = koSlotKey;

  // Broader KO signature: group-position slots (via koSlotKey) PLUS winner/loser feeders so
  // R16→Final fixtures match too. Our "W74"/"L101" and FIFA's "W74"/"RU101" share match numbers.
  function koMatchSig(s) {
    const k = koSlotKey(s);
    if (k) return k;
    const t = String(s || '').trim().toUpperCase();
    let m;
    if ((m = t.match(/^W(\d+)$/))) return 'W' + m[1];                   // winner of match ##
    if ((m = t.match(/^(?:L|RU)(\d+)$/))) return 'L' + m[1];            // loser / runner-up of match ##
    return null;
  }

  // Build { slotKey -> canonical team } from FIFA's knockout fixtures that already
  // have real teams assigned (their official third-place allocation, etc.).
  function buildKoSlotMap(rawMatches) {
    const ph = function (x) { return Array.isArray(x) ? (x[0] && x[0].Description) : x; };
    const stage = function (m) { const s = m.StageName; return Array.isArray(s) ? (s[0] && s[0].Description) : s; };
    const map = {};
    (rawMatches || []).forEach(function (m) {
      if (/first stage|group/i.test(stage(m) || '')) return;           // knockout rounds only
      const ka = koSlotKey(ph(m.PlaceHolderA)), kb = koSlotKey(ph(m.PlaceHolderB));
      const home = canonical(fifaTeamName(m.Home)), away = canonical(fifaTeamName(m.Away));
      if (ka && home) map[ka] = home;
      if (kb && away) map[kb] = away;
    });
    return map;
  }

  // Index matches by an order-independent team-pair key for merging.
  function pairKey(a, b) {
    return [a, b].sort().join(' :: ');
  }
  function buildIndex() {
    const idx = {};
    WC.data.matches.forEach(function (m) {
      if (m.round === 'group' && m.home && m.away) {
        (idx[pairKey(m.home, m.away)] = idx[pairKey(m.home, m.away)] || []).push(m);
      }
    });
    return idx;
  }

  // ---- Normalizers: each returns {home, away, hs, as, date, live, minute} (canonical names) ----
  function normalizeSdb(ev) {
    const home = canonical(ev.strHomeTeam);
    const away = canonical(ev.strAwayTeam);
    if (!home || !away) return null;
    const hs = ev.intHomeScore, as = ev.intAwayScore;
    const has = hs !== null && hs !== '' && hs !== undefined && as !== null && as !== '' && as !== undefined;
    const status = (ev.strStatus || '').toLowerCase().trim();
    const finishedRe = /(ft|aet|pen|finished|full.?time|after extra|abandoned)/;
    const notStartedRe = /(ns|not started|sched|tbd|postp|canc|^$)/;
    const live = has && !finishedRe.test(status) && !notStartedRe.test(status);
    const minute = live ? (ev.strProgress || ev.strStatus || '') : '';
    return { home: home, away: away, hs: has ? +hs : null, as: has ? +as : null,
      date: ev.dateEvent || null, live: live, minute: minute };
  }

  function fifaTeamName(side) {
    if (!side) return null;
    let tn = side.TeamName;
    if (Array.isArray(tn)) {
      const en = tn.find(function (x) { return /en/i.test(x.Locale || ''); }) || tn[0];
      tn = en && en.Description;
    }
    return tn || side.ShortClubName || side.Abbreviation || null;
  }
  function normalizeFifa(m) {
    const home = canonical(fifaTeamName(m.Home));
    const away = canonical(fifaTeamName(m.Away));
    if (!home || !away) return null;
    const hs = m.HomeTeamScore, as = m.AwayTeamScore;
    const has = hs != null && as != null && !isNaN(+hs) && !isNaN(+as);
    // FIFA MatchStatus: 0 = finished/played, 1 = not started; anything else with a score = in-play.
    const st = m.MatchStatus;
    const live = has && st !== 0 && st !== 1;
    const minute = live ? (m.MatchTime || (m.Period != null ? String(m.Period) : '')) : '';
    return { home: home, away: away, hs: has ? +hs : null, as: has ? +as : null,
      date: (m.Date || '').slice(0, 10), live: live, minute: minute };
  }

  // Merge canonical {home,away,hs,as,date} records into WC_DATA.matches. Returns count changed.
  function mergeNormalized(list) {
    const idx = buildIndex();
    let updated = 0;
    list.forEach(function (ev) {
      if (!ev || ev.hs === null) return;
      const candidates = idx[pairKey(ev.home, ev.away)];
      if (!candidates || !candidates.length) return;
      const m = candidates.find(function (c) { return ev.date && c.date === ev.date; }) || candidates[0];
      const newStatus = ev.live ? 'live' : 'finished';
      const changed = m.homeScore !== ev.hs || m.awayScore !== ev.as || m.status !== newStatus;
      if (m.home === ev.home) { m.homeScore = ev.hs; m.awayScore = ev.as; }
      else { m.homeScore = ev.as; m.awayScore = ev.hs; } // orient to our home/away
      m.status = newStatus;
      m.minute = ev.live ? (ev.minute || '') : '';
      if (changed) updated++;
    });
    return updated;
  }
  // Back-compat: accept raw TheSportsDB events.
  WC.api.mergeEvents = function (events) {
    return mergeNormalized((events || []).map(normalizeSdb).filter(Boolean));
  };

  // Merge FIFA knockout results into our KO matches (scores, real teams, penalty winners).
  // KO matches are matched by their slot signature (e.g. 1E + 3BEFIJ), since they have no fixed teams.
  function mergeKnockout(rawMatches) {
    const ph = function (x) { return Array.isArray(x) ? (x[0] && x[0].Description) : x; };
    const stage = function (m) { const s = m.StageName; return Array.isArray(s) ? (s[0] && s[0].Description) : s; };
    const sig = function (a, b) { return [a, b].sort().join('|'); };
    const idx = {};
    WC.data.matches.forEach(function (m) {
      if (m.round !== 'group') {
        const a = koMatchSig(m.homeSlot), b = koMatchSig(m.awaySlot);
        if (a && b) idx[sig(a, b)] = m;
      }
    });
    let updated = 0;
    (rawMatches || []).forEach(function (fm) {
      if (/first stage|group/i.test(stage(fm) || '')) return;
      const hs = fm.HomeTeamScore, as = fm.AwayTeamScore, st = fm.MatchStatus;
      if (hs == null || as == null || st === 1) return;               // no score / not started
      const ka = koMatchSig(ph(fm.PlaceHolderA)), kb = koMatchSig(ph(fm.PlaceHolderB));
      if (!ka || !kb) return;
      const m = idx[sig(ka, kb)];
      if (!m) return;
      const fh = canonical(fifaTeamName(fm.Home)), fa = canonical(fifaTeamName(fm.Away));
      const live = st !== 0;                                          // 0 = finished; else in-play
      let nh, na, nHome, nAway;
      if (koMatchSig(m.homeSlot) === ka) { nh = +hs; na = +as; nHome = fh; nAway = fa; }
      else { nh = +as; na = +hs; nHome = fa; nAway = fh; }
      const hp = fm.HomeTeamPenaltyScore, ap = fm.AwayTeamPenaltyScore;
      const hasPens = !live && hs === as && hp != null && ap != null;
      let penH = null, penA = null, pen = null;
      if (hasPens) {
        if (koMatchSig(m.homeSlot) === ka) { penH = +hp; penA = +ap; } else { penH = +ap; penA = +hp; }
        pen = penH > penA ? nHome : nAway;
      }
      const newStatus = live ? 'live' : 'finished';
      if (m.homeScore !== nh || m.awayScore !== na || m.status !== newStatus || (m.penWinner || null) !== pen) updated++;
      m.homeScore = nh; m.awayScore = na; m.status = newStatus;
      if (nHome) m.home = nHome;
      if (nAway) m.away = nAway;
      if (pen) { m.penWinner = pen; m.penHome = penH; m.penAway = penA; }
      else if (!live) { delete m.penWinner; delete m.penHome; delete m.penAway; }
      m.minute = live ? (fm.MatchTime || '') : '';
    });
    return updated;
  }

  // Fetch JSON with one retry on rate-limit / transient failure.
  // Returns { json } on success, or { rateLimited:true } / null on failure.
  function fetchJson(url, attempt) {
    attempt = attempt || 0;
    return fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 429) return { rateLimited: true };
        if (!r.ok) return null;
        return r.json().then(function (j) { return { json: j }; }).catch(function () { return null; });
      })
      .then(function (res) {
        if (res && res.rateLimited && attempt < 1) {
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(fetchJson(url, attempt + 1)); }, 1500);
          });
        }
        return res;
      })
      .catch(function () { return null; });
  }

  // ---- Providers: each resolves to {reached, rateLimited, events:[normalized]} ----
  function providerFifa() {
    const f = WC.api.config.fifa;
    const url = f.base + '/calendar/matches?idCompetition=' + f.competition +
      '&idSeason=' + f.season + '&count=500&language=en';
    return fetchJson(url, 0).then(function (res) {
      if (!res) return { reached: false, rateLimited: false, events: [] };
      if (res.rateLimited) return { reached: false, rateLimited: true, events: [] };
      const arr = (res.json && (res.json.Results || res.json.results)) || [];
      // Capture FIFA's official knockout slot assignments (e.g. USA's R32 opponent) so the
      // bracket can show real pairings without waiting for our own third-place allocation.
      WC.data.koSlotReal = buildKoSlotMap(arr);
      // Merge real knockout results (scores + penalty winners) — group merge below handles the rest.
      mergeKnockout(arr);
      return { reached: true, rateLimited: false, events: arr.map(normalizeFifa).filter(Boolean) };
    });
  }
  function providerSdb() {
    const s = WC.api.config.sdb;
    const k = s.base + '/' + s.key + '/';
    const urls = [
      k + 'eventspastleague.php?id=' + s.leagueId,                                   // freshest results
      k + 'eventsseason.php?id=' + s.leagueId + '&s=' + encodeURIComponent(s.season), // backfill
    ];
    return Promise.all(urls.map(function (u) { return fetchJson(u, 0); })).then(function (results) {
      let reached = false, rateLimited = false, events = [];
      results.forEach(function (res) {
        if (!res) return;
        if (res.rateLimited) { rateLimited = true; return; }
        if (res.json) { reached = true; events = events.concat((res.json.events || []).map(normalizeSdb).filter(Boolean)); }
      });
      return { reached: reached, rateLimited: rateLimited, events: events };
    });
  }

  function summarize(updated, total, source) {
    return { ok: true, updated: updated, total: total, source: source,
      message: (updated ? (updated + ' match' + (updated === 1 ? '' : 'es') + ' updated') : 'Already up to date') + ' · source: ' + source };
  }

  // FIFA primary; TheSportsDB fallback. Bundled data stays put if both fail.
  WC.api.refresh = function () {
    return providerFifa().then(function (fifa) {
      const fifaScored = fifa.events.filter(function (e) { return e.hs != null; });
      if (fifa.reached && fifaScored.length) {
        return summarize(mergeNormalized(fifa.events), fifaScored.length, 'FIFA.com');
      }
      // Fall back to TheSportsDB (and still fold in anything FIFA returned).
      return providerSdb().then(function (sdb) {
        const all = fifa.events.concat(sdb.events);
        const scored = all.filter(function (e) { return e.hs != null; });
        if (!fifa.reached && !sdb.reached) {
          return { ok: false, updated: 0,
            message: (fifa.rateLimited || sdb.rateLimited)
              ? 'Live providers are rate-limiting — try again shortly. Showing bundled data.'
              : 'Could not reach live providers. Showing bundled data.' };
        }
        if (!scored.length) return { ok: true, updated: 0, message: 'No new results from live providers yet.' };
        return summarize(mergeNormalized(all), scored.length, sdb.reached ? 'TheSportsDB' : 'FIFA.com');
      });
    });
  };

})(window.WC);
