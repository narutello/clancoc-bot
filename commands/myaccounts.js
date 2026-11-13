const { getUserAccounts, upsertTelegramUser } = require('../services/linkService');
const { formatTag } = require('../utils/helpers');

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true };

module.exports = async function myAccountsCommand(ctx) {
  const from = ctx.from;
  await upsertTelegramUser(from);

  try {
    const links = await getUserAccounts(from.id);
    if (!links.length) {
      return ctx.reply(ctx.t('myaccounts.empty'), HTML);
    }
    const list = links
      .map((row, i) => {
        const tag = formatTag(row.tag);
        const name = row.name ? ` — ${row.name}` : '';
        return `${i + 1}. <code>${tag}</code>${name}`;
      })
      .join('\n');
    return ctx.reply(ctx.t('myaccounts.title', { list }), HTML);
  } catch (err) {
    return ctx.reply(ctx.t('common.error', { message: err.message }), HTML);
  }
};
