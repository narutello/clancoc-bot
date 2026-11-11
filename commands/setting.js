const config = require('../config');
const { t, languageLabel, SUPPORTED, isRtl } = require('../utils/i18n');
const {
  getChatLanguage,
  setChatLanguage,
  getUserLanguage,
  setUserLanguage,
  ensureUserLanguage,
  resolveLangForCtx,
} = require('../services/settingsService');

function isOwner(userId) {
  return userId != null && Number(userId) === Number(config.ownerTelegramId);
}

async function isGroupAdmin(ctx) {
  const userId = ctx.from?.id;
  if (!userId || !ctx.chat?.id) return false;
  if (isOwner(userId)) return true;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return member.status === 'creator' || member.status === 'administrator';
  } catch {
    return false;
  }
}

function isPrivate(ctx) {
  return !ctx.chat?.type || ctx.chat.type === 'private';
}

function isGroup(ctx) {
  const tpe = ctx.chat?.type;
  return tpe === 'group' || tpe === 'supergroup';
}

function markCurrent(label, current, code) {
  return current === code ? `✅ ${label}` : label;
}

function homeKeyboard(lang, scope) {
  return {
    inline_keyboard: [
      [
        {
          text: t('settings.menu_language', { lng: lang }),
          callback_data: `set:${scope}:lang`,
        },
      ],
    ],
  };
}

function langKeyboard(lang, scope, current) {
  const rows = SUPPORTED.map((code) => [
    {
      text: markCurrent(languageLabel(code, lang), current, code),
      callback_data: `set:${scope}:lang:${code}`,
    },
  ]);
  rows.push([
    {
      text: t('common.back', { lng: lang }),
      callback_data: `set:${scope}:home`,
    },
  ]);
  return { inline_keyboard: rows };
}

function homeText(lang, scope, currentLang) {
  const title =
    scope === 'g'
      ? t('settings.title_group', { lng: lang })
      : t('settings.title_private', { lng: lang });
  const current = t('settings.current_language', {
    lng: lang,
    language: languageLabel(currentLang, lang),
  });
  return `${title}\n\n${current}`;
}

function langText(lang) {
  return t('settings.choose_language', { lng: lang });
}

async function replyPanel(ctx, text, keyboard) {
  return ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
    disable_web_page_preview: true,
  });
}

async function editPanel(ctx, text, keyboard) {
  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      disable_web_page_preview: true,
    });
  } catch (err) {
    // message not modified, etc.
    if (!String(err.message || '').includes('message is not modified')) {
      throw err;
    }
  }
}

module.exports = async function settingCommand(ctx) {
  try {
    if (isPrivate(ctx)) {
      const lang = await ensureUserLanguage(
        ctx.from.id,
        ctx.from.language_code
      );
      const text = homeText(lang, 'u', lang);
      return replyPanel(ctx, text, homeKeyboard(lang, 'u'));
    }

    if (isGroup(ctx)) {
      if (!(await isGroupAdmin(ctx))) {
        const lang = await resolveLangForCtx(ctx);
        return ctx.reply(t('settings.denied', { lng: lang }));
      }
      const lang = await getChatLanguage(ctx.chat.id);
      const text = homeText(lang, 'g', lang);
      return replyPanel(ctx, text, homeKeyboard(lang, 'g'));
    }

    return ctx.reply(t('settings.open_failed', { lng: 'fa' }));
  } catch (err) {
    console.error('[/setting]', err.message);
    return ctx.reply(t('common.generic_error', { lng: 'fa' }));
  }
};

async function settingAction(ctx) {
  const data = ctx.callbackQuery?.data || '';
  const parts = data.split(':');
  // set : scope : section [: code]
  const scope = parts[1];
  const section = parts[2];
  const code = parts[3];

  const userId = ctx.from?.id;

  try {
    if (scope === 'g') {
      if (!isGroup(ctx)) {
        await ctx.answerCbQuery();
        return;
      }
      if (!(await isGroupAdmin(ctx))) {
        const lang = await getChatLanguage(ctx.chat.id);
        await ctx.answerCbQuery(t('settings.denied', { lng: lang }), {
          show_alert: true,
        });
        return;
      }

      if (section === 'home') {
        const lang = await getChatLanguage(ctx.chat.id);
        await ctx.answerCbQuery();
        return editPanel(ctx, homeText(lang, 'g', lang), homeKeyboard(lang, 'g'));
      }

      if (section === 'lang' && !code) {
        const lang = await getChatLanguage(ctx.chat.id);
        await ctx.answerCbQuery();
        return editPanel(ctx, langText(lang), langKeyboard(lang, 'g', lang));
      }

      if (section === 'lang' && code) {
        const lang = await setChatLanguage(ctx.chat.id, code);
        await ctx.answerCbQuery(
          t('settings.saved', {
            lng: lang,
            language: languageLabel(lang, lang),
          }).replace(/<[^>]+>/g, '')
        );
        return editPanel(ctx, homeText(lang, 'g', lang), homeKeyboard(lang, 'g'));
      }
    }

    if (scope === 'u') {
      if (!isPrivate(ctx)) {
        // Ignore group presses on private-scoped buttons
        await ctx.answerCbQuery();
        return;
      }
      if (!userId) {
        await ctx.answerCbQuery();
        return;
      }

      if (section === 'home') {
        const lang =
          (await getUserLanguage(userId)) ||
          (await ensureUserLanguage(userId, ctx.from.language_code));
        await ctx.answerCbQuery();
        return editPanel(ctx, homeText(lang, 'u', lang), homeKeyboard(lang, 'u'));
      }

      if (section === 'lang' && !code) {
        const lang =
          (await getUserLanguage(userId)) ||
          (await ensureUserLanguage(userId, ctx.from.language_code));
        await ctx.answerCbQuery();
        return editPanel(ctx, langText(lang), langKeyboard(lang, 'u', lang));
      }

      if (section === 'lang' && code) {
        const lang = await setUserLanguage(userId, code);
        await ctx.answerCbQuery(
          t('settings.saved', {
            lng: lang,
            language: languageLabel(lang, lang),
          }).replace(/<[^>]+>/g, '')
        );
        return editPanel(ctx, homeText(lang, 'u', lang), homeKeyboard(lang, 'u'));
      }
    }

    await ctx.answerCbQuery();
  } catch (err) {
    console.error('[settingAction]', err.message);
    try {
      await ctx.answerCbQuery(t('common.generic_error', { lng: 'fa' }), {
        show_alert: true,
      });
    } catch (_) {}
  }
}

module.exports.settingAction = settingAction;
module.exports.isGroupAdmin = isGroupAdmin;
