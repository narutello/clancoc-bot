module.exports = function helpCommand(ctx) {
  const text = `
📖 <b>راهنمای دستورات</b>

<b>عمومی:</b>
/start — معرفی ربات
/help — همین راهنما
/war — وضعیت فعلی وار
/clan — اطلاعات کلن

<b>مدیریت اکانت‌ها:</b>
/link #TAG — لینک اکانت کلش به حساب خودت
/myaccounts — لیست اکانت‌های لینک‌شده
/unlink #TAG — حذف لینک یک اکانت
/unlinkall — حذف تمام لینک‌های خودت

<b>دستورات اونر (فقط صاحب ربات):</b>
/link TELEGRAM_ID #TAG — لینک اکانت برای کاربر دیگر
/unlink TELEGRAM_ID #TAG — حذف لینک کاربر دیگر
/testnotify — ارسال پیام تست به گروه اعلان‌ها

مثال:
<code>/link #ABC123XYZ</code>
<code>/link 123456789 #ABC123XYZ</code>
`.trim();

  return ctx.reply(text, { parse_mode: 'HTML' });
};
