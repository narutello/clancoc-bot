const { t, DEFAULT_LANG, normalizeLang } = require('./i18n');

function normalizeTag(tag) {
  if (!tag) return null;
  return String(tag).replace(/^#/, '').toUpperCase().replace(/O/g, '0');
}

function isValidTag(tag) {
  const x = normalizeTag(tag);
  return x && /^[0289PYLQGRJCUV]{3,15}$/.test(x);
}

function formatTag(tag) {
  const x = normalizeTag(tag);
  return x ? `#${x}` : '';
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tgUserLink(telegramId, displayName) {
  const name = escapeHtml(displayName || 'User');
  return `<a href="tg://user?id=${telegramId}">${name}</a>`;
}

function formatDuration(ms, lang = DEFAULT_LANG) {
  if (!ms || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const lng = normalizeLang(lang) || DEFAULT_LANG;
  if (lng === 'en') {
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  }
  if (h > 0) return `${h}س ${m}د`;
  return `${m} دقیقه`;
}

function parseClashTime(iso) {
  if (!iso) return null;
  try {
    let s = String(iso).trim();
    const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z?$/);
    if (m) {
      s = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function stripEmojis(text) {
  if (!text) return '';
  return String(text)
    .replace(
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{203C}-\u{3299}]/gu,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function formatWarTime(date, lang = DEFAULT_LANG) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;

  const lng = normalizeLang(lang) || DEFAULT_LANG;
  const locale = lng === 'en' ? 'en-GB' : 'fa-IR';

  const timeStr = date.toLocaleTimeString(locale, {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const dateTehran = new Date(
    date.toLocaleString('en-US', { timeZone: 'Asia/Tehran' })
  );
  const todayTehran = new Date(
    today.toLocaleString('en-US', { timeZone: 'Asia/Tehran' })
  );
  const tomorrowTehran = new Date(
    tomorrow.toLocaleString('en-US', { timeZone: 'Asia/Tehran' })
  );

  if (isSameDay(dateTehran, todayTehran)) {
    return t('time.today', { lng, time: timeStr });
  }
  if (isSameDay(dateTehran, tomorrowTehran)) {
    return t('time.tomorrow', { lng, time: timeStr });
  }

  const weekday = date.toLocaleDateString(locale, {
    timeZone: 'Asia/Tehran',
    weekday: 'long',
  });
  return t('time.weekday', { lng, weekday, time: timeStr });
}

function warStateLabel(state, lang = DEFAULT_LANG) {
  const lng = normalizeLang(lang) || DEFAULT_LANG;
  const key = `state.${state}`;
  const translated = t(key, { lng });
  if (translated === key) return t('state.unknown', { lng });
  return translated;
}

function resultLabel(result, lang = DEFAULT_LANG) {
  const lng = normalizeLang(lang) || DEFAULT_LANG;
  if (result === 'win') return t('result.win', { lng });
  if (result === 'lose') return t('result.lose', { lng });
  if (result === 'tie') return t('result.tie', { lng });
  return result || '—';
}

function getAttacksPerMember(war, isCwl = false) {
  if (isCwl) return 1;
  if (war && war.attacksPerMember != null && war.attacksPerMember > 0) {
    return Number(war.attacksPerMember);
  }
  return 2;
}

module.exports = {
  getAttacksPerMember,
  normalizeTag,
  isValidTag,
  formatTag,
  escapeHtml,
  tgUserLink,
  formatDuration,
  parseClashTime,
  stripEmojis,
  formatWarTime,
  warStateLabel,
  resultLabel,
};
