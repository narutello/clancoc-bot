const { listLinks, upsertTelegramUser } = require('../services/linkService');
const { formatTag } = require('../utils/helpers');

module.exports = async function myAccountsCommand(ctx) {
  const from = ctx.from;
  await upsertTelegramUser(from);

  try {
    const links = await listLinks(from.id);
    if (!links.length) {
      return ctx.reply(ctx.t('myaccounts.empty'));
    }
    const list = links
      .map((row, i) => {
        const tag = formatTag(row.clash_tag || row.tag);
        const name = row.name ? ` — ${row.name}` : '';
        return `${i + 1}. ${tag}${name}`;
      })
      .join('\n');
    return ctx.reply(ctx.t('myaccounts.title', { list }));
  } catch (err) {
    return ctx.reply(ctx.t('common.error', { message: err.message }));
  }
};
