# ClanCoC Bot

Telegram bot for **Clash of Clans** clan war management.

It watches regular wars and CWL, posts clear group alerts, shows rich war tables, and links Clash accounts to Telegram — built to stay online on a free/small Node host with Neon PostgreSQL and the RoyaleAPI proxy.

> **فارسی:** [نسخه فارسی README](#-فارسی)

---

## Features

### Automatic group notifications
| Event | What you get |
|--------|----------------|
| Opponent found / preparation | Clan score table + war roster |
| Battle start | Full table + attack counts |
| **1 hour left** | Current score + who still has attacks (mentions when linked) |
| War end | Final table + result |
| CWL league end | Group standings + thanks to players with ≥15 stars |

Notifications are deduplicated (safe across restarts).

### `/war` and `/cwl`
Rich Telegram tables:

- Clan row: name · stars · destruction %
- Human-readable times (Tehran timezone)
- Member table: `#` · player · TH · attacks · stars · defense
- Buttons: Home / Enemy (and CWL standings)
- Linked members → clickable Telegram names

In CWL, preparation alerts fire only at league start (not every day).

### Account linking
- Multiple Clash accounts per Telegram user
- Multiple Telegram users per Clash account
- Owner can link for others: `/link TELEGRAM_ID #TAG`
- Links persist in PostgreSQL across restarts

### Bilingual UI
- **Persian** and **English**
- Group language and private language are independent
- `/setting` panel (group: admins + owner; private: each user)
- All commands, alerts, and buttons go through the i18n layer

### Reliability
- Adaptive war polling (idle / active / near events)
- Command rate limits (owner exempt from command limits)
- Clash + Telegram retries with backoff
- Optional log channel (`LOG_TELEGRAM_ID`)
- HTTP health endpoint for hosts that probe a port

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Intro |
| `/help` | Help (owner sees extra technical commands) |
| `/war` | Regular war status |
| `/cwl` | CWL day status |
| `/clan` | Clan overview |
| `/link #TAG` | Link your Clash account |
| `/unlink #TAG` | Unlink an account |
| `/myaccounts` | List your linked accounts |
| `/setting` | Language settings |

**Owner-only**

| Command | Description |
|---------|-------------|
| `/status` | Technical status (DB, API, poll, links) |
| `/testnotify` | Send a test message to `TELEGRAM_GROUP_ID` |
| `/testlog` | Send a test line to the log channel |
| `/testw` | Experimental war widget preview |
| `/link USER_ID #TAG` | Link a tag for another user |
| `/unlinkall` | Remove all of your own links (with confirm) |

---

## Stack

| Piece | Choice |
|-------|--------|
| Runtime | Node.js 18+ |
| Bot framework | [Telegraf](https://github.com/telegraf/telegraf) |
| Database | [Neon](https://neon.tech) PostgreSQL |
| Clash API | [RoyaleAPI CoC proxy](https://cocproxy.royaleapi.dev) only |
| Language | Plain JavaScript (CommonJS), no build step |
| Entry | `index.js` → `npm start` |

---

## Quick start

```bash
git clone https://github.com/narutello/clancoc-bot.git
cd clancoc-bot
npm install
cp .env.example .env
# edit .env with real values
npm start
```

On first boot the bot runs DB migrations, connects to Telegram, and starts the war monitor.

### Requirements

1. Bot token from [@BotFather](https://t.me/BotFather)
2. Neon (or any) PostgreSQL URL
3. Clash API token from [developer.clashofclans.com](https://developer.clashofclans.com)
4. Your clan tag and Telegram group id (for alerts)

Add the bot to the group and grant send-message permission. For the optional log channel, add the bot as admin there too.

---

## Environment variables

Copy `.env.example`. Sensitive values must never be committed.

### Required

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token |
| `DATABASE_URL` | PostgreSQL connection string |
| `CLASH_API_TOKEN` | Official Clash API token (sent via RoyaleAPI proxy) |
| `OWNER_TELEGRAM_ID` | Numeric Telegram user id of the owner |
| `CLAN_TAG` | Clan tag, e.g. `#UCJV89YQ` |

### Recommended

| Variable | Description |
|----------|-------------|
| `TELEGRAM_GROUP_ID` | Group/supergroup id for war alerts |
| `LOG_TELEGRAM_ID` | Optional channel/group for structured logs |
| `CLASH_API_BASE_URL` | Default: `https://cocproxy.royaleapi.dev/v1` |

### Optional tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `WAR_POLL_IDLE_MS` | `300000` | Poll interval when not in war |
| `WAR_POLL_INTERVAL_MS` / `WAR_POLL_ACTIVE_MS` | `120000` | Poll interval during active war |
| `WAR_POLL_NEAR_MS` | `30000` | Poll near start / 1h-left / end |
| `WAR_POLL_MIN_MS` | `20000` | Minimum adaptive interval |
| `WAR_CMD_LIMIT` / `WAR_CMD_WINDOW_MS` | `5` / `60000` | `/war` rate limit |
| `CWL_CMD_LIMIT` / `CWL_CMD_WINDOW_MS` | `5` / `60000` | `/cwl` rate limit |
| `CLAN_CMD_LIMIT` / `CLAN_CMD_WINDOW_MS` | `8` / `60000` | `/clan` rate limit |
| `WAR_CACHE_TTL_MS` | `8000` | Short in-memory war cache |
| `CLASH_MAX_RETRIES` | `3` | Clash API retries |
| `TELEGRAM_MAX_RETRIES` | `3` | Telegram API retries |
| `LOG_LEVEL` | `debug` | Console log level |
| `LOG_TG_MIN_LEVEL` | `info` | Minimum level sent to log channel |

Hosts that require a listening port: the process exposes a small health server (see startup logs for the port).

---

## Project layout

```
index.js              # entry + health server + boot
bot/                  # Telegraf app wiring
commands/             # /war /cwl /clan /link /setting /status ...
services/             # war monitor, CWL, notify, link, settings
api/                  # RoyaleAPI client
database/             # pool + migrations
locales/              # fa / en (+ extra keys)
middleware/           # i18n context (ctx.t, ctx.lang)
utils/                # rate limit, cache, logger, helpers
config/               # env loading
```

---

## Deploy notes

1. Set all required env vars on the host.
2. Start command: `npm start` (runs `node index.js`).
3. Prefer a host that keeps the process alive 24/7 and can hit the health port if needed.
4. After push/redeploy, check `/status` (owner) and `/testnotify`.

GitHub auto-deploy (Inject Cloud / similar) is fine as long as env vars are configured on the platform, not only locally.

---

## License

MIT

---

# 🇮🇷 فارسی

ربات تلگرام برای **مدیریت وار کلن Clash of Clans**.

وار معمولی و لیگ کلن‌ها را پایش می‌کند، اعلان گروهی می‌فرستد، جدول وضعیت جنگ را نشان می‌دهد و اکانت کلش را به تلگرام وصل می‌کند — مناسب هاست کوچک Node با دیتابیس Neon و پروکسی RoyaleAPI.

---

## قابلیت‌ها

### اعلان خودکار در گروه
| رویداد | خروجی |
|--------|--------|
| پیدا شدن حریف / آماده‌سازی | جدول کلن‌ها + اعضای وار |
| شروع روز نبرد | جدول کامل + تعداد حمله |
| **۱ ساعت مانده** | امتیاز فعلی + لیست/منشن کسانی که هنوز حمله دارند |
| پایان وار | جدول نهایی |
| پایان لیگ (CWL) | رتبه‌بندی گروه + تشکر از بازیکنان با حداقل ۱۵ ستاره |

اعلان‌ها تکراری ارسال نمی‌شوند (حتی بعد از Restart).

### دستور `/war` و `/cwl`
نمایش با Rich Message تلگرام:

- ردیف کلن: نام · ستاره · درصد تخریب
- زمان خوانا به وقت تهران
- جدول اعضا: `#` · بازیکن · TH · حمله · ستاره · دفاع
- دکمه جابه‌جایی خودمان / حریف (و در CWL رتبه گروه)
- اعضای لینک‌شده → اسم قابل کلیک

در CWL اعلان آماده‌سازی فقط در شروع لیگ می‌آید، نه هر روز.

### لینک اکانت
- چند اکانت کلش برای یک کاربر تلگرام
- چند کاربر تلگرام برای یک اکانت کلش
- اونر: `/link TELEGRAM_ID #TAG`
- ماندگاری لینک‌ها در PostgreSQL

### رابط دوزبانه
- **فارسی** و **انگلیسی**
- زبان گروه و زبان پیوی جداست
- پنل `/setting` (گروه: ادمین + اونر؛ پیوی: هر کاربر)
- همه دستورات، اعلان‌ها و دکمه‌ها از سیستم ترجمه عبور می‌کنند

### پایداری
- پولینگ تطبیقی وار (بیکار / فعال / نزدیک رویداد)
- محدودیت نرخ دستورات (اونر از محدودیت دستور معاف است)
- Retry برای Clash و تلگرام
- کانال لاگ اختیاری (`LOG_TELEGRAM_ID`)
- Health HTTP برای هاست‌هایی که پورت چک می‌کنند

---

## دستورات

| دستور | توضیح |
|-------|--------|
| `/start` | معرفی |
| `/help` | راهنما (اونر دستورات فنی بیشتر می‌بیند) |
| `/war` | وضعیت وار معمولی |
| `/cwl` | وضعیت روز لیگ |
| `/clan` | اطلاعات کلن |
| `/link #TAG` | لینک اکانت کلش |
| `/unlink #TAG` | حذف لینک |
| `/myaccounts` | لیست اکانت‌های لینک‌شده |
| `/setting` | تنظیم زبان |

**فقط اونر**

| دستور | توضیح |
|-------|--------|
| `/status` | وضعیت فنی (دیتابیس، API، پول، لینک‌ها) |
| `/testnotify` | پیام تست به گروه |
| `/testlog` | خط تست به کانال لاگ |
| `/testw` | پیش‌نمایش ویجت وار |
| `/link USER_ID #TAG` | لینک برای کاربر دیگر |
| `/unlinkall` | حذف همه لینک‌های خودتان (با تأیید) |

---

## اجرا

```bash
git clone https://github.com/narutello/clancoc-bot.git
cd clancoc-bot
npm install
cp .env.example .env
# مقادیر واقعی را در .env بگذارید
npm start
```

در اولین اجرا migration دیتابیس انجام می‌شود، به تلگرام وصل می‌شود و مانیتور وار شروع به کار می‌کند.

### پیش‌نیاز

1. توکن ربات از [@BotFather](https://t.me/BotFather)
2. آدرس PostgreSQL (مثلاً Neon)
3. توکن Clash API از [developer.clashofclans.com](https://developer.clashofclans.com)
4. تگ کلن و آیدی گروه تلگرام برای اعلان‌ها

ربات را به گروه اضافه کنید و اجازه ارسال پیام بدهید. برای کانال لاگ، ربات را ادمین کنید.

---

## متغیرهای محیطی

فایل `.env.example` را کپی کنید. مقادیر محرمانه را داخل گیت نگذارید.

**ضروری:** `BOT_TOKEN` · `DATABASE_URL` · `CLASH_API_TOKEN` · `OWNER_TELEGRAM_ID` · `CLAN_TAG`  
**پیشنهادی:** `TELEGRAM_GROUP_ID` · `LOG_TELEGRAM_ID` · `CLASH_API_BASE_URL`  

جزئیات کامل جدول‌ها در بخش انگلیسی همین فایل آمده است.

---

## لایسنس

MIT
