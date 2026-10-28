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
  return recent.length < MAX_PER_WINDOW;
}

function markSent() {
  recent.push(Date.now());
}

function escapeText(text) {
  return String(text ?? '');
}

function formatMessage(level, message, extra) {
  const icon =
    level === 'error' ? '🔴' : level === 'warn' ? '🟡' : level === 'info' ? '🔵' : '⚪';
  const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tehran' });
  let body = `${icon} [${level.toUpperCase()}] ${escapeText(message)}`;
  body += `\n${time}`;
  if (extra !== undefined && extra !== null && extra !== '') {
    const extraStr =
      typeof extra === 'string' ? extra : JSON.stringify(extra);
    body += `\n${String(extraStr).slice(0, 1500)}`;
  }
  if (body.length > MAX_LEN) body = body.slice(0, MAX_LEN) + '...';
  return body;
}

async function sendViaHttpApi(chatId, text) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 4000),
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const msg = data.description || res.statusText || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return true;
}

async function sendRaw(text, { silent = false } = {}) {
  const chatId = getLogChatId();
  if (!chatId) {
    if (!silent) console.warn('[TGLogger] skip: LOG_TELEGRAM_ID is empty');
    return false;
  }
  if (!canSend()) {
    console.warn('[TGLogger] skip: rate limit');
    return false;
  }

  if (botInstance && botInstance.telegram) {
    try {
      await botInstance.telegram.sendMessage(chatId, String(text).slice(0, 4000), {
        disable_web_page_preview: true,
      });
      markSent();
      return true;
    } catch (err) {
      console.error('[TGLogger] telegraf send failed:', err.message);
    }
  }

  try {
    await sendViaHttpApi(chatId, text);
    markSent();
    console.log('[TGLogger] sent via HTTP API fallback');
    return true;
  } catch (err) {
    console.error('[TGLogger] HTTP API send failed:', err.message);
    return false;
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
    await sendRaw(formatMessage(level, message, extra));
  }
}

async function sendStartupBanner() {
  const chatId = getLogChatId();
  console.log(`[TGLogger] sendStartupBanner chatId=${chatId || '(none)'}`);
  if (!chatId) {
    console.warn('[TGLogger] LOG_TELEGRAM_ID not configured');
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
