/* util.js — shared helpers. Loaded first; defines window.WC. */
window.WC = window.WC || {};
(function (WC) {
  'use strict';
  const D = window.WC_DATA;
  WC.data = D;

  // Country flag (SVG via flagcdn). Team names ARE the country names.
  WC.flagUrl = function (team) {
    const code = D.teams[team];
    return code ? 'https://flagcdn.com/' + code + '.svg' : '';
  };

  WC.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // A team chip: flag + country name. `cls` adds modifier classes (e.g. 'winner').
  WC.teamChip = function (team, cls) {
    cls = cls || '';
    if (!team) return '<span class="team slot ' + cls + '"><span class="nm slot">TBD</span></span>';
    const url = WC.flagUrl(team);
    const img = url
      ? '<img src="' + url + '" alt="' + WC.esc(team) + ' flag" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
      : '';
    return '<span class="team ' + cls + '">' + img + '<span class="nm" title="' + WC.esc(team) + '">' + WC.esc(team) + '</span></span>';
  };

  // Smaller chip used inside bracket boxes.
  WC.teamChipSmall = function (team, cls) {
    cls = cls || '';
    if (!team) return '<span class="bx-team slot ' + cls + '"><span class="nm">TBD</span></span>';
    const url = WC.flagUrl(team);
    const img = url ? '<img src="' + url + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '';
    return '<span class="bx-team ' + cls + '">' + img + '<span class="nm" title="' + WC.esc(team) + '">' + WC.esc(team) + '</span></span>';
  };

  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Parse 'YYYY-MM-DD' as a local date (avoids UTC off-by-one).
  WC.parseDate = function (iso) {
    const p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  };
  WC.longDate = function (iso) {
    const d = WC.parseDate(iso);
    return DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate();
  };
  WC.todayISO = function () {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  };

  // 24h ET "HH:MM" -> "h:MM AM/PM ET"
  WC.fmtTime = function (t) {
    if (!t) return '';
    const p = t.split(':');
    let h = +p[0]; const m = p[1];
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + m + ' ' + ap + ' ET';
  };

  WC.roundLabel = function (round) {
    const rm = D.roundMeta[round];
    return rm ? rm.label : round;
  };
  WC.roundShort = function (round) {
    const rm = D.roundMeta[round];
    return rm ? rm.short : round;
  };
  WC.isKnockout = function (round) { return round !== 'group'; };

})(window.WC);
