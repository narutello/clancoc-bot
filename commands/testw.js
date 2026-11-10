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

function memberStats(m, atkPer) {
  const attacks = m.attacks || [];
  const stars = attacks.reduce((s, a) => s + (a.stars || 0), 0);
  const defStars = m.bestOpponentAttack?.stars ?? 0;
  const th = m.townhallLevel ?? m.townHallLevel ?? '—';
  return {
    name: escapeHtml(m.name || '—'),
    attacks: attacks.length,
    atkPer,
    stars,
    defStars,
    th,
  };
}

function buildWidgetHtml(resolved) {
  const { war, isCwl, cwlDay, cwlTotalDays } = resolved;
  const our = war.clan || {};
  const opp = war.opponent || {};
  const ourMembers = sortMembers(our.members || []).slice(0, 15);
  const enemyMembers = sortMembers(opp.members || []).slice(0, 15);
  const teamSize = war.teamSize || ourMembers.length || 0;
  const atkPer = getAttacksPerMember(war, Boolean(isCwl));

  const ourName = escapeHtml(stripEmojis(our.name || '—') || '—');
  const oppName = escapeHtml(stripEmojis(opp.name || '—') || '—');
  const ourStars = our.stars ?? 0;
  const oppStars = opp.stars ?? 0;
  const ourDest = Number(our.destructionPercentage ?? 0);
  const oppDest = Number(opp.destructionPercentage ?? 0);
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

  const diff = ourStars - oppStars;
  const diffLabel =
    diff > 0 ? `+${diff} ستاره` : diff < 0 ? `${diff} ستاره` : 'مساوی';
  const diffColor = diff > 0 ? '#70dfa0' : diff < 0 ? '#ff8a80' : '#9db2bd';

  // progress: relative share of stars (visual only)
  const totalStars = Math.max(ourStars + oppStars, 1);
  const barPct = Math.max(8, Math.min(92, Math.round((ourStars / totalStars) * 100)));

  const statusLabel =
    war.state === 'inWar'
      ? '● در حال جنگ'
      : war.state === 'preparation'
        ? '● آماده‌سازی'
        : war.state === 'warEnded'
          ? '● پایان یافته'
          : `● ${state}`;

  const subtitleParts = [`${ourName} vs ${oppName}`];
  if (isCwl && cwlDay) {
    subtitleParts.push(
      `CWL روز ${cwlDay}${cwlTotalDays ? '/' + cwlTotalDays : ''}`
    );
  }
  if (timeLine) subtitleParts.push(timeLine);
  const subtitle = subtitleParts.join(' · ');

  const ourRows = ourMembers
    .map((m, i) => {
      const s = memberStats(m, atkPer);
      return `<div class="player"><div class="pi"><div class="av">${i + 1}</div><div><div class="nm">${s.name}</div><div class="tg">TH${s.th}</div></div></div><div class="st"><div>${s.attacks}/${s.atkPer}</div><div class="ss">${s.stars}⭐</div></div></div>`;
    })
    .join('');

  const enemyRows = enemyMembers
    .map((m, i) => {
      const s = memberStats(m, atkPer);
      return `<div class="player"><div class="pi"><div class="av e">${i + 1}</div><div><div class="nm">${s.name}</div><div class="tg">TH${s.th}</div></div></div><div class="st"><div>${s.attacks}/${s.atkPer}</div><div class="ss">${s.stars}⭐</div></div></div>`;
    })
    .join('');

  const ourMore =
    (our.members || []).length > ourMembers.length
      ? `<div class="more">+${(our.members || []).length - ourMembers.length} عضو دیگر</div>`
      : '';
  const enemyMore =
    (opp.members || []).length > enemyMembers.length
      ? `<div class="more">+${(opp.members || []).length - enemyMembers.length} عضو دیگر</div>`
      : '';

  // Scrollable dashboard; keep CSS/JS minimal for 4KB zlib limit
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
html,body{height:100%;margin:0}
body{background:#101a22;color:#edf4f5;font:13px/1.35 Arial,sans-serif;overflow:hidden}
.scroll{height:100%;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.wrap{max-width:650px;margin:0 auto;padding:10px}
.dash{background:#182630;border:1px solid #30434e;border-radius:16px;overflow:hidden}
.hd{background:#172d3a;padding:14px}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px}
h2{margin:0;font-size:16px}
.badge{background:#194d39;color:#75e6a4;padding:5px 10px;border-radius:16px;font-size:11px;white-space:nowrap}
.sub{color:#9db2bd;font-size:11px;margin:10px 0 12px}
.teams{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.team{background:#25483f;border-radius:12px;padding:10px}
.team.en{background:#34404b}
.team small{color:#c3d8ce;font-size:11px}
.score{font-size:24px;font-weight:700;margin:6px 0;color:#70dfa0}
.team.en .score{color:#fff}
.plab{display:flex;justify-content:space-between;margin-top:12px;font-size:11px;color:#d3e2e8}
.bar{height:6px;background:#40535c;border-radius:8px;overflow:hidden;margin-top:6px}
.bar>i{display:block;height:100%;background:#55ce8a;width:${barPct}%}
.ct{padding:12px}
.tabs{display:flex;gap:6px;margin-bottom:12px}
.tab{flex:1;border:0;border-radius:10px;padding:10px 4px;background:#293943;color:#c0d0d8;font-size:12px}
.tab.on{background:#244d3c;color:#70dfa0;font-weight:700}
.sec{font-size:13px;font-weight:700;margin:0 0 10px}
.player{display:flex;justify-content:space-between;align-items:center;gap:8px;background:#243640;border-radius:10px;padding:10px;margin-bottom:6px}
.pi{display:flex;align-items:center;gap:8px;min-width:0}
.av{width:28px;height:28px;border-radius:50%;background:#526e85;display:grid;place-items:center;font-size:11px;font-weight:700;flex:0 0 auto}
.av.e{background:#6b5b6b}
.nm{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
.tg{font-size:10px;color:#9db1bd;margin-top:2px}
.st{text-align:left;font-size:11px;flex:0 0 auto}
.ss{color:#70dfa0;margin-top:2px}
.more,.ft{text-align:center;color:#7e99a5;font-size:10px;padding:6px 0}
.ft{border-top:1px solid #344650;padding:10px}
.hid{display:none}
</style></head><body>
<div class="scroll"><div class="wrap"><div class="dash">
<div class="hd">
 <div class="top"><h2>⚔️ CLAN WAR</h2><span class="badge">${statusLabel}</span></div>
 <div class="sub">${subtitle}</div>
 <div class="teams">
  <div class="team"><small>کلن شما</small><div class="score">${ourStars} ⭐</div><small>${ourDest.toFixed(1)}% تخریب</small></div>
  <div class="team en"><small>حریف</small><div class="score">${oppStars} ⭐</div><small>${oppDest.toFixed(1)}% تخریب</small></div>
 </div>
 <div class="plab"><span>${teamSize}v${teamSize}</span><b style="color:${diffColor}">${diffLabel}</b></div>
 <div class="bar"><i></i></div>
</div>
<div class="ct">
 <div class="tabs">
  <button class="tab on" type="button" data-t="m">بازیکنان</button>
  <button class="tab" type="button" data-t="e">حریف</button>
 </div>
 <div id="m">
  <div class="sec">اعضای وار</div>
  ${ourRows || '<div class="more">عضوی نیست</div>'}
  ${ourMore}
 </div>
 <div id="e" class="hid">
  <div class="sec">تیم حریف</div>
  ${enemyRows || '<div class="more">اطلاعات حریف نیست</div>'}
  ${enemyMore}
 </div>
</div>
<div class="ft">CLAN WAR WIDGET · TEST</div>
</div></div></div>
<script>
document.querySelectorAll('.tab').forEach(function(b){
 b.onclick=function(){
  document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');
  var t=b.getAttribute('data-t');
  document.getElementById('m').classList.toggle('hid',t!=='m');
  document.getElementById('e').classList.toggle('hid',t!=='e');
 };
});
</script>
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
      return ctx.reply(
        'در حال حاضر کلن در وار / CWL نیست — برای تست ویجت چیزی برای نمایش نیست.'
      );
    }

    const html = buildWidgetHtml(resolved);
    const size = assertWidgetSize(html);
    if (!size.ok) {
      return ctx.reply(
        `❌ HTML ویجت از حد مجاز بزرگ‌تر است (raw=${size.raw}, zlib=${size.compressed}).`
      );
    }

    // Fixed taller viewport so inner .scroll can move
    await withTelegramRetry(
      () =>
        ctx.telegram.callApi('sendWidget', {
          chat_id: ctx.chat.id,
          html,
          height: 560,
          caption: '🧪 تست Widget — داشبورد وار',
        }),
      { maxRetries: config.telegramMaxRetries }
    );

    await ctx.reply(
      `✅ ویجت داشبورد ارسال شد.\n` +
        `اندازه: raw ${size.raw}B · zlib ${size.compressed}B / 4096\n` +
        `داخل ویجت باید اسکرول شود.`
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
