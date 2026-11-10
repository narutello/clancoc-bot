# ClanCoC Bot

ربات تلگرام برای مدیریت وارهای کلن **Clash of Clans**.

پایش خودکار وار معمولی و CWL، اعلان گروهی با جدول Rich Message، لینک چندبه‌چند کاربران تلگرام و اکانت‌های کلش، و دیتابیس پایدار روی Neon PostgreSQL.

---

## ویژگی‌ها

### اعلان‌های خودکار گروه
| رویداد | توضیح |
|--------|--------|
| پیدا شدن حریف / آماده‌سازی | جدول کلن‌ها + اعضای وار |
| شروع روز نبرد | جدول کامل + تعداد حمله‌ها |
| **۱ ساعت مانده به پایان** | امتیاز فعلی + لیست/منشن کسانی که حمله باقی دارند |
| پایان وار | جدول نهایی + نتیجه |
| پایان لیگ (CWL) | رتبه نهایی گروه + تشکر از بازیکنان با حداقل ۱۵ ستاره |

اعلان‌ها تکراری ارسال نمی‌شوند (حتی بعد از Restart).

### دستور `/war` و `/cwl`
نمایش وضعیت با **Telegram Rich Message**:

- جدول کلن‌ها: نام · ستاره · درصد تخریب
- وضعیت و زمان خوانا به وقت تهران
- جدول اعضا: `#` · بازیکن · TH · حمله · ستاره · دفاع
- دکمه جابه‌جایی خودمان / حریف (و در CWL: رتبه گروه)
- اعضای لینک‌شده → اسم قابل کلیک

### سیستم لینک اکانت
- چند اکانت کلش برای یک کاربر تلگرام
- یک اکانت کلش برای چند کاربر تلگرام
- اونر: `/link TELEGRAM_ID #TAG`
- پایداری لینک‌ها در دیتابیس بعد از Restart

### فنی
- Node.js + Telegraf
- Neon PostgreSQL (pool + migration + retry)
- Clash API فقط از طریق پروکسی RoyaleAPI
- Rate limit دستورات، کش کوتاه `/war`، singleflight
- کانال لاگ اختیاری (`LOG_TELEGRAM_ID`)
- Health HTTP برای هاست

---

## پیش‌نیازها

- Node.js 18+
- توکن ربات از [@BotFather](https://t.me/BotFather)
- دیتابیس [Neon PostgreSQL](https://neon.tech)
- توکن API از [developer.clashofclans.com](https://developer.clashofclans.com)
- هاست Node.js (Inject Cloud / Botkeep / مشابه)

---

## متغیرهای محیطی

```bash
cp .env.example .env
```

| متغیر | توضیح | الزامی |
|-------|--------|--------|
| `BOT_TOKEN` | توکن ربات تلگرام | بله |
| `DATABASE_URL` | رشته اتصال Neon | بله |
| `CLASH_API_TOKEN` | توکن API کلش | بله |
| `CLASH_API_BASE_URL` | پیش‌فرض RoyaleAPI proxy | خیر |
| `OWNER_TELEGRAM_ID` | آیدی عددی اونر | بله |
| `TELEGRAM_GROUP_ID` | گروه اعلان‌ها | توصیه |
| `CLAN_TAG` | تگ کلن | بله |
| `WAR_POLL_INTERVAL_MS` | فاصله پایش (پیش‌فرض ۱۲۰۰۰۰) | خیر |
| `LOG_TELEGRAM_ID` | کانال/چت لاگ | خیر |
| `WAR_CMD_LIMIT` / `WAR_CMD_WINDOW_MS` | ریت‌لیمیت `/war` | خیر |
| `CWL_CMD_LIMIT` / `CWL_CMD_WINDOW_MS` | ریت‌لیمیت `/cwl` | خیر |
| `CLAN_CMD_LIMIT` / `CLAN_CMD_WINDOW_MS` | ریت‌لیمیت `/clan` | خیر |

کلید API کلش باید IP پروکسی RoyaleAPI را وایت‌لیست کند (در مستندات پروکسی).

---

## نصب و اجرا

```bash
npm install
npm start
```

با `npm start` مهاجرت دیتابیس، اتصال تلگرام، health server و مانیتور وار اجرا می‌شود.

---

## دستورات ربات

| دستور | توضیح | دسترسی |
|-------|--------|--------|
| `/start` | معرفی | همه |
| `/help` | راهنما | همه |
| `/war` | وضعیت وار معمولی | همه |
| `/cwl` | وضعیت لیگ کلن‌ها | همه |
| `/clan` | اطلاعات کلن | همه |
| `/testw` | پیش‌نمایش Widget (عمدتاً PV) | همه |
| `/link #TAG` | لینک اکانت | همه |
| `/link TELEGRAM_ID #TAG` | لینک برای دیگری | اونر |
| `/myaccounts` | لیست اکانت‌ها | همه |
| `/unlink` / `/unlinkall` | حذف لینک | همه |
| `/status` | وضعیت فنی | اونر |
| `/testnotify` | تست پیام گروه | اونر |
| `/testlog` | تست کانال لاگ | اونر |

---

## ساختار پروژه

```
index.js                 # ورود + health
config/                  # env
bot/                     # Telegraf
commands/                # دستورات
services/
  warMonitor.js          # پایش + اعلان
  cwlService.js          # CWL + standings
  cwlLeagueEnd.js        # پیام پایان لیگ
  linkService.js         # لینک Many-to-Many
api/clash.js             # RoyaleAPI client
database/                # pool + migrate
utils/                   # helpers, rate limit, logger, ...
```

---

## مجوز

MIT
