const config = require('../config');
const { withTelegramRetry } = require('../utils/telegramSafe');
const { tgLog } = require('../utils/telegramLogger');

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

function isOwnerUser(userId) {
  if (userId == null) return false;
  const ownerId = Number(config.ownerTelegramId);
  if (!Number.isFinite(ownerId)) return false;
  return Number(userId) === ownerId;
}

module.exports = async function helpCommand(ctx) {
  const userId = ctx.from?.id;
  const isOwner = isOwnerUser(userId);
  const isPrivate = !ctx.chat?.type || ctx.chat.type === 'private';
  const publicText = publicHelpText();
  const ownerText = ownerHelpText();

  // Log who requested help (helps audit mistaken owner matches)
  try {
    await tgLog.info(
      `/help by ${userId}${isOwner ? ' (owner)' : ''}`,
      {
        chatId: ctx.chat?.id,
        chatType: ctx.chat?.type,
        username: ctx.from?.username || '',
      },
      { module: 'Help' }
    );
  } catch (_) {}

  // Private chat: owner gets full help, others get public
  if (isPrivate) {
    const text = isOwner ? ownerText : publicText;
    return ctx.reply(text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  // Group/supergroup:
  // - Prefer ephemeral so only the caller sees it
  // - Owner text ONLY via ephemeral (or DM). Never post owner tools publicly.
  const textForCaller = isOwner ? ownerText : publicText;

  try {
    await withTelegramRetry(
      () =>
        ctx.telegram.callApi('sendMessage', {
          chat_id: ctx.chat.id,
          text: textForCaller,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ephemeral_message_parameters: {
            receiver_user_id: userId,
          },
        }),
      { maxRetries: config.telegramMaxRetries }
    );
    return;
  } catch (err) {
    console.warn('[/help] ephemeral send failed:', err.message);
  }

  // Fallback: public message must stay public-safe
  try {
    await ctx.reply(publicText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.warn('[/help] public fallback failed:', e.message);
  }

  // If owner and ephemeral failed, try DM with full owner help
  if (isOwner && userId) {
    try {
      await withTelegramRetry(
        () =>
          ctx.telegram.sendMessage(userId, ownerText, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        { maxRetries: config.telegramMaxRetries }
      );
    } catch (e) {
      console.warn('[/help] owner DM failed:', e.message);
    }
  }
};
