function normalizeTag(tag) {
  if (!tag) return null;
  return String(tag).replace(/^#/, '').toUpperCase().replace(/O/g, '0');
}

function isValidTag(tag) {
  const t = normalizeTag(tag);
  return t && /^[0289PYLQGRJCUV]{3,15}$/.test(t);
}

function formatTag(tag) {
  const t = normalizeTag(tag);
  return t ? `#${t}` : '';
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

function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}س ${m}د`;
  return `${m} دقیقه`;
}

function parseClashTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso);
  } catch {
    return null;
  }
}

function warStateLabel(state) {
  const map = {
    notInWar: 'خارج از وار',
    preparation: 'آماده‌سازی',
    inWar: 'در حال نبرد',
    warEnded: 'پایان یافته',
  };
  return map[state] || state || 'نامشخص';
}

function resultLabel(result) {
  if (result === 'win') return '🏆 برد';
  if (result === 'lose') return '❌ باخت';
  if (result === 'tie') return '🤝 مساوی';
  return result || '—';
}

module.exports = {
  normalizeTag,
  isValidTag,
  formatTag,
  escapeHtml,
  tgUserLink,
  formatDuration,
  parseClashTime,
  warStateLabel,
  resultLabel,
};
