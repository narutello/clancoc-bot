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
const { checkCommandLimit } = require('../utils/commandRateLimit');

function sortMembers(list) {
  return (list || [])
    .slice()
    .sort((a, b) => (a.mapPosition || 0) - (b.mapPosition || 0));
}

function memberLine(m, index, atkPer) {
  const attacks = m.attacks || [];
  const stars = attacks.reduce((s, a) => s + (a.stars || 0), 0);
  const th = m.townhallLevel ?? m.townHallLevel ?? '—';
  const name = escapeHtml(m.name || '—');
  return (
    `<div class="row">` +
    `<span class="idx">${index + 1}</span>` +
    `<span class="name">${name}</span>` +
    `<span class="meta">TH${th}</span>` +
    `<span class="meta">${attacks.length}/${atkPer}</span>` +
    `<span class="stars">${stars}⭐</span>` +
    `</div>`
  );
}

function buildWidgetHtml(resolved) {
  const { war, isCwl, cwlDay, cwlTotalDays } = resolved;
  const our = war.clan || {};
  const opp = war.opponent || {};
  const maxRows = 8;
  const ourAll = sortMembers(our.members || []);
  const oppAll = sortMembers(opp.members || []);
  const ourMembers = ourAll.slice(0, maxRows);
  const oppMembers = oppAll.slice(0, maxRows);
  const teamSize = war.teamSize || ourAll.length || 0;
  const atkPer = getAttacksPerMember(war, Boolean(isCwl));

  const ourName = escapeHtml(stripEmojis(our.name || '—') || '—');
  const oppName = escapeHtml(stripEmojis(opp.name || '—') || '—');
  const ourStars = our.stars ?? 0;
  const oppStars = opp.stars ?? 0;
  const ourDest = Number(our.destructionPercentage ?? 0).toFixed(1);
  const oppDest = Number(opp.destructionPercentage ?? 0).toFixed(1);

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

  const statusMap = {
    preparation: 'آماده‌سازی',
    inWar: 'در حال جنگ',
    warEnded: 'پایان یافته',
  };
  const status =
    statusMap[war.state] || escapeHtml(warStateLabel(war.state));

  const diff = ourStars - oppStars;
  const diffText =
    diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '0';

  let sub = `${ourName} vs ${oppName}`;
  if (isCwl && cwlDay) {
    sub += ` · CWL ${cwlDay}${cwlTotalDays ? '/' + cwlTotalDays : ''}`;
  }
  if (timeLine) sub += ` · ${timeLine}`;

  const ourRows = ourMembers
    .map((m, i) => memberLine(m, i, atkPer))
    .join('');
  const oppRows = oppMembers
    .map((m, i) => memberLine(m, i, atkPer))
    .join('');

  const ourMore =
    ourAll.length > maxRows
      ? `<p class="hint">+${ourAll.length - maxRows} عضو دیگر</p>`
      : '';
  const oppMore =
    oppAll.length > maxRows
      ? `<p class="hint">+${oppAll.length - maxRows} عضو دیگر</p>`
      : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8"/>
<style>
body{margin:0;padding:10px 12px 18px;font-size:14px;line-height:1.35}
.hd{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
h3{margin:0;font-size:16px}
.badge{font-size:12px;color:var(--tg-theme-accent-text-color,#70dfa0)}
.sub{margin:0 0 10px;font-size:12px;color:var(--tg-theme-hint-color,#9db2bd)}
.teams{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.card{background:var(--tg-theme-secondary-bg-color,#243640);border-radius:10px;padding:8px 10px}
.card .lbl{font-size:11px;color:var(--tg-theme-hint-color,#9db2bd)}
.card .sc{font-size:20px;font-weight:700;margin:4px 0;color:var(--tg-theme-accent-text-color,#70dfa0)}
.card.en .sc{color:var(--tg-theme-text-color,#edf4f5)}
.diff{font-size:12px;margin:0 0 10px;color:var(--tg-theme-hint-color,#9db2bd)}
.tabs{display:flex;gap:6px;margin-bottom:8px}
button{flex:1;padding:8px 4px;font-size:13px}
button.on{outline:2px solid var(--tg-theme-button-color,#55ce8a)}
.list .row{display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--tg-theme-section-separator-color,#344650)}
.list .row:last-child{border-bottom:0}
.idx{width:18px;font-size:12px;color:var(--tg-theme-hint-color,#9db2bd);flex:0 0 auto}
.name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.meta{font-size:11px;color:var(--tg-theme-hint-color,#9db2bd);flex:0 0 auto}
.stars{font-size:12px;flex:0 0 auto}
.hint{margin:6px 0 0;font-size:11px;color:var(--tg-theme-hint-color,#9db2bd)}
.hid{display:none}
</style>
</head>
<body>
<div class="hd">
  <h3>⚔️ Clan War</h3>
  <span class="badge">${status}</span>
</div>
<p class="sub">${sub}</p>
<div class="teams">
  <div class="card">
    <div class="lbl">کلن شما</div>
    <div class="sc">${ourStars} ⭐</div>
    <div class="lbl">${ourDest}% · ${teamSize}v${teamSize}</div>
  </div>
  <div class="card en">
    <div class="lbl">حریف</div>
    <div class="sc">${oppStars} ⭐</div>
    <div class="lbl">${oppDest}%</div>
  </div>
</div>
<p class="diff">اختلاف ستاره: <b>${diffText}</b></p>
<div class="tabs">
  <button type="button" class="on" data-t="m">بازیکنان</button>
  <button type="button" data-t="e">حریف</button>
</div>
<div id="m" class="list">${ourRows || '<p class="hint">عضوی نیست</p>'}${ourMore}</div>
<div id="e" class="list hid">${oppRows || '<p class="hint">اطلاعات حریف نیست</p>'}${oppMore}</div>
<script>
(function(){
  var tabs=document.querySelectorAll('button[data-t]');
  var m=document.getElementById('m');
  var e=document.getElementById('e');
  for(var i=0;i<tabs.length;i++){
    tabs[i].onclick=function(){
      for(var j=0;j<tabs.length;j++) tabs[j].classList.remove('on');
      this.classList.add('on');
      var t=this.getAttribute('data-t');
      m.className=t==='m'?'list':'list hid';
      e.className=t==='e'?'list':'list hid';
    };
  }
  if(window.TelegramWidget&&typeof TelegramWidget.ready==='function'){
    TelegramWidget.ready();
  }
})();
</script>
</body>
</html>`;
}

function assertWidgetSize(html) {
  const compressed = zlib.deflateSync(Buffer.from(html, 'utf8'), {
    level: 9,
  });
  return {
    raw: Buffer.byteLength(html, 'utf8'),
    compressed: compressed.length,
    ok: compressed.length <= 4096 && Buffer.byteLength(html, 'utf8') <= 32768,
  };
}

module.exports = async function testwCommand(ctx) {
  try {
    const userId = ctx.from?.id;
    const isOwner =
      userId != null && Number(userId) === Number(config.ownerTelegramId);
    const limit = checkCommandLimit(userId, 'testw', {
      limit: config.warCmdLimit,
      windowMs: config.warCmdWindowMs,
      isOwner,
    });
    if (!limit.allowed) {
      return ctx.reply(
        `⏳ تعداد درخواست زیاد است. حدود <b>${limit.retryAfterSec}</b> ثانیه دیگر دوباره بزن.`,
        { parse_mode: 'HTML' }
      );
    }

    let resolved = await resolveRegularWar();
    if (!resolved || !resolved.war) {
      resolved = await resolveCwlWar();
    }

    if (!resolved || !resolved.war) {
      return ctx.reply('در حال حاضر کلن در وار / CWL نیست.');
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
          caption: '⚔️ وضعیت وار (Widget)',
        }),
      { maxRetries: config.telegramMaxRetries }
    );
  } catch (err) {
    console.error('[/testw]', err.message);
    const desc = String(err.description || err.message || err);
    const lower = desc.toLowerCase();

    // Production often still blocks widgets outside private chats
    if (
      lower.includes('private') ||
      lower.includes('chat_id') ||
      lower.includes('forbidden') ||
      lower.includes('not available') ||
      lower.includes('group')
    ) {
      return ctx.reply(
        '⚠️ تلگرام فعلاً ویجت را در این نوع چت پشتیبانی نمی‌کند.\n' +
          'در چت خصوصی با ربات /testw را بزن، یا از /war استفاده کن.'
      );
    }

    return ctx.reply(
      `❌ ارسال ویجت ناموفق بود:\n<code>${escapeHtml(desc)}</code>`,
      { parse_mode: 'HTML' }
    );
  }
};
