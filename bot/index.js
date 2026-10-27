const { Telegraf } = require('telegraf');
const config = require('../config');

const startCommand = require('../commands/start');
const helpCommand = require('../commands/help');
const linkCommand = require('../commands/link');
const unlinkCommand = require('../commands/unlink');
const unlinkAllCommand = require('../commands/unlinkall');
const myAccountsCommand = require('../commands/myaccounts');
const warCommand = require('../commands/war');
const clanCommand = require('../commands/clan');

function createBot() {
  const bot = new Telegraf(config.botToken);

  bot.start(startCommand);
  bot.help(helpCommand);

  bot.command('link', linkCommand);
  bot.command('unlink', unlinkCommand);
  bot.command('unlinkall', unlinkAllCommand);
  bot.command('myaccounts', myAccountsCommand);
  bot.command('war', warCommand);
  bot.command('clan', clanCommand);

  bot.catch((err, ctx) => {
    console.error(`[Bot] Error for ${ctx.updateType}:`, err.message);
    try {
      ctx.reply('⚠️ خطایی رخ داد. لطفاً بعداً دوباره تلاش کنید.');
    } catch (_) {}
  });

  return bot;
}

module.exports = { createBot };
