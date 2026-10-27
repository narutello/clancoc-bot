const { getClan } = require('../api/clash');
const { escapeHtml, formatTag } = require('../utils/helpers');
const config = require('../config');

module.exports = async function clanCommand(ctx) {
  try {
    const clan = await getClan();

    const text = `
🏰 <b>${escapeHtml(clan.name)}</b> (${formatTag(clan.tag)})

📝 ${escapeHtml(clan.description || '—')}
👥 اعضا: ${clan.members || 0}/${clan.type === 'inviteOnly' ? 'دعوتی' : clan.type || '—'}
🏆 سطح کلن: ${clan.clanLevel || '—'}
⭐ امتیاز وار: ${clan.warWins || 0} برد
🛡️ لیگ وار: ${clan.warLeague?.name || '—'}
📍 مکان: ${clan.location?.name || '—'}
`.trim();

    return ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[/clan]', err.message);
    return ctx.reply(`❌ خطا در دریافت اطلاعات کلن: ${err.message}`);
  }
};
