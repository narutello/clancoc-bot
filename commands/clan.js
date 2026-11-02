const { getClan } = require('../api/clash');
const { escapeHtml, formatTag, stripEmojis } = require('../utils/helpers');

function typeLabel(type) {
  switch (type) {
    case 'open':
      return 'باز';
    case 'inviteOnly':
      return 'فقط با دعوت';
    case 'closed':
      return 'بسته';
    default:
      return type || '—';
  }
}

function warFrequencyLabel(freq) {
  switch (freq) {
    case 'always':
      return 'همیشه';
    case 'moreThanOncePerWeek':
      return 'بیش از هفته‌ای یک‌بار';
    case 'oncePerWeek':
      return 'هفته‌ای یک‌بار';
    case 'lessThanOncePerWeek':
      return 'کمتر از هفته‌ای یک‌بار';
    case 'never':
    case 'unknown':
      return 'نامشخص';
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
  try {
    const clan = await getClan();

    const name = stripEmojis(clan.name || '—') || '—';
    const tag = formatTag(clan.tag);
    const description = (clan.description || '').trim();
    const members = clan.members ?? '—';
    const level = clan.clanLevel ?? '—';
    const points = clan.clanPoints ?? '—';
    const builderPoints = clan.clanBuilderBasePoints ?? clan.clanVersusPoints ?? null;
    const capitalPoints = clan.clanCapitalPoints ?? null;

    const warWins = clan.warWins ?? 0;
    const warLosses = clan.warLosses ?? 0;
    const warTies = clan.warTies ?? 0;
    const warStreak = clan.warWinStreak ?? 0;
    const warLeague = clan.warLeague?.name || '—';
    const capitalLeague = clan.capitalLeague?.name || null;

    const location = clan.location?.name || '—';
    const isPublicLog = clan.isWarLogPublic === true ? 'عمومی' : 'خصوصی';
    const requiredTh = clan.requiredTownhallLevel ?? '—';
    const requiredTrophies = clan.requiredTrophies ?? '—';

    const labels = (clan.labels || [])
      .map((l) => l.name)
      .filter(Boolean)
      .slice(0, 5);
    const labelsLine =
      labels.length > 0
        ? `<p>🏷 ${labels.map((l) => escapeHtml(l)).join(' · ')}</p>`
        : '';

    const descBlock = description
      ? `<p>📝 ${escapeHtml(description)}</p>`
      : '';

    const extraRows = [];
    if (builderPoints != null) {
      extraRows.push(row('🔨 بیلدر بیس', escapeHtml(String(builderPoints))));
    }
    if (capitalPoints != null) {
      extraRows.push(row('🏛 پایتخت', escapeHtml(String(capitalPoints))));
    }
    if (capitalLeague) {
      extraRows.push(row('🏛 لیگ پایتخت', escapeHtml(capitalLeague)));
    }

    const html = `
      <h2>🏰 ${escapeHtml(name)}</h2>
      <p><code>${escapeHtml(tag)}</code></p>
      ${descBlock}
      ${labelsLine}

      <h3>📊 وضعیت کلن</h3>
      <table bordered striped compact>
        <tr>
          <th>مورد</th>
          <th>مقدار</th>
        </tr>
        ${row('👥 اعضا', escapeHtml(String(members)))}
        ${row('🏆 سطح', escapeHtml(String(level)))}
        ${row('⭐ امتیاز', escapeHtml(String(points)))}
        ${extraRows.join('')}
        ${row('🔐 عضویت', escapeHtml(typeLabel(clan.type)))}
        ${row('📍 مکان', escapeHtml(location))}
        ${row('🏠 حداقل TH', escapeHtml(String(requiredTh)))}
        ${row('🎯 حداقل کاپ', escapeHtml(String(requiredTrophies)))}
      </table>

      <h3>⚔️ جنگ و لیگ</h3>
      <table bordered striped compact>
        <tr>
          <th>مورد</th>
          <th>مقدار</th>
        </tr>
        ${row('🛡️ لیگ وار', escapeHtml(warLeague))}
        ${row('📅 تناوب وار', escapeHtml(warFrequencyLabel(clan.warFrequency)))}
        ${row('🔥 وین‌استریک', escapeHtml(String(warStreak)))}
        ${row('✅ برد', escapeHtml(String(warWins)))}
        ${row('❌ باخت', escapeHtml(String(warLosses)))}
        ${row('🤝 مساوی', escapeHtml(String(warTies)))}
        ${row('📜 وار لاگ', escapeHtml(isPublicLog))}
      </table>
    `.trim();

    try {
      return await ctx.telegram.callApi('sendRichMessage', {
        chat_id: ctx.chat.id,
        rich_message: {
          html,
          is_rtl: true,
        },
      });
    } catch (richErr) {
      console.warn('[/clan] rich message failed, fallback HTML:', richErr.message);
      const fallback = `
🏰 <b>${escapeHtml(name)}</b> <code>${escapeHtml(tag)}</code>

${description ? `📝 ${escapeHtml(description)}\n` : ''}👥 اعضا: <b>${members}</b>
🏆 سطح: <b>${level}</b> | ⭐ امتیاز: <b>${points}</b>
🔐 ${escapeHtml(typeLabel(clan.type))} | 📍 ${escapeHtml(location)}

⚔️ لیگ وار: <b>${escapeHtml(warLeague)}</b>
🔥 استریک: <b>${warStreak}</b>
✅ ${warWins} | ❌ ${warLosses} | 🤝 ${warTies}
📜 وار لاگ: ${escapeHtml(isPublicLog)}
🏠 حداقل TH: ${requiredTh} | 🎯 کاپ: ${requiredTrophies}
`.trim();
      return ctx.reply(fallback, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('[/clan]', err.message);
    return ctx.reply(`❌ خطا در دریافت اطلاعات کلن: ${err.message}`);
  }
};
