const config = require('../config');
const { withTelegramRetry } = require('./telegramSafe');

/** @type {import('telegraf').Telegraf | null} */
let botInstance = null;

const recent = [];
const MAX_PER_WINDOW = Number(process.env.LOG_TG_MAX_PER_WINDOW) || 40;
const WINDOW_MS = Number(process.env.LOG_TG_WINDOW_MS) || 5 * 60 * 1000;
const MAX_LEN = 3900;

const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
const consoleMin = (process.env.LOG_LEVEL || 'debug').toLowerCase();
const tgMin = (process.env.LOG_TG_MIN_LEVEL || 'info').toLowerCase();

function levelAllowed(level, minName) {
  const a = LEVEL_ORDER[level] ?? 20;
  const b = LEVEL_ORDER[minName] ?? 20;
  return a >= b;
}

function setBot(bot) {
  botInstance = bot;
  console.log(
    `[logger] bot attached | channel=${config.logTelegramId || 'not set'}`
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

function nowStamp() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function iconFor(level) {
  switch (level) {
    case 'error':
      return '🔴';
    case 'warn':
      return '🟡';
    case 'info':
      return '🔵';
    case 'debug':
      return '⚪';
    default:
      return '⚪';
  }
}

function stringifyExtra(extra) {
  if (extra === undefined || extra === null || extra === '') return null;
  if (typeof extra === 'string') return extra;
  if (extra instanceof Error) {
    return `${extra.message}${extra.stack ? `\n${extra.stack}` : ''}`;
  }
  try {
    return JSON.stringify(extra, null, 2);
  } catch {
    return String(extra);
  }
}

function formatTelegram(level, message, extra, meta = {}) {
  const icon = iconFor(level);
  const mod = meta.module ? ` · ${meta.module}` : '';
  const lines = [
    `${icon}  ${level.toUpperCase()}${mod}`,
    `🕒 ${nowStamp()} (Tehran)`,
    '',
    String(message || ''),
  ];

  const extraStr = stringifyExtra(extra);
  if (extraStr) {
    lines.push('');
    lines.push('── detail ──');
    lines.push(extraStr.slice(0, 2800));
  }

  if (meta.context && typeof meta.context === 'object') {
    lines.push('');
    lines.push('── context ──');
    try {
      lines.push(JSON.stringify(meta.context, null, 2).slice(0, 800));
    } catch {
      lines.push(String(meta.context));
    }
  }

  let body = lines.join('\n');
  if (body.length > MAX_LEN) body = `${body.slice(0, MAX_LEN)}…`;
  return body;
}

function formatConsole(level, message, extra, meta = {}) {
  const mod = meta.module ? `[${meta.module}] ` : '';
  const base = `[${level.toUpperCase()}] ${mod}${message}`;
  const extraStr = stringifyExtra(extra);
  if (!extraStr) return base;
  if (extraStr.includes('\n')) return `${base}\n${extraStr}`;
  return `${base} | ${extraStr}`;
}

async function sendViaHttpApi(chatId, text) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 4096),
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
    if (!silent) console.warn('[logger] skip TG: LOG_TELEGRAM_ID not set');
    return false;
  }
  if (!canSend()) {
    console.warn('[logger] skip TG: rate limit reached');
    return false;
  }

  if (botInstance && botInstance.telegram) {
    try {
      await withTelegramRetry(
        () =>
          botInstance.telegram.sendMessage(chatId, String(text).slice(0, 4096), {
            disable_web_page_preview: true,
          }),
        { maxRetries: config.telegramMaxRetries || 3 }
      );
      markSent();
      return true;
    } catch (err) {
      console.error('[logger] telegraf send failed:', err.message);
    }
  }

  try {
    await sendViaHttpApi(chatId, text);
    markSent();
    return true;
  } catch (err) {
    console.error('[logger] HTTP API send failed:', err.message);
    return false;
  }
}

async function log(level, message, extra, meta = {}) {
  const msg = String(message ?? '');

  if (levelAllowed(level, consoleMin)) {
    const line = formatConsole(level, msg, extra, meta);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  const wantTg =
    meta.tg !== false &&
    levelAllowed(level, tgMin) &&
    (level === 'error' || level === 'warn' || level === 'info');

  if (wantTg) {
    await sendRaw(formatTelegram(level, msg, extra, meta), { silent: true });
  }
}

async function sendStartupBanner() {
  const chatId = getLogChatId();
  console.log(`[logger] startup banner → ${chatId || '(no channel)'}`);
  if (!chatId) {
    console.warn('[logger] LOG_TELEGRAM_ID not configured');
    return false;
  }

  const text = [
    '🤖  ClanCoC Bot — ONLINE',
    `🕒 ${nowStamp()} (Tehran)`,
    '',
    `Clan     #${config.clanTag}`,
    `Owner    ${config.ownerTelegramId}`,
    `Group    ${config.telegramGroupId || '-'}`,
    `Log      ${chatId}`,
    `Poll     ${config.warPollIntervalMs}ms`,
    `API      ${config.clashApiBaseUrl}`,
  ].join('\n');

  const ok = await sendRaw(text);
  console.log(`[logger] startup banner sent=${ok}`);
  return ok;
}

const tgLog = {
  setBot,
  sendStartupBanner,
  sendRaw,
  debug: (msg, extra, meta) => log('debug', msg, extra, meta),
  info: (msg, extra, meta) => log('info', msg, extra, meta),
  warn: (msg, extra, meta) => log('warn', msg, extra, meta),
  error: (msg, extra, meta) => log('error', msg, extra, meta),
  log,
};

module.exports = { tgLog, setBot: tgLog.setBot };
