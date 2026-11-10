const config = require('../config');
const { withTelegramRetry } = require('../utils/telegramSafe');

function publicHelpText() {
  return `
🤖 <b>راهنمای ربات مدیریت وار</b>

<b>دستورات</b>
/war — وضعیت وار معمولی
/cwl — وضعیت لیگ کلن‌ها (CWL)
/clan — اطلاعات کلن
/help — همین راهنما

<b>اکانت‌ها</b>
/link #TAG — لینک اکانت کلش به تلگرام
/unlink #TAG — حذف لینک
/unlinkall — حذف همه لینک‌های شما
/myaccounts — فهرست اکانت‌های لینک‌شده

<b>نکته</b>
در لیگ کلن‌ها از /cwl استفاده کنید.
اگر /war بزنید و کلن در CWL باشد، ربات شما را راهنمایی می‌کند.
`.trim();
}

function ownerHelpText() {
  return `
🤖 <b>راهنمای ربات — Owner</b>

<b>عمومی</b>
/war · /cwl · /clan · /help
/link #TAG · /unlink #TAG · /unlinkall · /myaccounts

<b>مدیریت لینک دیگران</b>
<code>/link TELEGRAM_USER_ID #TAG</code>
<code>/unlink TELEGRAM_USER_ID #TAG</code>

<b>ابزار اونر</b>
/status — وضعیت فنی ربات
/testnotify — تست ارسال به گروه
/testlog — تست کانال لاگ
/testw — پیش‌نمایش Widget (عمدتاً PV)

<b>نکته</b>
نوتیف‌های وار/CWL خودکار به گروه می‌روند.
این راهنما فقط برای شما نمایش داده می‌شود.
`.trim();
}

module.exports = async function helpCommand(ctx) {
  const userId = ctx.from?.id;
  const isOwner =
    userId != null && Number(userId) === Number(config.ownerTelegramId);
  const text = isOwner ? ownerHelpText() : publicHelpText();

  const payload = {
    chat_id: ctx.chat.id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  // In groups: only the caller sees the help message (Bot API ephemeral)
  if (ctx.chat?.type && ctx.chat.type !== 'private' && userId) {
    payload.ephemeral_message_parameters = {
      receiver_user_id: userId,
    };
  }

  try {
    await withTelegramRetry(() => ctx.telegram.callApi('sendMessage', payload), {
      maxRetries: config.telegramMaxRetries,
    });
  } catch (err) {
    // Older clients / API: fall back to a normal reply
    console.warn('[/help] ephemeral send failed:', err.message);
    return ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
  }
};
