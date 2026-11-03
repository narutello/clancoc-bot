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

function formatWarTime(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;

  const options = {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };

  const timeStr = date.toLocaleTimeString('fa-IR', options);

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
    return `امروز ساعت ${timeStr}`;
  }
  if (isSameDay(dateTehran, tomorrowTehran)) {
    return `فردا ساعت ${timeStr}`;
  }

  const weekday = date.toLocaleDateString('fa-IR', {
    timeZone: 'Asia/Tehran',
    weekday: 'long',
  });
  return `${weekday} ساعت ${timeStr}`;
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

/** تعداد حمله مجاز هر بازیکن: CWL=1 ، وار معمولی=2 */
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
