const { getCurrentWar } = require('../api/clash');
const { getLinksForTags } = require('../services/linkService');
const {
  escapeHtml,
  warStateLabel,
  normalizeTag,
  tgUserLink,
  stripEmojis,
  formatWarTime,
  parseClashTime,
} = require('../utils/helpers');

module.exports = async function warCommand(ctx) {
  try {
    const war = await getCurrentWar();

    if (!war || war.state === 'notInWar') {
      return ctx.reply('در حال حاضر کلن در وار نیست.');
    }

    const our = war.clan || {};
    const opp = war.opponent || {};
    const members = (our.members || []).slice().sort(
      (a, b) => (a.mapPosition || 0) - (b.mapPosition || 0)
    );
    const teamSize = war.teamSize || members.length;

    const used = members.reduce(
      (sum, m) => sum + (m.attacks || []).length,
      0
    );
    const max = teamSize * (war.attacksPerMember || 2);

    const attacksInfo =
      war.state === 'inWar' || war.state === 'warEnded'
        ? `<p>⚔️ حمله‌ها: <b>${used}/${max}</b></p>`
        : '';

    // زمان شروع / پایان
    let timeInfo = '';
    if (war.state === 'preparation') {
      const start = parseClashTime(war.startTime);
      const formatted = formatWarTime(start);
      if (formatted) {
        timeInfo = `<p>🕐 شروع نبرد: <b>${formatted}</b></p>`;
      }
    } else if (war.state === 'inWar') {
      const end = parseClashTime(war.endTime);
      const formatted = formatWarTime(end);
      if (formatted) {
        timeInfo = `<p>🕐 پایان وار: <b>${formatted}</b></p>`;
      }
    }

    // لینک‌های تلگرام اعضا
    const tags = members.map((m) => normalizeTag(m.tag));
    const linksMap = await getLinksForTags(tags);

    const rows = members
      .map((member) => {
        const attacks = member.attacks || [];
        const stars = attacks.reduce((sum, a) => sum + (a.stars || 0), 0);
        const tag = normalizeTag(member.tag);
        const links = linksMap.get(tag) || [];

        let nameCell;
        if (links.length > 0) {
          nameCell = links
            .map((u) => tgUserLink(u.telegram_id, member.name))
            .join(' / ');
        } else {
          nameCell = escapeHtml(member.name || '—');
        }

        return `
          <tr>
            <td>${member.mapPosition ?? '—'}</td>
            <td>${nameCell}</td>
            <td>${attacks.length}</td>
            <td>${stars} ⭐</td>
          </tr>
        `;
      })
      .join('');

    const ourName = stripEmojis(our.name || '—') || '—';
    const oppName = stripEmojis(opp.name || '—') || '—';

    const html = `
      <h2>⚔️ وضعیت وار</h2>

      <table bordered striped compact>
        <tr>
          <th>کلن</th>
          <th>ستاره</th>
          <th>تخریب</th>
        </tr>
        <tr>
          <td>🏰 ${escapeHtml(ourName)}</td>
          <td>${our.stars ?? 0} ⭐</td>
          <td>${(our.destructionPercentage ?? 0).toFixed(1)}%</td>
        </tr>
        <tr>
          <td>⚡ ${escapeHtml(oppName)}</td>
          <td>${opp.stars ?? 0} ⭐</td>
          <td>${(opp.destructionPercentage ?? 0).toFixed(1)}%</td>
        </tr>
      </table>

      <p>
        👥 ${teamSize}v${teamSize}<br/>
        ⏳ وضعیت: <b>${escapeHtml(warStateLabel(war.state))}</b>
      </p>

      ${timeInfo}
      ${attacksInfo}

      <h3>📋 اعضای وار</h3>

      <table bordered striped compact>
        <tr>
          <th>#</th>
          <th>بازیکن</th>
          <th>حمله</th>
          <th>ستاره</th>
        </tr>
        ${rows}
      </table>
    `.trim();

    return ctx.telegram.callApi('sendRichMessage', {
      chat_id: ctx.chat.id,
      rich_message: {
        html,
        is_rtl: true,
      },
    });
  } catch (err) {
    console.error('[/war]', err.message);

    if (
      err.description?.includes('sendRichMessage') ||
      err.message?.includes('sendRichMessage') ||
      err.response?.description?.includes('sendRichMessage')
    ) {
      return ctx.reply(
        '⚠️ نسخه فعلی کلاینت تلگرام از Rich Message پشتیبانی نمی‌کند.\nلطفاً تلگرام را آپدیت کنید.'
      );
    }

    return ctx.reply(`❌ خطا در دریافت اطلاعات وار: ${err.message}`);
  }
};
