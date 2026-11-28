// Group protection: join requests with a captcha in private, CAS spam database,
// 24-hour newcomer restrictions, message filters, welcome messages.

import {
  tg, esc, now, t, DAY, LINK_RE,
  upsertUser, getUser, getSetting, setSetting, isStaffId, logAction, logEvent, groupId, getCfg,
  send, sendHtml, answer, mainMenu, userLabel,
} from './common.js';

const AUTO_MUTE_AFTER = 3;          // порушень за добу
const AUTO_MUTE_SECONDS = 3600;     // 1 година
const CAPTCHA_TRIES = 2;
const CAPTCHA_TIMEOUT = 15 * 60;    // незавершені заявки відхиляються через 15 хв

const EMOJIS = ['🍎', '🚗', '🐶', '⚽', '🌻', '✈️', '🎸', '🍕', '🐱', '🏠', '⭐', '🎁'];

export const DEFAULT_STOP_WORDS = [
  'в лс', 'в личку', 'в личные', 'в особисті', 'в приват', 'пишіть в приват', 'напиши мне', 'напишіть мені',
  'заработ', 'заробіт', 'крипт', 'інвест', 'инвест', 'пассивн', 'пасивн', 'интим', 'інтим',
  'казино', 'onlyfans', '18+', 'быстрые деньги', 'швидкі гроші', 'доход от', 'дохід від',
];

// Stop words: the owner edits them in ⚙️ Налаштування; until then the default list is used.
export async function getStopWords(env) {
  const raw = await getSetting(env, 'stop_words');
  if (raw == null) return [...DEFAULT_STOP_WORDS];
  try { return JSON.parse(raw); } catch (e) { return [...DEFAULT_STOP_WORDS]; }
}

const NO_PERMS = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false, can_invite_users: false,
};
const TEXT_ONLY = { ...NO_PERMS, can_send_messages: true };

const langOf = (code) => (code === 'ru' ? 'ru' : code === 'en' ? 'en' : 'ua');

// ───────────────────────────── CAS ─────────────────────────────

export async function casBanned(uid) {
  try {
    const r = await fetch(`https://api.cas.chat/check?user_id=${uid}`, { cf: { cacheTtl: 300 } });
    const j = await r.json();
    return j && j.ok === true;
  } catch (e) {
    return false; // база недоступна — не блокуємо
  }
}

async function casBan(env, gid, user) {
  await tg(env, 'banChatMember', { chat_id: gid, user_id: user.id });
  await logEvent(env, 'cas_block', user.id);
  await logAction(env, 0, 'cas_ban', user.id, 'база CAS');
  if (env.ADMIN_CHAT_ID) {
    await sendHtml(env, env.ADMIN_CHAT_ID, `🛡 <b>CAS</b>: заблоковано відомого спамера ${userLabel(user, user.id)}. Нічого робити не треба.`);
  }
}

// ───────────────────────────── join requests + captcha ─────────────────────────────

function captchaOptions() {
  const pool = [...EMOJIS].sort(() => Math.random() - 0.5).slice(0, 4);
  return { options: pool, answer: pool[Math.floor(Math.random() * pool.length)] };
}

const captchaKeyboard = (options) => ({
  inline_keyboard: [
    options.slice(0, 2).map((e, i) => ({ text: e, callback_data: `jc:${i}` })),
    options.slice(2, 4).map((e, i) => ({ text: e, callback_data: `jc:${i + 2}` })),
  ],
});

export async function onJoinRequest(env, req) {
  const gid = await groupId(env);
  if (!gid || String(req.chat.id) !== String(gid)) return;
  const from = req.from;
  if (from.is_bot) return tg(env, 'declineChatJoinRequest', { chat_id: gid, user_id: from.id });

  const user = await upsertUser(env, from);
  const lang = user.lang || langOf(from.language_code);
  if (!user.lang) await env.DB.prepare('UPDATE users SET lang = ? WHERE id = ?').bind(lang, from.id).run();

  if (user.banned) return tg(env, 'declineChatJoinRequest', { chat_id: gid, user_id: from.id });
  await logEvent(env, 'jr_new', from.id);

  // Personal group invite link → remember who invited (for the owner's statistics).
  const link = req.invite_link && req.invite_link.invite_link;
  if (link) {
    const ref = await env.DB.prepare("SELECT user_id FROM ref_links WHERE invite_link = ? AND track = 'group'").bind(link).first();
    if (ref && ref.user_id !== from.id) {
      await env.DB.prepare(
        "INSERT INTO group_invites (invitee_id, inviter_id, status, created_at) VALUES (?, ?, 'pending', ?) ON CONFLICT(invitee_id) DO NOTHING"
      ).bind(from.id, ref.user_id, now()).run();
    }
  }

  if (await casBanned(from.id)) {
    await tg(env, 'declineChatJoinRequest', { chat_id: gid, user_id: from.id });
    return casBan(env, gid, user);
  }

  if ((await getCfg(env, 'captcha_on')) !== '1') {
    await tg(env, 'approveChatJoinRequest', { chat_id: gid, user_id: from.id });
    return logEvent(env, 'jr_ok', from.id, 'no_captcha');
  }

  const { options, answer: correct } = captchaOptions();
  await env.DB.prepare(
    `INSERT INTO join_requests (user_id, chat_id, answer, options, tries, lang, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)
     ON CONFLICT(user_id) DO UPDATE SET chat_id = ?2, answer = ?3, options = ?4, tries = 0, lang = ?5, created_at = ?6`
  ).bind(from.id, String(gid), correct, JSON.stringify(options), lang, now()).run();

  await send(env, req.user_chat_id || from.id, t(lang, 'captcha_ask', { name: from.first_name || '', emoji: correct }), {
    reply_markup: captchaKeyboard(options),
  });
}

export async function onCaptchaButton(env, user, cq, parts) {
  const row = await env.DB.prepare('SELECT * FROM join_requests WHERE user_id = ?').bind(user.id).first();
  if (!row) return answer(env, cq, '✔️');
  const lang = row.lang || 'ua';
  const options = JSON.parse(row.options);
  const msg = cq.message;
  const picked = options[Number(parts[1])];

  if (picked === row.answer) {
    await env.DB.prepare('DELETE FROM join_requests WHERE user_id = ?').bind(user.id).run();
    const r = await tg(env, 'approveChatJoinRequest', { chat_id: row.chat_id, user_id: user.id });
    await logEvent(env, 'jr_ok', user.id);
    await tg(env, 'editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text: '✅' });
    await answer(env, cq);
    if (!r.ok && !/USER_ALREADY_PARTICIPANT/i.test(r.description || '')) {
      return send(env, user.id, t(lang, 'captcha_failed'));
    }
    return send(env, user.id, t(lang, 'captcha_ok', { bot: env.BOT_USERNAME || 'vus_ua_bot' }), { reply_markup: mainMenu(lang, false) });
  }

  const tries = row.tries + 1;
  if (tries >= CAPTCHA_TRIES) {
    await env.DB.prepare('DELETE FROM join_requests WHERE user_id = ?').bind(user.id).run();
    await logEvent(env, 'jr_fail', user.id);
    await tg(env, 'declineChatJoinRequest', { chat_id: row.chat_id, user_id: user.id });
    await tg(env, 'editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text: t(lang, 'captcha_failed') });
    return answer(env, cq);
  }
  const next = captchaOptions();
  await env.DB.prepare('UPDATE join_requests SET tries = ?, answer = ?, options = ? WHERE user_id = ?')
    .bind(tries, next.answer, JSON.stringify(next.options), user.id).run();
  await tg(env, 'editMessageText', {
    chat_id: msg.chat.id, message_id: msg.message_id,
    text: t(lang, 'captcha_wrong', { emoji: next.answer }), reply_markup: captchaKeyboard(next.options),
  });
  return answer(env, cq);
}

// ───────────────────────────── newcomers ─────────────────────────────

// Called when someone becomes a member of the group (any way of joining).
export async function onJoined(env, gid, member) {
  if (member.is_bot) return;
  const user = await upsertUser(env, member);
  await logEvent(env, 'gr_join', member.id);
  await env.DB.prepare("UPDATE group_invites SET status = 'joined' WHERE invitee_id = ? AND status = 'pending'").bind(member.id).run();
  if (user.isStaff) return;
  if (await casBanned(member.id)) return casBan(env, gid, member);

  const hours = Number(await getCfg(env, 'newbie_hours')) || 0;
  if (hours > 0) {
    await tg(env, 'restrictChatMember', {
      chat_id: gid, user_id: member.id, permissions: TEXT_ONLY,
      use_independent_chat_permissions: true, until_date: now() + hours * 3600,
    });
  }
  if ((await getCfg(env, 'welcome_on')) !== '1') return;

  // Keep only the latest welcome so the chat doesn't fill up with greetings.
  const prev = await getSetting(env, 'last_welcome_msg');
  if (prev) await tg(env, 'deleteMessage', { chat_id: gid, message_id: Number(prev) });
  const bot = env.BOT_USERNAME || 'vus_ua_bot';
  const r = await sendHtml(env, gid,
    `👋 Вітаємо, ${userLabel(member, member.id).replace(/ \(ID \d+\)$/, '')}!\n\n` +
    `Правила — у закріпленому повідомленні.${hours > 0 ? ` Перші ${hours} год можна надсилати лише текст.` : ''}\n` +
    `Оголошення подавайте безкоштовно через @${bot}`);
  if (r.ok) await setSetting(env, 'last_welcome_msg', r.result.message_id);
}

// ───────────────────────────── message filters ─────────────────────────────

const FOREIGN_RE = /[؀-ۿݐ-ݿ一-鿿぀-ヿऀ-ॿ฀-๿가-힯]/g;

function ownNames(env) {
  return [env.CHANNEL_USERNAME, env.GROUP_USERNAME, env.BOT_USERNAME].filter(Boolean).map((x) => x.toLowerCase());
}

function hasForeignLink(env, text, entities) {
  const own = ownNames(env);
  const urls = [];
  for (const e of entities || []) {
    if (e.type === 'url') urls.push(text.substr(e.offset, e.length));
    if (e.type === 'text_link') urls.push(e.url);
  }
  if (!urls.length && LINK_RE.test(text)) return true;
  return urls.some((u) => {
    const m = /t(?:elegram)?\.me\/([A-Za-z0-9_]+)/i.exec(u);
    return !(m && own.includes(m[1].toLowerCase()));
  });
}

async function hasForeignChannelMention(env, text, entities) {
  const own = ownNames(env);
  const names = (entities || []).filter((e) => e.type === 'mention')
    .map((e) => text.substr(e.offset + 1, e.length - 1).toLowerCase())
    .filter((n) => !own.includes(n))
    .slice(0, 3);
  for (const n of names) {
    const r = await tg(env, 'getChat', { chat_id: '@' + n });
    if (r.ok && (r.result.type === 'channel' || r.result.type === 'supergroup' || r.result.type === 'group')) return true;
  }
  return false;
}

async function violationOf(env, msg) {
  const text = msg.text || msg.caption || '';
  const entities = msg.entities || msg.caption_entities || [];
  const low = text.toLowerCase();

  if (msg.sender_chat && String(msg.sender_chat.id) !== String(env.CHANNEL_ID)) return 'повідомлення від імені іншого каналу';
  const o = msg.forward_origin;
  if (o && (o.type === 'channel' || o.type === 'chat') && !(o.chat && String(o.chat.id) === String(env.CHANNEL_ID))) {
    return 'пересилання з інших каналів заборонене';
  }
  if (msg.forward_from_chat && String(msg.forward_from_chat.id) !== String(env.CHANNEL_ID)) return 'пересилання з інших каналів заборонене';
  if (text && hasForeignLink(env, text, entities)) return 'посилання в чаті заборонені';
  if ((await getStopWords(env)).some((w) => low.includes(w))) return 'схоже на рекламу або спам';
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters >= 10 && (text.match(FOREIGN_RE) || []).length / letters > 0.3) return 'схоже на спам';
  if (text && (await hasForeignChannelMention(env, text, entities))) return 'реклама інших каналів заборонена';
  return null;
}

// Returns true if the message was removed.
export async function filterGroupMessage(env, msg) {
  if (msg.is_automatic_forward) return false;                         // пост з нашого каналу
  if (msg.sender_chat && String(msg.sender_chat.id) === String(msg.chat.id)) return false; // анонімний адмін
  if (msg.sender_chat && String(msg.sender_chat.id) === String(env.CHANNEL_ID)) return false;
  if (msg.from && msg.from.is_bot && !msg.sender_chat) return false;
  if ((msg.text || '').startsWith('/')) return false;
  if (msg.from && !msg.sender_chat && (await isStaffId(env, msg.from.id))) return false;

  const reason = await violationOf(env, msg);
  if (!reason) return false;
  return punishViolation(env, msg, reason);
}

// Removes the message, counts a violation (3 a day = 1-hour mute) and leaves one short hint in the chat.
export async function punishViolation(env, msg, reason) {
  await tg(env, 'deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id });
  if (msg.sender_chat) return true; // від імені каналу — просто видаляємо

  const uid = msg.from.id;
  await env.DB.prepare('INSERT INTO violations (user_id, created_at) VALUES (?, ?)').bind(uid, now()).run();
  await logEvent(env, 'filter', uid, reason);
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM violations WHERE user_id = ? AND created_at > ?').bind(uid, now() - DAY).first();

  let extra = '';
  if (c.n >= AUTO_MUTE_AFTER) {
    await tg(env, 'restrictChatMember', {
      chat_id: msg.chat.id, user_id: uid, permissions: NO_PERMS,
      use_independent_chat_permissions: true, until_date: now() + AUTO_MUTE_SECONDS,
    });
    await env.DB.prepare("INSERT INTO punishments (user_id, type, hours, until, reason, by_id, created_at) VALUES (?, 'mute', 1, ?, 'spam', 0, ?)")
      .bind(uid, now() + AUTO_MUTE_SECONDS, now()).run();
    await logAction(env, 0, 'auto_mute', uid, `${c.n} порушень за добу`);
    await env.DB.prepare('DELETE FROM violations WHERE user_id = ?').bind(uid).run();
    extra = '\n🔇 Третє порушення за добу — заборона писати на 1 годину.';
  }

  const prev = await getSetting(env, 'last_hint_msg');
  if (prev) await tg(env, 'deleteMessage', { chat_id: msg.chat.id, message_id: Number(prev) });
  const bot = env.BOT_USERNAME || 'vus_ua_bot';
  const r = await sendHtml(env, msg.chat.id,
    `🚫 ${userLabel(msg.from, uid).replace(/ \(ID \d+\)$/, '')}, повідомлення видалено: ${esc(reason)}.\n` +
    `Оголошення — безкоштовно через @${bot}${extra}`,
    msg.message_thread_id && msg.is_topic_message ? { message_thread_id: msg.message_thread_id } : {});
  if (r.ok) await setSetting(env, 'last_hint_msg', r.result.message_id);
  return true;
}

// ───────────────────────────── cron ─────────────────────────────

export async function cronGuard(env) {
  const { results } = await env.DB.prepare('SELECT * FROM join_requests WHERE created_at < ?').bind(now() - CAPTCHA_TIMEOUT).all();
  for (const r of results) {
    await tg(env, 'declineChatJoinRequest', { chat_id: r.chat_id, user_id: r.user_id });
    await logEvent(env, 'jr_fail', r.user_id, 'timeout');
    await env.DB.prepare('DELETE FROM join_requests WHERE user_id = ?').bind(r.user_id).run();
  }
  await env.DB.prepare('DELETE FROM violations WHERE created_at < ?').bind(now() - 2 * DAY).run();
}
