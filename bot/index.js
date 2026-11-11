const { Telegraf } = require('telegraf');
const config = require('../config');
const { tgLog } = require('../utils/telegramLogger');
const { upsertTelegramUser } = require('../services/linkService');
const i18nContext = require('../middleware/i18nContext');
const { t } = require('../utils/i18n');

const startCommand = require('../commands/start');
const helpCommand = require('../commands/help');
const linkCommand = require('../commands/link');
const unlinkCommand = require('../commands/unlink');
const unlinkAllCommand = require('../commands/unlinkall');
const {
  unlinkAllConfirmAction,
  unlinkAllCancelAction,
} = unlinkAllCommand;
const myAccountsCommand = require('../commands/myaccounts');
const warCommand = require('../commands/war');
const { warEnemyAction, warHomeAction } = warCommand;
const cwlCommand = require('../commands/cwl');
const {
  cwlEnemyAction,
  cwlHomeAction,
  cwlStandingsAction,
} = cwlCommand;
const clanCommand = require('../commands/clan');
const statusCommand = require('../commands/status');
const testNotifyCommand = require('../commands/testnotify');
const testLogCommand = require('../commands/testlog');
const testwCommand = require('../commands/testw');
const settingCommand = require('../commands/setting');
const { settingAction } = settingCommand;

function createBot() {
  const bot = new Telegraf(config.botToken);

  bot.use(async (ctx, next) => {
    const user = ctx.from;
    if (user && user.id) {
      upsertTelegramUser(user).catch((err) => {
        console.warn('[Bot] upsertTelegramUser failed:', err.message);
      });
    }
    return next();
  });

  bot.use(i18nContext);

  bot.start(startCommand);
  bot.help(helpCommand);

  bot.command('setting', settingCommand);
  bot.command('settings', settingCommand);
  bot.action(/^set:(g|u):(home|lang)(?::[a-z]{2})?$/, settingAction);

  bot.command('link', linkCommand);
  bot.command('unlink', unlinkCommand);
  bot.command('unlinkall', unlinkAllCommand);
  bot.action(/^unlinkall:confirm:\d+$/, unlinkAllConfirmAction);
  bot.action(/^unlinkall:cancel:\d+$/, unlinkAllCancelAction);
  bot.command('myaccounts', myAccountsCommand);
  bot.command('war', warCommand);
  bot.action('war:enemy', warEnemyAction);
  bot.action('war:home', warHomeAction);
  bot.command('cwl', cwlCommand);
  bot.action('cwl:enemy', cwlEnemyAction);
  bot.action('cwl:home', cwlHomeAction);
  bot.action('cwl:standings', cwlStandingsAction);
  bot.command('clan', clanCommand);
  bot.command('status', statusCommand);
  bot.command('testnotify', testNotifyCommand);
  bot.command('testlog', testLogCommand);
  bot.command('testw', testwCommand);

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
      const lang = ctx.lang || 'fa';
      await ctx.reply(t('common.generic_error', { lng: lang }));
    } catch (_) {}
  });

  return bot;
}

module.exports = { createBot };
