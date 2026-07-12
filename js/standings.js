/* standings.js — group standings engine. Works with real and/or predicted scores. */
(function (WC) {
  'use strict';

  // scoreFn(match) -> {hs, as, predicted:boolean} | null
  function blankRow(team) {
    return { team: team, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0, form: [], predUsed: false, liveUsed: false, played: 0 };
  }

  function applyResult(row, gf, ga, predicted, live) {
    row.P++; row.GF += gf; row.GA += ga; row.GD = row.GF - row.GA;
    if (predicted) row.predUsed = true;
    if (live) row.liveUsed = true;
    if (gf > ga) { row.W++; row.Pts += 3; row.form.push('W'); }
    else if (gf < ga) { row.L++; row.form.push('L'); }
    else { row.D++; row.Pts += 1; row.form.push('D'); }
  }

  // Head-to-head mini-table among a set of tied teams.
  function h2h(teams, matches, scoreFn) {
    const set = {}; teams.forEach(function (t) { set[t] = blankRow(t); });
    matches.forEach(function (m) {
      if (set[m.home] && set[m.away]) {
        const s = scoreFn(m);
        if (!s) return;
        applyResult(set[m.home], s.hs, s.as, s.predicted);
        applyResult(set[m.away], s.as, s.hs, s.predicted);
      }
    });
    return set;
  }

  function cmp(a, b) {
    if (b.Pts !== a.Pts) return b.Pts - a.Pts;
    if (b.GD !== a.GD) return b.GD - a.GD;
    if (b.GF !== a.GF) return b.GF - a.GF;
    return 0;
  }

  // Returns sorted array of rows for one group, with .pos (1-based) and .complete flag.
  WC.standings = WC.standings || {};
  WC.standings.computeGroup = function (groupTeams, groupMatches, scoreFn) {
    const rows = {};
    groupTeams.forEach(function (t) { rows[t] = blankRow(t); });
    let played = 0, finished = 0, liveCount = 0;
    groupMatches.forEach(function (m) {
      const s = scoreFn(m);
      if (!s) return;
      played++;
      if (s.live) liveCount++; else finished++;
      if (rows[m.home]) applyResult(rows[m.home], s.hs, s.as, s.predicted, s.live);
      if (rows[m.away]) applyResult(rows[m.away], s.as, s.hs, s.predicted, s.live);
    });

    const arr = groupTeams.map(function (t) { return rows[t]; });

    arr.sort(function (a, b) {
      const c = cmp(a, b);
      if (c !== 0) return c;
      // tie -> head-to-head among all teams currently equal on Pts/GD/GF
      const tied = arr.filter(function (r) { return cmp(r, a) === 0; }).map(function (r) { return r.team; });
      if (tied.length > 1) {
        const mini = h2h(tied, groupMatches, scoreFn);
        const ch = cmp(mini[a.team], mini[b.team]);
        if (ch !== 0) return ch;
      }
      return a.team.localeCompare(b.team);
    });

    arr.forEach(function (r, i) { r.pos = i + 1; });
    // "complete" requires every match FINISHED (live games don't count toward completion).
    return {
      rows: arr, played: played, finished: finished, live: liveCount,
      total: groupMatches.length, complete: finished === groupMatches.length && groupMatches.length > 0,
    };
  };

  // Compute all 12 groups -> { A:{...}, B:{...}, ... }
  WC.standings.computeAll = function (scoreFn) {
    const groups = WC.data.groups;
    const byGroup = {};
    Object.keys(groups).forEach(function (g) {
      const gm = WC.data.matches.filter(function (m) { return m.round === 'group' && m.group === g; });
      byGroup[g] = WC.standings.computeGroup(groups[g], gm, scoreFn);
    });
    return byGroup;
  };

  // Rank the 12 third-placed teams; top 8 qualify (FIFA Pts->GD->GF).
  WC.standings.bestThirds = function (allStandings) {
    const thirds = [];
    Object.keys(allStandings).forEach(function (g) {
      const st = allStandings[g];
      if (st.complete && st.rows[2]) {
        thirds.push(Object.assign({ group: g }, st.rows[2]));
      }
    });
    thirds.sort(cmp);
    thirds.forEach(function (r, i) { r.thirdRank = i + 1; r.qualifies = i < 8; });
    return thirds;
  };

})(window.WC);
