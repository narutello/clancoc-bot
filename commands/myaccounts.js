const { getUserAccounts, upsertTelegramUser } = require('../services/linkService');
const { formatTag, escapeHtml } = require('../utils/helpers');

module.exports = async function myAccountsCommand(ctx) {
  const from = ctx.from;
  await upsertTelegramUser(from);

  try {
    const accounts = await getUserAccounts(from.id);
    if (accounts.length === 0) {
      return ctx.reply('هنوز هیچ اکانتی لینک نکرده‌اید.\nاز /link #TAG استفاده کنید.');
    }

    const lines = accounts.map((a, i) => {
      const name = a.name ? escapeHtml(a.name) : '—';
      return `${i + 1}. <b>${name}</b> — ${formatTag(a.tag)}`;
    });

    const text = `📋 <b>اکانت‌های لینک‌شده شما:</b>\n\n${lines.join('\n')}`;
    return ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    return ctx.reply(`❌ خطا: ${err.message}`);
  }
};
