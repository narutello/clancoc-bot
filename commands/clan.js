const { getClan } = require('../api/clash');
const { escapeHtml, formatTag, stripEmojis } = require('../utils/helpers');
const config = require('../config');
const { checkCommandLimit } = require('../utils/commandRateLimit');
const { withTelegramRetry } = require('../utils/telegramSafe');
const { isRtl } = require('../utils/i18n');
const {
  sendLoading,
  deleteLoading,
  replaceLoadingText,
} = require('../utils/loading');

function typeLabel(type, t) {
  switch (type) {
    case 'open':
      return t('clan.type_open');
    case 'inviteOnly':
      return t('clan.type_invite');
    case 'closed':
      return t('clan.type_closed');
    default:
      return type || '—';
  }
}

function warFrequencyLabel(freq, t) {
  switch (freq) {
    case 'always':
      return t('clan.freq_always');
    case 'moreThanOncePerWeek':
      return t('clan.freq_moreThanOncePerWeek');
    case 'oncePerWeek':
      return t('clan.freq_oncePerWeek');
    case 'lessThanOncePerWeek':
      return t('clan.freq_lessThanOncePerWeek');
    case 'never':
      return t('clan.freq_never');
    case 'unknown':
      return t('clan.freq_unknown');
    default:
      return freq || '—';
  }
}

function row(label, value) {
  return `
    <tr>
      <td>${label}</td>
      <td>${value}</td>
    </tr>
  `;
}

module.exports = async function clanCommand(ctx) {
  let loadingMsg = null;
  const lang = ctx.lang || 'fa';
  const t = ctx.t.bind(ctx);

  try {
    const userId = ctx.from?.id;
    const isOwner =
      userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'clan', {
      limit: config.clanCmdLimit,
      windowMs: config.clanCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.reply(t('rate.clan', { sec: limit.retryAfterSec }), {
        parse_mode: 'HTML',
      });
    }

    loadingMsg = await sendLoading(ctx, t('loading.clan'));

    const clan = await getClan();

    const name = stripEmojis(clan.name || '—') || '—';
    const tag = formatTag(clan.tag);
    const description = (clan.description || '').trim();
    const members = clan.members ?? '—';
    const level = clan.clanLevel ?? '—';
    const points = clan.clanPoints ?? '—';
    const builderPoints =
      clan.clanBuilderBasePoints ?? clan.clanVersusPoints ?? null;
    const capitalPoints = clan.clanCapitalPoints ?? null;

    const warWins = clan.warWins ?? 0;
    const warLosses = clan.warLosses ?? 0;
    const warTies = clan.warTies ?? 0;
    const warStreak = clan.warWinStreak ?? 0;
    const warLeague = clan.warLeague?.name || '—';
    const capitalLeague = clan.capitalLeague?.name || null;

    const location = clan.location?.name || '—';
    const isPublicLog =
      clan.isWarLogPublic === true
        ? t('clan.log_public')
        : t('clan.log_private');
    const requiredTh = clan.requiredTownhallLevel ?? '—';
    const requiredTrophies = clan.requiredTrophies ?? '—';

    const labels = (clan.labels || [])
      .map((l) => l.name)
      .filter(Boolean)
      .slice(0, 5);
    const labelsLine =
      labels.length > 0
        ? `<p>🏷 ${labels.map((x) => escapeHtml(x)).join(' · ')}</p>`
        : '';

    const descBlock = description
      ? `<p>📝 ${escapeHtml(description)}</p>`
      : '';

    const extraRows = [];
    if (builderPoints != null) {
      extraRows.push(
        row(t('clan.builder'), escapeHtml(String(builderPoints)))
      );
    }
    if (capitalPoints != null) {
      extraRows.push(
        row(t('clan.capital'), escapeHtml(String(capitalPoints)))
      );
    }
    if (capitalLeague) {
      extraRows.push(
        row(t('clan.capital_league'), escapeHtml(capitalLeague))
      );
    }

    const html = `
      <h2>🏰 ${escapeHtml(name)}</h2>
      <p><code>${escapeHtml(tag)}</code></p>
      ${descBlock}
      ${labelsLine}

      <h3>${t('clan.title_status')}</h3>
      <table bordered striped compact>
        <tr>
          <th>${t('clan.col_item')}</th>
          <th>${t('clan.col_value')}</th>
        </tr>
        ${row(t('clan.members'), escapeHtml(String(members)))}
        ${row(t('clan.level'), escapeHtml(String(level)))}
        ${row(t('clan.points'), escapeHtml(String(points)))}
        ${extraRows.join('')}
        ${row(t('clan.type'), escapeHtml(typeLabel(clan.type, t)))}
        ${row(t('clan.location'), escapeHtml(location))}
        ${row(t('clan.min_th'), escapeHtml(String(requiredTh)))}
        ${row(t('clan.min_trophies'), escapeHtml(String(requiredTrophies)))}
      </table>

      <h3>${t('clan.title_war')}</h3>
      <table bordered striped compact>
        <tr>
          <th>${t('clan.col_item')}</th>
          <th>${t('clan.col_value')}</th>
        </tr>
        ${row(t('clan.war_league'), escapeHtml(warLeague))}
        ${row(
          t('clan.war_frequency'),
          escapeHtml(warFrequencyLabel(clan.warFrequency, t))
        )}
        ${row(t('clan.war_streak'), escapeHtml(String(warStreak)))}
        ${row(t('clan.wins'), escapeHtml(String(warWins)))}
        ${row(t('clan.losses'), escapeHtml(String(warLosses)))}
        ${row(t('clan.ties'), escapeHtml(String(warTies)))}
        ${row(t('clan.war_log'), escapeHtml(isPublicLog))}
      </table>
    `.trim();

    await deleteLoading(ctx, loadingMsg);
    loadingMsg = null;

    try {
      return await withTelegramRetry(
        () =>
          ctx.telegram.callApi('sendRichMessage', {
            chat_id: ctx.chat.id,
            rich_message: {
              html,
              is_rtl: isRtl(lang),
            },
          }),
        { maxRetries: config.telegramMaxRetries }
      );
    } catch (richErr) {
      console.warn('[/clan] rich message failed, fallback HTML:', richErr.message);
      const fallback = `
🏰 <b>${escapeHtml(name)}</b> <code>${escapeHtml(tag)}</code>

${description ? `📝 ${escapeHtml(description)}\n` : ''}${t('clan.members')}: <b>${members}</b>
${t('clan.level')}: <b>${level}</b> | ${t('clan.points')}: <b>${points}</b>
${escapeHtml(typeLabel(clan.type, t))} | ${escapeHtml(location)}

${t('clan.war_league')}: <b>${escapeHtml(warLeague)}</b>
${t('clan.war_streak')}: <b>${warStreak}</b>
${t('clan.wins')} ${warWins} | ${t('clan.losses')} ${warLosses} | ${t('clan.ties')} ${warTies}
${t('clan.war_log')}: ${escapeHtml(isPublicLog)}
${t('clan.min_th')}: ${requiredTh} | ${t('clan.min_trophies')}: ${requiredTrophies}
`.trim();
      return ctx.reply(fallback, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('[/clan]', err.message);
    return replaceLoadingText(
      ctx,
      loadingMsg,
      t('clan.fetch_error', { message: err.message })
    );
  }
};
