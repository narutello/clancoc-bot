const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');

module.exports = async function testLogCommand(ctx) {
  const fromId = ctx.from?.id;
  const t = ctx.t.bind(ctx);

  if (!fromId || String(fromId) !== String(config.ownerTelegramId)) {
    return ctx.reply(t('test.owner_only'));
  }

  if (!config.logTelegramId) {
    return ctx.reply(t('test.no_log'));
  }

  try {
    const ok = await tgLog.info('Manual log channel test', {
      from: fromId,
      chat: ctx.chat?.id,
    }, { module: 'TestLog' });
    if (ok === false) {
      return ctx.reply(t('test.log_fail', { message: 'not delivered' }));
    }
    return ctx.reply(t('test.log_ok'));
  } catch (err) {
    return ctx.reply(t('test.log_fail', { message: err.message }));
  }
};
