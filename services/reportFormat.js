const { stripEmojis, escapeHtml } = require('../utils/helpers');
const { t, DEFAULT_LANG } = require('../utils/i18n');

function formatPlayerLine(row, value) {
  const name = escapeHtml(
    stripEmojis(row.player_name || row.name || row.tag || '—') || '—'
  );
  return `${name} — <b>${value}</b>`;
}

function formatReportText(report, lang = DEFAULT_LANG) {
  const lines = [];
  lines.push(t('report.title', { lng: lang, month: report.monthKey }));
  lines.push('');
  lines.push(t('report.section_wars', { lng: lang }));
  lines.push(
    t('report.wars_count', {
      lng: lang,
      total: report.wars,
    })
  );
  lines.push(
    t('report.wars_results', {
      lng: lang,
      wins: report.wins,
      losses: report.losses,
      ties: report.ties,
    })
  );
  if (report.cwlCount > 0) {
    lines.push(t('report.cwl_line', { lng: lang, count: report.cwlCount }));
  }
  lines.push(
    t('report.stars_ours', {
      lng: lang,
      stars: report.starsFor,
    })
  );
  lines.push(
    t('report.stars_enemy', {
      lng: lang,
      stars: report.starsAgainst,
    })
  );

  if (!report.wars) {
    lines.push('');
    lines.push(t('report.empty_wars', { lng: lang }));
  }

  const topStars = (report.topStars || []).filter((row) => (row.stars || 0) > 0);
  if (topStars.length) {
    lines.push('');
    lines.push(t('report.section_top_stars', { lng: lang }));
    topStars.forEach((row, i) => {
      const name = escapeHtml(
        stripEmojis(row.player_name || row.name || row.tag || '—') || '—'
      );
      lines.push(
        t('report.player_stars_line', {
          lng: lang,
          rank: i + 1,
          name,
          stars: row.stars || 0,
          wars: row.wars || 0,
        })
      );
    });
  }

  const topAttacks = (report.topAttacks || []).filter(
    (row) => (row.attacks || 0) > 0
  );
  if (topAttacks.length) {
    lines.push('');
    lines.push(t('report.section_top_attacks', { lng: lang }));
    topAttacks.forEach((row, i) => {
      const name = escapeHtml(
        stripEmojis(row.player_name || row.name || row.tag || '—') || '—'
      );
      lines.push(
        t('report.player_attacks_line', {
          lng: lang,
          rank: i + 1,
          name,
          attacks: row.attacks || 0,
          stars: row.stars || 0,
        })
      );
    });
  }

  const don = report.donations;
  if (don.samplePlayers > 0) {
    lines.push('');
    lines.push(t('report.section_donations', { lng: lang }));
    if (don.byDonated.some((x) => x.donated > 0)) {
      lines.push(t('report.top_donors', { lng: lang }));
      don.byDonated
        .filter((x) => x.donated > 0)
        .slice(0, 5)
        .forEach((row, i) => {
          const name = escapeHtml(
            stripEmojis(row.player_name || row.name || row.tag || '—') || '—'
          );
          lines.push(
            t('report.player_donated_line', {
              lng: lang,
              rank: i + 1,
              name,
              amount: row.donated,
            })
          );
        });
    } else {
      lines.push(t('report.donations_pending', { lng: lang }));
    }
    if (don.byReceived.some((x) => x.received > 0)) {
      lines.push(t('report.top_received', { lng: lang }));
      don.byReceived
        .filter((x) => x.received > 0)
        .slice(0, 5)
        .forEach((row, i) => {
          const name = escapeHtml(
            stripEmojis(row.player_name || row.name || row.tag || '—') || '—'
          );
          lines.push(
            t('report.player_received_line', {
              lng: lang,
              rank: i + 1,
              name,
              amount: row.received,
            })
          );
        });
    }
  } else {
    lines.push('');
    lines.push(t('report.section_donations', { lng: lang }));
    lines.push(t('report.donations_pending', { lng: lang }));
  }

  lines.push('');
  lines.push(t('report.footer', { lng: lang }));
  return lines.join('\n');
}

module.exports = { formatPlayerLine, formatReportText };
