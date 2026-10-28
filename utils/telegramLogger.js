const config = require('../config');

/** @type {import('telegraf').Telegraf | null} */
let botInstance = null;

const recent = [];
const MAX_PER_WINDOW = 30;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_LEN = 3500;

function setBot(bot) {
  botInstance = bot;
  console.log(
    `[TGLogger] bot attached; LOG_TELEGRAM_ID=${config.logTelegramId || '(not set)'}`
  );
}

function getLogChatId() {
  let id = config.logTelegramId;
  if (!id) return null;
  id = String(id).trim().replace(/^["']|["']$/g, '');
  return id || null;
}

function canSend() {
  const now = Date.now();
  while (recent.length && now - recent[0] > WINDOW_MS) {
    recent.shift();
  }
  if (recent.length >= MAX_PER_WINDOW) return false;
  return true;
}

function markSent() {
  recent.push(Date.now());
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMessage(level, message, extra) {
  const icon =
    level === 'error' ? '🔴' : level === 'warn' ? '🟡' : level === 'info' ? '🔵' : '⚪';
  const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tehran' });
  let body = `${icon} [${level.toUpperCase()}] ${escapeHtml(message)}`;
  body += `\n${escapeHtml(time)}`;
  if (extra !== undefined && extra !== null && extra !== '') {
    const extraStr =
      typeof extra === 'string' ? extra : JSON.stringify(extra);
    body += `\n${escapeHtml(extraStr).slice(0, 1500)}`;
  }
  if (body.length > MAX_LEN) {
    body = body.slice(0, MAX_LEN) + '...';
  }
  return body;
}

/**
 * ارسال مستقیم به کانال لاگ
 * @returns {Promise<boolean>}
 */
async function sendRaw(text, { silent = false } = {}) {
  const chatId = getLogChatId();
  if (!chatId) {
    if (!silent) {
      console.warn('[TGLogger] skip: LOG_TELEGRAM_ID is empty');
    }
    return false;
  }
  if (!botInstance || !botInstance.telegram) {
    if (!silent) {
      console.warn('[TGLogger] skip: bot instance not ready');
    }
    return false;
  }
  if (!canSend()) {
    console.warn('[TGLogger] skip: rate limit');
    return false;
  }

  try {
    await botInstance.telegram.sendMessage(chatId, text, {
      disable_web_page_preview: true,
    });
    markSent();
    return true;
  } catch (err) {
    console.error('[TGLogger] sendMessage failed:', err.message);
    try {
      const numericId = Number(chatId);
      await botInstance.telegram.sendMessage(
        Number.isNaN(numericId) ? chatId : numericId,
        String(text).slice(0, 4000),
        { disable_web_page_preview: true }
      );
      markSent();
      return true;
    } catch (err2) {
      console.error('[TGLogger] retry failed:', err2.message);
      return false;
    }
  }
}

async function log(level, message, extra) {
  const line = `[${level.toUpperCase()}] ${message}${
    extra !== undefined && extra !== null
      ? ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))
      : ''
  }`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (level === 'error' || level === 'warn' || level === 'info') {
    const text = formatMessage(level, message, extra);
    await sendRaw(text);
  }
}

/** پیام استارت صریح بعد از آنلاین شدن ربات */
async function sendStartupBanner() {
  const chatId = getLogChatId();
  console.log(`[TGLogger] sendStartupBanner chatId=${chatId || '(none)'}`);
  if (!chatId) {
    console.warn('[TGLogger] LOG_TELEGRAM_ID not configured — no startup log');
    return false;
  }

  const text =
    `🤖 ClanCoC Bot online\n` +
    `Clan: #${config.clanTag}\n` +
    `Group: ${config.telegramGroupId || '-'}\n` +
    `Log: ${chatId}\n` +
    `Poll: ${config.warPollIntervalMs}ms`;

  const ok = await sendRaw(text);
  console.log(`[TGLogger] startup banner sent=${ok}`);
  return ok;
}

const tgLog = {
  setBot,
  sendStartupBanner,
  sendRaw,
  error: (msg, extra) => log('error', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
};

module.exports = { tgLog, setBot };
