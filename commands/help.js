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

async function sendDmHelp(telegram, userId, text) {
  await withTelegramRetry(
    () =>
      telegram.sendMessage(userId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    { maxRetries: config.telegramMaxRetries }
  );
}

module.exports = async function helpCommand(ctx) {
  const userId = ctx.from?.id;
  const isOwner = isOwnerUser(userId);
  const isPrivate = !ctx.chat?.type || ctx.chat.type === 'private';
  const text = isOwner ? ownerHelpText() : publicHelpText();

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

  // PV: normal message
  if (isPrivate) {
    return ctx.reply(text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  if (!userId) {
    return ctx.reply(publicHelpText(), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  // Group: 1) try ephemeral (works reliably if bot is admin)
  // Docs: non-admin bots need callback/ephemeral context; admin can use receiver_user_id.
  try {
    await withTelegramRetry(
      () =>
        ctx.telegram.callApi('sendMessage', {
          chat_id: ctx.chat.id,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ephemeral_message_parameters: {
            receiver_user_id: userId,
          },
        }),
      { maxRetries: 1 }
    );
    return;
  } catch (err) {
    console.warn('[/help] ephemeral failed:', err.description || err.message);
    try {
      await tgLog.warn(
        'Ephemeral /help failed; falling back to DM',
        err.description || err.message,
        { module: 'Help' }
      );
    } catch (_) {}
  }

  // 2) Fallback: DM only — do NOT post help publicly in the group
  try {
    await sendDmHelp(ctx.telegram, userId, text);
    try {
      await ctx.reply('📩 راهنما براتون توی پیوی ربات ارسال شد.', {
        disable_notification: true,
      });
    } catch (_) {}
    return;
  } catch (err) {
    console.warn('[/help] DM failed:', err.description || err.message);
  }

  // 3) Last resort: public message, but only public (non-owner) text
  return ctx.reply(publicHelpText(), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
};
