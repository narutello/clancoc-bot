const { getCurrentWar } = require('../api/clash');
const { formatMembersList } = require('../services/warMonitor');
const {
  escapeHtml,
  warStateLabel,
  formatTag,
  normalizeTag,
} = require('../utils/helpers');
const config = require('../config');

module.exports = async function warCommand(ctx) {
  try {
    const war = await getCurrentWar();

    if (!war || war.state === 'notInWar') {
      return ctx.reply('در حال حاضر کلن در وار نیست.');
    }

    const our = war.clan || {};
    const opp = war.opponent || {};
    const members = (our.members || []).map((m) => ({
      tag: normalizeTag(m.tag),
      name: m.name,
      mapPosition: m.mapPosition,
      attacks: m.attacks || [],
    }));

    const membersList = await formatMembersList(members);
    const teamSize = war.teamSize || members.length;

    let attacksInfo = '';
    if (war.state === 'inWar' || war.state === 'warEnded') {
      const used = members.reduce((s, m) => s + (m.attacks || []).length, 0);
      const max = teamSize * (war.attacksPerMember || 2);
      attacksInfo = `\n⚔️ حمله‌ها: ${used}/${max}`;
    }

    const text = `
⚔️ <b>وضعیت وار</b>

🏰 ${escapeHtml(our.name || '—')}  ${our.stars ?? 0}⭐ (${(our.destructionPercentage ?? 0).toFixed(1)}%)
🆚 ${escapeHtml(opp.name || '—')}  ${opp.stars ?? 0}⭐ (${(opp.destructionPercentage ?? 0).toFixed(1)}%)

👥 ${teamSize}v${teamSize}
⏳ وضعیت: ${warStateLabel(war.state)}${attacksInfo}

📋 <b>اعضا:</b>
${membersList}
`.trim();

    return ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    console.error('[/war]', err.message);
    return ctx.reply(`❌ خطا در دریافت اطلاعات وار: ${err.message}`);
  }
};
