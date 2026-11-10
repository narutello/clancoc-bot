module.exports = async function helpCommand(ctx) {
  const text = `
🤖 <b>راهنمای ربات مدیریت وار</b>

<b>دستورات عمومی</b>
/war — وضعیت وار معمولی
/cwl — وضعیت لیگ کلن‌ها (CWL)
/clan — اطلاعات کلن
/help — همین راهنما

<b>اکانت‌ها</b>
/link #TAG — لینک اکانت کلش به تلگرام
/unlink #TAG — حذف لینک
/unlinkall — حذف همه لینک‌های شما
/myaccounts — فهرست اکانت‌های لینک‌شده

<b>آزمایشی</b>
/testw — پیش‌نمایش Widget وضعیت وار\n(در production فعلاً مطمئن‌ترین حالت: چت خصوصی با ربات)

<b>نکته CWL</b>
در لیگ کلن‌ها از /cwl استفاده کنید.\nاگر /war بزنید و کلن در CWL باشد، ربات شما را به /cwl راهنمایی می‌کند.

<b>Owner</b>
<code>/status</code> — وضعیت فنی ربات\n<code>/link TELEGRAM_USER_ID #TAG</code>\n<code>/testnotify</code> — تست ارسال به گروه\n<code>/testlog</code> — تست کانال لاگ
`.trim();

  return ctx.reply(text, { parse_mode: 'HTML' });
};
