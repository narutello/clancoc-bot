const { stripEmojis, escapeHtml } = require('../utils/helpers');
const { t, DEFAULT_LANG } = require('../utils/i18n');

function playerName(row) {
  return escapeHtml(
    stripEmojis(row.player_name || row.name || row.tag || '—') || '—'
  );
}

function formatPlayerLine(row, value) {
  return `${playerName(row)} — <b>${value}</b>`;
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
      lines.push(
        t('report.player_stars_line', {
          lng: lang,
          rank: i + 1,
          name: playerName(row),
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
      lines.push(
        t('report.player_attacks_line', {
          lng: lang,
          rank: i + 1,
          name: playerName(row),
          attacks: row.attacks || 0,
          stars: row.stars || 0,
        })
      );
    });
  }

  const don = report.donations || {};
  if (don.samplePlayers > 0) {
    lines.push('');
    lines.push(t('report.section_donations', { lng: lang }));
    if (don.byDonated && don.byDonated.some((x) => x.donated > 0)) {
      lines.push(t('report.top_donors', { lng: lang }));
      don.byDonated
        .filter((x) => x.donated > 0)
        .slice(0, 5)
        .forEach((row, i) => {
          lines.push(
            t('report.player_donated_line', {
              lng: lang,
              rank: i + 1,
              name: playerName(row),
              amount: row.donated,
            })
          );
        });
    } else {
      lines.push(t('report.donations_pending', { lng: lang }));
    }
    if (don.byReceived && don.byReceived.some((x) => x.received > 0)) {
      lines.push(t('report.top_received', { lng: lang }));
      don.byReceived
        .filter((x) => x.received > 0)
        .slice(0, 5)
        .forEach((row, i) => {
          lines.push(
            t('report.player_received_line', {
              lng: lang,
              rank: i + 1,
              name: playerName(row),
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

function formatReportHtml(report, lang = DEFAULT_LANG) {
  const topStars = (report.topStars || []).filter((row) => (row.stars || 0) > 0);
  const topAttacks = (report.topAttacks || []).filter(
    (row) => (row.attacks || 0) > 0
  );
  const don = report.donations || {
    samplePlayers: 0,
    byDonated: [],
    byReceived: [],
  };
  const donors = (don.byDonated || [])
    .filter((x) => (x.donated || 0) > 0)
    .slice(0, 5);
  const receivers = (don.byReceived || [])
    .filter((x) => (x.received || 0) > 0)
    .slice(0, 5);

  const warBlock = `
    <p>
      ${t('report.wars_count', { lng: lang, total: report.wars })}<br/>
      ${t('report.wars_results', {
        lng: lang,
        wins: report.wins,
        losses: report.losses,
        ties: report.ties,
      })}<br/>
      ${
        report.cwlCount > 0
          ? `${t('report.cwl_line', { lng: lang, count: report.cwlCount })}<br/>`
          : ''
      }
      ${t('report.stars_ours', { lng: lang, stars: report.starsFor })}<br/>
      ${t('report.stars_enemy', { lng: lang, stars: report.starsAgainst })}
    </p>
  `;

  let starsTable = '';
  if (topStars.length) {
    const rows = topStars
      .map(
        (row, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${playerName(row)}</td>
        <td>${row.stars || 0} ⭐</td>
        <td>${row.wars || 0}</td>
      </tr>`
      )
      .join('');
    starsTable = `
      <h3>${t('report.section_top_stars', { lng: lang })}</h3>
      <table bordered striped compact>
        <tr>
          <th>${t('report.col_rank', { lng: lang })}</th>
          <th>${t('report.col_player', { lng: lang })}</th>
          <th>${t('report.col_stars', { lng: lang })}</th>
          <th>${t('report.col_wars', { lng: lang })}</th>
        </tr>
        ${rows}
      </table>
    `;
  }

  let attacksTable = '';
  if (topAttacks.length) {
    const rows = topAttacks
      .map(
        (row, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${playerName(row)}</td>
        <td>${row.attacks || 0}</td>
        <td>${row.stars || 0} ⭐</td>
      </tr>`
      )
      .join('');
    attacksTable = `
      <h3>${t('report.section_top_attacks', { lng: lang })}</h3>
      <table bordered striped compact>
        <tr>
          <th>${t('report.col_rank', { lng: lang })}</th>
          <th>${t('report.col_player', { lng: lang })}</th>
          <th>${t('report.col_attacks', { lng: lang })}</th>
          <th>${t('report.col_stars', { lng: lang })}</th>
        </tr>
        ${rows}
      </table>
    `;
  }

  let donationsBlock = `
    <h3>${t('report.section_donations', { lng: lang })}</h3>
  `;
  if (don.samplePlayers > 0 && (donors.length || receivers.length)) {
    if (donors.length) {
      const rows = donors
        .map(
          (row, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${playerName(row)}</td>
          <td>${row.donated || 0}</td>
        </tr>`
        )
        .join('');
      donationsBlock += `
        <p>${t('report.top_donors', { lng: lang })}</p>
        <table bordered striped compact>
          <tr>
            <th>${t('report.col_rank', { lng: lang })}</th>
            <th>${t('report.col_player', { lng: lang })}</th>
            <th>${t('report.col_donated', { lng: lang })}</th>
          </tr>
          ${rows}
        </table>
      `;
    }
    if (receivers.length) {
      const rows = receivers
        .map(
          (row, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${playerName(row)}</td>
          <td>${row.received || 0}</td>
        </tr>`
        )
        .join('');
      donationsBlock += `
        <p>${t('report.top_received', { lng: lang })}</p>
        <table bordered striped compact>
          <tr>
            <th>${t('report.col_rank', { lng: lang })}</th>
            <th>${t('report.col_player', { lng: lang })}</th>
            <th>${t('report.col_received', { lng: lang })}</th>
          </tr>
          ${rows}
        </table>
      `;
    }
  } else {
    donationsBlock += `<p>${t('report.donations_pending', { lng: lang })}</p>`;
  }

  const emptyWars = !report.wars
    ? `<p>${t('report.empty_wars', { lng: lang })}</p>`
    : '';

  return `
    <h2>${t('report.title', { lng: lang, month: report.monthKey })}</h2>
    <h3>${t('report.section_wars', { lng: lang })}</h3>
    ${warBlock}
    ${emptyWars}
    ${starsTable}
    ${attacksTable}
    ${donationsBlock}
    <p><i>${t('report.footer', { lng: lang })}</i></p>
  `.trim();
}

module.exports = {
  formatPlayerLine,
  formatReportText,
  formatReportHtml,
};
