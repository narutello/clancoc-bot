const { Telegraf } = require('telegraf');
const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');
const { upsertTelegramUser } = require('../services/linkService');

const startCommand = require('../commands/start');
const helpCommand = require('../commands/help');
const linkCommand = require('../commands/link');
const unlinkCommand = require('../commands/unlink');
const unlinkAllCommand = require('../commands/unlinkall');
const myAccountsCommand = require('../commands/myaccounts');
const warCommand = require('../commands/war');
const { warEnemyAction, warHomeAction } = warCommand;
const cwlCommand = require('../commands/cwl');
const { cwlEnemyAction, cwlHomeAction } = cwlCommand;
const clanCommand = require('../commands/clan');
const statusCommand = require('../commands/status');
const testNotifyCommand = require('../commands/testnotify');
const testLogCommand = require('../commands/testlog');

function createBot() {
  const bot = new Telegraf(config.botToken);

  // هر تعامل (دستور، دکمه، استارت) → ذخیره/به‌روزرسانی پروفایل تلگرام
  bot.use(async (ctx, next) => {
    const user = ctx.from;
    if (user && user.id) {
      upsertTelegramUser(user).catch((err) => {
        console.warn('[Bot] upsertTelegramUser failed:', err.message);
      });
    }
    return next();
  });

  bot.start(startCommand);
  bot.help(helpCommand);

  bot.command('link', linkCommand);
  bot.command('unlink', unlinkCommand);
  bot.command('unlinkall', unlinkAllCommand);
  bot.command('myaccounts', myAccountsCommand);
  bot.command('war', warCommand);
  bot.action('war:enemy', warEnemyAction);
  bot.action('war:home', warHomeAction);
  bot.command('cwl', cwlCommand);
  bot.action('cwl:enemy', cwlEnemyAction);
  bot.action('cwl:home', cwlHomeAction);
  bot.command('clan', clanCommand);
  bot.command('status', statusCommand);
  bot.command('testnotify', testNotifyCommand);
  bot.command('testlog', testLogCommand);

  bot.catch(async (err, ctx) => {
    console.error(`[Bot] Error for ${ctx.updateType}:`, err.message);
    await tgLog.error(
      `Bot error (${ctx.updateType})`,
      err.stack || err.message,
      {
        module: 'Bot',
        context: {
          updateType: ctx.updateType,
          chatId: ctx.chat?.id,
          userId: ctx.from?.id,
        },
      }
    );
    try {
      await ctx.reply('⚠️ خطایی رخ داد. لطفاً بعداً دوباره تلاش کنید.');
    } catch (_) {}
  });

  return bot;
}

module.exports = { createBot };
