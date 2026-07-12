/* app.js — UI state, rendering, interactions. Loaded last. */
(function (WC) {
  'use strict';
  const D = WC.data;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------------- State ----------------
  const LS_PRED = 'wc2026.predictions';
  const LS_KO = 'wc2026.koWinners';
  const LS_AUTO = 'wc2026.autoRefresh';
  const LS_INCL = 'wc2026.includePredictions';
  const LS_LIVE = 'wc2026.includeLive';
  const LS_BPRED = 'wc2026.bracketPred';
  const LS_BLAYOUT = 'wc2026.bracketLayout';
  function load(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function loadBool(key) { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } }
  function loadBoolDefault(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v === '1'; } catch (e) { return def; } }

  const state = {
    view: 'schedule',
    predictMode: false,
    predictions: load(LS_PRED),   // { matchId: {hs, as} }
    koWinners: load(LS_KO),       // { matchId: teamName }
    autoRefresh: loadBoolDefault(LS_AUTO, true),  // on by default so the bracket/standings self-update (60s); respects an explicit off choice
    includePredictions: loadBool(LS_INCL),  // false = tables show actual results only
    includeLive: loadBoolDefault(LS_LIVE, true),  // true = fold in-progress scores into the table
    bracketPred: loadBoolDefault(LS_BPRED, true), // Bracket page: true = show predicted teams, false = actual-only
    bracketLayout: (function () { try { return localStorage.getItem(LS_BLAYOUT) === 'radial' ? 'radial' : 'tree'; } catch (e) { return 'tree'; } })(),
    lastUpdated: null,
    filters: { stage: 'all', group: 'all', team: 'all', upcoming: false, q: '' },
  };

  // ---------------- Effective scores ----------------
  function realScore(m) {
    return (m.homeScore != null && m.awayScore != null)
      ? { hs: m.homeScore, as: m.awayScore, predicted: false } : null;
  }
  function predScore(m) {
    const p = state.predictions[m.id];
    if (p && p.hs !== '' && p.as !== '' && p.hs != null && p.as != null && !isNaN(+p.hs) && !isNaN(+p.as)) {
      return { hs: +p.hs, as: +p.as, predicted: true };
    }
    return null;
  }
  // Display score — includes in-progress (live) results.
  function getScore(m) {
    const r = realScore(m);
    if (r) { r.live = m.status === 'live'; return r; }
    const p = predScore(m); if (p) { p.live = false; return p; }
    return null;
  }
  // --- TOGGLE-CONTROLLED scores (Groups standings, best-thirds, Eliminated) ---
  // Live games: counted provisionally when "Live table" is on, else held out.
  // Predictions: folded in only when "Include my predictions" is on.
  function tableScore(m) {
    if (m.status === 'live') {
      if (state.includeLive) return { hs: m.homeScore, as: m.awayScore, predicted: false, live: true };
      return state.includePredictions ? predScore(m) : null;
    }
    const r = realScore(m); if (r) return r;
    return state.includePredictions ? predScore(m) : null;
  }
  function elimBracketScore(m) {
    // Definitive: live games never count toward elimination/knockout.
    if (m.status === 'live') { if (state.includePredictions) { const p = predScore(m); if (p) { p.live = false; return p; } } return null; }
    const r = realScore(m); if (r) { r.live = false; return r; }
    if (state.includePredictions) { const p = predScore(m); if (p) { p.live = false; return p; } }
    return null;
  }
  // Standings used to decide eliminations — excludes live scores (a team is never knocked out on a provisional result).
  function elimScore(m) {
    if (m.status === 'live') return state.includePredictions ? predScore(m) : null;
    const r = realScore(m); if (r) return r;
    return state.includePredictions ? predScore(m) : null;
  }
  // --- ALWAYS-PROJECTED scores (the Knockout Bracket tab + KO prediction) ---
  // real results win; your predictions fill every unplayed slot so the bracket resolves.
  function projScore(m) {
    if (m.status === 'live') return predScore(m); // live not counted in group standings
    const r = realScore(m); if (r) return r;
    return predScore(m);
  }
  function projBracketScore(m) {
    const r = realScore(m); if (r) { r.live = m.status === 'live'; return r; }
    const p = predScore(m); if (p) { p.live = false; return p; }
    return null;
  }
  function getKoWinner(id) {
    // A real penalty-shootout result (from the data/live feed) wins over the user's pick.
    const m = D.matches.find(function (x) { return x.id === +id; });
    if (m && m.penWinner) return m.penWinner;
    return state.koWinners[id] || null;
  }
  // --- ACTUAL-ONLY scores (Bracket "show my predictions" OFF): real results, no predictions ---
  function realBracketScore(m) {
    const r = realScore(m); if (r) { r.live = m.status === 'live'; return r; }
    return null;
  }

  let MODEL = null; // {standings, bracket, realBracket, thirds, eliminated}
  // Which bracket the Knockout page shows: projected (with your predictions) or actual-only.
  function bracketM() { return state.bracketPred ? MODEL.bracket : MODEL.realBracket; }
  function recompute() {
    // Toggle-controlled standings for Groups / best-thirds / Eliminated.
    const standings = WC.standings.computeAll(tableScore);
    const thirds = WC.standings.bestThirds(standings);
    // Always-projected bracket so the knockout stage is viewable AND predictable.
    const projStandings = WC.standings.computeAll(projScore);
    const bracket = WC.resolveBracket(projStandings, projBracketScore, getKoWinner);
    // Eliminated follows the toggle: reuse the projected bracket when predictions are on,
    // otherwise resolve an actual-only bracket so no team is knocked out on a prediction.
    // Eliminations are definitive → use finished-only standings (no live), respecting the predictions toggle.
    const elimStandings = state.includePredictions ? projStandings : WC.standings.computeAll(elimScore);
    const elimBracket = state.includePredictions ? bracket : WC.resolveBracket(elimStandings, elimBracketScore, getKoWinner);
    const eliminated = computeEliminated(elimStandings, elimBracket, WC.standings.bestThirds(elimStandings));
    // Teams that have ACTUALLY clinched a knockout spot (finished real groups only — no live, no predictions).
    const realStandings = WC.standings.computeAll(function (m) {
      return (m.status !== 'live' && m.homeScore != null) ? { hs: m.homeScore, as: m.awayScore, predicted: false } : null;
    });
    // Actual-only bracket: real qualified teams + real KO results; everything else stays TBD.
    const realBracket = WC.resolveBracket(realStandings, realBracketScore, getKoWinner);
    const actualQualified = {};
    const allRealComplete = Object.keys(realStandings).every(function (g) { return realStandings[g].complete; });
    Object.keys(realStandings).forEach(function (g) {
      const s = realStandings[g];
      if (s.complete) { actualQualified[s.rows[0].team] = true; actualQualified[s.rows[1].team] = true; }
    });
    if (allRealComplete) WC.standings.bestThirds(realStandings).forEach(function (t) { if (t.qualifies) actualQualified[t.team] = true; });
    // Teams FIFA has officially assigned to a knockout slot are confirmed qualifiers too (e.g. best thirds).
    if (WC.data.koSlotReal) Object.keys(WC.data.koSlotReal).forEach(function (k) { actualQualified[WC.data.koSlotReal[k]] = true; });
    MODEL = { standings: standings, bracket: bracket, realBracket: realBracket, elimBracket: elimBracket, thirds: thirds, eliminated: eliminated, actualQualified: actualQualified };
  }

  // ---------------- Eliminated computation ----------------
  const ROUND_WEIGHT = { 'R32': 3, 'R16': 4, 'QF': 5, 'SF': 6, '3P': 6, 'F': 7 };
  function computeEliminated(standings, bracket, thirds) {
    const out = {};
    // Knockout losers (SF losers excluded — they still play the 3rd-place game)
    ['R32', 'R16', 'QF', '3P', 'F'].forEach(function (round) {
      bracket.rounds[round].forEach(function (bx) {
        if (bx.loser && !out[bx.loser]) {
          // Score from the eliminated team's perspective (their goals – opponent's goals), + pens if any.
          let byScore = '';
          if (bx.hs != null && bx.as != null) {
            const lg = (bx.loser === bx.home) ? bx.hs : bx.as;
            const wg = (bx.loser === bx.home) ? bx.as : bx.hs;
            byScore = lg + '–' + wg;
            if (bx.match.penWinner != null && bx.match.penHome != null) {
              const lp = (bx.loser === bx.home) ? bx.match.penHome : bx.match.penAway;
              const wp = (bx.loser === bx.home) ? bx.match.penAway : bx.match.penHome;
              byScore += ' (' + lp + '–' + wp + ' pens)';
            }
          }
          out[bx.loser] = { team: bx.loser, reason: 'Lost in ' + WC.roundLabel(round),
            by: bx.winner, byScore: byScore, byMatchId: bx.match.id, weight: ROUND_WEIGHT[round], predicted: bx.predicted };
        }
      });
    });
    const allComplete = Object.keys(standings).every(function (g) { return standings[g].complete; });
    const qThirds = {}; thirds.forEach(function (t) { if (t.qualifies) qThirds[t.team] = true; });

    Object.keys(standings).forEach(function (g) {
      const st = standings[g];
      st.rows.forEach(function (row, i) {
        if (out[row.team]) return;
        // Teams that finished above them in the group — the group-stage equivalent of "who knocked them out".
        const above = st.rows.filter(function (r) { return r.pos < row.pos; }).map(function (r) { return r.team; });
        if (st.complete) {
          if (i === 3) out[row.team] = { team: row.team, reason: 'Finished 4th in Group ' + g, above: above, weight: 1, predicted: row.predUsed };
          else if (i === 2 && allComplete && !qThirds[row.team]) out[row.team] = { team: row.team, reason: '3rd in Group ' + g + ' — outside best 8', above: above, weight: 2, predicted: row.predUsed };
        } else {
          // mid-group: eliminated only if mathematically certain to finish 4th
          const remaining = 3 - row.P;
          const maxPts = row.Pts + 3 * remaining;
          let guaranteedAbove = 0;
          st.rows.forEach(function (o) { if (o.team !== row.team && o.Pts > maxPts) guaranteedAbove++; });
          if (guaranteedAbove >= 3) out[row.team] = { team: row.team, reason: 'Eliminated in Group ' + g, above: above, weight: 0, predicted: row.predUsed };
        }
      });
    });
    return Object.keys(out).map(function (k) { return out[k]; })
      .sort(function (a, b) { return b.weight - a.weight || a.team.localeCompare(b.team); });
  }

  // ---------------- Shared bits ----------------
  function teamGroup(team) {
    const gs = D.groups;
    return Object.keys(gs).find(function (g) { return gs[g].indexOf(team) >= 0; });
  }
  // For a knockout match, resolved teams + scores from the ACTIVE bracket model
  // (follows the "Show my predictions" toggle: projected when on, actual-only when off).
  function koView(m) { return bracketM().byId[m.id]; }

  // Format a live clock: "67" -> "67'", "HT"/"" handled.
  function liveMinute(s) {
    s = (s == null ? '' : String(s)).trim();
    if (!s) return 'LIVE';
    if (/^\d+$/.test(s)) return s + "'";
    return s;
  }
  function statusTag(m, score, koResolved) {
    if (m.status === 'live') return '<span class="tag live">● ' + WC.esc(liveMinute(m.minute)) + '</span>';
    if (score && score.predicted) return '<span class="tag pred">PREDICTED</span>';
    if (score) return '<span class="tag ft">FT</span>';
    return '<span class="tag sched">SCHEDULED</span>';
  }

  // ---------------- SCHEDULE ----------------
  function matchTeams(m) {
    if (m.round === 'group') {
      const s = getScore(m);
      return { home: m.home, away: m.away, hs: s ? s.hs : null, as: s ? s.as : null,
        predicted: s ? s.predicted : false, live: s ? !!s.live : false, resolved: true };
    }
    const kv = koView(m);
    return { home: kv.home, away: kv.away, hs: kv.hs, as: kv.as,
      predicted: kv.predicted, live: kv.live, resolved: !!(kv.home && kv.away) };
  }

  function predictableNow(m, t) {
    if (!state.predictMode) return false;
    if (realScore(m)) return false;            // played already
    if (m.round === 'group') return true;
    return t.resolved;                         // KO only once both teams known
  }

  function scoreCell(val, predicted, live) {
    if (val == null) return '<span class="score dim">–</span>';
    return '<span class="score' + (predicted ? ' pred' : '') + (live ? ' live' : '') + '">' + val + '</span>';
  }

  // The "actual" column value (right): real/live score, or a dash if not played yet.
  function actualNum(val, live) {
    if (val == null) return '<span class="ps-dim">–</span>';
    return '<span class="ps-act' + (live ? ' live' : '') + '">' + val + '</span>';
  }

  // Penalty-shootout note: "Paraguay won 4–3 on penalties" (full) or "pens 4–3" (short). Empty if none.
  function penNote(m, short) {
    if (!m || m.penWinner == null || m.penHome == null || m.penAway == null) return '';
    const hi = Math.max(m.penHome, m.penAway), lo = Math.min(m.penHome, m.penAway);
    return short ? ('pens ' + hi + '–' + lo) : (WC.esc(m.penWinner) + ' won ' + hi + '–' + lo + ' on penalties');
  }
  function matchCard(m) {
    const t = matchTeams(m);
    const ko = m.round !== 'group';
    const real = realScore(m);
    const pick = predScore(m);
    const showBoth = !!(real && pick);
    // Highlight the winner only on a finished result (not live, not a future prediction).
    const winnerH = !!(real && m.status !== 'live' && real.hs > real.as);
    const winnerA = !!(real && m.status !== 'live' && real.as > real.hs);
    const stageTxt = ko ? WC.roundShort(m.round) : ('Group ' + m.group);
    const homeLabel = ko && !t.home ? slotLabel(m.homeSlot) : t.home;
    const awayLabel = ko && !t.away ? slotLabel(m.awaySlot) : t.away;
    let gradeCls = '';
    if (showBoth) {
      if (m.status === 'live') gradeCls = 'g-live';
      else { const g = gradeOne({ hs: pick.hs, as: pick.as }, { hs: real.hs, as: real.as }); gradeCls = 'g-' + g; }
    }

    let body;
    if (predictableNow(m, t)) {
      const p = state.predictions[m.id] || {};
      body =
        rowEditable(homeLabel, 'h', m.id, p.hs) +
        rowEditable(awayLabel, 'a', m.id, p.as) +
        koWinnerPicker(m, t);
    } else if (pick) {
      // Two labelled columns: your PRED beside the ACTUAL (a dash until the match is played).
      const actLabel = (real && m.status === 'live') ? 'LIVE' : 'ACTUAL';
      body =
        '<div class="mc-scorehead"><span></span><span>PRED</span><span>' + actLabel + '</span></div>' +
        '<div class="mc-row r2">' + chipOrSlot(homeLabel, winnerH, ko && !t.home) +
          '<span class="ps-pred ' + gradeCls + '" title="Your prediction">' + pick.hs + '</span>' +
          actualNum(real ? real.hs : null, t.live) + '</div>' +
        '<div class="mc-row r2">' + chipOrSlot(awayLabel, winnerA, ko && !t.away) +
          '<span class="ps-pred ' + gradeCls + '" title="Your prediction">' + pick.as + '</span>' +
          actualNum(real ? real.as : null, t.live) + '</div>';
    } else {
      body =
        '<div class="mc-row">' + chipOrSlot(homeLabel, winnerH, ko && !t.home) + scoreCell(t.hs, t.predicted, t.live) + '</div>' +
        '<div class="mc-row">' + chipOrSlot(awayLabel, winnerA, ko && !t.away) + scoreCell(t.as, t.predicted, t.live) + '</div>';
    }

    return '' +
      '<div class="match-card' + (t.live ? ' live' : '') + '" data-match-id="' + m.id + '">' +
        '<div class="mc-top"><span class="mc-stage' + (ko ? ' ko' : '') + '">' + stageTxt + '</span>' +
          '<span class="mc-time">🕒 ' + WC.fmtTime(m.time) + ' · #' + m.id + '</span></div>' +
        body +
        (penNote(m, false) ? '<div class="mc-pens">🥅 ' + penNote(m, false) + '</div>' : '') +
        '<div class="mc-foot"><span>' + WC.esc(m.venue) + ' · ' + WC.esc(m.city) + '</span>' +
          statusTag(m, getScore(m), t.resolved) + '</div>' +
      '</div>';
  }

  function chipOrSlot(label, isWinner, isSlot) {
    if (isSlot) return '<span class="team slot"><span class="nm slot">' + WC.esc(label) + '</span></span>';
    return WC.teamChip(label, isWinner ? 'winner' : '');
  }
  function rowEditable(label, side, id, val) {
    const isTeam = !!D.teams[label];
    const chip = isTeam ? WC.teamChip(label) : '<span class="team slot"><span class="nm slot">' + WC.esc(label) + '</span></span>';
    return '<div class="mc-row">' + chip +
      '<span class="pred-inputs"><input type="number" min="0" max="99" class="pred-' + side + '" data-mid="' + id + '" value="' + (val == null ? '' : val) + '" aria-label="score"></span></div>';
  }
  function koWinnerPicker(m, t) {
    if (m.round === 'group' || !t.resolved) return '';
    const p = state.predictions[m.id] || {};
    if (p.hs === '' || p.as === '' || p.hs == null || p.as == null || +p.hs !== +p.as) return '';
    const pick = state.koWinners[m.id] || '';
    const need = !pick;
    return '<div class="pred-winner-pick' + (need ? ' needs-pick' : '') + '">' +
      (need ? '⚠ Draw — pick who advances on penalties:' : '✓ Advances on penalties:') +
      '<select class="pred-winner" data-mid="' + m.id + '">' +
        '<option value="">—</option>' +
        '<option value="' + WC.esc(t.home) + '"' + (pick === t.home ? ' selected' : '') + '>' + WC.esc(t.home) + '</option>' +
        '<option value="' + WC.esc(t.away) + '"' + (pick === t.away ? ' selected' : '') + '>' + WC.esc(t.away) + '</option>' +
      '</select></div>';
  }
  function slotLabel(slot) {
    if (!slot) return 'TBD';
    let m;
    if ((m = slot.match(/^1([A-L])$/))) return 'Winner Group ' + m[1];
    if ((m = slot.match(/^2([A-L])$/))) return 'Runner-up Group ' + m[1];
    if ((m = slot.match(/^3\((.+)\)$/))) return '3rd: ' + m[1];
    if ((m = slot.match(/^W(\d+)$/))) return 'Winner of #' + m[1];
    if ((m = slot.match(/^L(\d+)$/))) return 'Loser of #' + m[1];
    return slot;
  }

  function filtersActive() {
    const f = state.filters;
    return f.stage !== 'all' || f.group !== 'all' || f.team !== 'all' || f.upcoming || f.q.trim() !== '';
  }
  function updateFiltersBtn() {
    const btn = $('#filters-toggle');
    if (!btn) return;
    const open = !$('#schedule-toolbar').classList.contains('hidden');
    const active = filtersActive();
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('has-filters', active && !open);
    btn.textContent = (open ? '☰ Hide filters' : '☰ Filters') + (active && !open ? ' •' : '');
  }

  function filteredMatches() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    return D.matches.filter(function (m) {
      const ko = m.round !== 'group';
      if (f.stage === 'group' && ko) return false;
      if (f.stage === 'knockout' && !ko) return false;
      if (f.group !== 'all') { if (ko || m.group !== f.group) return false; }
      const t = matchTeams(m);
      if (f.team !== 'all') {
        const teams = [t.home, t.away];
        if (teams.indexOf(f.team) < 0) return false;
      }
      if (f.upcoming && realScore(m)) return false;
      if (q) {
        const hay = [t.home, t.away, m.venue, m.city, slotLabel(m.homeSlot), slotLabel(m.awaySlot)]
          .filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function renderSchedule() {
    updateFiltersBtn();
    const matches = filteredMatches();
    const list = $('#schedule-list');
    if (!matches.length) { list.innerHTML = '<div class="empty">No matches match your filters.</div>'; return; }
    const byDate = {};
    matches.forEach(function (m) { (byDate[m.date] = byDate[m.date] || []).push(m); });
    const today = WC.todayISO();
    updateFiltersBtn();
    const html = Object.keys(byDate).sort().map(function (date) {
      const isToday = date === today;
      const dayMatches = byDate[date].sort(function (a, b) { return (a.time || '').localeCompare(b.time || '') || a.id - b.id; });
      const round = dayMatches[0].round;
      const sub = WC.roundLabel(round) === 'Group Stage' ? '' : WC.roundLabel(round);
      return '<div class="day-group">' +
        '<div class="day-head' + (isToday ? ' is-today' : '') + '" id="day-' + date + '">' +
          '<h2>' + WC.longDate(date) + '</h2>' +
          (isToday ? '<span class="today-pill">TODAY</span>' : '') +
          (sub ? '<span class="day-sub">' + sub + '</span>' : '') +
          '<span class="day-sub">' + dayMatches.length + ' match' + (dayMatches.length === 1 ? '' : 'es') + '</span>' +
        '</div>' +
        '<div class="match-grid">' + dayMatches.map(matchCard).join('') + '</div>' +
      '</div>';
    }).join('');
    list.innerHTML = html;
  }

  // ---------------- Predictions toggle (Groups / Bracket / Eliminated) ----------------
  function predToggleHtml() {
    const on = state.includePredictions;
    const n = Object.keys(state.predictions).length;
    return '<label class="pred-switch' + (on ? ' on' : '') + '" title="Blend your predicted scores into the tables and bracket">' +
      '<input type="checkbox" id="incl-pred-toggle"' + (on ? ' checked' : '') + '>' +
      '<span class="ps-track"><span class="ps-thumb"></span></span>' +
      '<span class="ps-label">Include my predictions' + (n ? ' (' + n + ')' : '') + '</span></label>' +
      '<span class="vc-mode">' + (on ? 'Showing actual + your predictions' : 'Showing actual results only') + '</span>';
  }
  function liveToggleHtml() {
    const on = state.includeLive;
    const n = WC.data.matches.filter(function (m) { return m.status === 'live'; }).length;
    return '<label class="pred-switch live-switch' + (on ? ' on' : '') + '" title="Fold in-progress scores into the table (provisional until full-time)">' +
      '<input type="checkbox" id="incl-live-toggle"' + (on ? ' checked' : '') + '>' +
      '<span class="ps-track"><span class="ps-thumb"></span></span>' +
      '<span class="ps-label">🔴 Live table' + (n ? ' (' + n + ' live)' : '') + '</span></label>';
  }
  // Bracket page: switch between the left-to-right Tree and the radial diagram.
  function bracketLayoutSwitchHtml() {
    const r = state.bracketLayout === 'radial';
    return '<div class="bk-layout" role="tablist" title="Switch bracket layout">' +
      '<button class="bkl' + (!r ? ' on' : '') + '" data-layout="tree">🌳 Tree</button>' +
      '<button class="bkl' + (r ? ' on' : '') + '" data-layout="radial">◎ Radial</button>' +
    '</div>';
  }
  // Bracket page: toggle between projected (with your predictions) and actual-only.
  function bracketPredToggleHtml() {
    const on = state.bracketPred;
    const n = Object.keys(state.predictions).length;
    return '<label class="pred-switch' + (on ? ' on' : '') + '" title="Show your predicted teams &amp; results in the bracket, or only what has actually happened">' +
      '<input type="checkbox" id="bracket-pred-toggle"' + (on ? ' checked' : '') + '>' +
      '<span class="ps-track"><span class="ps-thumb"></span></span>' +
      '<span class="ps-label">Show my predictions' + (n ? ' (' + n + ')' : '') + '</span></label>' +
      '<span class="vc-mode">' + (on ? 'Actual results + your predicted teams' : 'Actual qualified teams only — undecided slots stay TBD') + '</span>';
  }
  function renderViewControls() {
    // Toggles govern the Groups standings + Best-thirds + Eliminated + Bracket views.
    ['groups-controls', 'bracket-controls', 'elim-controls'].forEach(function (id) {
      const el = document.getElementById(id); if (el) el.innerHTML = '';
    });
    if (state.view === 'groups') {
      const host = document.getElementById('groups-controls');
      if (host) host.innerHTML = predToggleHtml() + liveToggleHtml();
    } else if (state.view === 'eliminated') {
      const host = document.getElementById('elim-controls');
      if (host) host.innerHTML = predToggleHtml();
    } else if (state.view === 'bracket') {
      const host = document.getElementById('bracket-controls');
      if (host) host.innerHTML = bracketLayoutSwitchHtml() + bracketPredToggleHtml() +
        (state.bracketLayout === 'radial' ? '' : bracketLegendHtml());
    }
  }

  // ---------------- GROUPS ----------------
  function renderGroups() {
    const grid = $('#groups-grid');
    const html = Object.keys(D.groups).map(function (g) {
      const st = MODEL.standings[g];
      // Teams currently playing live in this group (only relevant when the live table is on).
      const liveTeams = {};
      if (state.includeLive) {
        D.matches.forEach(function (m) {
          if (m.round === 'group' && m.group === g && m.status === 'live') { liveTeams[m.home] = true; liveTeams[m.away] = true; }
        });
      }
      const rows = st.rows.map(function (r) {
        const cls = r.pos === 1 || r.pos === 2 ? 'q' + r.pos : (r.pos === 3 ? 'q3' : '');
        const isLive = !!liveTeams[r.team];
        const form = r.form.slice(-5).map(function (x) { return '<i class="' + x + '"></i>'; }).join('');
        return '<tr class="' + cls + (isLive ? ' st-live' : '') + '">' +
          '<td class="pos"><span class="pos-bar"></span>' + r.pos + '</td>' +
          '<td class="team-col"><span class="tm">' + flagImg(r.team) + '<span>' + WC.esc(r.team) + '</span>' +
            (isLive ? '<span class="st-live-dot" title="Playing now (provisional)">●</span>' : '') + '</span></td>' +
          '<td>' + r.P + '</td><td>' + r.W + '</td><td>' + r.D + '</td><td>' + r.L + '</td>' +
          '<td>' + r.GF + '</td><td>' + r.GA + '</td><td>' + (r.GD > 0 ? '+' + r.GD : r.GD) + '</td>' +
          '<td class="pts">' + r.Pts + '</td>' +
          '<td><span class="form">' + form + '</span></td>' +
        '</tr>';
      }).join('');
      const pred = st.rows.some(function (r) { return r.predUsed; });
      const liveN = st.live || 0;
      const progress = st.finished + '/' + st.total + ' played' +
        (pred ? ' <span class="gc-pred">incl. predictions</span>' : '') +
        (liveN ? ' <span class="gc-live">● ' + liveN + ' live</span>' : '');
      return '<div class="group-card' + (liveN ? ' has-live' : '') + '">' +
        '<h3>Group ' + g + '<span class="gc-prog">' + progress + '</span></h3>' +
        '<div class="table-wrap"><table class="standings"><thead><tr>' +
          '<th></th><th class="team-col">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Form</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="group-foot"><span><span class="legend-dot" style="background:var(--accent)"></span>Advance (top 2)</span>' +
          (liveN ? '<span class="gc-live">● live = provisional</span>' : '<span><span class="legend-dot" style="background:var(--accent-3)"></span>3rd — best-8 contention</span>') +
        '</div>' +
      '</div>';
    }).join('');
    grid.innerHTML = html;
    renderBestThirds();
  }

  // Best third-placed teams — 8 of the 12 group thirds advance (FIFA Pts→GD→GF).
  function renderBestThirds() {
    const host = $('#best-thirds');
    if (!host) return;
    const thirds = Object.keys(MODEL.standings).map(function (g) {
      const st = MODEL.standings[g], r = st.rows[2];
      return r ? { group: g, team: r.team, P: r.P, GD: r.GD, GF: r.GF, Pts: r.Pts } : null;
    }).filter(Boolean);
    thirds.sort(function (a, b) { return b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.team.localeCompare(b.team); });
    const allComplete = Object.keys(MODEL.standings).every(function (g) { return MODEL.standings[g].complete; });
    const anyPlayed = thirds.some(function (t) { return t.P > 0; });
    const rows = thirds.map(function (t, i) {
      const q = i < 8;
      return '<tr class="' + (q ? 'bt-q' : 'bt-out') + '">' +
        '<td class="bt-rank">' + (i + 1) + '</td>' +
        '<td class="bt-grp">' + t.group + '</td>' +
        '<td class="team-col"><span class="tm">' + flagImg(t.team) + '<span>' + WC.esc(t.team) + '</span></span></td>' +
        '<td>' + t.P + '</td><td>' + (t.GD > 0 ? '+' + t.GD : t.GD) + '</td><td>' + t.GF + '</td>' +
        '<td class="pts">' + t.Pts + '</td>' +
        '<td class="bt-status">' + (q ? '✓' : '—') + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="bt-card">' +
      '<h3>Best third-placed teams<span class="gc-prog">top 8 advance' + (allComplete ? '' : ' · provisional') + '</span></h3>' +
      '<div class="table-wrap"><table class="standings bt-table"><thead><tr>' +
        '<th>#</th><th>Grp</th><th class="team-col">Team</th><th>P</th><th>GD</th><th>GF</th><th>Pts</th><th>Q</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="group-foot"><span><span class="legend-dot" style="background:var(--accent)"></span>Qualify (best 8)</span>' +
        (anyPlayed ? '<span>Ranked by Pts · GD · GF</span>' : '<span>No results yet</span>') + '</div></div>';
  }

  function flagImg(team) {
    const u = WC.flagUrl(team);
    return u ? '<img src="' + u + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '';
  }

  // ---------------- BRACKET ----------------
  const BRACKET_COLS = [
    { round: 'R32', title: 'Round of 32' },
    { round: 'R16', title: 'Round of 16' },
    { round: 'QF', title: 'Quarter-finals' },
    { round: 'SF', title: 'Semi-finals' },
    { round: 'F', title: 'Final' },
  ];
  function bracketLegendHtml() {
    return '<span class="bx-legend">' +
        '<span class="bx-leg-item"><span class="bx-leg-name win">Team ▸</span> wins · advances</span>' +
        '<span class="bx-leg-item"><span class="bx-leg-name lose">Team</span> lost · knocked out</span>' +
        '<span class="bx-leg-item"><span class="bx-leg-name slot">Winner A</span> slot not decided</span>' +
        '<span class="bx-leg-item"><span class="bx-qual">✓</span> actually qualified</span>' +
        '<span class="bx-leg-item"><span class="bx-tag bx-t-ft">FT</span> real result</span>' +
        '<span class="bx-leg-item"><span class="bx-tag bx-t-pick">✎ your pick</span> predicted</span>' +
        '<span class="bx-leg-item"><span class="bx-tag bx-t-live">● LIVE</span> in progress</span>' +
      '</span>';
  }
  function renderBracket() {
    const scroll = document.querySelector('.bracket-scroll');
    if (state.bracketLayout === 'radial') {
      $('#bracket-note').innerHTML = '<b>Radial view</b> — Round of 32 around the edge, winners spiral inward to the trophy. ' +
        'Click any flag for match details. The champion\'s path glows gold.';
      if (scroll) scroll.classList.add('is-radial');
      renderRadialBracket();
      return;
    }
    if (scroll) scroll.classList.remove('is-radial');
    $('#bracket-note').innerHTML = '<b>Real results + your predictions.</b> Toggle <b>Show my predictions</b> off for actual-only · ' +
      'third-place slots follow FIFA\'s official candidate structure.';
    const cols = BRACKET_COLS.map(function (c) {
      const boxes = bracketM().rounds[c.round].map(bracketBox).join('');
      let extra = '';
      if (c.round === 'F') extra = championBox() + thirdPlaceBox();
      const sub = roundSub(c.round);
      return '<div class="round-col">' +
        '<div class="round-title">' + c.title + (sub ? '<span class="round-sub">' + sub + '</span>' : '') + '</div>' +
        '<div class="round-boxes">' + boxes + extra + '</div>' +
      '</div>';
    }).join('');
    $('#bracket-tree').innerHTML = '<svg class="bx-lines" id="bx-lines" aria-hidden="true"></svg>' + cols;
    requestAnimationFrame(drawConnectors);
  }

  // Primary national colour for each team — used to tint that team's advancing line in the
  // radial bracket (matching the reference, where each path takes its flag's signature colour).
  // Each colour is flag-representative but tuned so every team is perceptually distinct
  // (min CIE76 deltaE ~18) — so two red-flag teams never draw the same red line.
  const KO_TEAM_COLOR = {
    'Algeria': '#007a3d', 'Argentina': '#75aadb', 'Australia': '#806700', 'Austria': '#ed2939',
    'Belgium': '#b59a0b', 'Bosnia and Herzegovina': '#2b74d4', 'Brazil': '#ebb914', 'Canada': '#ed1606',
    'Cape Verde': '#0061ff', 'Colombia': '#ae7600', 'Croatia': '#ff6b6b', 'Curaçao': '#80a0ff',
    'Czechia': '#c33c40', 'DR Congo': '#2ba1f1', 'Ecuador': '#bdbd00', 'Egypt': '#e06c79',
    'England': '#dc909a', 'France': '#0f7bff', 'Germany': '#c73916', 'Ghana': '#13ac6d',
    'Haiti': '#b2bbfb', 'Iran': '#26ac45', 'Iraq': '#ee2f5e', 'Ivory Coast': '#ff8200',
    'Japan': '#ff5c8e', 'Jordan': '#ba365f', 'Mexico': '#00dc95', 'Morocco': '#a85148',
    'Netherlands': '#d5610b', 'New Zealand': '#8c86f9', 'Norway': '#fe8bb2', 'Panama': '#d21075',
    'Paraguay': '#db7055', 'Portugal': '#09e277', 'Qatar': '#bf5e88', 'Saudi Arabia': '#157a5b',
    'Scotland': '#136dae', 'Senegal': '#00e14d', 'South Africa': '#13ac92', 'South Korea': '#00c3ff',
    'Spain': '#ff9d8a', 'Sweden': '#0089b3', 'Switzerland': '#ff5e22', 'Tunisia': '#aa541e',
    'Türkiye': '#ff9259', 'United States': '#8c85cb', 'Uruguay': '#86cfea', 'Uzbekistan': '#00a5b5'
  };
  function koTeamColor(name) { return (name && KO_TEAM_COLOR[name]) || '#f4c750'; }

  // ---------------- RADIAL BRACKET ----------------
  // 32 teams around the rim → winners spiral inward through each round to the trophy at the center.
  function renderRadialBracket() {
    const B = bracketM();
    const host = $('#bracket-tree');
    const finalBx = B.rounds.F && B.rounds.F[0];
    if (!finalBx) { host.innerHTML = '<div class="empty">Bracket not available yet.</div>'; return; }
    const champ = B.champion;
    function feeder(slot) { const m = /^W(\d+)$/.exec(slot || ''); return m ? +m[1] : null; }

    // Walk the tree from the Final to order the 32 R32 participants (leaves) + record each match's span.
    const matchLeaves = {}, leaves = [];
    function collect(mid) {
      const bx = B.byId[mid]; if (!bx) return [];
      const m = bx.match;
      if (m.round === 'R32') {
        const i0 = leaves.length; leaves.push({ team: bx.home });
        const i1 = leaves.length; leaves.push({ team: bx.away });
        matchLeaves[mid] = [i0, i1]; return matchLeaves[mid];
      }
      const a = collect(feeder(m.homeSlot)), b = collect(feeder(m.awaySlot));
      matchLeaves[mid] = a.concat(b); return matchLeaves[mid];
    }
    collect(finalBx.match.id);
    const N = leaves.length || 32;
    // Two interleaved sets of radii (% of the 0-100 viewBox), matching the reference:
    //  RP = participant flag rings (R32 teams on the rim, then each round's winners further in)
    //  RD = match "convergence" dots, sitting BETWEEN the participant rings.
    // A match of round `rd`: its two participants sit on RP[rd], they meet at a dot on RD[rd],
    // and the winner's flag is drawn one ring further in (RP[NEXT[rd]], or the trophy for the Final).
    const RP = { R32: 47, R16: 36.5, QF: 27, SF: 18, F: 10.5 };
    const RD = { R32: 42, R16: 32, QF: 22.5, SF: 14, F: 7 };
    const NEXT = { R32: 'R16', R16: 'QF', QF: 'SF', SF: 'F' };
    const SIZE = { R16: 30, QF: 28, SF: 26, F: 24 };

    function pt(r, idx) {
      const a = (-90 + (idx + 0.5) / N * 360) * Math.PI / 180;
      return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
    }
    function mean(arr) { return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length; }
    function midIdx(id) { const m = matchLeaves[id]; return m ? mean(m) : 0; }
    const onPath = function (team) { return champ && team === champ; };
    // A match is "advanced" (worth a coloured line) only when it's a REAL finished result —
    // not a prediction — mirroring the reference where only played matches light up.
    const realAdv = function (bx) { return !!(bx && bx.decided && !bx.predicted && bx.winner); };

    function seg(p1, p2, color) {
      const won = !!color;
      return '<path d="M ' + p1.x.toFixed(2) + ' ' + p1.y.toFixed(2) + ' L ' + p2.x.toFixed(2) + ' ' + p2.y.toFixed(2) +
        '" class="rl' + (won ? ' won' : '') + '"' + (won ? ' style="stroke:' + color + '"' : '') + '/>';
    }
    function dotAt(p, color, r) {
      const won = !!color;
      return '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="' + (r || 0.6) +
        '" class="rdot' + (won ? ' won' : '') + '"' + (won ? ' style="fill:' + color + '"' : '') + '/>';
    }
    // Tooltip shows which match this flag opens: "Argentina · Quarter-finals · Sat, Jul 11".
    function nodeTitle(team, mid) {
      const label = team ? WC.esc(team) : 'TBD';
      const bx = mid != null && B.byId[mid];
      if (!bx) return label;
      return label + ' · ' + WC.roundLabel(bx.match.round) + ' · ' + WC.longDate(bx.match.date);
    }
    function node(team, p, mid, size, opt) {
      opt = opt || {};
      const cls = 'rnode' + (team ? '' : ' tbd') + (opt.lost ? ' lost' : '') + (opt.ring ? ' adv' : '') + (onPath(team) ? ' champ' : '');
      const style = 'left:' + p.x.toFixed(2) + '%;top:' + p.y.toFixed(2) + '%;width:' + size + 'px;height:' + size + 'px' +
        (opt.ring ? ';--ring:' + opt.ring : '');
      return '<div class="' + cls + '" style="' + style + '" ' +
        (mid != null ? 'data-match-id="' + mid + '" ' : '') + 'title="' + nodeTitle(team, mid) + '">' + (team ? flagImg(team) : '') + '</div>';
    }
    function ringFor(bx) { return realAdv(bx) ? koTeamColor(bx.winner) : null; }

    const DOTR = { R32: 0.72, R16: 0.64, QF: 0.56, SF: 0.5, F: 0.5 };
    let lines = '', dots = '', nodes = '';
    // A winner's flag sits one node FORWARD of its match's merge point — on the elbow of the
    // connector that carries it inward (its two feeders meet at a bare dot; the flag is the next
    // junction, a crisp corner). This keeps every advancing flag on a node, never mid-spoke.
    // (The Final's winner is the champion → the trophy at the centre.)
    function winFlagP(bx) { const rd = bx.match.round; return rd === 'F' ? { x: 50, y: 50 } : pt(RD[NEXT[rd]], midIdx(bx.match.id)); }
    // A parent always connects to a child at that child's merge dot; the child's winner flag then
    // sits on the elbow of that very connector (radius RD[parent-round], child's angle).
    function childRI(cb) { return { r: RD[cb.match.round], idx: midIdx(cb.match.id) }; }
    // Connector = straight RADIAL segment inward, a crisp 90° bend, then a straight chord to the
    // match node (technical/circuit look from the reference). Returns the bend point for a junction dot.
    function connect(rFrom, idxFrom, rTo, idxTo, color) {
      const a = pt(rFrom, idxFrom), bend = pt(rTo, idxFrom), b = pt(rTo, idxTo);
      const won = !!color;
      lines += '<path d="M ' + a.x.toFixed(2) + ' ' + a.y.toFixed(2) + ' L ' + bend.x.toFixed(2) + ' ' + bend.y.toFixed(2) +
        ' L ' + b.x.toFixed(2) + ' ' + b.y.toFixed(2) + '" class="rl' + (won ? ' won' : '') + '"' +
        (won ? ' style="stroke:' + color + '"' : '') + '/>';
      return bend;
    }

    // Complete balanced binary tree: every match is a junction node; each rim flag reaches the trophy
    // through the same rounds (R32 → R16 → QF → SF → Final → centre). Flags appear only on the rim and
    // for ACTUAL winners, exactly like the reference; everything else is bare dark dots.
    ['R32', 'R16', 'QF', 'SF', 'F'].forEach(function (rd) {
      (B.rounds[rd] || []).forEach(function (bx) {
        if (!matchLeaves[bx.match.id]) return;
        const midM = midIdx(bx.match.id), mp = pt(RD[rd], midM);
        if (rd === 'R32') {
          matchLeaves[bx.match.id].forEach(function (leafIdx) {
            const col = (realAdv(bx) && leaves[leafIdx].team === bx.winner) ? koTeamColor(bx.winner) : null;
            const bend = connect(RP.R32, leafIdx, RD.R32, midM, col);
            dots += dotAt(bend, col, 0.5);
          });
        } else {
          [feeder(bx.match.homeSlot), feeder(bx.match.awaySlot)].forEach(function (fid) {
            if (fid == null || !B.byId[fid] || !matchLeaves[fid]) return;
            const cb = B.byId[fid], ri = childRI(cb), col = realAdv(cb) ? koTeamColor(cb.winner) : null;
            const bend = connect(ri.r, ri.idx, RD[rd], midM, col);
            dots += dotAt(bend, col, 0.45);
          });
        }
        // Final node → trophy centre (the champion). Other winners sit on their own convergence
        // dot `mp`, so the inward line to the next round is drawn by the parent's connector below.
        if (rd === 'F') lines += seg(mp, { x: 50, y: 50 }, realAdv(bx) ? koTeamColor(bx.winner) : null);
        dots += dotAt(mp, realAdv(bx) ? koTeamColor(bx.winner) : null, DOTR[rd]);
      });
    });

    // Flags: 32 rim participants (real losers dimmed), plus a flag for each ACTUAL winner one ring in.
    leaves.forEach(function (lf, i) {
      const mId = leafMatchOf(B, i, matchLeaves), bx = B.byId[mId];
      const lost = realAdv(bx) && bx.winner !== lf.team;
      const ring = (realAdv(bx) && bx.winner === lf.team) ? koTeamColor(lf.team) : null;
      nodes += node(lf.team, pt(RP.R32, i), mId, 34, { lost: lost, ring: ring });
    });
    ['R32', 'R16', 'QF', 'SF'].forEach(function (rd) {
      (B.rounds[rd] || []).forEach(function (bx) {
        if (realAdv(bx) && matchLeaves[bx.match.id]) {
          nodes += node(bx.winner, winFlagP(bx), bx.match.id, SIZE[NEXT[rd]], { ring: koTeamColor(bx.winner) });
        }
      });
    });

    const center = '<div class="radial-center" data-match-id="' + finalBx.match.id + '" title="Final · ' + WC.longDate(finalBx.match.date) + '">' +
      '<div class="rc-glow"></div>' +
      '<img class="rc-cup" src="assets/trophy.png" alt="FIFA World Cup trophy" draggable="false">' +
      (champ ? '<div class="rc-name has">' + WC.esc(champ) + '</div>' : '') + '</div>';

    host.innerHTML = '<div class="radial-wrap">' +
      '<svg class="radial-lines" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + lines + dots + '</svg>' +
      center + nodes + '</div>';
  }
  // Which R32 match a rim leaf belongs to (so clicking a rim flag opens its match).
  function leafMatchOf(B, leafIdx, matchLeaves) {
    const r32 = B.rounds.R32;
    for (let k = 0; k < r32.length; k++) { const li = matchLeaves[r32[k].match.id]; if (li && li.indexOf(leafIdx) >= 0) return r32[k].match.id; }
    return null;
  }
  // Draw curved connector lines from each match back to the two cards that feed it.
  function drawConnectors() {
    if (state.view !== 'bracket') return;
    const wrap = document.getElementById('bracket-tree');
    const svg = document.getElementById('bx-lines');
    if (!wrap || !svg) return;
    const W = wrap.scrollWidth, H = wrap.scrollHeight;
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const base = wrap.getBoundingClientRect();
    const champ = bracketM().champion;
    const byId = bracketM().byId;
    let paths = '', winPaths = '';
    WC.data.matches.forEach(function (m) {
      if (m.round === 'group' || m.round === 'R32') return;
      const tEl = wrap.querySelector('[data-match-id="' + m.id + '"]');
      if (!tEl) return;
      [m.homeSlot, m.awaySlot].forEach(function (slot) {
        const fm = (slot || '').match(/^[WL](\d+)$/);
        if (!fm) return;
        const fEl = wrap.querySelector('[data-match-id="' + fm[1] + '"]');
        if (!fEl) return;
        const f = fEl.getBoundingClientRect(), t = tEl.getBoundingClientRect();
        const x1 = f.right - base.left, y1 = f.top - base.top + f.height / 2;
        const x2 = t.left - base.left, y2 = t.top - base.top + t.height / 2;
        const dx = Math.max(16, (x2 - x1) / 2);
        const loser = slot.charAt(0) === 'L'; // 3rd-place feeders (semi losers)
        // green if this edge is on the champion's path (champ won the feeder AND the target)
        const onChampPath = !loser && champ && byId[fm[1]] && byId[fm[1]].winner === champ && byId[m.id] && byId[m.id].winner === champ;
        const d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
          ' C ' + (x1 + dx).toFixed(1) + ' ' + y1.toFixed(1) + ', ' + (x2 - dx).toFixed(1) + ' ' + y2.toFixed(1) +
          ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
        const p = '<path class="bx-line' + (loser ? ' bx-line-lose' : '') + (onChampPath ? ' bx-line-win' : '') + '" d="' + d + '"/>';
        if (onChampPath) winPaths += p; else paths += p;   // champion path drawn last (on top)
      });
    });
    svg.innerHTML = paths + winPaths;
  }
  const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(iso) { const d = WC.parseDate(iso); return MON_ABBR[d.getMonth()] + ' ' + d.getDate(); }
  function roundSub(round) {
    const ms = bracketM().rounds[round];
    if (!ms || !ms.length) return '';
    const ds = ms.map(function (b) { return b.match.date; }).sort();
    const a = shortDate(ds[0]), b = shortDate(ds[ds.length - 1]);
    const range = a === b ? a : a + ' – ' + b;
    return ms.length + (ms.length === 1 ? ' match' : ' matches') + ' · ' + range;
  }
  function bxTeam(team, slot, isWinner) {
    if (team) {
      // ✓ only on group-entry slots (1X/2X/3...) for teams that have ACTUALLY qualified —
      // not on W## slots (later-round progression, which is predicted until played).
      const qualified = MODEL.actualQualified && MODEL.actualQualified[team] && /^([12][A-L]$|3\()/.test(slot || '');
      const mark = qualified ? '<span class="bx-qual" title="Has actually qualified for the knockouts">✓</span>' : '';
      return '<span class="bx-teamwrap">' + WC.teamChipSmall(team, isWinner ? 'winner' : '') + mark + '</span>';
    }
    return '<span class="bx-team slot"><span class="nm">' + WC.esc(slotLabel(slot)) + '</span></span>';
  }
  function bracketBox(bx) {
    const m = bx.match;
    const editable = state.bracketPred && state.predictMode && bx.home && bx.away && !realScore(m);
    let rows;
    if (editable) {
      const p = state.predictions[m.id] || {};
      rows =
        '<div class="bx-row">' + WC.teamChipSmall(bx.home) + '<input type="number" min="0" max="99" class="pred-h" data-mid="' + m.id + '" value="' + (p.hs == null ? '' : p.hs) + '" style="width:34px"></div>' +
        '<div class="bx-row">' + WC.teamChipSmall(bx.away) + '<input type="number" min="0" max="99" class="pred-a" data-mid="' + m.id + '" value="' + (p.as == null ? '' : p.as) + '"  style="width:34px"></div>' +
        koWinnerPicker(m, { home: bx.home, away: bx.away, resolved: true });
    } else {
      const decided = bx.winner != null;
      const hRole = decided ? (bx.winner === bx.home ? ' win' : ' lose') : '';
      const aRole = decided ? (bx.winner === bx.away ? ' win' : ' lose') : '';
      rows =
        '<div class="bx-row' + hRole + '">' + bxTeam(bx.home, m.homeSlot, hRole === ' win') + scoreSpan(bx.hs, bx.predicted, bx.live) + '</div>' +
        '<div class="bx-row' + aRole + '">' + bxTeam(bx.away, m.awaySlot, aRole === ' win') + scoreSpan(bx.as, bx.predicted, bx.live) + '</div>';
    }
    const tag = boxTag(bx, editable);
    const pens = editable ? '' : penNote(m, true);
    const meta = bx.live
      ? '<span class="bx-live">● ' + WC.esc(liveMinute(m.minute)) + '</span> · #' + m.id
      : '#' + m.id + ' · ' + WC.longDate(m.date) + ' · ' + WC.esc(m.city);
    return '<div class="bx' + (bx.live ? ' live' : '') + (bx.predicted && !bx.live ? ' bx-pred' : '') + '" data-match-id="' + m.id + '">' +
      tag + rows + (pens ? '<div class="bx-pens">🥅 ' + WC.esc(m.penWinner) + ' won ' + pens.replace('pens ', '') + ' on pens</div>' : '') +
      '<div class="bx-meta">' + meta + '</div></div>';
  }
  // Explicit per-box status so it's never ambiguous what you're looking at.
  function boxTag(bx, editable) {
    if (bx.live) return '<div class="bx-tag bx-t-live">● LIVE</div>';
    if (editable) return '<div class="bx-tag bx-t-pick">✎ predict</div>';
    if (bx.hs != null && bx.predicted) return '<div class="bx-tag bx-t-pick">✎ your pick</div>';
    if (bx.hs != null) return '<div class="bx-tag bx-t-ft">FT · actual</div>';
    return '';
  }
  function scoreSpan(v, predicted, live) {
    if (v == null) return '<span class="bx-sc dim" style="color:var(--txt-faint)">–</span>';
    const color = live ? ' style="color:var(--live)"' : (predicted ? ' style="color:var(--accent-2)"' : '');
    return '<span class="bx-sc"' + color + '>' + v + '</span>';
  }
  function thirdPlaceBox() {
    const bx = bracketM().byId[103];
    return '<div class="bx" data-match-id="103" style="margin-top:18px"><h4 style="color:var(--txt-dim)">3rd place</h4>' +
      '<div class="bx-row">' + bxTeam(bx.home, bx.match.homeSlot, bx.winner === bx.home) + scoreSpan(bx.hs, bx.predicted) + '</div>' +
      '<div class="bx-row">' + bxTeam(bx.away, bx.match.awaySlot, bx.winner === bx.away) + scoreSpan(bx.as, bx.predicted) + '</div>' +
      '<div class="bx-meta">#103 · ' + WC.longDate(bx.match.date) + '</div></div>';
  }
  function championBox() {
    const champ = bracketM().champion;
    return '<div class="bx final" style="margin-top:18px"><div class="champion-box">' +
      '<div class="trophy">🏆</div>' +
      (champ ? flagImg(champ) + '<div class="champ-name">' + WC.esc(champ) + '</div>' : '<div class="champ-name" style="color:var(--txt-dim)">Champion TBD</div>') +
      '</div></div>';
  }

  // ---------------- ELIMINATED ----------------
  function renderEliminated() {
    const elim = MODEL.eliminated;
    const total = Object.keys(D.teams).length;
    // Champion must come from the SAME bracket the eliminated list uses (respects the toggle).
    const champ = MODEL.elimBracket.champion;
    const remaining = total - elim.length;
    const anyPred = elim.some(function (e) { return e.predicted; });
    $('#elim-summary').innerHTML =
      '<div class="elim-stat"><b>' + elim.length + '</b> eliminated</div>' +
      '<div class="elim-stat"><b>' + remaining + '</b> still in contention</div>' +
      (champ ? '<div class="elim-stat champ">🏆 <b>' + WC.esc(champ) + '</b> are champions</div>' : '') +
      (anyPred ? '<div class="elim-note">Includes your predictions</div>' : '') ;
    const grid = $('#elim-grid');
    if (!elim.length) {
      grid.innerHTML = '<div class="empty">No teams are eliminated yet — the group stage is still in progress.<br>' +
        'Play matches forward in <b>Predict mode</b> (Schedule tab) to see who goes out.</div>';
      return;
    }
    // Group into labelled sections by exit stage (furthest run first).
    const SECTIONS = [
      { test: function (e) { return e.weight === 7; }, label: 'Runner-up — lost the Final' },
      { test: function (e) { return e.weight === 6; }, label: 'Fourth place' },
      { test: function (e) { return e.weight === 5; }, label: 'Out in the Quarter-finals' },
      { test: function (e) { return e.weight === 4; }, label: 'Out in the Round of 16' },
      { test: function (e) { return e.weight === 3; }, label: 'Out in the Round of 32' },
      { test: function (e) { return e.weight <= 2; }, label: 'Out in the Group stage' },
    ];
    function grpOf(e) { return (e.reason.match(/Group ([A-L])/) || [])[1] || ''; }
    let html = '';
    SECTIONS.forEach(function (sec) {
      let items = elim.filter(sec.test);
      if (!items.length) return;
      // Group-stage section reads better ordered by group letter.
      if (sec.label.indexOf('Group') >= 0) {
        items = items.slice().sort(function (a, b) { return grpOf(a).localeCompare(grpOf(b)) || a.team.localeCompare(b.team); });
      }
      html += '<h3 class="elim-section-h">' + sec.label + ' · ' + items.length + '</h3>' +
        '<div class="elim-row">' + items.map(elimCardHtml).join('') + '</div>';
    });
    grid.innerHTML = html;
  }
  // Small pill: flag + team name.
  function teamChip(t) { return '<span class="tchip">' + flagImg(t) + '<span>' + WC.esc(t) + '</span></span>'; }
  function teamsInline(arr) { return (arr || []).map(teamChip).join(''); }
  function elimCardHtml(e) {
    let out = '';
    if (e.by) {
      out = '<div class="elim-out"><span class="elim-out-lbl">Knocked out by</span>' +
        '<span class="elim-out-chips">' + teamChip(e.by) +
        (e.byScore ? '<span class="elim-out-sc">' + e.byScore + '</span>' : '') + '</span></div>';
    } else if (e.above && e.above.length) {
      out = '<div class="elim-out"><span class="elim-out-lbl">Finished behind</span>' +
        '<span class="elim-out-chips">' + e.above.map(teamChip).join('') + '</span></div>';
    }
    return '<div class="elim-card" data-team="' + WC.esc(e.team) + '">' +
      '<div class="elim-head">' + flagImg(e.team) +
        '<div class="elim-info"><div class="elim-name">' + WC.esc(e.team) + '</div>' +
        '<div class="elim-reason">' + WC.esc(e.reason) + (e.predicted ? ' <span class="pred-flag">(predicted)</span>' : '') + '</div></div>' +
      '</div>' + out +
    '</div>';
  }

  // ---------------- MY PICKS (prediction scorecard) ----------------
  // exact = same scoreline; outcome = same result (W/D/L); wrong = different result.
  function gradeOne(pred, real) {
    if (pred.hs === real.hs && pred.as === real.as) return 'exact';
    const po = Math.sign(pred.hs - pred.as), ro = Math.sign(real.hs - real.as);
    return po === ro ? 'outcome' : 'wrong';
  }
  const GRADE_PTS = { exact: 3, outcome: 1, wrong: 0 };

  function gradeAll() {
    const graded = [], pending = [];
    Object.keys(state.predictions).forEach(function (id) {
      const m = D.matches.find(function (x) { return x.id === +id; });
      if (!m) return;
      const p = state.predictions[id];
      if (!(p && p.hs !== '' && p.as !== '' && p.hs != null && p.as != null && !isNaN(+p.hs) && !isNaN(+p.as))) return;
      const pred = { hs: +p.hs, as: +p.as };
      const real = realScore(m);
      if (real && m.status !== 'live') graded.push({ m: m, pred: pred, real: real, grade: gradeOne(pred, real) });
      else pending.push({ m: m, pred: pred, live: m.status === 'live' });
    });
    graded.sort(function (a, b) { return b.m.id - a.m.id; });   // most recent first
    pending.sort(function (a, b) { return a.m.id - b.m.id; });
    const s = { exact: 0, outcome: 0, wrong: 0, points: 0, total: graded.length };
    graded.forEach(function (g) { s[g.grade]++; s.points += GRADE_PTS[g.grade]; });
    s.maxPoints = graded.length * 3;
    s.correct = s.exact + s.outcome;
    s.accuracy = graded.length ? Math.round(s.correct / graded.length * 100) : 0;
    return { graded: graded, pending: pending, stats: s };
  }

  function donutSvg(s) {
    const r = 52, C = 2 * Math.PI * r, total = s.total || 1;
    const segs = [
      { v: s.exact, c: 'var(--accent)' },
      { v: s.outcome, c: 'var(--accent-3)' },
      { v: s.wrong, c: 'var(--live)' },
    ];
    let off = 0;
    const arcs = segs.map(function (seg) {
      const len = seg.v / total * C;
      const el = '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + seg.c + '" stroke-width="13" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" ' +
        'transform="rotate(-90 60 60)" stroke-linecap="butt"/>';
      off += len; return el;
    }).join('');
    return '<svg viewBox="0 0 120 120" class="donut">' +
      '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="13"/>' + arcs +
      '<text x="60" y="56" text-anchor="middle" class="donut-pct">' + s.accuracy + '%</text>' +
      '<text x="60" y="74" text-anchor="middle" class="donut-sub">correct</text></svg>';
  }

  function predTile(cls, big, label) {
    return '<div class="pred-tile ' + cls + '"><div class="pt-big">' + big + '</div><div class="pt-label">' + label + '</div></div>';
  }

  function predTeamsHtml(m) {
    const t = matchTeams(m);
    const home = t.home || slotLabel(m.homeSlot);
    const away = t.away || slotLabel(m.awaySlot);
    return '<div class="pg-match">' +
      '<span class="pg-team">' + flagImg(home) + '<span class="pg-nm">' + WC.esc(home) + '</span></span>' +
      '<span class="pg-vs">v</span>' +
      '<span class="pg-team">' + flagImg(away) + '<span class="pg-nm">' + WC.esc(away) + '</span></span></div>';
  }
  const GRADE_BADGE = { exact: 'EXACT', outcome: 'RESULT', wrong: 'MISS' };

  const GRADE_ICON = { exact: '★', outcome: '✓', wrong: '✗', live: '●', pending: '◷' };
  // Labelled Predicted / Actual chips (mirrors the Schedule cards).
  // Per-team mini scoreboard: each team on its own line with aligned Pred / Actual columns,
  // penalty scores in parentheses, and the actual winner bolded. Unambiguous which score is whose.
  function picksBoard(m, pred, real, live) {
    const t = matchTeams(m);
    const home = t.home || slotLabel(m.homeSlot);
    const away = t.away || slotLabel(m.awaySlot);
    const hasReal = real && real.hs != null && real.as != null;
    let winner = null;
    if (hasReal) {
      if (real.hs > real.as) winner = home;
      else if (real.hs < real.as) winner = away;
      else if (m.penWinner) winner = m.penWinner;
    }
    const hasPen = m.penWinner != null && m.penHome != null;
    function cells(team, pg, ag, pen) {
      const w = hasReal && winner === team ? ' w' : '';
      return '<span class="pgb-team' + w + '">' + flagImg(team) + '<span class="pgb-nm">' + WC.esc(team) + '</span></span>' +
        '<span class="pgb-p">' + pg + '</span>' +
        '<span class="pgb-a' + (live ? ' live' : '') + w + '">' + (ag == null ? '–' : ag) +
          (pen != null ? '<i class="pgb-pen" title="penalty shootout">(' + pen + ')</i>' : '') + '</span>';
    }
    return '<div class="pg-board">' +
      '<span class="pgb-h"></span><span class="pgb-h pgb-c">Pred</span><span class="pgb-h pgb-c">' + (live ? 'Live' : 'Actual') + '</span>' +
      cells(home, pred.hs, hasReal ? real.hs : null, hasPen ? m.penHome : null) +
      cells(away, pred.as, hasReal ? real.as : null, hasPen ? m.penAway : null) +
      (hasPen ? '<span class="pgb-pennote">🥅 ' + WC.esc(m.penWinner) + ' won on penalties</span>' : '') +
    '</div>';
  }
  function gradedRow(g) {
    const pts = GRADE_PTS[g.grade];
    const ptsTxt = pts > 0 ? '+' + pts + ' pt' + (pts > 1 ? 's' : '') : '0 pts';
    return '<div class="pg-row pg-' + g.grade + '" data-match-id="' + g.m.id + '">' +
      '<div class="pg-left">' +
        '<span class="pg-badge pg-b-' + g.grade + '">' + GRADE_ICON[g.grade] + ' ' + GRADE_BADGE[g.grade] + '</span>' +
        '<span class="pg-pts p-' + g.grade + '">' + ptsTxt + '</span></div>' +
      picksBoard(g.m, g.pred, g.real, false) +
      '<div class="pg-date">' + WC.longDate(g.m.date) + '</div>' +
    '</div>';
  }
  function pendingRow(g) {
    const key = g.live ? 'live' : 'pending';
    const real = g.live ? { hs: g.m.homeScore, as: g.m.awayScore } : null;
    const when = g.live ? '<span class="pg-date live">● ' + WC.esc(liveMinute(g.m.minute)) + '</span>'
      : '<span class="pg-date">' + WC.longDate(g.m.date) + ' · ' + WC.fmtTime(g.m.time) + '</span>';
    return '<div class="pg-row pg-' + key + '" data-match-id="' + g.m.id + '">' +
      '<div class="pg-left"><span class="pg-badge pg-b-' + key + '">' + GRADE_ICON[key] + ' ' + (g.live ? 'LIVE' : 'PENDING') + '</span></div>' +
      picksBoard(g.m, g.pred, real, g.live) +
      when +
    '</div>';
  }

  function renderPredictions() {
    const r = gradeAll();
    const summary = $('#pred-summary');
    const list = $('#pred-list');
    if (!r.graded.length && !r.pending.length) {
      summary.innerHTML = '';
      list.innerHTML = '<div class="empty">You haven\'t made any predictions yet.<br>' +
        'Turn on <b>🔮 Predict mode</b> on the Schedule tab and enter some scores — they\'ll be graded here as matches finish.</div>';
      return;
    }
    const s = r.stats;
    summary.innerHTML =
      '<div class="pred-hero">' +
        '<div class="pred-ring">' + donutSvg(s) +
          '<div class="ring-points"><b>' + s.points + '</b><span>/ ' + s.maxPoints + ' pts</span></div>' +
        '</div>' +
        '<div class="pred-tiles">' +
          predTile('t-exact', s.exact, 'Exact score') +
          predTile('t-outcome', s.outcome, 'Right result') +
          predTile('t-wrong', s.wrong, 'Missed') +
          predTile('t-total', s.total, 'Graded') +
        '</div>' +
      '</div>' +
      '<div class="pred-legend">Scoring: <b class="lg-exact">Exact 3 pts</b> · ' +
        '<b class="lg-outcome">Right result 1 pt</b> · <b class="lg-wrong">Miss 0</b> · ' +
        'win/draw/loss counts even if the scoreline differs.</div>';

    let html = '';
    if (r.graded.length) html += '<h3 class="pred-section-h">Graded · ' + r.graded.length + '</h3>' + r.graded.map(gradedRow).join('');
    if (r.pending.length) html += '<h3 class="pred-section-h">Awaiting result · ' + r.pending.length + '</h3>' + r.pending.map(pendingRow).join('');
    list.innerHTML = html;
  }

  // ---------------- Modal ----------------
  function openMatchModal(id) {
    const m = D.matches.find(function (x) { return x.id === +id; });
    if (!m) return;
    const t = matchTeams(m);
    const ko = m.round !== 'group';
    const homeLabel = (ko && !t.home) ? slotLabel(m.homeSlot) : t.home;
    const awayLabel = (ko && !t.away) ? slotLabel(m.awaySlot) : t.away;
    const sc = (t.hs == null ? '–' : t.hs) + ' : ' + (t.as == null ? '–' : t.as);
    const pens = penNote(m, false);
    const statusLine = t.live
      ? '🔴 LIVE — ' + WC.esc(liveMinute(m.minute))
      : (t.predicted ? 'Predicted result' : (realScore(m) ? ('Full time' + (m.penWinner ? ' · decided on penalties' : '')) : 'Scheduled — ' + WC.fmtTime(m.time)));
    const html =
      '<button class="close-x" data-close>&times;</button>' +
      '<div class="mod-stage">' + (ko ? WC.roundLabel(m.round) : 'Group ' + m.group) + ' · Match #' + m.id + '</div>' +
      '<div class="mod-score">' +
        modTeam(homeLabel, ko && !t.home) +
        '<div class="big">' + sc + '</div>' +
        modTeam(awayLabel, ko && !t.away) +
      '</div>' +
      (pens ? '<div class="mod-pens">🥅 Penalties ' + m.penHome + '–' + m.penAway + ' · <b>' + WC.esc(m.penWinner) + ' advances</b></div>' : '') +
      '<div class="mod-meta">' +
        '<b>Status</b><span>' + statusLine + '</span>' +
        '<b>Date</b><span>' + WC.longDate(m.date) + ', 2026</span>' +
        '<b>Kick-off</b><span>' + WC.fmtTime(m.time) + '</span>' +
        '<b>Stadium</b><span>' + WC.esc(m.venue) + '</span>' +
        '<b>Location</b><span>' + WC.esc(m.region) + '</span>' +
      '</div>' +
      matchInsightHtml(m, t) +
      teamFactsBlock(t.home) +
      teamFactsBlock(t.away);
    showModal(html);
  }

  const WC_EDITIONS = [1930, 1934, 1938, 1950, 1954, 1958, 1962, 1966, 1970, 1974, 1978, 1982, 1986, 1990, 1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026];
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  // Derived history note from a team's year list (debut / streak / return after a gap).
  function historyNote(years) {
    if (!years || !years.length) return '';
    if (years.length === 1) return '🌟 their first-ever World Cup!';
    const has = {}; years.forEach(function (y) { has[y] = 1; });
    let streak = 0;
    for (let i = WC_EDITIONS.length - 1; i >= 0; i--) { if (has[WC_EDITIONS[i]]) streak++; else break; }
    if (streak >= 3) return '🔥 ' + streak + ' World Cups in a row';
    const prev = years.filter(function (y) { return y < 2026; }).sort(function (a, b) { return b - a; })[0];
    if (prev && (2026 - prev) >= 12) return '⏳ back after ' + (2026 - prev) + ' years away (last in ' + prev + ')';
    if (streak === 2) return '↗ back-to-back World Cups';
    return '';
  }
  // Insight line: round context + combined World Cup pedigree of the two teams.
  function matchInsightHtml(m, t) {
    const fh = window.WC_FACTS && WC_FACTS[t.home], fa = window.WC_FACTS && WC_FACTS[t.away];
    const bits = [];
    if (m.round === 'group') bits.push('Group ' + m.group + ' fixture');
    else bits.push(WC.roundLabel(m.round) + ' — winner advances');
    if (fh && fa) {
      const tot = (fh.titles || 0) + (fa.titles || 0);
      if (tot > 0) bits.push(tot + ' World Cup title' + (tot === 1 ? '' : 's') + ' between them');
      const apps = (fh.years ? fh.years.length : 0) + (fa.years ? fa.years.length : 0);
      if (apps) bits.push(apps + ' combined appearances');
    }
    return '<div class="mod-insight">⚡ ' + bits.join(' · ') + '</div>';
  }
  // A team's World Cup year history as chips (title-winning years highlighted, 2026 marked).
  function yearChips(f) {
    if (!f || !f.years) return '';
    const wins = {}; (f.titleYears || []).forEach(function (y) { wins[y] = 1; });
    return '<div class="tfb-years">' + f.years.map(function (y) {
      return '<span class="yr' + (wins[y] ? ' yr-win' : '') + (y === 2026 ? ' yr-now' : '') + '">' + y + (wins[y] ? ' 🏆' : '') + '</span>';
    }).join('') + '</div>';
  }
  // Per-team block: this-tournament record + World Cup pedigree + year history + fun fact.
  function teamFactsBlock(team) {
    if (!team || !D.teams[team]) return '';
    const f = window.WC_FACTS && WC_FACTS[team];
    const g = teamGroup(team);
    const st = g && MODEL.standings[g];
    const row = st && st.rows.filter(function (r) { return r.team === team; })[0];
    const apps = f && f.years ? f.years.length : 0;
    let html = '<div class="tfb"><div class="tfb-head">' + flagImg(team) +
      '<span class="tfb-name">' + WC.esc(team) + '</span>' +
      (f ? '<span class="tfb-conf">' + f.conf + '</span>' : '') + '</div>';
    if (row) {
      const form = row.form.slice(-5).map(function (x) { return '<i class="' + x + '"></i>'; }).join('');
      html += '<div class="tfb-tour">This tournament · Group ' + g + ' · ' + ordinal(row.pos) + ' · ' +
        row.W + 'W ' + row.D + 'D ' + row.L + 'L · ' + row.GF + ':' + row.GA + ' · ' + row.Pts + ' pts ' +
        '<span class="form">' + form + '</span></div>';
    }
    if (f) {
      const note = historyNote(f.years);
      html += '<div class="tfb-grid">' +
        '<span>World Cups</span><b>' + apps + (apps === 1 ? ' (debut)' : ' · ' + ordinal(apps) + ' time') + '</b>' +
        '<span>Titles</span><b>' + (f.titles || 0) + (f.titles ? ' 🏆 (' + f.titleYears.join(', ') + ')' : '') + '</b>' +
        '<span>Best finish</span><b>' + WC.esc(f.best) + '</b>' +
        '</div>' +
        '<div class="tfb-ylabel">Appearances' + (note ? ' — <i>' + note + '</i>' : '') + '</div>' +
        yearChips(f) +
        '<div class="tfb-fact">💡 ' + WC.esc(f.fact) + '</div>';
    }
    return html + '</div>';
  }
  function modTeam(label, isSlot) {
    if (isSlot) return '<div class="team"><div class="nm slot">' + WC.esc(label) + '</div></div>';
    return '<div class="team">' + flagImg(label) + '<div class="nm">' + WC.esc(label) + '</div></div>';
  }
  function openTeamModal(team) {
    const g = teamGroup(team);
    const ms = D.matches.filter(function (m) {
      const t = matchTeams(m);
      return t.home === team || t.away === team;
    }).sort(function (a, b) { return a.id - b.id; });
    const rows = ms.map(function (m) {
      const t = matchTeams(m);
      const opp = t.home === team ? t.away : t.home;
      const us = t.home === team ? t.hs : t.as;
      const them = t.home === team ? t.as : t.hs;
      let res = 'vs';
      if (us != null && them != null) res = us > them ? 'W' : us < them ? 'L' : 'D';
      const score = (us == null ? '' : us + '–' + them);
      return '<div class="tm-match"><span class="tm-res tm-' + res + '">' + res + '</span>' +
        flagImg(opp) + '<span class="tm-opp">' + WC.esc(opp || slotLabel(t.home === team ? m.awaySlot : m.homeSlot)) + '</span>' +
        '<span class="tm-sc">' + score + '</span>' +
        '<span class="tm-rd">' + (m.round === 'group' ? 'Grp ' + m.group : WC.roundShort(m.round)) + '</span></div>';
    }).join('');
    const st = g ? MODEL.standings[g] : null;
    const row = st && st.rows.find(function (r) { return r.team === team; });
    const standLine = row ? ('Group ' + g + ' · ' + row.Pts + ' pts · position ' + row.pos) : '';
    const elim = MODEL.eliminated && MODEL.eliminated.find(function (x) { return x.team === team; });
    let elimBanner = '';
    if (elim && elim.by) {
      elimBanner = '<div class="tm-elim"><span>❌ ' + WC.esc(elim.reason) + ' · beaten by</span>' + teamChip(elim.by) +
        (elim.byScore ? '<span class="elim-out-sc">' + elim.byScore + '</span>' : '') + '</div>';
    } else if (elim && elim.above && elim.above.length) {
      elimBanner = '<div class="tm-elim"><span>❌ ' + WC.esc(elim.reason) + ' · finished behind</span>' + teamsInline(elim.above) + '</div>';
    } else if (elim) {
      elimBanner = '<div class="tm-elim">❌ ' + WC.esc(elim.reason) + '</div>';
    }
    showModal(
      '<button class="close-x" data-close>&times;</button>' +
      '<div class="mod-stage">' + WC.esc(team) + '</div>' +
      '<div class="mod-score" style="gap:14px"><span class="team">' + flagImg(team) + '</span></div>' +
      (standLine ? '<div style="text-align:center;color:var(--txt-dim);margin-bottom:12px">' + standLine + '</div>' : '') +
      elimBanner +
      '<div class="tm-matches">' + rows + '</div>'
    );
  }
  function showModal(html) { $('#modal').innerHTML = html; $('#modal-backdrop').classList.remove('hidden'); }
  function closeModal() { $('#modal-backdrop').classList.add('hidden'); }

  // ---------------- Render dispatch ----------------
  function render() {
    recompute();
    $$('.view').forEach(function (v) { v.classList.add('hidden'); });
    $('#view-' + state.view).classList.remove('hidden');
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === state.view); });
    if (state.view === 'schedule') renderSchedule();
    else if (state.view === 'groups') renderGroups();
    else if (state.view === 'bracket') renderBracket();
    else if (state.view === 'eliminated') renderEliminated();
    else if (state.view === 'predictions') renderPredictions();
    renderViewControls();
    renderFooter();
    ensurePredictBar();
    updateLiveBadge();
    setStickyOffsets();
  }
  function updateLiveBadge() {
    const live = D.matches.filter(function (m) { return m.status === 'live'; }).length;
    const tab = document.querySelector('.tab[data-view="schedule"]');
    if (!tab) return;
    tab.classList.toggle('has-live', live > 0);
    let b = tab.querySelector('.live-badge');
    if (live > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'live-badge'; tab.appendChild(b); }
      b.textContent = live + ' LIVE';
    } else if (b) { b.remove(); }
  }
  function renderFooter() {
    $('#footer-meta').textContent = D.meta.matchesCount + ' matches · ' + D.meta.teamsCount + ' teams · ' +
      D.meta.timezoneNote + (state.lastUpdated ? ' · Updated ' + state.lastUpdated : '');
  }

  // predict-mode toolbar (schedule + bracket)
  function ensurePredictBar() {
    $$('.predict-bar').forEach(function (b) { b.remove(); });
    if (state.view !== 'schedule' && state.view !== 'bracket') return;
    const host = state.view === 'schedule' ? $('#sched-controls') : $('#bracket-note').parentNode;
    const bar = document.createElement('div');
    bar.className = 'predict-bar';
    const count = Object.keys(state.predictions).length;
    bar.innerHTML = '<label class="chk"><input type="checkbox" id="predict-toggle"' + (state.predictMode ? ' checked' : '') + '> <b>🔮 Predict mode</b></label>' +
      '<span class="pred-count">' + count + ' prediction' + (count === 1 ? '' : 's') + '</span>' +
      '<button class="btn-ghost" id="export-pred" title="Download your predictions as a JSON file">⬇ Export</button>' +
      '<button class="btn-ghost" id="import-pred" title="Load predictions from a JSON file">⬆ Import</button>' +
      '<button class="btn-ghost" id="reset-pred">Reset predictions</button>' +
      (serverMode ? '<span class="autosave-note as-' + saveState + '" id="autosave-note" title="Saved to data/predictions.json in the project">' + autosaveText() + '</span>' : '');
    if (state.view === 'schedule') host.appendChild(bar);
    else $('#view-bracket').insertBefore(bar, $('#view-bracket').firstChild);
  }

  // ---------------- Filters init ----------------
  function initFilters() {
    const gsel = $('#filter-group');
    gsel.innerHTML = '<option value="all">All groups</option>' +
      Object.keys(D.groups).map(function (g) { return '<option value="' + g + '">Group ' + g + '</option>'; }).join('');
    const tsel = $('#filter-team');
    const teams = Object.keys(D.teams).sort();
    tsel.innerHTML = '<option value="all">All teams</option>' +
      teams.map(function (t) { return '<option value="' + WC.esc(t) + '">' + WC.esc(t) + '</option>'; }).join('');
  }

  // ---------------- Refresh ----------------
  let autoTimer = null;
  function setStatus(kind, text) {
    $('#status-dot').className = 'dot ' + (kind || '');
    $('#status-text').textContent = text;
  }
  // Enable/disable auto-refresh and persist the choice.
  function setAuto(on, persist) {
    state.autoRefresh = on;
    const box = $('#auto-refresh');
    if (box) box.checked = on;
    if (persist) { try { localStorage.setItem(LS_AUTO, on ? '1' : '0'); } catch (e) {} }
    clearInterval(autoTimer); autoTimer = null;
    if (on) autoTimer = setInterval(doRefresh, 60000);
  }
  function doRefresh() {
    const btn = $('#refresh-btn');
    btn.disabled = true; btn.classList.add('spinning');
    setStatus('busy', 'Fetching live scores…');
    return WC.api.refresh().then(function (res) {
      btn.disabled = false; btn.classList.remove('spinning');
      const now = new Date();
      state.lastUpdated = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (res.ok) setStatus('ok', res.message);
      else setStatus('err', res.message);
      render();
    });
  }

  // ---------------- Project auto-save (optional Node backend) ----------------
  let serverMode = false;        // true when server.js is serving us (vs static-only)
  let serverSaveTimer = null;
  let saveState = 'idle';        // idle | saving | saved | error
  function autosaveText() {
    if (saveState === 'saving') return '⟳ Saving…';
    if (saveState === 'saved') return '✓ Saved to project';
    if (saveState === 'error') return '⚠ Save failed — retrying';
    return '💾 Auto-saving to project';
  }
  function setSaveState(s) {
    saveState = s;
    const el = document.getElementById('autosave-note');
    if (el) { el.textContent = autosaveText(); el.className = 'autosave-note as-' + s; }
  }
  // Persist to localStorage always; also debounce-save to the project file when available.
  function persist() {
    save(LS_PRED, state.predictions);
    save(LS_KO, state.koWinners);
    if (serverMode) {
      setSaveState('saving');
      clearTimeout(serverSaveTimer);
      serverSaveTimer = setTimeout(saveToServer, 800);
    }
  }
  function saveToServer() {
    fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ predictions: state.predictions, koWinners: state.koWinners }),
    })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (res) { setSaveState(res && res.ok ? 'saved' : 'error'); })
      .catch(function () { setSaveState('error'); }); // localStorage still holds it
  }
  // On boot: if the backend is present, the project file is the source of truth.
  function initProjectStore() {
    fetch('/api/predictions', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (!json) return;            // no backend (e.g. python server) -> localStorage only
        serverMode = true;
        const sPreds = sanitizePredictions(json.predictions);
        const sKos = (json.koWinners && typeof json.koWinners === 'object') ? json.koWinners : {};
        if (Object.keys(sPreds).length) {
          // adopt what's saved in the project
          state.predictions = sPreds;
          state.koWinners = sKos;
          save(LS_PRED, state.predictions);
          save(LS_KO, state.koWinners);
          render();
        } else if (Object.keys(state.predictions).length) {
          saveToServer();             // seed the project file from existing browser data
        } else {
          render();                   // just to surface the "auto-saving" note
        }
      })
      .catch(function () { serverMode = false; });
  }

  // ---------------- Export / Import predictions ----------------
  function exportPredictions() {
    const payload = {
      app: 'fifa-wc-2026',
      version: 1,
      exportedAt: new Date().toISOString(),
      predictions: state.predictions,
      koWinners: state.koWinners,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'wc2026-predictions-' + stamp + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    const n = Object.keys(state.predictions).length;
    setStatus('ok', 'Exported ' + n + ' prediction' + (n === 1 ? '' : 's') + '.');
  }

  function triggerImport() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.addEventListener('change', function () {
      if (inp.files && inp.files[0]) importPredictions(inp.files[0]);
    });
    inp.click();
  }

  // Keep only well-formed {hs,as} entries (0–99 or blank).
  function sanitizePredictions(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(obj).forEach(function (id) {
      const p = obj[id];
      if (!p || typeof p !== 'object') return;
      const clean = {};
      ['hs', 'as'].forEach(function (k) {
        const v = p[k];
        if (v === '' || v == null) clean[k] = '';
        else if (!isNaN(+v)) clean[k] = Math.max(0, Math.min(99, parseInt(v, 10)));
      });
      if (clean.hs != null || clean.as != null) out[id] = { hs: clean.hs == null ? '' : clean.hs, as: clean.as == null ? '' : clean.as };
    });
    return out;
  }

  function importPredictions(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { setStatus('err', 'Import failed — that file isn\'t valid JSON.'); return; }
      if (!data || typeof data !== 'object' || (!data.predictions && !data.koWinners)) {
        setStatus('err', 'Import failed — no predictions found in that file.'); return;
      }
      const preds = sanitizePredictions(data.predictions);
      const kos = (data.koWinners && typeof data.koWinners === 'object') ? data.koWinners : {};
      const n = Object.keys(preds).length;
      if (!confirm('Import ' + n + ' prediction' + (n === 1 ? '' : 's') + '? This replaces your current predictions.')) return;
      state.predictions = preds;
      state.koWinners = kos;
      persist();
      if (!state.predictMode) state.predictMode = true; // so the imported picks are visible/editable
      render();
      setStatus('ok', 'Imported ' + n + ' prediction' + (n === 1 ? '' : 's') + '.');
    };
    reader.onerror = function () { setStatus('err', 'Import failed — could not read the file.'); };
    reader.readAsText(file);
  }

  // ---------------- Prediction score editing (debounced) ----------------
  let predTimer = null;
  function onPredInput(el) {
    const id = el.dataset.mid;
    const p = state.predictions[id] || { hs: '', as: '' };
    const v = el.value === '' ? '' : Math.max(0, Math.min(99, parseInt(el.value, 10) || 0));
    if (el.classList.contains('pred-h')) p.hs = v; else p.as = v;
    if (p.hs === '' && p.as === '') delete state.predictions[id]; else state.predictions[id] = p;
    persist();
    updatePredCount();
    // Re-render (recomputes standings/bracket/eliminated) only after the user pauses,
    // so spinner clicks and typing aren't interrupted; restore focus afterward.
    clearTimeout(predTimer);
    predTimer = setTimeout(applyPredRender, 350);
  }
  function applyPredRender() {
    const a = document.activeElement;
    const focus = (a && a.dataset && a.dataset.mid && (a.classList.contains('pred-h') || a.classList.contains('pred-a')))
      ? { mid: a.dataset.mid, cls: a.classList.contains('pred-h') ? 'pred-h' : 'pred-a' } : null;
    render();
    if (focus) {
      const el = document.querySelector('input.' + focus.cls + '[data-mid="' + focus.mid + '"]');
      if (el) el.focus();
    }
  }
  function updatePredCount() {
    const span = document.querySelector('.predict-bar .pred-count');
    if (span) {
      const n = Object.keys(state.predictions).length;
      span.textContent = n + ' prediction' + (n === 1 ? '' : 's');
    }
  }

  // ---------------- Events ----------------
  function bindEvents() {
    // tabs
    $('#tabs').addEventListener('click', function (e) {
      const t = e.target.closest('.tab'); if (!t) return;
      state.view = t.dataset.view;
      try { history.replaceState(null, '', '#' + state.view); } catch (err) {}
      render();
    });
    // filters
    $('#search').addEventListener('input', function (e) { state.filters.q = e.target.value; renderSchedule(); });
    $('#filter-stage').addEventListener('change', function (e) { state.filters.stage = e.target.value; renderSchedule(); });
    $('#filter-group').addEventListener('change', function (e) { state.filters.group = e.target.value; renderSchedule(); });
    $('#filter-team').addEventListener('change', function (e) { state.filters.team = e.target.value; renderSchedule(); });
    $('#filter-upcoming').addEventListener('change', function (e) { state.filters.upcoming = e.target.checked; renderSchedule(); });
    $('#jump-today').addEventListener('click', function () {
      if (!scrollToToday(true)) setStatus('', 'No matches scheduled today');
    });
    $('#filters-toggle').addEventListener('click', function () {
      $('#schedule-toolbar').classList.toggle('hidden');
      updateFiltersBtn();
    });
    $('#clear-filters').addEventListener('click', function () {
      state.filters = { stage: 'all', group: 'all', team: 'all', upcoming: false, q: '' };
      $('#search').value = ''; $('#filter-stage').value = 'all';
      $('#filter-group').value = 'all'; $('#filter-team').value = 'all';
      $('#filter-upcoming').checked = false;
      renderSchedule();
    });
    // refresh
    $('#refresh-btn').addEventListener('click', doRefresh);
    $('#auto-refresh').addEventListener('change', function (e) {
      setAuto(e.target.checked, true);
      if (e.target.checked) doRefresh(); // immediate tick when the user enables it
    });

    // delegated clicks
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target.id === 'modal-backdrop') { closeModal(); return; }
      if (e.target.id === 'predict-toggle' || e.target.closest('#predict-toggle')) return; // handled by change
      if (e.target.closest('#export-pred')) { exportPredictions(); return; }
      if (e.target.closest('#import-pred')) { triggerImport(); return; }
      const reset = e.target.closest('#reset-pred');
      if (reset) {
        if (confirm('Clear all your predictions?')) {
          state.predictions = {}; state.koWinners = {}; persist(); render();
        }
        return;
      }
      const layoutBtn = e.target.closest('.bkl');
      if (layoutBtn) {
        const lay = layoutBtn.dataset.layout;
        if (lay && lay !== state.bracketLayout) {
          state.bracketLayout = lay;
          try { localStorage.setItem(LS_BLAYOUT, lay); } catch (err) {}
          render();
        }
        return;
      }
      const elimCard = e.target.closest('.elim-card');
      if (elimCard) { openTeamModal(elimCard.dataset.team); return; }
      // don't open modal when interacting with inputs
      if (e.target.matches('input, select, button')) return;
      const card = e.target.closest('[data-match-id]');
      if (card) openMatchModal(card.dataset.matchId);
    });

    // Score edits: handle live on 'input' (fires on spinner clicks + typing) but DON'T
    // re-render synchronously — that would tear down the input mid-click. Debounce instead.
    document.addEventListener('input', function (e) {
      if (e.target.classList.contains('pred-h') || e.target.classList.contains('pred-a')) {
        onPredInput(e.target);
      }
    });
    // delegated changes (predict toggle + penalty-winner pick)
    document.addEventListener('change', function (e) {
      if (e.target.id === 'predict-toggle') { state.predictMode = e.target.checked; render(); return; }
      if (e.target.id === 'incl-pred-toggle') {
        state.includePredictions = e.target.checked;
        try { localStorage.setItem(LS_INCL, e.target.checked ? '1' : '0'); } catch (err) {}
        render(); return;
      }
      if (e.target.id === 'incl-live-toggle') {
        state.includeLive = e.target.checked;
        try { localStorage.setItem(LS_LIVE, e.target.checked ? '1' : '0'); } catch (err) {}
        render(); return;
      }
      if (e.target.id === 'bracket-pred-toggle') {
        state.bracketPred = e.target.checked;
        try { localStorage.setItem(LS_BPRED, e.target.checked ? '1' : '0'); } catch (err) {}
        render(); return;
      }
      const mid = e.target.dataset && e.target.dataset.mid;
      if (e.target.classList.contains('pred-winner')) {
        if (e.target.value) state.koWinners[mid] = e.target.value; else delete state.koWinners[mid];
        persist();
        render();
      }
    });

    // Esc closes modal
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  // Keep sticky offsets in sync with the actual header/tabs/controls heights (handles wrapping).
  function setStickyOffsets() {
    const root = document.documentElement;
    const header = $('.site-header');
    const tabs = $('.tabs');
    const controls = $('#sched-controls');
    const H = header ? header.offsetHeight : 0;
    const T = tabs ? tabs.offsetHeight : 0;
    root.style.setProperty('--header-h', H + 'px');
    root.style.setProperty('--tabs-h', T + 'px');
    if (controls) root.style.setProperty('--controls-h', controls.offsetHeight + 'px');
    // Bracket page: cumulative top offsets for the pinned stack (predict-bar → toggles/legend → note),
    // then --bk-stack = total pinned height so the bracket gets its own scroll area beneath it.
    if (state.view === 'bracket') {
      const bar = document.querySelector('#view-bracket .predict-bar');
      const ctrl = document.getElementById('bracket-controls');
      const note = document.getElementById('bracket-note');
      const barH = bar ? bar.offsetHeight : 0;
      const ctrlH = ctrl ? ctrl.offsetHeight : 0;
      const noteH = note ? note.offsetHeight : 0;
      const t0 = H + T;
      root.style.setProperty('--bk-top-bar', t0 + 'px');
      root.style.setProperty('--bk-top-ctrl', (t0 + barH) + 'px');
      root.style.setProperty('--bk-top-note', (t0 + barH + ctrlH) + 'px');
      root.style.setProperty('--bk-stack', (t0 + barH + ctrlH + noteH) + 'px');
    }
  }
  // Total height of everything pinned at the top right now (for accurate scroll targeting).
  function stickyStackHeight() {
    const header = $('.site-header'), tabs = $('.tabs'), controls = $('#sched-controls');
    const toolbar = $('#schedule-toolbar');
    let h = (header ? header.offsetHeight : 0) + (tabs ? tabs.offsetHeight : 0) + (controls ? controls.offsetHeight : 0);
    if (toolbar && !toolbar.classList.contains('hidden')) h += toolbar.offsetHeight;
    return h;
  }
  // Scroll the Schedule list to today's matches (or the next upcoming day if none today).
  function scrollToToday(smooth) {
    let head = $('#day-' + WC.todayISO());
    if (!head) {
      const todayISO = WC.todayISO();
      const heads = $$('.day-head');
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].id.replace('day-', '') >= todayISO) { head = heads[i]; break; }
      }
    }
    if (!head) return false;
    // Measure the non-sticky container — the sticky .day-head reports a displaced rect once pinned.
    const target = head.closest('.day-group') || head;
    const y = target.getBoundingClientRect().top + window.scrollY - stickyStackHeight() - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }

  // ---------------- Boot ----------------
  function boot() {
    const VIEWS = ['schedule', 'groups', 'bracket', 'eliminated', 'predictions'];
    const h = (location.hash || '').replace('#', '');
    if (VIEWS.indexOf(h) >= 0) state.view = h;
    initFilters();
    bindEvents();
    setStickyOffsets();
    window.addEventListener('resize', function () { setStickyOffsets(); if (state.view === 'bracket') drawConnectors(); });
    setStatus('ok', 'Bundled data loaded · ' + D.meta.generatedNote.replace('Use Refresh for live updates.', '').trim());
    render();
    // On first open of the Schedule tab, jump straight to today's matches.
    if (state.view === 'schedule') requestAnimationFrame(function () { requestAnimationFrame(function () { scrollToToday(false); }); });
    // restore persisted auto-refresh choice (ticks the box + starts the 60s timer)
    setAuto(state.autoRefresh, false);
    // adopt project-saved predictions if the Node backend is serving us
    initProjectStore();
    // try a live refresh on load (non-blocking; falls back silently)
    doRefresh();
  }
  boot();

})(window.WC);
