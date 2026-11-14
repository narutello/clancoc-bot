const config = require('../config');
const { t, languageLabel, SUPPORTED } = require('../utils/i18n');
const {
  getChatLanguage,
  setChatLanguage,
  getUserLanguage,
  setUserLanguage,
  ensureUserLanguage,
  resolveLangForCtx,
  getNotifySettings,
  toggleNotifySetting,
  NOTIFY_KEYS,
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

function onOff(enabled) {
  return enabled ? '✅' : '❌';
}

function homeKeyboard(lang, scope) {
  const rows = [
    [
      {
        text: t('settings.menu_language', { lng: lang }),
        callback_data: `set:${scope}:lang`,
      },
    ],
  ];
  if (scope === 'g') {
    rows.push([
      {
        text: t('settings.menu_notifications', { lng: lang }),
        callback_data: `set:g:notif`,
      },
    ]);
  }
  return { inline_keyboard: rows };
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

function notifMenuKeyboard(lang) {
  return {
    inline_keyboard: [
      [
        {
          text: t('settings.notif_war', { lng: lang }),
          callback_data: 'set:g:notif:war',
        },
      ],
      [
        {
          text: t('settings.notif_cwl', { lng: lang }),
          callback_data: 'set:g:notif:cwl',
        },
      ],
      [
        {
          text: t('common.back', { lng: lang }),
          callback_data: 'set:g:home',
        },
      ],
    ],
  };
}

function notifScopeKeyboard(lang, scope, settings) {
  const block = settings[scope] || {};
  const rows = NOTIFY_KEYS.map((key) => [
    {
      text: `${onOff(block[key])} ${t(`settings.notif_key_${key}`, { lng: lang })}`,
      callback_data: `set:g:notif:${scope}:${key}`,
    },
  ]);
  rows.push([
    {
      text: t('common.back', { lng: lang }),
      callback_data: 'set:g:notif',
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

function notifMenuText(lang) {
  return t('settings.notif_menu_title', { lng: lang });
}

function notifScopeText(lang, scope) {
  return scope === 'cwl'
    ? t('settings.notif_cwl_title', { lng: lang })
    : t('settings.notif_war_title', { lng: lang });
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
  // set : scope : section [: ...]
  const scope = parts[1];
  const section = parts[2];
  const arg3 = parts[3];
  const arg4 = parts[4];

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

      if (section === 'lang' && !arg3) {
        const lang = await getChatLanguage(ctx.chat.id);
        await ctx.answerCbQuery();
        return editPanel(ctx, langText(lang), langKeyboard(lang, 'g', lang));
      }

      if (section === 'lang' && arg3) {
        const lang = await setChatLanguage(ctx.chat.id, arg3);
        await ctx.answerCbQuery(
          t('settings.saved', {
            lng: lang,
            language: languageLabel(lang, lang),
          }).replace(/<[^>]+>/g, '')
        );
        return editPanel(ctx, homeText(lang, 'g', lang), homeKeyboard(lang, 'g'));
      }

      // Notifications menu
      if (section === 'notif' && !arg3) {
        const lang = await getChatLanguage(ctx.chat.id);
        await ctx.answerCbQuery();
        return editPanel(ctx, notifMenuText(lang), notifMenuKeyboard(lang));
      }

      // Scope list: war | cwl
      if (section === 'notif' && (arg3 === 'war' || arg3 === 'cwl') && !arg4) {
        const lang = await getChatLanguage(ctx.chat.id);
        const settings = await getNotifySettings(ctx.chat.id);
        await ctx.answerCbQuery();
        return editPanel(
          ctx,
          notifScopeText(lang, arg3),
          notifScopeKeyboard(lang, arg3, settings)
        );
      }

      // Toggle a key
      if (
        section === 'notif' &&
        (arg3 === 'war' || arg3 === 'cwl') &&
        NOTIFY_KEYS.includes(arg4)
      ) {
        const lang = await getChatLanguage(ctx.chat.id);
        const settings = await toggleNotifySetting(ctx.chat.id, arg3, arg4);
        const enabled = settings[arg3][arg4];
        await ctx.answerCbQuery(
          enabled
            ? t('settings.notif_enabled', { lng: lang })
            : t('settings.notif_disabled', { lng: lang })
        );
        return editPanel(
          ctx,
          notifScopeText(lang, arg3),
          notifScopeKeyboard(lang, arg3, settings)
        );
      }
    }

    if (scope === 'u') {
      if (!isPrivate(ctx)) {
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

      if (section === 'lang' && !arg3) {
        const lang =
          (await getUserLanguage(userId)) ||
          (await ensureUserLanguage(userId, ctx.from.language_code));
        await ctx.answerCbQuery();
        return editPanel(ctx, langText(lang), langKeyboard(lang, 'u', lang));
      }

      if (section === 'lang' && arg3) {
        const lang = await setUserLanguage(userId, arg3);
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
