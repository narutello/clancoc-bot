const config = require('../config');

/** @type {import('telegraf').Telegraf | null} */
let botInstance = null;

const recent = [];
const MAX_PER_WINDOW = 25;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_LEN = 3500;

function setBot(bot) {
  botInstance = bot;
}

function canSend() {
  const now = Date.now();
  while (recent.length && now - recent[0] > WINDOW_MS) {
    recent.shift();
  }
  if (recent.length >= MAX_PER_WINDOW) return false;
  recent.push(now);
  return true;
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
  const time = new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
  let body = `${icon} <b>[${level.toUpperCase()}]</b> ${escapeHtml(message)}`;
  body += `\n🕐 ${escapeHtml(time)}`;
  if (extra) {
    const extraStr =
      typeof extra === 'string' ? extra : JSON.stringify(extra, null, 0);
    body += `\n<code>${escapeHtml(extraStr).slice(0, 1500)}</code>`;
  }
  if (body.length > MAX_LEN) {
    body = body.slice(0, MAX_LEN) + '…';
  }
  return body;
}

async function sendToLogChat(text) {
  if (!config.logTelegramId || !botInstance) return;
  if (!canSend()) {
    console.warn('[TGLogger] rate limit — skipped telegram log');
    return;
  }
  try {
    await botInstance.telegram.sendMessage(config.logTelegramId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('[TGLogger] failed to send:', err.message);
  }
}

async function log(level, message, extra) {
  const line = `[${level.toUpperCase()}] ${message}${
    extra ? ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''
  }`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (level === 'error' || level === 'warn' || level === 'info') {
    await sendToLogChat(formatMessage(level, message, extra));
  }
}

const tgLog = {
  setBot,
  error: (msg, extra) => log('error', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
};

module.exports = { tgLog, setBot };
