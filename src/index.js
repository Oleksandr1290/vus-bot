// ВУС bot — stage 1: language, menu, ad submission, manual moderation,
// publishing to the channel, "My ads", expiry reminders.

import { tg, esc, now, fmtDate } from './tg.js';
import { t, menuKeyOf, LANGS } from './i18n.js';
import { COUNTRIES, CATEGORIES, countryByCode, categoryByKey, hashtag } from './data.js';

const DAY = 86400;
const AD_LIFETIME = 30 * DAY;
const LIMIT_PER_DAY = 1;
const LIMIT_ACTIVE = 5;
const MAX_PHOTOS = 3;
const LINK_RE = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\.(com|net|org|ru|ua|pl|de)\b)/i;

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
        await handleUpdate(update, env);
      } catch (e) {
        console.log('update error', e && e.stack ? e.stack : e);
      }
      return new Response('ok');
    }

    if (url.pathname === '/register') {
      if (url.searchParams.get('key') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
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
    ctx.waitUntil(runCron(env));
  },
};

async function handleUpdate(update, env) {
  if (update.message && update.message.chat.type === 'private') return onPrivateMessage(update.message, env);
  if (update.callback_query) return onCallback(update.callback_query, env);
}

// ───────────────────────────── database helpers ─────────────────────────────

async function upsertUser(env, from) {
  await env.DB.prepare(
    `INSERT INTO users (id, username, first_name, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET username = ?2, first_name = ?3`
  ).bind(from.id, from.username || null, from.first_name || '', now()).run();
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(from.id).first();
}

const getUser = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();

async function getSession(env, userId) {
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?').bind(userId).first();
  return row ? { state: row.state, data: JSON.parse(row.data || '{}') } : { state: null, data: {} };
}

async function setSession(env, userId, state, data) {
  await env.DB.prepare(
    `INSERT INTO sessions (user_id, state, data, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id) DO UPDATE SET state = ?2, data = ?3, updated_at = ?4`
  ).bind(userId, state, JSON.stringify(data || {}), now()).run();
}

const clearSession = (env, userId) => env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();

const getAd = (env, id) => env.DB.prepare('SELECT * FROM ads WHERE id = ?').bind(id).first();

// ───────────────────────────── keyboards ─────────────────────────────

const isOwner = (env, id) => String(id) === String(env.OWNER_ID);

const menuFor = (env, user) => mainMenu(user.lang, isOwner(env, user.id));

function mainMenu(lang, owner = false) {
  const rows = [
    [{ text: t(lang, 'menu_new') }],
    [{ text: t(lang, 'menu_my') }, { text: t(lang, 'menu_report') }],
    [{ text: t(lang, 'menu_admin') }, { text: t(lang, 'menu_help') }],
  ];
  if (owner) rows.unshift([{ text: t(lang, 'menu_panel') }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
  };
}

const langPicker = () => ({
  inline_keyboard: [[
    { text: '🇺🇦 Українська', callback_data: 'lang:ua' },
    { text: 'Русский', callback_data: 'lang:ru' },
    { text: '🇬🇧 English', callback_data: 'lang:en' },
  ]],
});

function navRow(lang, withBack = true) {
  const row = [];
  if (withBack) row.push({ text: t(lang, 'back'), callback_data: 'nav:back' });
  row.push({ text: t(lang, 'cancel'), callback_data: 'nav:cancel' });
  return row;
}

function pairs(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

const send = (env, chatId, text, extra = {}) =>
  tg(env, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra });

const showMenu = (env, user, key = 'menu_hint') =>
  send(env, user.id, t(user.lang, key), { reply_markup: menuFor(env, user) });

const removeButtons = (env, msg) =>
  tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });

// ───────────────────────────── private messages ─────────────────────────────

async function onPrivateMessage(msg, env) {
  const user = await upsertUser(env, msg.from);
  const text = (msg.text || '').trim();

  if (user.banned) return send(env, user.id, t(user.lang || 'ua', 'banned'));

  if (text.startsWith('/start')) {
    await clearSession(env, user.id);
    const payload = text.split(' ')[1] || '';
    if (!user.lang) return send(env, user.id, t('ua', 'choose_lang'), { reply_markup: langPicker() });
    if (payload === 'new') return startAd(env, user);
    if (payload.startsWith('report_')) {
      await send(env, user.id, t(user.lang, 'soon'));
      return showMenu(env, user);
    }
    return showMenu(env, user, 'welcome');
  }

  if (!user.lang) return send(env, user.id, t('ua', 'choose_lang'), { reply_markup: langPicker() });

  if (text === '/cancel') {
    await clearSession(env, user.id);
    return showMenu(env, user, 'cancelled');
  }

  // A menu button always wins, even in the middle of a form.
  const menuKey = menuKeyOf(text);
  if (menuKey) {
    await clearSession(env, user.id);
    return onMenu(env, user, menuKey);
  }

  const session = await getSession(env, user.id);
  if (session.state && session.state.startsWith('ad:')) return onAdInput(env, user, session, msg);

  return showMenu(env, user);
}

async function onMenu(env, user, key) {
  switch (key) {
    case 'menu_new':
      return startAd(env, user);
    case 'menu_my':
      return showMyAds(env, user);
    case 'menu_report':
    case 'menu_admin':
      return send(env, user.id, t(user.lang, 'soon'));
    case 'menu_panel':
      if (!isOwner(env, user.id)) return showMenu(env, user);
      return showPanel(env, user);
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
  if (isOwner(env, user.id)) return null; // владелец — без лимитов
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
    id: 0,
    user_id: user.id,
    country: d.country,
    city: d.city,
    category: d.category,
    title: d.title,
    body: d.body,
    price: d.price,
    photos: JSON.stringify(d.photos || []),
    contact: d.contact,
    on_site: d.onSite ? 1 : 0,
  };
}

// Text / photo input while filling the form.
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
    case 'city':
      return needText(2, 40, 'city', 'cat');
    case 'title':
      return needText(3, 80, 'title', 'body', { noLinks: true });
    case 'body':
      return needText(10, 800, 'body', 'price', { noLinks: true });
    case 'price':
      return needText(1, 40, 'price', 'photos', { noLinks: true });
    case 'contact':
      return needText(3, 64, 'contact', 'site', { noLinks: true });
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
      // Step expects a button press — show it again.
      return promptStep(env, user, step, data);
  }
}

// Which session state each form button belongs to.
const BUTTON_STATE = { c: 'country', ci: 'city', cat: 'cat', pr: 'price', ph: 'photos', ct: 'contact', site: 'site', sub: 'preview', redo: 'preview' };

async function onAdButton(env, user, cq, parts) {
  const L = user.lang;
  const session = await getSession(env, user.id);
  const expected = BUTTON_STATE[parts[1]];
  if (session.state !== `ad:${expected}`) return answer(env, cq, t(L, 'stale'));
  await removeButtons(env, cq.message);
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
    case 'cat':
      data.category = parts[2];
      return goStep(env, user, 'title', data);
    case 'pr':
      data.price = parts[2]; // 'neg' | 'free'
      return goStep(env, user, 'photos', data);
    case 'ph':
      if (parts[2] === 'none') data.photos = [];
      return goStep(env, user, 'contact', data);
    case 'ct':
      data.contact = '@' + user.username;
      return goStep(env, user, 'site', data);
    case 'site':
      data.onSite = parts[2] === '1';
      return goStep(env, user, 'preview', data);
    case 'redo':
      return goStep(env, user, 'country', {});
    case 'sub':
      return submitAd(env, user, data);
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

  // Объявления владельца публикуются сразу, без модерации.
  if (isOwner(env, user.id)) {
    const r = await publishAd(env, ad, user.id);
    if (!r.ok) return send(env, user.id, `⚠️ Не вдалося опублікувати #${id}: ${r.error}`, { reply_markup: menuFor(env, user) });
    const link = env.CHANNEL_USERNAME ? `https://t.me/${env.CHANNEL_USERNAME}/${r.ids[0]}` : '';
    return send(env, user.id, t(user.lang, 'published_user', { id, link }), { reply_markup: menuFor(env, user) });
  }

  await sendAdminCard(env, ad, user);
  return send(env, user.id, t(user.lang, 'submitted', { id }), { reply_markup: menuFor(env, user) });
}

// ───────────────────────────── post rendering ─────────────────────────────

function priceUa(p) {
  if (p === 'neg') return 'Договірна';
  if (p === 'free') return 'Безкоштовно';
  return esc(p);
}

function buildPost(ad, env) {
  const cat = categoryByKey(ad.category);
  const tags = [hashtag(ad.country), hashtag(ad.city), cat ? '#' + cat.tag : ''].filter(Boolean).join(' ');
  const bot = env.BOT_USERNAME || 'vus_ua_bot';
  return `${tags}\n\n<b>${esc(ad.title)}</b>\n\n` +
    `💰 Ціна: ${priceUa(ad.price)}\n` +
    `📍 Місце: ${esc(ad.city)}, ${esc(ad.country)}\n\n` +
    `${esc(ad.body)}\n\n` +
    `📞 Контакт: ${esc(ad.contact)}\n\n` +
    `➕ Подати своє оголошення безкоштовно: @${bot}`;
}

const plainLength = (html) => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, 'x').length;

function channelKeyboard(env, adId) {
  const bot = env.BOT_USERNAME || 'vus_ua_bot';
  return {
    inline_keyboard: [[
      { text: '➕ Подати оголошення', url: `https://t.me/${bot}?start=new` },
      { text: '⚠️ Поскаржитися', url: `https://t.me/${bot}?start=report_${adId}` },
    ]],
  };
}

// Sends an ad to any chat. Returns { ids, kind }.
async function sendPost(env, chatId, ad, keyboard) {
  const html = buildPost(ad, env);
  const photos = JSON.parse(ad.photos || '[]');
  const kbExtra = keyboard ? { reply_markup: keyboard } : {};
  const ids = [];
  let err = null;

  if (photos.length === 0) {
    const r = await send(env, chatId, html, { parse_mode: 'HTML', ...kbExtra });
    if (r.ok) ids.push(r.result.message_id); else err = r.description;
    return { ids, kind: 'text', error: err };
  }

  const fits = plainLength(html) <= 1024;

  if (photos.length === 1 && fits) {
    const r = await tg(env, 'sendPhoto', { chat_id: chatId, photo: photos[0], caption: html, parse_mode: 'HTML', ...kbExtra });
    if (r.ok) ids.push(r.result.message_id); else err = r.description;
    return { ids, kind: 'photo', error: err };
  }

  // Several photos (or a caption too long for a photo): album first.
  const media = photos.map((p, i) => ({
    type: 'photo',
    media: p,
    ...(i === 0 && fits && !keyboard ? { caption: html, parse_mode: 'HTML' } : {}),
  }));
  if (media.length === 1) {
    const r = await tg(env, 'sendPhoto', { chat_id: chatId, photo: photos[0] });
    if (r.ok) ids.push(r.result.message_id); else err = r.description;
  } else {
    const r = await tg(env, 'sendMediaGroup', { chat_id: chatId, media });
    if (r.ok) r.result.forEach((m) => ids.push(m.message_id)); else err = r.description;
  }
  if (fits && !keyboard) return { ids, kind: 'album', error: err };

  // Text with buttons right under the photos.
  const r = await send(env, chatId, html, { parse_mode: 'HTML', ...kbExtra });
  if (r.ok) ids.push(r.result.message_id); else err = r.description;
  return { ids, kind: 'mixed', error: err };
}

async function removeFromChannel(env, ad) {
  const ids = JSON.parse(ad.channel_msg_ids || '[]');
  if (!ids.length) return;
  let failed = false;
  for (const id of ids) {
    const r = await tg(env, 'deleteMessage', { chat_id: env.CHANNEL_ID, message_id: id });
    if (!r.ok) failed = true;
  }
  if (!failed) return;
  // Could not delete (e.g. too old) — mark the post as inactive instead.
  const html = '❌ <b>НЕАКТУАЛЬНО</b>\n\n' + buildPost(ad, env);
  if (ad.channel_kind === 'text' || ad.channel_kind === 'mixed') {
    await tg(env, 'editMessageText', { chat_id: env.CHANNEL_ID, message_id: ids[ids.length - 1], text: html, parse_mode: 'HTML', disable_web_page_preview: true });
  } else {
    await tg(env, 'editMessageCaption', { chat_id: env.CHANNEL_ID, message_id: ids[0], caption: html, parse_mode: 'HTML' });
  }
}

// Публикует объявление в канал и помечает его опубликованным.
async function publishAd(env, ad, byId) {
  const { ids, kind, error } = await sendPost(env, env.CHANNEL_ID, ad, channelKeyboard(env, ad.id));
  if (!ids.length || error) {
    for (const id of ids) await tg(env, 'deleteMessage', { chat_id: env.CHANNEL_ID, message_id: id });
    return { ok: false, error: explainError(error) };
  }
  const ts = now();
  await env.DB.prepare(
    `UPDATE ads SET status = 'published', channel_msg_ids = ?, channel_kind = ?, moderated_by = ?,
     published_at = ?, expires_at = ?, reminded = 0 WHERE id = ?`
  ).bind(JSON.stringify(ids), kind, byId, ts, ts + AD_LIFETIME, ad.id).run();
  return { ok: true, ids };
}

function explainError(e) {
  const d = String(e || 'невідома помилка');
  if (/chat not found/i.test(d)) return 'канал не знайдено — перевір CHANNEL_ID у wrangler.toml (точний @юзернейм каналу)';
  if (/not enough rights|administrator|CHAT_ADMIN_REQUIRED|need administrator/i.test(d)) return 'у бота немає прав публікації в каналі';
  if (/wrong file identifier|file/i.test(d)) return 'проблема з фото: ' + d;
  return d;
}

// ───────────────────────────── moderation ─────────────────────────────

const REASONS = ['spam', 'forbidden', 'incomplete', 'duplicate', 'rules'];

function authorLine(user) {
  const name = esc(user ? user.first_name || 'Користувач' : 'Користувач');
  const uname = user && user.username ? ` @${esc(user.username)}` : '';
  return `<a href="tg://user?id=${user ? user.id : 0}">${name}</a>${uname} (ID ${user ? user.id : '?'})`;
}

function adminCard(env, ad, author, statusLine = '') {
  return `🆕 <b>Оголошення #${ad.id}</b> на модерації\n` +
    `Автор: ${authorLine(author)}\n` +
    `Сайт: ${ad.on_site ? 'так' : 'ні'}\n` +
    `────────────\n` +
    buildPost(ad, env) +
    (statusLine ? `\n────────────\n${statusLine}` : '');
}

const modButtons = (id) => ({
  inline_keyboard: [[
    { text: '✅ Опублікувати', callback_data: `mod:ok:${id}` },
    { text: '❌ Відхилити', callback_data: `mod:no:${id}` },
  ]],
});

async function sendAdminCard(env, ad, author) {
  if (!env.ADMIN_CHAT_ID) return console.log('ADMIN_CHAT_ID is not set');
  const photos = JSON.parse(ad.photos || '[]');
  if (photos.length === 1) await tg(env, 'sendPhoto', { chat_id: env.ADMIN_CHAT_ID, photo: photos[0] });
  if (photos.length > 1) {
    await tg(env, 'sendMediaGroup', { chat_id: env.ADMIN_CHAT_ID, media: photos.map((p) => ({ type: 'photo', media: p })) });
  }
  const r = await send(env, env.ADMIN_CHAT_ID, adminCard(env, ad, author), { parse_mode: 'HTML', reply_markup: modButtons(ad.id) });
  if (r.ok) await env.DB.prepare('UPDATE ads SET admin_msg_id = ? WHERE id = ?').bind(r.result.message_id, ad.id).run();
}

const whoName = (from) => (from.username ? '@' + from.username : from.first_name || String(from.id));

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
    if (!r.ok) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: `Не вдалося опублікувати: ${r.error}`.slice(0, 190), show_alert: true });
    await tg(env, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true,
      text: adminCard(env, ad, author, `✅ Опубліковано — ${esc(whoName(cq.from))}`),
    });
    if (author) {
      const link = env.CHANNEL_USERNAME ? `https://t.me/${env.CHANNEL_USERNAME}/${r.ids[0]}` : '';
      await send(env, author.id, t(author.lang, 'published_user', { id: ad.id, link }));
    }
    return answer(env, cq, 'Опубліковано');
  }

  if (action === 'r') {
    const code = REASONS.includes(reason) ? reason : 'rules';
    await env.DB.prepare("UPDATE ads SET status = 'rejected', reject_reason = ?, moderated_by = ? WHERE id = ?")
      .bind(code, cq.from.id, ad.id).run();
    await tg(env, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true,
      text: adminCard(env, ad, author, `❌ Відхилено (${t('ua', `reason_${code}`)}) — ${esc(whoName(cq.from))}`),
    });
    if (author) await send(env, author.id, t(author.lang, 'rejected_user', { id: ad.id, reason: t(author.lang, `reason_${code}`) }));
    return answer(env, cq, 'Відхилено');
  }

  return answer(env, cq);
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
  for (const ad of results) {
    await send(env, user.id, myAdText(L, ad), { parse_mode: 'HTML', reply_markup: myAdButtons(L, ad) });
  }
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

const answer = (env, cq, text) => tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, ...(text ? { text } : {}) });

async function onCallback(cq, env) {
  const parts = (cq.data || '').split(':');
  const chat = cq.message && cq.message.chat;

  // Moderation buttons live in the private admin channel.
  if (parts[0] === 'mod') {
    const fromAdminChat = chat && String(chat.id) === String(env.ADMIN_CHAT_ID);
    if (!fromAdminChat && !isOwner(env, cq.from.id)) return answer(env, cq);
    return onModeration(env, cq, parts);
  }

  const user = await upsertUser(env, cq.from);
  if (user.banned) return answer(env, cq, t(user.lang || 'ua', 'banned'));

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
    if (!session.state || !session.state.startsWith('ad:')) return answer(env, cq, t(user.lang, 'stale'));
    await removeButtons(env, cq.message);
    await answer(env, cq);
    if (parts[1] === 'cancel') {
      await clearSession(env, user.id);
      return showMenu(env, user, 'cancelled');
    }
    const prev = prevStep(session.state.slice(3), session.data);
    if (!prev) return promptStep(env, user, session.state.slice(3), session.data);
    return goStep(env, user, prev, session.data);
  }

  if (parts[0] === 'ad') {
    await answer(env, cq);
    return onAdButton(env, user, cq, parts);
  }

  if (parts[0] === 'my') return onMyButton(env, user, cq, parts);

  if (parts[0] === 'pan' && isOwner(env, user.id)) {
    await answer(env, cq);
    if (parts[1] === 'pending') return panelPending(env, user);
    if (parts[1] === 'stats') return panelStats(env, user);
  }

  return answer(env, cq);
}

// ───────────────────────────── owner panel ─────────────────────────────

async function showPanel(env, user) {
  const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM ads WHERE status = 'pending'").first();
  return send(env, user.id, '🛡 <b>Адмін-панель ВУС</b>\n\nПовна панель (репорти, бани, адміни, журнал) з’явиться на етапі 3.', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [
      [{ text: `📥 На модерації (${p.n})`, callback_data: 'pan:pending' }],
      [{ text: '📊 Статистика', callback_data: 'pan:stats' }],
    ] },
  });
}

async function panelPending(env, user) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM ads WHERE status = 'pending' ORDER BY id LIMIT 10"
  ).all();
  if (!results.length) return send(env, user.id, '📥 Немає оголошень на модерації.');
  for (const ad of results) {
    const author = await getUser(env, ad.user_id);
    const photos = JSON.parse(ad.photos || '[]');
    if (photos.length === 1) await tg(env, 'sendPhoto', { chat_id: user.id, photo: photos[0] });
    if (photos.length > 1) await tg(env, 'sendMediaGroup', { chat_id: user.id, media: photos.map((p) => ({ type: 'photo', media: p })) });
    await send(env, user.id, adminCard(env, ad, author), { parse_mode: 'HTML', reply_markup: modButtons(ad.id) });
  }
}

async function panelStats(env, user) {
  const day = now() - DAY;
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const users = await q('SELECT COUNT(*) AS n FROM users');
  const usersDay = await q('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', day);
  const pub = await q("SELECT COUNT(*) AS n FROM ads WHERE status = 'published'");
  const pend = await q("SELECT COUNT(*) AS n FROM ads WHERE status = 'pending'");
  const adsDay = await q('SELECT COUNT(*) AS n FROM ads WHERE created_at > ?', day);
  const total = await q('SELECT COUNT(*) AS n FROM ads');
  return send(env, user.id,
    `📊 <b>Статистика ВУС</b>\n\n` +
    `👥 Користувачів бота: ${users.n} (за добу +${usersDay.n})\n` +
    `✅ Активних оголошень: ${pub.n}\n` +
    `⏳ На модерації: ${pend.n}\n` +
    `📝 Подано за добу: ${adsDay.n}\n` +
    `📦 Усього оголошень: ${total.n}`, { parse_mode: 'HTML' });
}

// ───────────────────────────── cron: reminders and expiry ─────────────────────────────

async function runCron(env) {
  const ts = now();

  // Reminder 2 days before expiry.
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

  // Expired ads.
  const expired = await env.DB.prepare(
    "SELECT * FROM ads WHERE status = 'published' AND expires_at <= ?"
  ).bind(ts).all();
  for (const ad of expired.results) {
    await removeFromChannel(env, ad);
    await env.DB.prepare("UPDATE ads SET status = 'expired' WHERE id = ?").bind(ad.id).run();
    const u = await getUser(env, ad.user_id);
    if (u) await send(env, u.id, t(u.lang, 'expired_user', { id: ad.id, title: ad.title }));
  }
}
