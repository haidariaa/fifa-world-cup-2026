/* bracket.js — resolves knockout slots into teams and propagates winners.
   Works off real results and/or predictions via the supplied score functions. */
(function (WC) {
  'use strict';

  const KO_ORDER = ['R32', 'R16', 'QF', 'SF', '3P', 'F'];

  // Assign the 8 best third-placed teams to the eight "3(...)" R32 slots.
  // Provisional: any assignment respecting each slot's candidate groups (FIFA's official
  // allocation table may pair them differently). Returns { slotString -> groupLetter }.
  function thirdAllocation(standings) {
    const groups = Object.keys(standings);
    if (!groups.every(function (g) { return standings[g].complete; })) return {};
    // Rank the twelve third-placed teams; the top 8 qualify (Pts -> GD -> GF).
    const thirds = groups
      .map(function (g) { const r = standings[g].rows[2]; return r ? { g: g, Pts: r.Pts, GD: r.GD, GF: r.GF } : null; })
      .filter(Boolean)
      .sort(function (a, b) { return b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.g.localeCompare(b.g); });
    if (thirds.length < 8) return {};
    const qSet = {}; thirds.slice(0, 8).forEach(function (t) { qSet[t.g] = true; });
    // Collect the distinct "3(...)" slots and their qualifying candidate groups.
    const slotMap = {};
    WC.data.matches.forEach(function (mt) {
      [mt.homeSlot, mt.awaySlot].forEach(function (s) {
        if (s && /^3\(/.test(s) && !slotMap[s]) {
          slotMap[s] = s.slice(2, -1).split('/').filter(function (g) { return qSet[g]; });
        }
      });
    });
    const slots = Object.keys(slotMap).map(function (k) { return { key: k, allowed: slotMap[k] }; });
    // Most-constrained slot first, then backtracking for a perfect matching.
    slots.sort(function (a, b) { return a.allowed.length - b.allowed.length; });
    const assign = {}, used = {};
    (function bt(i) {
      if (i === slots.length) return true;
      const s = slots[i];
      for (let j = 0; j < s.allowed.length; j++) {
        const g = s.allowed[j];
        if (!used[g]) {
          used[g] = true; assign[s.key] = g;
          if (bt(i + 1)) return true;
          used[g] = false; delete assign[s.key];
        }
      }
      return false;
    })(0);
    return assign;
  }

  // Normalize a slot to the key used by FIFA's real-assignment map ("3(B/E/F/I/J)" -> "3BEFIJ").
  function slotKey(s) {
    s = String(s || '').trim().toUpperCase();
    let m;
    if ((m = s.match(/^([12])([A-L])$/))) return m[1] + m[2];
    if (/^3[(A-L/)]+$/.test(s)) { const L = (s.match(/[A-L]/g) || []).sort().join(''); return L ? '3' + L : null; }
    return null;
  }

  // slot examples: "1A" (winner grp A), "2B" (runner-up), "3(A/B/C)" (best third),
  // "W73" (winner of match 73), "L101" (loser of match 101).
  function resolveSlot(slot, ctx) {
    if (!slot) return null;
    // FIFA's official assignment (from the live feed) is authoritative — it wins over both our
    // computed third-place allocation AND any prediction, and doesn't wait for all groups to finish.
    const real = WC.data.koSlotReal, k = real && slotKey(slot);
    if (k && real[k]) return real[k];
    let m;
    if ((m = slot.match(/^([12])([A-L])$/))) {
      const st = ctx.standings[m[2]];
      if (st && st.complete) return st.rows[m[1] === '1' ? 0 : 1].team;
      return null;
    }
    if ((m = slot.match(/^W(\d+)$/))) return ctx.winners[+m[1]] || null;
    if ((m = slot.match(/^L(\d+)$/))) return ctx.losers[+m[1]] || null;
    if (/^3\(/.test(slot)) {
      const g = ctx.thirdAlloc[slot];
      const st = g && ctx.standings[g];
      return (st && st.complete) ? st.rows[2].team : null;
    }
    return null;
  }

  // standings: precomputed group standings (built from non-live scores)
  // getScore(match) -> {hs,as,predicted,live} | null  (display score, may be live)
  // getKoWinner(matchId, home, away) -> teamName | null  (penalty pick for draws)
  WC.resolveBracket = function (standings, getScore, getKoWinner) {
    const ctx = { standings: standings, winners: {}, losers: {}, thirdAlloc: thirdAllocation(standings) };
    const byId = {};
    const koMatches = WC.data.matches
      .filter(function (mt) { return mt.round !== 'group'; })
      .sort(function (a, b) { return a.id - b.id; });

    koMatches.forEach(function (mt) {
      // A finished knockout match carries its real teams (mt.home/mt.away) — use them directly;
      // otherwise resolve from the slot (group standings / best-third / earlier-round winner).
      const home = mt.home || resolveSlot(mt.homeSlot, ctx);
      const away = mt.away || resolveSlot(mt.awaySlot, ctx);
      const s = getScore(mt);
      let winner = null, loser = null, decided = false;
      // Only resolve a winner once the match is over (finished or predicted) — never mid-live.
      if (home && away && s && !s.live) {
        if (s.hs > s.as) { winner = home; loser = away; }
        else if (s.hs < s.as) { winner = away; loser = home; }
        else {
          // draw -> needs a knockout winner (penalties)
          const pick = getKoWinner ? getKoWinner(mt.id, home, away) : null;
          if (pick === home) { winner = home; loser = away; }
          else if (pick === away) { winner = away; loser = home; }
        }
        decided = !!winner;
      }
      if (winner) { ctx.winners[mt.id] = winner; ctx.losers[mt.id] = loser; }
      byId[mt.id] = {
        match: mt, home: home, away: away,
        homeSlot: mt.homeSlot, awaySlot: mt.awaySlot,
        hs: s ? s.hs : null, as: s ? s.as : null,
        predicted: s ? s.predicted : false,
        live: s ? !!s.live : false,
        winner: winner, loser: loser, decided: decided,
      };
    });

    const rounds = {};
    KO_ORDER.forEach(function (r) {
      rounds[r] = koMatches.filter(function (mt) { return mt.round === r; }).map(function (mt) { return byId[mt.id]; });
    });

    const finalBox = byId[104];
    return {
      rounds: rounds,
      byId: byId,
      standings: standings,
      champion: finalBox ? finalBox.winner : null,
      order: KO_ORDER,
    };
  };

})(window.WC);
