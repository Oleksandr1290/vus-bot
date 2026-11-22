// Shared helpers: database, roles, settings, keyboards, post rendering, publishing.

import { tg, esc, now, fmtDate } from './tg.js';
import { t } from './i18n.js';
import { categoryByKey, hashtag, priceText } from './data.js';

export { tg, esc, now, fmtDate, t };

export const DAY = 86400;
export const AD_LIFETIME = 30 * DAY;
export const LIMIT_PER_DAY = 1;
export const LIMIT_ACTIVE = 5;
export const MAX_PHOTOS = 3;
export const MUTE_BAN_THRESHOLD = 130; // годин: більше — вічний бан
export const LINK_RE = /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\.(com|net|org|ru|ua|pl|de)\b)/i;

// ───────────────────────────── schema (new tables are created automatically) ─────────────────────────────

let schemaReady = false;
export async function ensureSchema(env) {
  if (schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS admins (user_id INTEGER PRIMARY KEY, added_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id INTEGER, ad_id INTEGER,
       reason TEXT NOT NULL, note TEXT, msg_link TEXT, reporters TEXT NOT NULL DEFAULT '[]', count INTEGER NOT NULL DEFAULT 1,
       status TEXT NOT NULL DEFAULT 'open', taken_by INTEGER, decision TEXT, decided_by INTEGER,
       card_chat TEXT, card_msg_id INTEGER, created_at INTEGER NOT NULL, closed_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, target_id)`,
    `CREATE TABLE IF NOT EXISTS report_events (reporter_id INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS punishments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL,
       hours INTEGER, until INTEGER, reason TEXT, by_id INTEGER, report_id INTEGER, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_pun_user ON punishments(user_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, answers TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending', decided_by INTEGER, card_msg_id INTEGER, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, action TEXT NOT NULL,
       target_id INTEGER, details TEXT, created_at INTEGER NOT NULL)`,
  ];
  await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
  // New column for ads sent as ready-made text (fails harmlessly if it already exists).
  try { await env.DB.prepare('ALTER TABLE ads ADD COLUMN kind TEXT').run(); } catch (e) { /* already there */ }
  schemaReady = true;
}

// ───────────────────────────── users, sessions, settings ─────────────────────────────

export async function upsertUser(env, from) {
  await env.DB.prepare(
    `INSERT INTO users (id, username, first_name, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET username = ?2, first_name = ?3`
  ).bind(from.id, from.username || null, from.first_name || '', now()).run();
  const user = await getUser(env, from.id);
  user.isOwner = isOwner(env, user.id);
  user.isStaff = user.isOwner || (await isAdminId(env, user.id));
  return user;
}

export const getUser = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();

export async function getSession(env, userId) {
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE user_id = ?').bind(userId).first();
  return row ? { state: row.state, data: JSON.parse(row.data || '{}') } : { state: null, data: {} };
}

export async function setSession(env, userId, state, data) {
  await env.DB.prepare(
    `INSERT INTO sessions (user_id, state, data, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id) DO UPDATE SET state = ?2, data = ?3, updated_at = ?4`
  ).bind(userId, state, JSON.stringify(data || {}), now()).run();
}

export const clearSession = (env, userId) => env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();

export async function getSetting(env, key) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return r ? r.value : null;
}

export const setSetting = (env, key, value) =>
  env.DB.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2')
    .bind(key, String(value)).run();

export const getAd = (env, id) => env.DB.prepare('SELECT * FROM ads WHERE id = ?').bind(id).first();

// ───────────────────────────── roles and log ─────────────────────────────

export const isOwner = (env, id) => String(id) === String(env.OWNER_ID);

export async function isAdminId(env, id) {
  const r = await env.DB.prepare('SELECT 1 AS x FROM admins WHERE user_id = ?').bind(id).first();
  return !!r;
}

export const isStaffId = async (env, id) => isOwner(env, id) || (await isAdminId(env, id));

export async function logAction(env, adminId, action, targetId, details = '') {
  await env.DB.prepare('INSERT INTO admin_log (admin_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(adminId, action, targetId || null, details, now()).run();
}

export async function groupId(env) {
  return env.GROUP_ID || (await getSetting(env, 'group_id'));
}

// ───────────────────────────── keyboards and sending ─────────────────────────────

export function mainMenu(lang, staff = false) {
  const rows = [
    [{ text: t(lang, 'menu_new') }],
    [{ text: t(lang, 'menu_my') }, { text: t(lang, 'menu_report') }],
    [{ text: t(lang, 'menu_admin') }, { text: t(lang, 'menu_help') }],
  ];
  if (staff) rows.unshift([{ text: t(lang, 'menu_panel') }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

export const menuFor = (env, user) => mainMenu(user.lang, !!user.isStaff);

export function navRow(lang, withBack = true) {
  const row = [];
  if (withBack) row.push({ text: t(lang, 'back'), callback_data: 'nav:back' });
  row.push({ text: t(lang, 'cancel'), callback_data: 'nav:cancel' });
  return row;
}

export function pairs(buttons, n = 2) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += n) rows.push(buttons.slice(i, i + n));
  return rows;
}

export const send = (env, chatId, text, extra = {}) =>
  tg(env, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra });

export const sendHtml = (env, chatId, text, extra = {}) => send(env, chatId, text, { parse_mode: 'HTML', ...extra });

export const showMenu = (env, user, key = 'menu_hint') =>
  send(env, user.id, t(user.lang, key), { reply_markup: menuFor(env, user) });

export const removeButtons = (env, msg) =>
  tg(env, 'editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });

export const answer = (env, cq, text, alert = false) =>
  tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, ...(text ? { text: String(text).slice(0, 190), show_alert: alert } : {}) });

export const whoName = (u) => (u ? (u.username ? '@' + u.username : u.first_name || String(u.id)) : '?');

export function userLabel(u, id) {
  if (!u) return `ID ${id}`;
  const name = esc(u.first_name || 'Користувач');
  const uname = u.username ? ` @${esc(u.username)}` : '';
  return `<a href="tg://user?id=${u.id}">${name}</a>${uname} (ID ${u.id})`;
}

// Finds a user by @username or numeric ID.
export async function findUser(env, query) {
  const q = String(query || '').trim();
  if (/^-?\d+$/.test(q)) return (await getUser(env, Number(q))) || { id: Number(q), first_name: '', username: null, unknown: true };
  const name = q.replace(/^@/, '').toLowerCase();
  if (!name) return null;
  return env.DB.prepare('SELECT * FROM users WHERE lower(username) = ?').bind(name).first();
}

// ───────────────────────────── post rendering ─────────────────────────────

export function buildPost(ad, env) {
  const cat = categoryByKey(ad.category);
  const tags = [hashtag(ad.country), hashtag(ad.city), cat ? '#' + cat.tag : ''].filter(Boolean).join(' ');
  const bot = env.BOT_USERNAME || 'vus_ua_bot';
  const footer = `➕ Подати своє оголошення безкоштовно: @${bot}`;

  // Ready-made text from the author.
  if (ad.kind === 'free') return `${tags}\n\n${esc(ad.body)}\n\n${footer}`;

  const price = priceText(ad.price);
  const label = (cat && cat.pl && cat.pl.ua) || 'Ціна';
  return `${tags}\n\n<b>${esc(ad.title)}</b>\n\n` +
    (price ? `💰 ${label}: ${esc(price)}\n` : '') +
    `📍 Місце: ${esc(ad.city)}, ${esc(ad.country)}\n\n` +
    `${esc(ad.body)}\n\n` +
    (ad.contact ? `📞 Контакт: ${esc(ad.contact)}\n\n` : '') +
    footer;
}

const plainLength = (html) => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, 'x').length;

export function channelKeyboard(env, adId) {
  const bot = env.BOT_USERNAME || 'vus_ua_bot';
  return {
    inline_keyboard: [[
      { text: '➕ Подати оголошення', url: `https://t.me/${bot}?start=new` },
      { text: '⚠️ Поскаржитися', url: `https://t.me/${bot}?start=report_${adId}` },
    ]],
  };
}

// Sends an ad to any chat. Returns { ids, kind, error }.
export async function sendPost(env, chatId, ad, keyboard) {
  const html = buildPost(ad, env);
  const photos = JSON.parse(ad.photos || '[]');
  const kbExtra = keyboard ? { reply_markup: keyboard } : {};
  const ids = [];
  let err = null;

  if (photos.length === 0) {
    const r = await sendHtml(env, chatId, html, kbExtra);
    if (r.ok) ids.push(r.result.message_id); else err = r.description;
    return { ids, kind: 'text', error: err };
  }

  const fits = plainLength(html) <= 1024;

  if (photos.length === 1 && fits) {
    const r = await tg(env, 'sendPhoto', { chat_id: chatId, photo: photos[0], caption: html, parse_mode: 'HTML', ...kbExtra });
    if (r.ok) ids.push(r.result.message_id); else err = r.description;
    return { ids, kind: 'photo', error: err };
  }

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

  const r = await sendHtml(env, chatId, html, kbExtra);
  if (r.ok) ids.push(r.result.message_id); else err = r.description;
  return { ids, kind: 'mixed', error: err };
}

export async function removeFromChannel(env, ad) {
  const ids = JSON.parse(ad.channel_msg_ids || '[]');
  if (!ids.length) return;
  let failed = false;
  for (const id of ids) {
    const r = await tg(env, 'deleteMessage', { chat_id: env.CHANNEL_ID, message_id: id });
    if (!r.ok) failed = true;
  }
  if (!failed) return;
  const html = '❌ <b>НЕАКТУАЛЬНО</b>\n\n' + buildPost(ad, env);
  if (ad.channel_kind === 'text' || ad.channel_kind === 'mixed') {
    await tg(env, 'editMessageText', { chat_id: env.CHANNEL_ID, message_id: ids[ids.length - 1], text: html, parse_mode: 'HTML', disable_web_page_preview: true });
  } else {
    await tg(env, 'editMessageCaption', { chat_id: env.CHANNEL_ID, message_id: ids[0], caption: html, parse_mode: 'HTML' });
  }
}

export function explainError(e) {
  const d = String(e || 'невідома помилка');
  if (/chat not found/i.test(d)) return 'канал не знайдено — перевір CHANNEL_ID у wrangler.toml';
  if (/not enough rights|administrator|CHAT_ADMIN_REQUIRED|need administrator/i.test(d)) return 'у бота немає прав публікації в каналі';
  if (/wrong file identifier/i.test(d)) return 'проблема з фото: ' + d;
  return d;
}

export async function publishAd(env, ad, byId) {
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

export const postLink = (env, msgId) =>
  env.CHANNEL_USERNAME ? `https://t.me/${env.CHANNEL_USERNAME}/${msgId}` : `https://t.me/c/${String(env.CHANNEL_ID).replace(/^-100/, '')}/${msgId}`;

// Finds an ad by one of its message IDs in the channel.
export const adByChannelMsg = (env, msgId) =>
  env.DB.prepare(
    "SELECT * FROM ads WHERE instr(',' || trim(channel_msg_ids, '[]') || ',', ',' || ? || ',') > 0 ORDER BY id DESC LIMIT 1"
  ).bind(String(msgId)).first();

// ───────────────────────────── ad moderation card ─────────────────────────────

export function adminCard(env, ad, author, statusLine = '') {
  return `🆕 <b>Оголошення #${ad.id}</b> на модерації\n` +
    `Автор: ${userLabel(author, ad.user_id)}\n` +
    `Сайт: ${ad.on_site ? 'так' : 'ні'}\n` +
    `────────────\n` +
    buildPost(ad, env) +
    (statusLine ? `\n────────────\n${statusLine}` : '');
}

export const modButtons = (id) => ({
  inline_keyboard: [[
    { text: '✅ Опублікувати', callback_data: `mod:ok:${id}` },
    { text: '❌ Відхилити', callback_data: `mod:no:${id}` },
  ]],
});

export async function sendAdminCard(env, ad, author, chatId = env.ADMIN_CHAT_ID) {
  if (!chatId) return console.log('ADMIN_CHAT_ID is not set');
  const photos = JSON.parse(ad.photos || '[]');
  if (photos.length === 1) await tg(env, 'sendPhoto', { chat_id: chatId, photo: photos[0] });
  if (photos.length > 1) await tg(env, 'sendMediaGroup', { chat_id: chatId, media: photos.map((p) => ({ type: 'photo', media: p })) });
  const r = await sendHtml(env, chatId, adminCard(env, ad, author), { reply_markup: modButtons(ad.id) });
  if (r.ok && String(chatId) === String(env.ADMIN_CHAT_ID)) {
    await env.DB.prepare('UPDATE ads SET admin_msg_id = ? WHERE id = ?').bind(r.result.message_id, ad.id).run();
  }
}
