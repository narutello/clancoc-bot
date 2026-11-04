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

<b>نکته CWL</b>
در لیگ کلن‌ها از /cwl استفاده کنید.
اگر /war بزنید و کلن در CWL باشد، ربات شما را به /cwl راهنمایی می‌کند.

<b>Owner</b>
<code>/link TELEGRAM_USER_ID #TAG</code>
<code>/testnotify</code>
<code>/testlog</code>
`.trim();

  return ctx.reply(text, { parse_mode: 'HTML' });
};
