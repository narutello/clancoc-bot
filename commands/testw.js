const zlib = require('zlib');
const config = require('../config');
const { resolveRegularWar } = require('./war');
const { resolveCwlWar } = require('./cwl');
const {
  escapeHtml,
  stripEmojis,
  warStateLabel,
  parseClashTime,
  formatWarTime,
  getAttacksPerMember,
} = require('../utils/helpers');
const { withTelegramRetry } = require('../utils/telegramSafe');

function sortMembers(list) {
  return (list || [])
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0));
}

function buildWidgetHtml(resolved) {
  const { war, isCwl, cwlDay, cwlTotalDays } = resolved;
  const our = war.clan || {};
  const opp = war.opponent || {};
  const members = sortMembers(our.members || []).slice(0, 12);
  const teamSize = war.teamSize || members.length || 0;
  const atkPer = getAttacksPerMember(war, Boolean(isCwl));
  const ourName = escapeHtml(stripEmojis(our.name || '—') || '—');
  const oppName = escapeHtml(stripEmojis(opp.name || '—') || '—');
  const state = escapeHtml(warStateLabel(war.state));

  let timeLine = '';
  if (war.state === 'preparation') {
    const start =
      parseClashTime(war.startTime) || parseClashTime(war.preparationStartTime);
    const f = formatWarTime(start);
    if (f) timeLine = escapeHtml(f);
  } else if (war.state === 'inWar') {
    const end = parseClashTime(war.endTime);
    const f = formatWarTime(end);
    if (f) timeLine = escapeHtml(f);
  }

  const dayLine =
    isCwl && cwlDay
      ? `<div class="muted">CWL · روز ${cwlDay}${cwlTotalDays ? ' / ' + cwlTotalDays : ''}</div>`
      : '';

  const rows = members
    .map((m, i) => {
      const attacks = m.attacks || [];
      const stars = attacks.reduce((s, a) => s + (a.stars || 0), 0);
      const defStars = m.bestOpponentAttack?.stars ?? 0;
      const th = m.townhallLevel ?? m.townHallLevel ?? '—';
      const name = escapeHtml(m.name || '—');
      return `<tr><td>${i + 1}</td><td>${name}</td><td>${th}</td><td>${attacks.length}/${atkPer}</td><td>${stars}</td><td>${defStars}</td></tr>`;
    })
    .join('');

  const more =
    (our.members || []).length > members.length
      ? `<div class="muted">+${(our.members || []).length - members.length} عضو دیگر…</div>`
      : '';

  // Compact self-contained widget (must stay small after zlib)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
*{box-sizing:border-box}
body{margin:0;padding:10px;font:13px/1.35 system-ui,-apple-system,sans-serif;background:#111;color:#eee;direction:rtl}
h1{margin:0 0 6px;font-size:15px}
.card{background:#1c1c1e;border-radius:10px;padding:8px 10px;margin-bottom:8px}
.row{display:flex;justify-content:space-between;gap:8px;padding:3px 0}
.muted{color:#9a9a9a;font-size:11px}
.stars{color:#ffd60a;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:4px 3px;text-align:right;border-bottom:1px solid #2a2a2a}
th{color:#8ab4f8;font-weight:600}
.badge{display:inline-block;background:#2c2c2e;border-radius:6px;padding:2px 6px;font-size:11px}
</style></head><body>
<h1>⚔️ وضعیت وار <span class="badge">Widget Test</span></h1>
${dayLine}
<div class="card">
  <div class="row"><span>🏰 ${ourName}</span><span class="stars">${our.stars ?? 0} ⭐ · ${(our.destructionPercentage ?? 0).toFixed(1)}%</span></div>
  <div class="row"><span>⚡ ${oppName}</span><span class="stars">${opp.stars ?? 0} ⭐ · ${(opp.destructionPercentage ?? 0).toFixed(1)}%</span></div>
  <div class="muted" style="margin-top:4px">${teamSize}v${teamSize} · ${state}${timeLine ? ' · ' + timeLine : ''}</div>
</div>
<div class="card">
<table>
<thead><tr><th>#</th><th>بازیکن</th><th>TH</th><th>حمله</th><th>⭐</th><th>دفاع</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${more}
</div>
<div class="muted">پیش‌نمایش sendWidget · فقط تست</div>
</body></html>`;
}

function assertWidgetSize(html) {
  const compressed = zlib.deflateSync(Buffer.from(html, 'utf8'), {
    level: zlib.constants.Z_BEST_COMPRESSION,
  });
  return {
    raw: Buffer.byteLength(html, 'utf8'),
    compressed: compressed.length,
    ok: compressed.length <= 4096 && Buffer.byteLength(html, 'utf8') <= 32768,
  };
}

module.exports = async function testwCommand(ctx) {
  const fromId = ctx.from?.id;
  if (!fromId || String(fromId) !== String(config.ownerTelegramId)) {
    return ctx.reply('⛔ این دستور فقط برای اونر ربات است.');
  }

  const chatType = ctx.chat?.type;
  if (chatType && chatType !== 'private') {
    await ctx.reply(
      '⚠️ در production ویجت فعلاً فقط در چت خصوصی پشتیبانی می‌شود.\n' +
        'همین دستور را در PV ربات بزن.'
    );
  }

  try {
    let resolved = await resolveRegularWar();
    if (!resolved || !resolved.war) {
      resolved = await resolveCwlWar();
    }

    if (!resolved || !resolved.war) {
      return ctx.reply('در حال حاضر کلن در وار / CWL نیست — برای تست ویجت چیزی برای نمایش نیست.');
    }

    const html = buildWidgetHtml(resolved);
    const size = assertWidgetSize(html);
    if (!size.ok) {
      return ctx.reply(
        `❌ HTML ویجت از حد مجاز بزرگ‌تر است (raw=${size.raw}, zlib=${size.compressed}).`
      );
    }

    await withTelegramRetry(
      () =>
        ctx.telegram.callApi('sendWidget', {
          chat_id: ctx.chat.id,
          html,
          height: Math.min(600, 220 + Math.min(12, (resolved.war.clan?.members || []).length) * 22),
          caption: '🧪 تست Widget — وضعیت وار (Bot API 10.4)',
        }),
      { maxRetries: config.telegramMaxRetries }
    );

    await ctx.reply(
      `✅ ویجت ارسال شد.\n` +
        `اندازه: raw ${size.raw}B · zlib ${size.compressed}B / 4096`
    );
  } catch (err) {
    console.error('[/testw]', err.message);
    const desc = err.description || err.message || String(err);
    return ctx.reply(
      `❌ ارسال ویجت ناموفق بود:\n<code>${escapeHtml(desc)}</code>\n\n` +
        `اگر گفت فقط private: در PV ربات دوباره /testw بزن.\n` +
        `اگر method unknown: سرور تلگرام هنوز 10.4 را برای این بات فعال نکرده.`,
      { parse_mode: 'HTML' }
    );
  }
};
