const config = require('../config');
const { withTelegramRetry } = require('../utils/telegramSafe');
const { isRtl } = require('../utils/i18n');

module.exports = async function testNotifyCommand(ctx) {
  const fromId = ctx.from?.id;
  const t = ctx.t.bind(ctx);
  const lang = ctx.lang || 'fa';

  if (!fromId || String(fromId) !== String(config.ownerTelegramId)) {
    return ctx.reply(t('test.owner_only'));
  }

  if (!config.telegramGroupId) {
    return ctx.reply(t('test.no_group'));
  }

  const html = `
    <h2>${t('test.notify_title')}</h2>
    <p>${t('test.notify_body')}</p>
    <table bordered striped compact>
      <tr>
        <th>${t('test.col_item')}</th>
        <th>${t('test.col_value')}</th>
      </tr>
      <tr>
        <td>TELEGRAM_GROUP_ID</td>
        <td><code>${config.telegramGroupId}</code></td>
      </tr>
    </table>
  `.trim();

  try {
    await withTelegramRetry(
      () =>
        ctx.telegram.callApi('sendRichMessage', {
          chat_id: config.telegramGroupId,
          rich_message: { html, is_rtl: isRtl(lang) },
        }),
      { maxRetries: config.telegramMaxRetries }
    );
    return ctx.reply(
      t('test.notify_ok', { groupId: config.telegramGroupId }),
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    try {
      await withTelegramRetry(
        () =>
          ctx.telegram.sendMessage(
            config.telegramGroupId,
            `${t('test.notify_title')}\n${t('test.notify_body')}`
          ),
        { maxRetries: config.telegramMaxRetries }
      );
      return ctx.reply(
        t('test.notify_ok', { groupId: config.telegramGroupId }),
        { parse_mode: 'HTML' }
      );
    } catch (err2) {
      return ctx.reply(
        t('test.notify_fail', { message: err2.message }),
        { parse_mode: 'HTML' }
      );
    }
  }
};
