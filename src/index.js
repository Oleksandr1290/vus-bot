// ВУС bot — entry point: routing, ad form, "My ads", ad moderation, cron.

import {
  tg, esc, now, fmtDate, t, DAY, AD_LIFETIME, LIMIT_PER_DAY, LIMIT_ACTIVE, MAX_PHOTOS, LINK_RE,
  ensureSchema, upsertUser, getUser, getSession, setSession, clearSession, getAd,
  isOwner, isStaffId, logAction,
  menuFor, navRow, pairs, send, sendHtml, showMenu, removeButtons, answer, whoName,
  sendPost, removeFromChannel, publishAd, postLink, adminCard, modButtons, sendAdminCard,
} from './common.js';
import { menuKeyOf, LANGS } from './i18n.js';
import { COUNTRIES, CATEGORIES, countryByCode } from './data.js';
import {
  startReport, onReportInput, onReportButton, openReport,
  startApplication, onApplicationInput,
  showPanel, onStaffCommand, onStaffInput, onStaffButton,
  onGroupMessage, onChatMember,
} from './staff.js';

// ───────────────────────────── entry points ─────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await request.json();
      try {
        await ensureSchema(env);
        await handleUpdate(update, env);
      } catch (e) {
        console.log('update error', e && e.stack ? e.stack : e);
      }
      return new Response('ok');
    }

    if (url.pathname === '/register') {
      if (url.searchParams.get('key') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      await ensureSchema(env);
      const hook = await tg(env, 'setWebhook', {
        url: `${url.origin}/webhook`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query', 'chat_member', 'my_chat_member'],
      });
      const cmds = [];
      cmds.push(await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Головне меню' }] }));
      cmds.push(await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Главное меню' }], language_code: 'ru' }));
      cmds.push(await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Main menu' }], language_code: 'en' }));
      return Response.json({ webhook: hook, commands: cmds.map((c) => c.ok) });
    }

    return new Response('ВУС bot is running');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(ensureSchema(env).then(() => runCron(env)));
  },
};

async function handleUpdate(update, env) {
  const m = update.message;
  if (m && m.chat.type === 'private') return onPrivateMessage(m, env);
  if (m && (m.chat.type === 'supergroup' || m.chat.type === 'group')) return onGroupMessage(env, m);
  if (update.chat_member) return onChatMember(env, update.chat_member);
  if (update.callback_query) return onCallback(update.callback_query, env);
}

// ───────────────────────────── private messages ─────────────────────────────

const langPicker = () => ({
  inline_keyboard: [[
    { text: '🇺🇦 Українська', callback_data: 'lang:ua' },
    { text: 'Русский', callback_data: 'lang:ru' },
    { text: '🇬🇧 English', callback_data: 'lang:en' },
  ]],
});

async function onPrivateMessage(msg, env) {
  const user = await upsertUser(env, msg.from);
  const text = (msg.text || '').trim();

  if (user.banned && !user.isStaff) return send(env, user.id, t(user.lang || 'ua', 'banned'));

  if (text.startsWith('/start')) {
    await clearSession(env, user.id);
    const payload = text.split(' ')[1] || '';
    if (!user.lang) return send(env, user.id, t('ua', 'choose_lang'), { reply_markup: langPicker() });
    if (payload === 'new') return startAd(env, user);
    if (payload.startsWith('report_')) return startReport(env, user, payload.slice(7));
    if (payload.startsWith('rep_') && user.isStaff) return openReport(env, user, payload.slice(4));
    return showMenu(env, user, 'welcome');
  }

  if (!user.lang) return send(env, user.id, t('ua', 'choose_lang'), { reply_markup: langPicker() });

  if (text === '/cancel') {
    await clearSession(env, user.id);
    return showMenu(env, user, 'cancelled');
  }

  // Admin commands: /ads, /reports, /user, /unban, /stats, /log, /applications, /post, /setup
  if (text.startsWith('/')) {
    const [rawCmd, ...rest] = text.slice(1).split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase();
    if (user.isStaff) {
      await clearSession(env, user.id);
      const handled = await onStaffCommand(env, user, cmd, rest.join(' ').trim());
      if (handled !== false) return;
    }
    return showMenu(env, user);
  }

  // A menu button always wins, even in the middle of a form.
  const menuKey = menuKeyOf(text);
  if (menuKey) {
    await clearSession(env, user.id);
    return onMenu(env, user, menuKey);
  }

  const session = await getSession(env, user.id);
  const st = session.state || '';
  if (st.startsWith('ad:')) return onAdInput(env, user, session, msg);
  if (st.startsWith('rep:')) return onReportInput(env, user, session, msg);
  if (st.startsWith('app:')) return onApplicationInput(env, user, session, msg);
  if (st.startsWith('adm:') && user.isStaff) return onStaffInput(env, user, session, msg);

  return showMenu(env, user);
}

async function onMenu(env, user, key) {
  switch (key) {
    case 'menu_new': return startAd(env, user);
    case 'menu_my': return showMyAds(env, user);
    case 'menu_report': return startReport(env, user);
    case 'menu_admin': return startApplication(env, user);
    case 'menu_panel': return user.isStaff ? showPanel(env, user) : showMenu(env, user);
    case 'menu_help':
      return send(env, user.id, t(user.lang, 'help', {
        channel: env.CHANNEL_USERNAME || 'vus_ua',
        group: env.GROUP_USERNAME || 'vus_chat',
      }), { reply_markup: { inline_keyboard: [[{ text: t(user.lang, 'change_lang'), callback_data: 'lang:menu' }]] } });
  }
}

// ───────────────────────────── ad form ─────────────────────────────

const ORDER = ['country', 'city', 'cat', 'title', 'body', 'price', 'photos', 'contact', 'site', 'preview'];

function prevStep(step, data) {
  if (step === 'country_text') return 'country';
  if (step === 'city') return data.countryCode === 'XX' ? 'country_text' : 'country';
  const i = ORDER.indexOf(step);
  return i > 0 ? ORDER[i - 1] : null;
}

async function checkLimits(env, user) {
  if (user.isStaff) return null; // власник і адміни — без лімітів
  const since = now() - DAY;
  const day = await env.DB.prepare(
    'SELECT COUNT(*) AS n, MIN(created_at) AS first FROM ads WHERE user_id = ? AND created_at > ?'
  ).bind(user.id, since).first();
  if (day.n >= LIMIT_PER_DAY) {
    const h = Math.max(1, Math.ceil((day.first + DAY - now()) / 3600));
    return t(user.lang, 'limit_day', { h });
  }
  const active = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM ads WHERE user_id = ? AND status IN ('pending','published')"
  ).bind(user.id).first();
  if (active.n >= LIMIT_ACTIVE) return t(user.lang, 'limit_active', { n: active.n });
  return null;
}

async function startAd(env, user) {
  const limit = await checkLimits(env, user);
  if (limit) return send(env, user.id, limit, { reply_markup: menuFor(env, user) });
  const data = {};
  await setSession(env, user.id, 'ad:country', data);
  return promptStep(env, user, 'country', data);
}

async function goStep(env, user, step, data) {
  await setSession(env, user.id, `ad:${step}`, data);
  return promptStep(env, user, step, data);
}

async function promptStep(env, user, step, data) {
  const L = user.lang;
  const kb = (rows, back = true) => ({ reply_markup: { inline_keyboard: [...rows, navRow(L, back)] } });

  switch (step) {
    case 'country': {
      const btns = COUNTRIES.map((c) => ({ text: c[L] || c.ua, callback_data: `ad:c:${c.code}` }));
      btns.push({ text: t(L, 'other_country'), callback_data: 'ad:c:XX' });
      return send(env, user.id, t(L, 'ask_country'), kb(pairs(btns), false));
    }
    case 'country_text':
      return send(env, user.id, t(L, 'ask_country_text'), kb([]));
    case 'city': {
      const c = countryByCode(data.countryCode);
      if (!c) return send(env, user.id, t(L, 'ask_city_text'), kb([]));
      const btns = c.cities.map(([ua, en], i) => ({ text: L === 'en' ? en : ua, callback_data: `ad:ci:${i}` }));
      return send(env, user.id, t(L, 'ask_city'), kb(pairs(btns)));
    }
    case 'cat': {
      const btns = CATEGORIES.map((c) => ({ text: c[L] || c.ua, callback_data: `ad:cat:${c.key}` }));
      return send(env, user.id, t(L, 'ask_cat'), kb(pairs(btns)));
    }
    case 'title':
      return send(env, user.id, t(L, 'ask_title'), kb([]));
    case 'body':
      return send(env, user.id, t(L, 'ask_body'), kb([]));
    case 'price':
      return send(env, user.id, t(L, 'ask_price'), kb([[
        { text: t(L, 'price_neg'), callback_data: 'ad:pr:neg' },
        { text: t(L, 'price_free'), callback_data: 'ad:pr:free' },
      ]]));
    case 'photos': {
      const n = (data.photos || []).length;
      const row = n > 0
        ? [{ text: t(L, 'photos_done'), callback_data: 'ad:ph:done' }]
        : [{ text: t(L, 'photos_none'), callback_data: 'ad:ph:none' }];
      return send(env, user.id, t(L, 'ask_photos'), kb([row]));
    }
    case 'contact': {
      const rows = user.username
        ? [[{ text: t(L, 'contact_tg', { u: '@' + user.username }), callback_data: 'ad:ct:tg' }]]
        : [];
      return send(env, user.id, t(L, 'ask_contact'), kb(rows));
    }
    case 'site':
      return send(env, user.id, t(L, 'ask_site'), kb([[
        { text: t(L, 'site_yes'), callback_data: 'ad:site:1' },
        { text: t(L, 'site_no'), callback_data: 'ad:site:0' },
      ]]));
    case 'preview': {
      await send(env, user.id, t(L, 'preview_title'));
      await sendPost(env, user.id, draftToAd(user, data), null);
      return send(env, user.id, '👆', kb([[
        { text: t(L, 'submit'), callback_data: 'ad:sub' },
        { text: t(L, 'redo'), callback_data: 'ad:redo' },
      ]]));
    }
  }
}

function draftToAd(user, d) {
  return {
    id: 0, user_id: user.id, country: d.country, city: d.city, category: d.category, title: d.title,
    body: d.body, price: d.price, photos: JSON.stringify(d.photos || []), contact: d.contact, on_site: d.onSite ? 1 : 0,
  };
}

async function onAdInput(env, user, session, msg) {
  const L = user.lang;
  const step = session.state.slice(3);
  const data = session.data;
  const text = (msg.text || '').trim();

  const needText = async (min, max, field, next, opts = {}) => {
    if (!text) return send(env, user.id, t(L, 'err_text'));
    if (text.length > max) return send(env, user.id, t(L, 'err_long', { n: max }));
    if (text.length < min) return send(env, user.id, t(L, 'err_short'));
    if (opts.noLinks && LINK_RE.test(text)) return send(env, user.id, t(L, 'err_links'));
    data[field] = text;
    return goStep(env, user, next, data);
  };

  switch (step) {
    case 'country_text':
      data.countryCode = 'XX';
      return needText(2, 40, 'country', 'city');
    case 'city': return needText(2, 40, 'city', 'cat');
    case 'title': return needText(3, 80, 'title', 'body', { noLinks: true });
    case 'body': return needText(10, 800, 'body', 'price', { noLinks: true });
    case 'price': return needText(1, 40, 'price', 'photos', { noLinks: true });
    case 'contact': return needText(3, 64, 'contact', 'site', { noLinks: true });
    case 'photos': {
      if (!msg.photo) return send(env, user.id, t(L, 'err_photo'));
      data.photos = data.photos || [];
      if (data.photos.length >= MAX_PHOTOS) return send(env, user.id, t(L, 'photos_max'));
      data.photos.push(msg.photo[msg.photo.length - 1].file_id);
      await setSession(env, user.id, session.state, data);
      return send(env, user.id, t(L, 'photo_added', { n: data.photos.length }), {
        reply_markup: { inline_keyboard: [[{ text: t(L, 'photos_done'), callback_data: 'ad:ph:done' }], navRow(L)] },
      });
    }
    default:
      return promptStep(env, user, step, data);
  }
}

const BUTTON_STATE = { c: 'country', ci: 'city', cat: 'cat', pr: 'price', ph: 'photos', ct: 'contact', site: 'site', sub: 'preview', redo: 'preview' };

async function onAdButton(env, user, cq, parts) {
  const L = user.lang;
  const session = await getSession(env, user.id);
  const expected = BUTTON_STATE[parts[1]];
  if (session.state !== `ad:${expected}`) return answer(env, cq, t(L, 'stale'));
  await removeButtons(env, cq.message);
  await answer(env, cq);
  const data = session.data;

  switch (parts[1]) {
    case 'c': {
      if (parts[2] === 'XX') {
        data.countryCode = 'XX';
        return goStep(env, user, 'country_text', data);
      }
      const c = countryByCode(parts[2]);
      data.countryCode = c.code;
      data.country = c.ua;
      return goStep(env, user, 'city', data);
    }
    case 'ci': {
      const c = countryByCode(data.countryCode);
      const city = c && c.cities[Number(parts[2])];
      if (!city) return promptStep(env, user, 'city', data);
      data.city = city[0];
      return goStep(env, user, 'cat', data);
    }
    case 'cat': data.category = parts[2]; return goStep(env, user, 'title', data);
    case 'pr': data.price = parts[2]; return goStep(env, user, 'photos', data);
    case 'ph': if (parts[2] === 'none') data.photos = []; return goStep(env, user, 'contact', data);
    case 'ct': data.contact = '@' + user.username; return goStep(env, user, 'site', data);
    case 'site': data.onSite = parts[2] === '1'; return goStep(env, user, 'preview', data);
    case 'redo': return goStep(env, user, 'country', {});
    case 'sub': return submitAd(env, user, data);
  }
}

async function submitAd(env, user, data) {
  const limit = await checkLimits(env, user);
  if (limit) {
    await clearSession(env, user.id);
    return send(env, user.id, limit, { reply_markup: menuFor(env, user) });
  }
  const res = await env.DB.prepare(
    `INSERT INTO ads (user_id, country, city, category, title, body, price, photos, contact, on_site, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(user.id, data.country, data.city, data.category, data.title, data.body, data.price,
    JSON.stringify(data.photos || []), data.contact, data.onSite ? 1 : 0, now()).run();
  const id = res.meta.last_row_id;
  await clearSession(env, user.id);
  const ad = await getAd(env, id);

  // Оголошення власника публікуються одразу, без модерації.
  if (user.isOwner) {
    const r = await publishAd(env, ad, user.id);
    if (!r.ok) return send(env, user.id, `⚠️ Не вдалося опублікувати #${id}: ${r.error}`, { reply_markup: menuFor(env, user) });
    return send(env, user.id, t(user.lang, 'published_user', { id, link: postLink(env, r.ids[0]) }), { reply_markup: menuFor(env, user) });
  }

  await sendAdminCard(env, ad, user);
  return send(env, user.id, t(user.lang, 'submitted', { id }), { reply_markup: menuFor(env, user) });
}

// ───────────────────────────── ad moderation ─────────────────────────────

const REASONS = ['spam', 'forbidden', 'incomplete', 'duplicate', 'rules'];

async function onModeration(env, cq, parts) {
  const [, action, idStr, reason] = parts;
  const ad = await getAd(env, Number(idStr));
  const msg = cq.message;
  if (!ad) return answer(env, cq, 'Оголошення не знайдено');
  const author = await getUser(env, ad.user_id);

  if (ad.status !== 'pending') {
    await removeButtons(env, msg);
    return answer(env, cq, 'Вже оброблено');
  }

  if (action === 'no') {
    await tg(env, 'editMessageReplyMarkup', {
      chat_id: msg.chat.id, message_id: msg.message_id,
      reply_markup: { inline_keyboard: [
        ...pairs(REASONS.map((r) => ({ text: t('ua', `reason_${r}`), callback_data: `mod:r:${ad.id}:${r}` }))),
        [{ text: '⬅️ Назад', callback_data: `mod:back:${ad.id}` }],
      ] },
    });
    return answer(env, cq);
  }

  if (action === 'back') {
    await tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: modButtons(ad.id) });
    return answer(env, cq);
  }

  if (action === 'ok') {
    const r = await publishAd(env, ad, cq.from.id);
    if (!r.ok) return answer(env, cq, `Не вдалося опублікувати: ${r.error}`, true);
    const status = `✅ Опубліковано — ${esc(whoName(cq.from))}`;
    await tg(env, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true,
      text: adminCard(env, ad, author, status),
    });
    await syncAdminCopy(env, ad, author, msg, status);
    await logAction(env, cq.from.id, 'publish_ad', ad.user_id, `#${ad.id}`);
    if (author) await send(env, author.id, t(author.lang, 'published_user', { id: ad.id, link: postLink(env, r.ids[0]) }));
    return answer(env, cq, 'Опубліковано');
  }

  if (action === 'r') {
    const code = REASONS.includes(reason) ? reason : 'rules';
    await env.DB.prepare("UPDATE ads SET status = 'rejected', reject_reason = ?, moderated_by = ? WHERE id = ?")
      .bind(code, cq.from.id, ad.id).run();
    const status = `❌ Відхилено (${t('ua', `reason_${code}`)}) — ${esc(whoName(cq.from))}`;
    await tg(env, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true,
      text: adminCard(env, ad, author, status),
    });
    await syncAdminCopy(env, ad, author, msg, status);
    await logAction(env, cq.from.id, 'reject_ad', ad.user_id, `#${ad.id}`);
    if (author) await send(env, author.id, t(author.lang, 'rejected_user', { id: ad.id, reason: t(author.lang, `reason_${code}`) }));
    return answer(env, cq, 'Відхилено');
  }

  return answer(env, cq);
}

// When an ad is moderated from the bot, update its card in the admin channel too.
async function syncAdminCopy(env, ad, author, msg, status) {
  if (!ad.admin_msg_id || String(msg.chat.id) === String(env.ADMIN_CHAT_ID)) return;
  await tg(env, 'editMessageText', {
    chat_id: env.ADMIN_CHAT_ID, message_id: ad.admin_msg_id, parse_mode: 'HTML', disable_web_page_preview: true,
    text: adminCard(env, ad, author, status),
  });
}

// ───────────────────────────── my ads ─────────────────────────────

function myAdText(L, ad) {
  let s = `<b>#${ad.id} · ${esc(ad.title)}</b>\n${t(L, `status_${ad.status}`)}`;
  if (ad.status === 'published') s += `\n${t(L, 'until', { d: fmtDate(ad.expires_at) })}`;
  return s;
}

function myAdButtons(L, ad) {
  const row = [];
  if (ad.status === 'published') row.push({ text: t(L, 'extend'), callback_data: `my:ext:${ad.id}` });
  if (ad.status === 'published' || ad.status === 'pending') row.push({ text: t(L, 'delete'), callback_data: `my:del:${ad.id}` });
  return { inline_keyboard: row.length ? [row] : [] };
}

async function showMyAds(env, user) {
  const L = user.lang;
  const { results } = await env.DB.prepare(
    "SELECT * FROM ads WHERE user_id = ? AND status != 'deleted' ORDER BY id DESC LIMIT 10"
  ).bind(user.id).all();
  if (!results.length) return send(env, user.id, t(L, 'my_empty'), { reply_markup: menuFor(env, user) });
  await send(env, user.id, t(L, 'my_title'));
  for (const ad of results) await sendHtml(env, user.id, myAdText(L, ad), { reply_markup: myAdButtons(L, ad) });
}

async function onMyButton(env, user, cq, parts) {
  const L = user.lang;
  const ad = await getAd(env, Number(parts[2]));
  if (!ad || ad.user_id !== user.id) return answer(env, cq, t(L, 'stale'));
  const msg = cq.message;

  switch (parts[1]) {
    case 'ext': {
      if (ad.status !== 'published') return answer(env, cq, t(L, 'stale'));
      const exp = now() + AD_LIFETIME;
      await env.DB.prepare('UPDATE ads SET expires_at = ?, reminded = 0 WHERE id = ?').bind(exp, ad.id).run();
      await answer(env, cq);
      return send(env, user.id, t(L, 'extended', { id: ad.id, d: fmtDate(exp) }));
    }
    case 'del':
      await tg(env, 'editMessageReplyMarkup', {
        chat_id: msg.chat.id, message_id: msg.message_id,
        reply_markup: { inline_keyboard: [[
          { text: t(L, 'yes_delete'), callback_data: `my:delok:${ad.id}` },
          { text: t(L, 'no'), callback_data: `my:no:${ad.id}` },
        ]] },
      });
      return answer(env, cq, t(L, 'delete_confirm', { id: ad.id }));
    case 'no':
      await tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: myAdButtons(L, ad) });
      return answer(env, cq);
    case 'delok': {
      if (ad.status === 'published') await removeFromChannel(env, ad);
      await env.DB.prepare("UPDATE ads SET status = 'deleted' WHERE id = ?").bind(ad.id).run();
      await tg(env, 'editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text: t(L, 'deleted', { id: ad.id }) });
      return answer(env, cq);
    }
  }
  return answer(env, cq);
}

// ───────────────────────────── callbacks ─────────────────────────────

async function onCallback(cq, env) {
  const parts = (cq.data || '').split(':');
  const chat = cq.message && cq.message.chat;
  const inAdminChat = chat && String(chat.id) === String(env.ADMIN_CHAT_ID);

  // Ad moderation: from the admin channel, or from the bot by staff.
  if (parts[0] === 'mod') {
    if (!inAdminChat && !(await isStaffId(env, cq.from.id))) return answer(env, cq);
    if (inAdminChat) await upsertUser(env, cq.from);
    return onModeration(env, cq, parts);
  }

  const user = await upsertUser(env, cq.from);

  // Staff buttons (also pressed in the admin channel, e.g. admin applications).
  if (['pan', 'adr', 'usr', 'adm', 'app', 'post'].includes(parts[0])) {
    if (!user.isStaff) return answer(env, cq, 'Лише для адміністраторів', true);
    return onStaffButton(env, user, cq, parts);
  }

  if (user.banned && !user.isStaff) return answer(env, cq, t(user.lang || 'ua', 'banned'));

  if (parts[0] === 'lang') {
    if (parts[1] === 'menu') {
      await answer(env, cq);
      return send(env, user.id, t('ua', 'choose_lang'), { reply_markup: langPicker() });
    }
    if (!LANGS.includes(parts[1])) return answer(env, cq);
    await env.DB.prepare('UPDATE users SET lang = ? WHERE id = ?').bind(parts[1], user.id).run();
    user.lang = parts[1];
    await removeButtons(env, cq.message);
    await answer(env, cq);
    return showMenu(env, user, 'welcome');
  }

  if (!user.lang) return answer(env, cq);

  if (parts[0] === 'nav') {
    const session = await getSession(env, user.id);
    if (!session.state) { await removeButtons(env, cq.message); return answer(env, cq, t(user.lang, 'stale')); }
    await removeButtons(env, cq.message);
    await answer(env, cq);
    if (parts[1] === 'cancel' || !session.state.startsWith('ad:')) {
      await clearSession(env, user.id);
      return showMenu(env, user, 'cancelled');
    }
    const prev = prevStep(session.state.slice(3), session.data);
    if (!prev) return promptStep(env, user, session.state.slice(3), session.data);
    return goStep(env, user, prev, session.data);
  }

  if (parts[0] === 'ad') return onAdButton(env, user, cq, parts);
  if (parts[0] === 'my') return onMyButton(env, user, cq, parts);
  if (parts[0] === 'rep') return onReportButton(env, user, cq, parts);

  return answer(env, cq);
}

// ───────────────────────────── cron: reminders, expiry, mutes ─────────────────────────────

async function runCron(env) {
  const ts = now();

  const soon = await env.DB.prepare(
    "SELECT * FROM ads WHERE status = 'published' AND reminded = 0 AND expires_at > ? AND expires_at <= ?"
  ).bind(ts, ts + 2 * DAY).all();
  for (const ad of soon.results) {
    const u = await getUser(env, ad.user_id);
    if (u) {
      await send(env, u.id, t(u.lang, 'expire_soon', { id: ad.id, title: ad.title }), {
        reply_markup: { inline_keyboard: [[{ text: t(u.lang, 'extend'), callback_data: `my:ext:${ad.id}` }]] },
      });
    }
    await env.DB.prepare('UPDATE ads SET reminded = 1 WHERE id = ?').bind(ad.id).run();
  }

  const expired = await env.DB.prepare("SELECT * FROM ads WHERE status = 'published' AND expires_at <= ?").bind(ts).all();
  for (const ad of expired.results) {
    await removeFromChannel(env, ad);
    await env.DB.prepare("UPDATE ads SET status = 'expired' WHERE id = ?").bind(ad.id).run();
    const u = await getUser(env, ad.user_id);
    if (u) await send(env, u.id, t(u.lang, 'expired_user', { id: ad.id, title: ad.title }));
  }

  // Drafts abandoned for more than 2 days.
  await env.DB.prepare('DELETE FROM sessions WHERE updated_at < ?').bind(ts - 2 * DAY).run();
}
