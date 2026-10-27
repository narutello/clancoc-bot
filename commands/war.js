const { getCurrentWar } = require('../api/clash');
const { getLinksForTags } = require('../services/linkService');
const {
  escapeHtml,
  warStateLabel,
  normalizeTag,
  tgUserLink,
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
          // اسم قابل کلیک
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

    const html = `
      <h2>⚔️ وضعیت وار</h2>

      <p>
        🏰 <b>${escapeHtml(our.name || '—')}</b>
        — ${our.stars ?? 0} ⭐
        (${(our.destructionPercentage ?? 0).toFixed(1)}%)
      </p>

      <p>
        🆚 <b>${escapeHtml(opp.name || '—')}</b>
        — ${opp.stars ?? 0} ⭐
        (${(opp.destructionPercentage ?? 0).toFixed(1)}%)
      </p>

      <p>
        👥 ${teamSize}v${teamSize}<br/>
        ⏳ وضعیت: <b>${escapeHtml(warStateLabel(war.state))}</b>
      </p>

      ${attacksInfo}

      <h3>📋 اعضای کلن</h3>

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

    // استفاده از Rich Message (Bot API 10.1+)
    return ctx.telegram.callApi('sendRichMessage', {
      chat_id: ctx.chat.id,
      rich_message: {
        html,
        is_rtl: true,
      },
    });
  } catch (err) {
    console.error('[/war]', err.message);

    // اگر Rich Message پشتیبانی نشد، پیام مناسب بده
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
