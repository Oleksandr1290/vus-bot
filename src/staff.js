// Reports, punishments, admin commands, admin applications, /setup, group moderation hooks.

import {
  tg, esc, now, fmtDate, t, DAY, MUTE_BAN_THRESHOLD,
  upsertUser, getUser, getSession, setSession, clearSession, getSetting, setSetting, getAd,
  isOwner, isAdminId, isStaffId, logAction, groupId,
  send, sendHtml, showMenu, menuFor, removeButtons, answer, pairs, whoName, userLabel, findUser,
  removeFromChannel, postLink, adByChannelMsg, adminCard, modButtons, mainMenu,
} from './common.js';
import { filterGroupMessage, onJoined, punishViolation } from './guard.js';
import { aiModerate, onAiButton, addExample, noteGroupMessage } from './ai.js';
import { showSettings, onSettingsButton, onSettingsInput } from './settings.js';
import { onInviteeBanned } from './referral.js';
import { refCount, levelOf, ADMIN_REFS_NEEDED, ADMIN_CMDS, OWNER_CMDS, setStaffCommands, syncAdminStatus, logEvent } from './common.js';
import { showStats, showMembers, memberStatsBlock, onStatsButton } from './stats.js';

const BOT = (env) => env.BOT_USERNAME || 'vus_ua_bot';

// Reasons as shown to admins (always Ukrainian).
const RR_UA = {
  scam: 'Шахрайство', spam: 'Спам / реклама', insult: 'Образи', forbidden: 'Заборонений товар',
  other: 'Інше', group: 'Скарга з групи (/report)',
  check: '🔍 На перевірку (/proverka)', ai: '🤖 Підозра нейромережі на рекламу',
};
const USER_REASONS = ['scam', 'spam', 'insult', 'forbidden', 'other'];

const reasonFor = (lang, key) => (key === 'group' ? t(lang, 'reason_rules') : t(lang, `rr_${key}`).replace(/^\S+\s/, ''));

const fmtDateTime = (ts) => {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${fmtDate(ts)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
};

// ───────────────────────────── commands ─────────────────────────────

export { ADMIN_CMDS, OWNER_CMDS } from './common.js';

// ───────────────────────────── user side: reporting ─────────────────────────────

async function reportLimitHit(env, user) {
  if (user.isStaff) return false;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM report_events WHERE reporter_id = ? AND created_at > ?')
    .bind(user.id, now() - DAY).first();
  return r.n >= 10;
}

const cancelRow = (lang) => [{ text: t(lang, 'cancel'), callback_data: 'nav:cancel' }];

export async function startReport(env, user, adId = null) {
  const L = user.lang;
  if (await reportLimitHit(env, user)) return send(env, user.id, t(L, 'report_limit'), { reply_markup: menuFor(env, user) });

  if (adId) {
    const ad = await getAd(env, Number(adId));
    if (!ad || ad.status !== 'published') return send(env, user.id, t(L, 'report_not_found'), { reply_markup: menuFor(env, user) });
    if (ad.user_id === user.id) return send(env, user.id, t(L, 'report_self'), { reply_markup: menuFor(env, user) });
    return askReason(env, user, { adId: ad.id, targetId: ad.user_id }, t(L, 'report_ad', { id: ad.id, title: ad.title }));
  }
  await setSession(env, user.id, 'rep:target', {});
  return send(env, user.id, t(L, 'report_ask'), { reply_markup: { inline_keyboard: [cancelRow(L)] } });
}

async function askReason(env, user, data, text) {
  await setSession(env, user.id, 'rep:reason', data);
  const btns = USER_REASONS.map((k) => ({ text: t(user.lang, `rr_${k}`), callback_data: `rep:r:${k}` }));
  return send(env, user.id, text, { reply_markup: { inline_keyboard: [...pairs(btns), cancelRow(user.lang)] } });
}

const isOurChannel = (env, chat) =>
  chat && (String(chat.id) === String(env.CHANNEL_ID) ||
    (chat.username && env.CHANNEL_USERNAME && chat.username.toLowerCase() === env.CHANNEL_USERNAME.toLowerCase()));

// Works out who or what a report is about from a forwarded message or text.
async function resolveTarget(env, msg) {
  const o = msg.forward_origin;
  if (o) {
    if (o.type === 'user') return { targetId: o.sender_user.id, from: o.sender_user };
    if (o.type === 'hidden_user') return { hidden: true };
    if (o.type === 'channel' && isOurChannel(env, o.chat)) {
      const ad = await adByChannelMsg(env, o.message_id);
      return ad ? { adId: ad.id, targetId: ad.user_id, ad } : null;
    }
    return null;
  }
  if (msg.forward_from) return { targetId: msg.forward_from.id, from: msg.forward_from };
  if (msg.forward_sender_name) return { hidden: true };

  const text = (msg.text || '').trim();
  const m = text.match(/t\.me\/(?:c\/(\d+)|([A-Za-z0-9_]+))\/(\d+)/i);
  if (m) {
    const internal = String(env.CHANNEL_ID).replace(/^-100/, '');
    const sameChannel = (m[1] && m[1] === internal) ||
      (m[2] && env.CHANNEL_USERNAME && m[2].toLowerCase() === env.CHANNEL_USERNAME.toLowerCase());
    if (!sameChannel) return null;
    const ad = await adByChannelMsg(env, Number(m[3]));
    return ad ? { adId: ad.id, targetId: ad.user_id, ad } : null;
  }
  if (/^@?[A-Za-z0-9_]{4,32}$/.test(text) || /^\d{5,15}$/.test(text)) {
    const u = await findUser(env, text);
    return u && !u.unknown ? { targetId: u.id, from: u } : (u && u.unknown ? { targetId: u.id } : null);
  }
  return null;
}

export async function onReportInput(env, user, session, msg) {
  const L = user.lang;
  if (session.state === 'rep:target') {
    const r = await resolveTarget(env, msg);
    if (!r) return send(env, user.id, t(L, 'report_not_found'), { reply_markup: { inline_keyboard: [cancelRow(L)] } });
    if (r.hidden) return send(env, user.id, t(L, 'report_hidden'), { reply_markup: { inline_keyboard: [cancelRow(L)] } });
    if (r.targetId === user.id) {
      await clearSession(env, user.id);
      return send(env, user.id, t(L, 'report_self'), { reply_markup: menuFor(env, user) });
    }
    if (r.from && !r.from.is_bot) await upsertUser(env, r.from).catch(() => {});
    if (r.ad) return askReason(env, user, { adId: r.ad.id, targetId: r.targetId }, t(L, 'report_ad', { id: r.ad.id, title: r.ad.title }));
    const target = await getUser(env, r.targetId);
    const name = target ? whoName(target) : `ID ${r.targetId}`;
    return askReason(env, user, { targetId: r.targetId }, t(L, 'report_user', { name }));
  }
  if (session.state === 'rep:note') {
    const text = (msg.text || '').trim();
    if (!text) return send(env, user.id, t(L, 'err_text'));
    if (text.length > 300) return send(env, user.id, t(L, 'err_long', { n: 300 }));
    await clearSession(env, user.id);
    await createReport(env, user, { ...session.data, note: text });
    return send(env, user.id, t(L, 'report_sent'), { reply_markup: menuFor(env, user) });
  }
}

export async function onReportButton(env, user, cq, parts) {
  const L = user.lang;
  const session = await getSession(env, user.id);
  if (parts[1] !== 'r' || session.state !== 'rep:reason') return answer(env, cq, t(L, 'stale'));
  await removeButtons(env, cq.message);
  await answer(env, cq);
  const reason = USER_REASONS.includes(parts[2]) ? parts[2] : 'other';
  const data = { ...session.data, reason };
  if (reason === 'other') {
    await setSession(env, user.id, 'rep:note', data);
    return send(env, user.id, t(L, 'report_other_text'), { reply_markup: { inline_keyboard: [cancelRow(L)] } });
  }
  await clearSession(env, user.id);
  await createReport(env, user, data);
  return send(env, user.id, t(L, 'report_sent'), { reply_markup: menuFor(env, user) });
}

// ───────────────────────────── reports: storage and cards ─────────────────────────────

export async function createReport(env, reporter, { targetId, adId = null, reason, note = null, msgLink = null, msgChat = null, msgId = null, msgText = null }) {
  await env.DB.prepare('INSERT INTO report_events (reporter_id, created_at) VALUES (?, ?)').bind(reporter.id, now()).run();

  const open = await env.DB.prepare(
    "SELECT * FROM reports WHERE status != 'closed' AND target_id IS ? AND ad_id IS ? ORDER BY id DESC LIMIT 1"
  ).bind(targetId ?? null, adId ?? null).first();

  if (open) {
    const reporters = JSON.parse(open.reporters || '[]');
    if (!reporters.includes(reporter.id)) reporters.push(reporter.id);
    const notes = [open.note, note].filter(Boolean).join(' / ').slice(0, 600) || null;
    await env.DB.prepare(
      'UPDATE reports SET reporters = ?, count = count + 1, note = ?, msg_link = COALESCE(?, msg_link), msg_chat = COALESCE(?, msg_chat), msg_id = COALESCE(?, msg_id), msg_text = COALESCE(?, msg_text) WHERE id = ?'
    ).bind(JSON.stringify(reporters), notes, msgLink, msgChat == null ? null : String(msgChat), msgId, msgText, open.id).run();
    await refreshReportCard(env, open.id);
    return open.id;
  }

  const res = await env.DB.prepare(
    `INSERT INTO reports (target_id, ad_id, reason, note, msg_link, msg_chat, msg_id, msg_text, reporters, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(targetId ?? null, adId ?? null, reason, note, msgLink, msgChat == null ? null : String(msgChat), msgId, msgText,
    JSON.stringify(reporter.id ? [reporter.id] : []), now()).run();
  const id = res.meta.last_row_id;

  // A report about an admin goes only to the owner.
  const aboutStaff = targetId && (await isStaffId(env, targetId));
  const chatId = aboutStaff ? env.OWNER_ID : env.ADMIN_CHAT_ID;
  const rep = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  const r = await sendHtml(env, chatId, await reportCard(env, rep), { reply_markup: reportCardButtons(env, rep) });
  if (r.ok) {
    await env.DB.prepare('UPDATE reports SET card_chat = ?, card_msg_id = ? WHERE id = ?').bind(String(chatId), r.result.message_id, id).run();
  }
  return id;
}

const reportCardButtons = (env, rep) =>
  rep.status === 'closed'
    ? { inline_keyboard: [] }
    : { inline_keyboard: [[{ text: 'Розібрати →', url: `https://t.me/${BOT(env)}?start=rep_${rep.id}` }]] };

async function punishmentSummary(env, uid) {
  if (!uid) return '';
  const { results } = await env.DB.prepare(
    "SELECT * FROM punishments WHERE user_id = ? AND type != 'unban' ORDER BY id DESC LIMIT 3"
  ).bind(uid).all();
  if (!results.length) return 'Раніше: порушень не було';
  const names = { warn: 'попередження', mute: 'мут', ban: 'бан' };
  return 'Раніше: ' + results.map((p) => `${names[p.type] || p.type}${p.hours ? ' ' + p.hours + ' год' : ''} (${fmtDate(p.created_at)})`).join(', ');
}

async function reportCard(env, rep, statusOverride = null) {
  const target = rep.target_id ? await getUser(env, rep.target_id) : null;
  const ad = rep.ad_id ? await getAd(env, rep.ad_id) : null;
  const reporterIds = JSON.parse(rep.reporters || '[]');
  const reporters = [];
  for (const id of reporterIds.slice(0, 3)) reporters.push(whoName(await getUser(env, id)));
  if (!reporterIds.length) reporters.push('🤖 нейромережа');
  if (reporterIds.length > 3) reporters.push(`ще ${reporterIds.length - 3}`);

  let s = `⚠️ <b>Скарга #${rep.id}</b>\n`;
  if (ad) {
    const ids = JSON.parse(ad.channel_msg_ids || '[]');
    const link = ids.length && ad.status === 'published' ? ` — <a href="${postLink(env, ids[0])}">пост</a>` : '';
    s += `Оголошення: #${ad.id} «${esc(ad.title)}»${link}\n`;
  }
  s += `На кого: ${rep.target_id ? userLabel(target, rep.target_id) : 'невідомо'}\n`;
  s += `Причина: ${RR_UA[rep.reason] || esc(rep.reason)}\n`;
  if (rep.note) s += `Коментар: ${esc(rep.note)}\n`;
  if (rep.msg_link) s += `Повідомлення: <a href="${rep.msg_link}">відкрити</a>${rep.msg_id ? '' : ' (уже видалено)'}\n`;
  if (rep.msg_text) s += `Текст: <i>${esc(rep.msg_text.slice(0, 500))}</i>\n`;
  s += `Скарг: ${rep.count} · Від: ${esc(reporters.join(', '))}\n`;
  s += `${await punishmentSummary(env, rep.target_id)}\n`;

  let status = statusOverride;
  if (!status) {
    if (rep.status === 'open') status = '🟡 Відкрита';
    else if (rep.status === 'in_work') status = `🟠 В роботі у ${esc(whoName(await getUser(env, rep.taken_by)))}`;
    else status = rep.decision || '✔️ Закрита';
  }
  return s + `────────────\n${status}`;
}

async function refreshReportCard(env, rid) {
  const rep = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(rid).first();
  if (!rep || !rep.card_msg_id) return;
  await tg(env, 'editMessageText', {
    chat_id: rep.card_chat, message_id: rep.card_msg_id, parse_mode: 'HTML', disable_web_page_preview: true,
    text: await reportCard(env, rep), reply_markup: reportCardButtons(env, rep),
  });
}

async function closeReport(env, rid, decKey, line, staff) {
  const rep = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(rid).first();
  if (!rep || rep.status === 'closed') return;
  const decision = `${line} — вирішив ${esc(whoName(staff))}`;
  await env.DB.prepare("UPDATE reports SET status = 'closed', decision = ?, decided_by = ?, closed_at = ? WHERE id = ?")
    .bind(decision, staff.id, now(), rid).run();
  await refreshReportCard(env, rid);
  for (const id of JSON.parse(rep.reporters || '[]')) {
    const u = await getUser(env, id);
    if (u) await send(env, u.id, t(u.lang || 'ua', 'report_result', { id: rid, decision: t(u.lang || 'ua', `dec_${decKey}`) }));
  }
}

// ───────────────────────────── admin: open a report ─────────────────────────────

const decisionButtons = (rep) => {
  const rows = [
    [{ text: '✅ Відхилити', callback_data: `adr:rej:${rep.id}` }, { text: '⚠️ Попередити', callback_data: `adr:warn:${rep.id}` }],
    [{ text: '🔇 Мут', callback_data: `adr:mute:${rep.id}` }, { text: '⛔ Бан', callback_data: `adr:ban:${rep.id}` }],
  ];
  if (rep.msg_id) rows.unshift([{ text: '🗑 Видалити повідомлення з чату', callback_data: `adr:delmsg:${rep.id}` }]);
  if (rep.reason === 'ai') rows[rows.length - 2][0] = { text: '✅ Це не реклама', callback_data: `adr:rej:${rep.id}` };
  if (rep.ad_id) {
    rows.push([{ text: '🗑 Видалити оголошення', callback_data: `adr:delad:${rep.id}` }]);
    rows.push([{ text: '⛔ Бан + видалити всі оголошення', callback_data: `adr:banall:${rep.id}` }]);
  }
  return { inline_keyboard: rows };
};

export async function openReport(env, staff, rid) {
  const rep = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(Number(rid)).first();
  if (!rep) return send(env, staff.id, 'Скаргу не знайдено.');
  if (rep.status === 'closed') return sendHtml(env, staff.id, await reportCard(env, rep));
  if (rep.target_id && (await isStaffId(env, rep.target_id)) && !staff.isOwner) {
    return send(env, staff.id, 'Скаргу на адміністратора розглядає лише власник.');
  }
  let note = '';
  if (rep.status === 'in_work' && rep.taken_by && rep.taken_by !== staff.id) {
    note = `\n\n⚠️ Цю скаргу вже розбирає ${esc(whoName(await getUser(env, rep.taken_by)))}. Рішення ухвалить той, хто натисне першим.`;
  }
  await env.DB.prepare("UPDATE reports SET status = 'in_work', taken_by = ? WHERE id = ?").bind(staff.id, rep.id).run();
  await refreshReportCard(env, rep.id);
  const fresh = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(rep.id).first();
  return sendHtml(env, staff.id, (await reportCard(env, fresh)) + note + '\n\nОберіть рішення:', { reply_markup: decisionButtons(fresh) });
}

// ───────────────────────────── punishments ─────────────────────────────

const NO_PERMS = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false, can_invite_users: false,
};
const ALL_PERMS = Object.fromEntries(Object.keys(NO_PERMS).map((k) => [k, true]));

async function canActOn(env, staff, uid) {
  if (isOwner(env, uid)) return 'Власника не можна покарати.';
  if (uid === staff.id) return 'Не можна застосувати дію до себе.';
  if ((await isAdminId(env, uid)) && !staff.isOwner) return 'Покарати адміністратора може лише власник.';
  return null;
}

async function notifyUser(env, uid, key, vars) {
  const u = await getUser(env, uid);
  const r = await send(env, uid, t((u && u.lang) || 'ua', key, vars));
  return r.ok;
}

async function applyWarn(env, staff, uid, reasonKey, rid = null) {
  await env.DB.prepare("INSERT INTO punishments (user_id, type, reason, by_id, report_id, created_at) VALUES (?, 'warn', ?, ?, ?, ?)")
    .bind(uid, reasonKey, staff.id, rid, now()).run();
  await logAction(env, staff.id, 'warn', uid, RR_UA[reasonKey] || reasonKey);
  const u = await getUser(env, uid);
  const delivered = await notifyUser(env, uid, 'warned_user', { reason: reasonFor((u && u.lang) || 'ua', reasonKey) });
  const gid = await groupId(env);
  if (!delivered && gid) {
    await sendHtml(env, gid, `⚠️ ${userLabel(u, uid)}, попередження від адміністрації ВУС. Будь ласка, дотримуйтесь правил групи.`);
  }
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM punishments WHERE user_id = ? AND type = 'warn' AND created_at > ?")
    .bind(uid, now() - 30 * DAY).first();
  if (rid) await closeReport(env, rid, 'warn', '⚠️ Попередження', staff);
  return `⚠️ Попередження винесено. За 30 днів у користувача попереджень: ${c.n}.` + (c.n >= 3 ? ' Це вже 3+ — варто дати мут.' : '');
}

async function applyMute(env, staff, uid, hours, reasonKey, rid = null) {
  const until = now() + hours * 3600;
  const gid = await groupId(env);
  let groupNote = '';
  if (gid) {
    const r = await tg(env, 'restrictChatMember', { chat_id: gid, user_id: uid, permissions: NO_PERMS, until_date: until, use_independent_chat_permissions: true });
    if (!r.ok) groupNote = `\n(Telegram: ${r.description})`;
  } else groupNote = '\n(Група ще не прив’язана — мут не застосовано в Telegram, напишіть /setup у групі.)';
  await env.DB.prepare("INSERT INTO punishments (user_id, type, hours, until, reason, by_id, report_id, created_at) VALUES (?, 'mute', ?, ?, ?, ?, ?, ?)")
    .bind(uid, hours, until, reasonKey, staff.id, rid, now()).run();
  await logAction(env, staff.id, 'mute', uid, `${hours} год`);
  const u = await getUser(env, uid);
  await notifyUser(env, uid, 'muted_user', { d: fmtDateTime(until), reason: reasonFor((u && u.lang) || 'ua', reasonKey) });
  if (rid) await closeReport(env, rid, 'mute', `🔇 Мут ${hours} год`, staff);
  return `🔇 Мут на ${hours} год (до ${fmtDateTime(until)}).${groupNote}`;
}

async function applyBan(env, staff, uid, reasonKey, rid = null, deleteAds = false) {
  const gid = await groupId(env);
  let groupNote = '';
  if (gid) {
    const r = await tg(env, 'banChatMember', { chat_id: gid, user_id: uid });
    if (!r.ok) groupNote = `\n(Telegram: ${r.description})`;
  }
  await env.DB.prepare('INSERT INTO users (id, first_name, created_at, banned) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET banned = 1')
    .bind(uid, '', now()).run();
  let removed = 0;
  if (deleteAds) {
    const { results } = await env.DB.prepare("SELECT * FROM ads WHERE user_id = ? AND status IN ('pending','published')").bind(uid).all();
    for (const ad of results) {
      if (ad.status === 'published') await removeFromChannel(env, ad);
      await env.DB.prepare("UPDATE ads SET status = 'deleted' WHERE id = ?").bind(ad.id).run();
      removed++;
    }
  }
  await env.DB.prepare("INSERT INTO punishments (user_id, type, reason, by_id, report_id, created_at) VALUES (?, 'ban', ?, ?, ?, ?)")
    .bind(uid, reasonKey, staff.id, rid, now()).run();
  await logAction(env, staff.id, 'ban', uid, deleteAds ? `+ видалено оголошень: ${removed}` : '');
  await onInviteeBanned(env, uid);
  const u = await getUser(env, uid);
  await notifyUser(env, uid, 'banned_user', { reason: reasonFor((u && u.lang) || 'ua', reasonKey) });
  if (rid) await closeReport(env, rid, 'ban', deleteAds ? `⛔ Бан + видалено оголошень: ${removed}` : '⛔ Вічний бан', staff);
  return `⛔ Користувача заблоковано назавжди.${deleteAds ? ` Видалено оголошень: ${removed}.` : ''}${groupNote}`;
}

async function applyUnban(env, staff, uid) {
  const gid = await groupId(env);
  const notes = [];
  if (gid) {
    const a = await tg(env, 'unbanChatMember', { chat_id: gid, user_id: uid, only_if_banned: true });
    if (!a.ok) notes.push(a.description);
    await tg(env, 'restrictChatMember', { chat_id: gid, user_id: uid, permissions: ALL_PERMS, use_independent_chat_permissions: true });
  }
  await env.DB.prepare('UPDATE users SET banned = 0 WHERE id = ?').bind(uid).run();
  await env.DB.prepare("INSERT INTO punishments (user_id, type, by_id, created_at) VALUES (?, 'unban', ?, ?)").bind(uid, staff.id, now()).run();
  await logAction(env, staff.id, 'unban', uid, '');
  await notifyUser(env, uid, 'unbanned_user', {});
  return `✅ Обмеження знято.${notes.length ? `\n(Telegram: ${notes.join('; ')})` : ''}`;
}

async function deleteReportedAd(env, staff, rid) {
  const rep = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(rid).first();
  const ad = rep && rep.ad_id ? await getAd(env, rep.ad_id) : null;
  if (!ad) return 'Оголошення не знайдено.';
  if (ad.status === 'published') await removeFromChannel(env, ad);
  await env.DB.prepare("UPDATE ads SET status = 'deleted' WHERE id = ?").bind(ad.id).run();
  await logAction(env, staff.id, 'delete_ad', ad.user_id, `#${ad.id}`);
  await notifyUser(env, ad.user_id, 'ad_removed_mod', { id: ad.id });
  await closeReport(env, rid, 'delad', `🗑 Оголошення #${ad.id} видалено`, staff);
  return `🗑 Оголошення #${ad.id} видалено з каналу.`;
}

// ───────────────────────────── admin screens ─────────────────────────────

export async function showPanel(env, user) {
  const q = (sql) => env.DB.prepare(sql).first();
  const ads = await q("SELECT COUNT(*) AS n FROM ads WHERE status = 'pending'");
  const reps = await q("SELECT COUNT(*) AS n FROM reports WHERE status != 'closed'");
  const rows = [
    [{ text: `📥 Оголошення (${ads.n})`, callback_data: 'pan:ads' }, { text: `⚠️ Скарги (${reps.n})`, callback_data: 'pan:reports' }],
    [{ text: '🔎 Знайти користувача', callback_data: 'pan:user' }, { text: '📜 Журнал рішень', callback_data: 'pan:log' }],
  ];
  if (user.isOwner) {
    rows.push([{ text: '📈 Статистика', callback_data: 'pan:stats' }, { text: '👥 Учасники', callback_data: 'pan:members' }]);
    rows.push([{ text: '⚙️ Налаштування', callback_data: 'pan:settings' }]);
    const apps = await q("SELECT COUNT(*) AS n FROM applications WHERE status = 'pending'");
    rows.push([{ text: `🙋 Заявки в адміни (${apps.n})`, callback_data: 'pan:apps' }, { text: '📢 Новина', callback_data: 'pan:post' }]);
    rows.push([{ text: '📌 Оновити довідку і права (/setup)', callback_data: 'pan:setup' }]);
  }
  return sendHtml(env, user.id, `🛡 <b>Адмін-панель ВУС</b>${user.isOwner ? ' · власник' : ''}`, { reply_markup: { inline_keyboard: rows } });
}

export async function listPendingAds(env, user) {
  const { results: rows } = await env.DB.prepare("SELECT * FROM ads WHERE status = 'pending' ORDER BY id LIMIT 30").all();
  if (!rows.length) return send(env, user.id, '📥 Немає оголошень на модерації.');
  for (const ad of rows) ad.priority = (await levelOf(env, ad.user_id)).priority ? 1 : 0;
  const results = rows.sort((a, b) => b.priority - a.priority || a.id - b.id).slice(0, 10);
  for (const ad of results) {
    const author = await getUser(env, ad.user_id);
    const photos = JSON.parse(ad.photos || '[]');
    if (photos.length === 1) await tg(env, 'sendPhoto', { chat_id: user.id, photo: photos[0] });
    if (photos.length > 1) await tg(env, 'sendMediaGroup', { chat_id: user.id, media: photos.map((p) => ({ type: 'photo', media: p })) });
    await sendHtml(env, user.id, adminCard(env, ad, author), { reply_markup: modButtons(ad.id) });
  }
}

async function listReports(env, user) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM reports WHERE status != 'closed' ORDER BY CASE WHEN reason = 'check' THEN 0 WHEN reason = 'ai' THEN 1 ELSE 2 END, id LIMIT 20"
  ).all();
  if (!results.length) return send(env, user.id, '⚠️ Незавершених скарг немає.');
  const rows = [];
  let text = '⚠️ <b>Незавершені скарги</b>\n\n';
  for (const r of results) {
    const target = r.target_id ? await getUser(env, r.target_id) : null;
    const st = r.status === 'in_work' ? '🟠' : '🟡';
    text += `${st} #${r.id} · ${esc(whoName(target))} · ${RR_UA[r.reason] || r.reason} · скарг: ${r.count}\n`;
    rows.push({ text: `Розібрати #${r.id}`, callback_data: `adr:open:${r.id}` });
  }
  return sendHtml(env, user.id, text, { reply_markup: { inline_keyboard: pairs(rows) } });
}

const ACTION_UA = {
  warn: '⚠️ попередження', mute: '🔇 мут', ban: '⛔ бан', unban: '✅ розбан', delete_ad: '🗑 видалив оголошення',
  publish_ad: '✅ опублікував', reject_ad: '❌ відхилив', reject_report: '✅ відхилив скаргу', admin_add: '🛡 новий адмін',
  admin_remove: '➖ зняв адміна', post: '📢 новина', setup: '📌 /setup',
  auto_mute: '🔇 автомут за спам', cas_ban: '🛡 бан за базою CAS', ref_block: '🚫 виключено з програми запрошень',
  settings: '⚙️ налаштування', ai_mistake: '↩️ помилка нейромережі', night_close: '🔒 нічний режим', night_open: '🔓 чат відкрито',
  check: '🔍 на перевірку', delete_msg: '🗑 видалив повідомлення',
};

async function showLog(env, user) {
  const { results } = await env.DB.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT 20').all();
  if (!results.length) return send(env, user.id, '📜 Журнал порожній.');
  let text = '📜 <b>Останні рішення</b>\n\n';
  for (const r of results) {
    const a = r.admin_id ? await getUser(env, r.admin_id) : { first_name: '🤖 бот' };
    const target = r.target_id ? await getUser(env, r.target_id) : null;
    const d = new Date(r.created_at * 1000);
    const p = (n) => String(n).padStart(2, '0');
    text += `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} · ${esc(whoName(a))}: ${ACTION_UA[r.action] || r.action}` +
      (r.target_id ? ` → ${esc(target ? whoName(target) : 'ID ' + r.target_id)}` : '') +
      (r.details ? ` (${esc(r.details)})` : '') + '\n';
  }
  return sendHtml(env, user.id, text);
}

async function userCard(env, staff, query) {
  const u = await findUser(env, query);
  if (!u) return send(env, staff.id, 'Користувача не знайдено. Бот знає лише тих, хто писав боту або в групі. Спробуйте числовий ID.');
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
  const ads = await q("SELECT COUNT(*) AS n, SUM(status = 'published') AS p FROM ads WHERE user_id = ?", u.id);
  const reps = await q('SELECT COUNT(*) AS n FROM reports WHERE target_id = ?', u.id);
  const role = isOwner(env, u.id) ? '👑 власник' : (await isAdminId(env, u.id)) ? '🛡 адмін' : 'учасник';
  const text = `👤 <b>Картка користувача</b>\n\n${userLabel(u.unknown ? null : u, u.id)}\n` +
    `Роль: ${role}\n` +
    (u.created_at ? `У боті з: ${fmtDate(u.created_at)}\n` : '') +
    `Статус: ${u.banned ? '⛔ заблокований' : 'активний'}\n` +
    `Оголошень: ${ads.n || 0} (активних ${ads.p || 0})\n` +
    `Скарг на нього: ${reps.n}\n` +
    `${await punishmentSummary(env, u.id)}` +
    (staff.isOwner ? '\n\n' + (await memberStatsBlock(env, u.id)) : '');
  return sendHtml(env, staff.id, text, {
    reply_markup: { inline_keyboard: [
      [{ text: '⚠️ Попередити', callback_data: `usr:warn:${u.id}` }, { text: '🔇 Мут', callback_data: `usr:mute:${u.id}` }],
      [{ text: '⛔ Бан', callback_data: `usr:ban:${u.id}` }, { text: '✅ Зняти обмеження', callback_data: `usr:unban:${u.id}` }],
    ] },
  });
}

// ───────────────────────────── admin applications ─────────────────────────────

export async function startApplication(env, user) {
  const L = user.lang;
  if (user.isStaff) return send(env, user.id, t(L, 'app_already'), { reply_markup: menuFor(env, user) });
  const refs = await refCount(env, user.id, 'admin');
  if (refs < ADMIN_REFS_NEEDED) {
    return send(env, user.id, t(L, 'app_need_refs', { n: refs, need: ADMIN_REFS_NEEDED }), {
      reply_markup: { inline_keyboard: [[{ text: t(L, 'app_open_program'), callback_data: 'ref:join:admin' }]] },
    });
  }
  const last = await env.DB.prepare('SELECT created_at FROM applications WHERE user_id = ? ORDER BY id DESC LIMIT 1').bind(user.id).first();
  if (last && last.created_at > now() - 30 * DAY) return send(env, user.id, t(L, 'app_cooldown'), { reply_markup: menuFor(env, user) });
  await setSession(env, user.id, 'app:1', { answers: [] });
  await send(env, user.id, t(L, 'app_intro'));
  return send(env, user.id, t(L, 'app_q1'), { reply_markup: { inline_keyboard: [cancelRow(L)] } });
}

export async function onApplicationInput(env, user, session, msg) {
  const L = user.lang;
  const text = (msg.text || '').trim();
  if (!text) return send(env, user.id, t(L, 'err_text'));
  if (text.length > 400) return send(env, user.id, t(L, 'err_long', { n: 400 }));
  const step = Number(session.state.split(':')[1]);
  const answers = [...(session.data.answers || []), text];
  if (step < 4) {
    await setSession(env, user.id, `app:${step + 1}`, { answers });
    return send(env, user.id, t(L, `app_q${step + 1}`), { reply_markup: { inline_keyboard: [cancelRow(L)] } });
  }
  await clearSession(env, user.id);
  const res = await env.DB.prepare('INSERT INTO applications (user_id, answers, created_at) VALUES (?, ?, ?)')
    .bind(user.id, JSON.stringify(answers), now()).run();
  const id = res.meta.last_row_id;
  const card = applicationCard({ id, answers: JSON.stringify(answers) }, user);
  const r = await sendHtml(env, env.ADMIN_CHAT_ID, card, { reply_markup: appButtons(id) });
  if (r.ok) await env.DB.prepare('UPDATE applications SET card_msg_id = ? WHERE id = ?').bind(r.result.message_id, id).run();
  return send(env, user.id, t(L, 'app_sent'), { reply_markup: menuFor(env, user) });
}

const APP_Q = ['Країна і місто', 'Час на день', 'Досвід', 'Чому хоче'];

function applicationCard(app, user, status = '') {
  const a = JSON.parse(app.answers || '[]');
  return `🙋 <b>Заявка в адміни #${app.id}</b>\nВід: ${userLabel(user, user ? user.id : app.user_id)}\n\n` +
    a.map((x, i) => `<b>${APP_Q[i]}:</b> ${esc(x)}`).join('\n') +
    `\n────────────\n${status || '🟡 Чекає рішення власника'}`;
}

const appButtons = (id) => ({ inline_keyboard: [[
  { text: '✅ Призначити', callback_data: `app:ok:${id}` }, { text: '❌ Відмовити', callback_data: `app:no:${id}` },
]] });

async function listApplications(env, user) {
  const { results } = await env.DB.prepare("SELECT * FROM applications WHERE status = 'pending' ORDER BY id LIMIT 10").all();
  if (!results.length) return send(env, user.id, '🙋 Нових заявок немає.');
  for (const a of results) await sendHtml(env, user.id, applicationCard(a, await getUser(env, a.user_id)), { reply_markup: appButtons(a.id) });
}

async function adminInviteLink(env, uid) {
  const r = await tg(env, 'createChatInviteLink', { chat_id: env.ADMIN_CHAT_ID, member_limit: 1, name: `admin ${uid}` });
  return r.ok ? r.result.invite_link : null;
}

// Makes a user an admin in the bot: role, commands, invite to the admin channel.
export async function addAdmin(env, uid, byId) {
  await env.DB.prepare('INSERT INTO admins (user_id, added_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING').bind(uid, now()).run();
  await env.DB.prepare(
    'INSERT INTO admin_cache (user_id, is_admin, checked_at) VALUES (?1, 1, ?2) ON CONFLICT(user_id) DO UPDATE SET is_admin = 1, checked_at = ?2'
  ).bind(uid, now()).run();
  await setStaffCommands(env, uid, false);
  await logAction(env, byId || uid, 'admin_add', uid, '');
  const u = await getUser(env, uid);
  const lang = (u && u.lang) || 'ua';
  const link = await adminInviteLink(env, uid);
  await send(env, uid, t(lang, 'admin_added', { link: link ? t(lang, 'admin_link', { link }) : '' }), {
    reply_markup: mainMenu(lang, true),
  });
}

export async function removeAdmin(env, uid, byId) {
  await env.DB.prepare('DELETE FROM admins WHERE user_id = ?').bind(uid).run();
  await tg(env, 'deleteMyCommands', { scope: { type: 'chat', chat_id: uid } });
  // Remove from the admin channel (ban + unban = kick without a permanent ban).
  await tg(env, 'banChatMember', { chat_id: env.ADMIN_CHAT_ID, user_id: uid });
  await tg(env, 'unbanChatMember', { chat_id: env.ADMIN_CHAT_ID, user_id: uid, only_if_banned: true });
  await logAction(env, byId || uid, 'admin_remove', uid, '');
  const u = await getUser(env, uid);
  await send(env, uid, t((u && u.lang) || 'ua', 'admin_removed'), {
    reply_markup: mainMenu((u && u.lang) || 'ua', false),
  });
}

async function decideApplication(env, owner, cq, approve, id) {
  const app = await env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(id).first();
  if (!app) return answer(env, cq, 'Заявку не знайдено');
  if (app.status !== 'pending') { await removeButtons(env, cq.message); return answer(env, cq, 'Вже вирішено'); }
  const u = await getUser(env, app.user_id);
  let status;
  if (approve) {
    const gid = await groupId(env);
    let note = '';
    if (gid) {
      const r = await tg(env, 'promoteChatMember', {
        chat_id: gid, user_id: app.user_id,
        can_manage_chat: true, can_delete_messages: true, can_restrict_members: true, can_pin_messages: true,
        can_invite_users: true, can_manage_topics: true,
      });
      if (!r.ok) note = ` (у групі не призначено: ${esc(r.description)} — додайте людину в групу й повторіть /setup або призначте вручну)`;
    }
    await addAdmin(env, app.user_id, owner.id);
    status = `✅ Призначено адміном — ${esc(whoName(owner))}${note}`;
  } else {
    await send(env, app.user_id, t((u && u.lang) || 'ua', 'app_rejected'));
    status = `❌ Відмовлено — ${esc(whoName(owner))}`;
  }
  await env.DB.prepare('UPDATE applications SET status = ?, decided_by = ? WHERE id = ?').bind(approve ? 'approved' : 'rejected', owner.id, id).run();
  await tg(env, 'editMessageText', {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id, parse_mode: 'HTML',
    text: applicationCard(app, u, status), reply_markup: { inline_keyboard: [] },
  });
  // Keep the copy in the admin channel in sync when deciding from the private chat.
  if (app.card_msg_id && String(cq.message.chat.id) !== String(env.ADMIN_CHAT_ID)) {
    await tg(env, 'editMessageText', { chat_id: env.ADMIN_CHAT_ID, message_id: app.card_msg_id, parse_mode: 'HTML', text: applicationCard(app, u, status) });
  }
  return answer(env, cq, approve ? 'Призначено' : 'Відмовлено');
}

// ───────────────────────────── /setup ─────────────────────────────

const GROUP_RULES = (env) => `📌 <b>Правила ВУС</b>

1. Поважай співрозмовників. Без образ, погроз і цькування.
2. Жодної реклами та посилань у чаті — оголошення подавай через @${BOT(env)}, це безкоштовно.
3. Заборонено: спам, шахрайство, наркотики, зброя, порнографія, пропаганда ворога.
4. Не пиши учасникам в особисті з рекламою чи «вигідними пропозиціями».
5. Пиши в тему — для кожного питання є свій розділ.

Помітив порушника? Дай відповідь на його повідомлення командою /report

За порушення: попередження → заборона писати на кілька годин → вічний бан.
Шахраї отримують бан одразу.`;

function adminHelpText(env) {
  const cmds = ADMIN_CMDS.filter((c) => c.command !== 'start').map((c) => `/${c.command} — ${c.description}`).join('\n');
  const own = OWNER_CMDS.slice(ADMIN_CMDS.length).map((c) => `/${c.command} — ${c.description}`).join('\n');
  return `🛡 <b>Довідка адміністратора ВУС</b>
Оновлено: ${fmtDate(now())}

<b>Команди</b> (у боті @${BOT(env)}, меню «/» або кнопка «🛡 Адмін-панель»):
${cmds}

<b>Лише власник:</b>
${own}

<b>Оголошення</b>
Нові оголошення приходять сюди карткою → ✅ Опублікувати або ❌ Відхилити з причиною. Автор отримує відповідь автоматично.

<b>Скарги</b>
0. Підозріле повідомлення в групі: дайте на нього відповідь командою /proverka — картка прийде сюди, у чаті ніхто нічого не побачить
1. Сюди приходить картка скарги → «Розібрати →»
2. У боті оберіть рішення: відхилити, попередити, мут (у годинах), бан, видалити оголошення
3. Мут понад ${MUTE_BAN_THRESHOLD} годин = вічний бан
4. Картка тут оновиться сама, автор скарги отримає відповідь

<b>Нейромережа</b>
Бот сам перевіряє підозрілі повідомлення в групі. Явну рекламу видаляє одразу (під карткою тут кнопка «↩️ Це була помилка»), сумнівну присилає сюди як скаргу з кнопками «🗑 Видалити повідомлення» і «✅ Це не реклама». Ваші відповіді «не реклама» бот запам'ятовує як приклади.

<b>Програма запрошень</b>
Анкету в адміни можна подати лише після ${ADMIN_REFS_NEEDED} зарахованих запрошень. Запрошення рахуються через 3 дні в каналі; якщо запрошеного забанити, він не рахується.

<b>Правила для адмінів</b>
• Кожне рішення записується в журнал (/log)
• Сумнівний випадок — залиште власнику
• Скарги на адмінів бачить лише власник`;
}

async function checkRights(env, botId, chatId, need, title) {
  if (!chatId) return `➖ ${title}: не налаштовано`;
  const r = await tg(env, 'getChatMember', { chat_id: chatId, user_id: botId });
  if (!r.ok) return `❌ ${title}: ${r.description}`;
  const m = r.result;
  if (m.status !== 'administrator') return `❌ ${title}: бот не адміністратор`;
  const missing = need.filter(([k]) => !m[k]).map(([, n]) => n);
  return missing.length ? `⚠️ ${title}: не вистачає прав — ${missing.join(', ')}` : `✅ ${title}: усі права є`;
}

export async function runSetup(env, owner, groupChat = null) {
  const lines = [];
  if (groupChat) {
    await setSetting(env, 'group_id', groupChat.id);
    lines.push(`✅ Групу «${esc(groupChat.title || '')}» прив’язано (ID ${groupChat.id})`);
  }
  const me = await tg(env, 'getMe');
  const botId = me.ok ? me.result.id : null;
  const gid = await groupId(env);

  // 1. Rights.
  lines.push(await checkRights(env, botId, env.CHANNEL_ID, [
    ['can_post_messages', 'публікація'], ['can_edit_messages', 'редагування'], ['can_delete_messages', 'видалення'],
    ['can_invite_users', 'запрошення (для програми запрошень)'],
  ], 'Канал оголошень'));
  lines.push(await checkRights(env, botId, env.ADMIN_CHAT_ID, [
    ['can_post_messages', 'публікація'], ['can_edit_messages', 'редагування'], ['can_invite_users', 'запрошення'],
  ], 'Канал адмінів'));
  lines.push(gid ? await checkRights(env, botId, gid, [
    ['can_delete_messages', 'видалення'], ['can_restrict_members', 'блокування'], ['can_pin_messages', 'закріплення'],
    ['can_promote_members', 'призначення адмінів'], ['can_invite_users', 'запрошення'],
  ], 'Група') : '➖ Група: ще не прив’язана — додайте бота адміном у групу й напишіть там /setup');

  // 2. Pinned guide in the admin channel (edited in place on repeat runs).
  const helpId = await getSetting(env, 'admin_help_msg');
  let helpOk = false;
  if (helpId) {
    const r = await tg(env, 'editMessageText', { chat_id: env.ADMIN_CHAT_ID, message_id: Number(helpId), text: adminHelpText(env), parse_mode: 'HTML', disable_web_page_preview: true });
    helpOk = r.ok || /not modified/i.test(r.description || '');
  }
  if (!helpOk) {
    const r = await sendHtml(env, env.ADMIN_CHAT_ID, adminHelpText(env));
    if (r.ok) {
      await setSetting(env, 'admin_help_msg', r.result.message_id);
      await tg(env, 'pinChatMessage', { chat_id: env.ADMIN_CHAT_ID, message_id: r.result.message_id, disable_notification: true });
      helpOk = true;
    }
  }
  lines.push(helpOk ? '✅ Довідку для адмінів опубліковано й закріплено' : '❌ Не вдалося опублікувати довідку в каналі адмінів');

  // 3. Pinned rules in the group.
  if (gid) {
    const rulesId = await getSetting(env, 'rules_msg');
    let ok = false;
    if (rulesId) {
      const r = await tg(env, 'editMessageText', { chat_id: gid, message_id: Number(rulesId), text: GROUP_RULES(env), parse_mode: 'HTML' });
      ok = r.ok || /not modified/i.test(r.description || '');
    }
    if (!ok) {
      const r = await sendHtml(env, gid, GROUP_RULES(env));
      if (r.ok) {
        await setSetting(env, 'rules_msg', r.result.message_id);
        await tg(env, 'pinChatMessage', { chat_id: gid, message_id: r.result.message_id, disable_notification: true });
        ok = true;
      }
    }
    lines.push(ok ? '✅ Правила групи опубліковано й закріплено' : '❌ Не вдалося закріпити правила в групі');

    // 4. Sync admins from the group.
    const admins = await tg(env, 'getChatAdministrators', { chat_id: gid });
    if (admins.ok) {
      let added = 0;
      for (const m of admins.result) {
        if (m.user.is_bot || isOwner(env, m.user.id)) continue;
        await upsertUser(env, m.user);
        if (!(await isAdminId(env, m.user.id))) { await addAdmin(env, m.user.id, owner.id); added++; }
      }
      lines.push(`✅ Адміни групи синхронізовані${added ? ` (нових: ${added})` : ''}`);
    }
  }

  // 5. Commands.
  await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Головне меню' }] });
  await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Главное меню' }], language_code: 'ru' });
  await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Main menu' }], language_code: 'en' });
  await setStaffCommands(env, env.OWNER_ID, true);
  const { results } = await env.DB.prepare('SELECT user_id FROM admins').all();
  for (const a of results) await setStaffCommands(env, a.user_id, false);
  lines.push(`✅ Команди оновлено (власник + адмінів: ${results.length})`);

  await logAction(env, owner.id, 'setup', null, '');
  return sendHtml(env, owner.id, `📌 <b>Налаштування ВУС</b>\n\n${lines.join('\n')}`);
}

// ───────────────────────────── staff commands and buttons ─────────────────────────────

export async function onStaffCommand(env, user, cmd, args) {
  switch (cmd) {
    case 'ads': return listPendingAds(env, user);
    case 'reports': return listReports(env, user);
    case 'log': return showLog(env, user);
    case 'user':
      if (!args) { await setSession(env, user.id, 'adm:user', {}); return send(env, user.id, 'Надішліть @нік або числовий ID користувача:'); }
      return userCard(env, user, args);
    case 'unban': {
      if (!args) return send(env, user.id, 'Формат: /unban @нік або /unban 123456789');
      const u = await findUser(env, args);
      if (!u) return send(env, user.id, 'Користувача не знайдено.');
      const deny = await canActOn(env, user, u.id);
      if (deny) return send(env, user.id, deny);
      return send(env, user.id, await applyUnban(env, user, u.id));
    }
  }
  if (!user.isOwner) return false;
  switch (cmd) {
    case 'stats': return showStats(env, user, 'week');
    case 'members': return showMembers(env, user);
    case 'settings': return showSettings(env, user);
    case 'applications': return listApplications(env, user);
    case 'setup': {
      if (!args) return runSetup(env, user);
      // /setup @group or /setup -100123… — bind the group from the private chat.
      const chatRef = /^-?\d+$/.test(args) ? Number(args) : '@' + args.replace(/^@|^https?:\/\/t\.me\//g, '');
      const chat = await tg(env, 'getChat', { chat_id: chatRef });
      if (!chat.ok) return send(env, user.id, `Не вдалося знайти групу ${args}: ${chat.description}. Перевірте, що бот доданий у групу.`);
      if (chat.result.type !== 'supergroup' && chat.result.type !== 'group') return send(env, user.id, 'Це не група. Вкажіть @юзернейм або ID саме групи.');
      const me = await tg(env, 'getChatMember', { chat_id: chat.result.id, user_id: user.id });
      if (!me.ok || !['creator', 'administrator'].includes(me.result.status)) return send(env, user.id, 'Ви не є адміністратором цієї групи.');
      return runSetup(env, user, chat.result);
    }
    case 'post':
      await setSession(env, user.id, 'adm:post', {});
      return send(env, user.id, '📢 Надішліть новину одним повідомленням: текст, фото з підписом або відео. Я покажу кнопки публікації.',
        { reply_markup: { inline_keyboard: [[{ text: '✖️ Скасувати', callback_data: 'nav:cancel' }]] } });
  }
  return false;
}

export async function onStaffInput(env, user, session, msg) {
  const text = (msg.text || '').trim();
  const data = session.data;

  if (session.state === 'adm:user') {
    await clearSession(env, user.id);
    return userCard(env, user, text);
  }

  if (session.state.startsWith('adm:cfg_') && user.isOwner) return onSettingsInput(env, user, session, msg);

  if (session.state === 'adm:mute') {
    if (!/^\d{1,6}$/.test(text) || Number(text) < 1) return send(env, user.id, 'Введіть ціле число годин, наприклад 24:');
    const hours = Number(text);
    if (hours > MUTE_BAN_THRESHOLD) {
      await setSession(env, user.id, 'adm:mute', { ...data, hours });
      return send(env, user.id, `Мут понад ${MUTE_BAN_THRESHOLD} годин = вічний бан. Підтвердити бан?`, {
        reply_markup: { inline_keyboard: [[
          { text: '⛔ Так, вічний бан', callback_data: 'adm:banok' }, { text: '↩️ Ввести інше число', callback_data: 'adm:banno' },
        ]] },
      });
    }
    await clearSession(env, user.id);
    return send(env, user.id, await applyMute(env, user, data.uid, hours, data.reason || 'group', data.rid || null));
  }

  if (session.state === 'adm:post') {
    await clearSession(env, user.id);
    const mid = msg.message_id;
    return send(env, user.id, 'Куди опублікувати цю новину?', {
      reply_to_message_id: mid,
      reply_markup: { inline_keyboard: [
        [{ text: '📢 Канал + група', callback_data: `post:all:${mid}` }, { text: '📢 Тільки канал', callback_data: `post:ch:${mid}` }],
        [{ text: '✖️ Скасувати', callback_data: 'post:no:0' }],
      ] },
    });
  }
}

export async function onStaffButton(env, user, cq, parts) {
  const [kind, action, arg] = parts;

  if (kind === 'pan') {
    await answer(env, cq);
    switch (action) {
      case 'ads': return listPendingAds(env, user);
      case 'reports': return listReports(env, user);
      case 'log': return showLog(env, user);
      case 'user': await setSession(env, user.id, 'adm:user', {}); return send(env, user.id, 'Надішліть @нік або числовий ID користувача:');
    }
    if (!user.isOwner) return;
    switch (action) {
      case 'stats': return showStats(env, user, 'week');
      case 'members': return showMembers(env, user);
      case 'settings': return showSettings(env, user);
      case 'apps': return listApplications(env, user);
      case 'post': return onStaffCommand(env, user, 'post', '');
      case 'setup': return runSetup(env, user);
    }
    return;
  }

  if (kind === 'cfg') return onSettingsButton(env, user, cq, parts);
  if (kind === 'ai') return onAiButton(env, user, cq, parts);

  if (kind === 'st') {
    if (!user.isOwner) return answer(env, cq, 'Статистика доступна лише власнику', true);
    if (action === 'u') { await answer(env, cq); return userCard(env, user, arg); }
    if (action === 'find') {
      await answer(env, cq);
      await setSession(env, user.id, 'adm:user', {});
      return send(env, user.id, 'Надішліть @нік або числовий ID учасника:');
    }
    return onStatsButton(env, user, cq, parts);
  }

  if (kind === 'adr') {
    const rid = Number(arg);
    if (action === 'open') { await answer(env, cq); return openReport(env, user, rid); }
    const rep = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(rid).first();
    if (!rep || rep.status === 'closed') { await removeButtons(env, cq.message); return answer(env, cq, 'Скаргу вже закрито', true); }
    if (rep.target_id) {
      const deny = action === 'rej' || action === 'delad' || action === 'delmsg' ? null : await canActOn(env, user, rep.target_id);
      if (deny) return answer(env, cq, deny, true);
    }
    await removeButtons(env, cq.message);
    await answer(env, cq);
    switch (action) {
      case 'delmsg': {
        if (rep.msg_chat && rep.msg_id) await tg(env, 'deleteMessage', { chat_id: rep.msg_chat, message_id: rep.msg_id });
        await env.DB.prepare('UPDATE reports SET msg_id = NULL WHERE id = ?').bind(rid).run();
        await logAction(env, user.id, 'delete_msg', rep.target_id, `#${rid}`);
        await refreshReportCard(env, rid);
        await send(env, user.id, '🗑 Повідомлення видалено з чату. Тепер оберіть рішення щодо автора або закрийте скаргу.');
        return openReport(env, user, rid);
      }
      case 'rej':
        if (rep.reason === 'ai' && rep.msg_text) await addExample(env, rep.msg_text);
        await logAction(env, user.id, 'reject_report', rep.target_id, `#${rid}`);
        await closeReport(env, rid, 'reject', '✅ Відхилено, порушень немає', user);
        return send(env, user.id, `✅ Скаргу #${rid} відхилено.`);
      case 'warn': return send(env, user.id, await applyWarn(env, user, rep.target_id, rep.reason, rid));
      case 'mute':
        await setSession(env, user.id, 'adm:mute', { uid: rep.target_id, rid, reason: rep.reason });
        return send(env, user.id, `На скільки годин заборонити писати? Введіть число (понад ${MUTE_BAN_THRESHOLD} = вічний бан):`);
      case 'ban': return send(env, user.id, await applyBan(env, user, rep.target_id, rep.reason, rid, false));
      case 'banall': return send(env, user.id, await applyBan(env, user, rep.target_id, rep.reason, rid, true));
      case 'delad': return send(env, user.id, await deleteReportedAd(env, user, rid));
    }
    return;
  }

  if (kind === 'usr') {
    const uid = Number(arg);
    const deny = await canActOn(env, user, uid);
    if (deny) return answer(env, cq, deny, true);
    await answer(env, cq);
    switch (action) {
      case 'warn': return send(env, user.id, await applyWarn(env, user, uid, 'group'));
      case 'mute':
        await setSession(env, user.id, 'adm:mute', { uid, rid: null, reason: 'group' });
        return send(env, user.id, `На скільки годин заборонити писати? Введіть число (понад ${MUTE_BAN_THRESHOLD} = вічний бан):`);
      case 'ban': return send(env, user.id, await applyBan(env, user, uid, 'group'));
      case 'unban': return send(env, user.id, await applyUnban(env, user, uid));
    }
    return;
  }

  if (kind === 'adm') {
    const session = await getSession(env, user.id);
    if (session.state !== 'adm:mute') return answer(env, cq, 'Кнопка вже неактуальна');
    await removeButtons(env, cq.message);
    await answer(env, cq);
    if (action === 'banok') {
      await clearSession(env, user.id);
      const d = session.data;
      return send(env, user.id, await applyBan(env, user, d.uid, d.reason || 'group', d.rid || null));
    }
    return send(env, user.id, 'Введіть кількість годин:');
  }

  if (kind === 'app') {
    if (!user.isOwner) return answer(env, cq, 'Рішення ухвалює лише власник', true);
    return decideApplication(env, user, cq, action === 'ok', Number(arg));
  }

  if (kind === 'post') {
    if (!user.isOwner) return answer(env, cq);
    await removeButtons(env, cq.message);
    if (action === 'no') return answer(env, cq, 'Скасовано');
    const mid = Number(arg);
    const results = [];
    const c = await tg(env, 'copyMessage', { chat_id: env.CHANNEL_ID, from_chat_id: user.id, message_id: mid });
    results.push(c.ok ? '✅ канал' : `❌ канал: ${c.description}`);
    if (action === 'all') {
      const gid = await groupId(env);
      if (gid) {
        const g = await tg(env, 'copyMessage', { chat_id: gid, from_chat_id: user.id, message_id: mid });
        results.push(g.ok ? '✅ група' : `❌ група: ${g.description}`);
      } else results.push('➖ група не прив’язана');
    }
    await logAction(env, user.id, 'post', null, action === 'all' ? 'канал + група' : 'канал');
    await answer(env, cq, 'Готово');
    return send(env, user.id, `📢 Новину опубліковано: ${results.join(', ')}`);
  }

  return answer(env, cq);
}

// ───────────────────────────── group and chat_member updates ─────────────────────────────

export async function onGroupMessage(env, msg) {
  if (!msg.from) return;
  const raw = (msg.text || '').trim().split(/\s|@/)[0].toLowerCase();
  // Anonymous admin or a message sent "as the channel": the bot can't see who wrote it.
  if (raw === '/setup' && (msg.sender_chat || msg.from.username === 'GroupAnonymousBot')) {
    await send(env, env.OWNER_ID, `Бот не бачить, хто написав /setup у групі (повідомлення надіслано анонімно або від імені каналу).\n\nНапишіть мені тут у особистих: /setup ${msg.chat.username ? '@' + msg.chat.username : msg.chat.id}`);
    return;
  }
  const text = (msg.text || '').trim();
  const cmd = text.split(/\s|@/)[0].toLowerCase();

  if (cmd === '/setup' && !msg.from.is_bot && isOwner(env, msg.from.id)) {
    const owner = await upsertUser(env, msg.from);
    await tg(env, 'deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id });
    return runSetup(env, owner, msg.chat);
  }

  const gid = await groupId(env);
  if (!gid || String(msg.chat.id) !== String(gid)) return;

  // Service messages "X joined / left" — remove to keep the chat clean.
  if (msg.new_chat_members || msg.left_chat_member) {
    await tg(env, 'deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id });
    return;
  }

  // Spam filters (links, foreign channels, stop words, other alphabets).
  if (await filterGroupMessage(env, msg)) return;
  if (msg.from.is_bot) return;

  await upsertUser(env, msg.from);
  if (!cmd.startsWith('/')) {
    await countActivity(env, msg);
    await noteGroupMessage(env, msg.from.id);
    const ai = await aiModerate(env, msg, punishViolation);
    if (ai === true) return;
    if (ai && ai.review) {
      await createReport(env, { id: 0 }, {
        targetId: msg.from.id, reason: 'ai', note: `Нейромережа: впевненість ${ai.verdict.confidence}%, ${ai.verdict.reason || 'схоже на рекламу'}`,
        msgLink: messageLink(msg, msg.message_id), msgChat: msg.chat.id, msgId: msg.message_id, msgText: (msg.text || msg.caption || '').slice(0, 1000),
      });
    }
    return;
  }

  if (cmd === '/proverka') {
    await tg(env, 'deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id });
    const staff = await upsertUser(env, msg.from);
    if (!staff.isStaff) return;
    const reply = msg.reply_to_message;
    if (!reply || !reply.from || reply.from.is_bot) {
      return send(env, staff.id, 'Щоб надіслати повідомлення на перевірку, дайте відповідь на нього в групі командою /proverka.');
    }
    await upsertUser(env, reply.from, { detect: false });
    const rid = await createReport(env, staff, {
      targetId: reply.from.id, reason: 'check', note: staff.isOwner ? 'Надіслав власник' : `Надіслав адмін ${whoName(staff)}`,
      msgLink: messageLink(msg, reply.message_id), msgChat: msg.chat.id, msgId: reply.message_id,
      msgText: (reply.text || reply.caption || '[медіа без тексту]').slice(0, 1000),
    });
    await logAction(env, staff.id, 'check', reply.from.id, `#${rid}`);
    return send(env, staff.id, `🔍 Повідомлення надіслано адмінам на перевірку (скарга #${rid}).`);
  }

  if (cmd === '/report') {
    await tg(env, 'deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id });
    const reporter = await upsertUser(env, msg.from);
    const reply = msg.reply_to_message;
    if (!reply) {
      return send(env, reporter.id, 'Щоб поскаржитися в групі, дайте відповідь на повідомлення порушника командою /report.');
    }
    const internal = String(msg.chat.id).replace(/^-100/, '');
    const msgLink = msg.chat.username ? `https://t.me/${msg.chat.username}/${reply.message_id}` : `https://t.me/c/${internal}/${reply.message_id}`;

    let targetId = null;
    let adId = null;
    if (reply.is_automatic_forward && reply.forward_origin && reply.forward_origin.type === 'channel') {
      const ad = await adByChannelMsg(env, reply.forward_origin.message_id);
      if (ad) { adId = ad.id; targetId = ad.user_id; }
    } else if (reply.from && !reply.from.is_bot) {
      targetId = reply.from.id;
      await upsertUser(env, reply.from);
    }
    if (!targetId || targetId === reporter.id) return;
    await createReport(env, reporter, { targetId, adId, reason: 'group', msgLink });
    return send(env, reporter.id, t(reporter.lang || 'ua', 'report_sent'));
  }
}

const messageLink = (msg, id) => {
  const internal = String(msg.chat.id).replace(/^-100/, '');
  return msg.chat.username ? `https://t.me/${msg.chat.username}/${id}` : `https://t.me/c/${internal}/${id}`;
};

// Messages per day and replies received — counted only, the text is never stored.
async function countActivity(env, msg) {
  const day = Math.floor(now() / DAY);
  const up = (uid, field) => env.DB.prepare(
    `INSERT INTO member_days (user_id, day, ${field}) VALUES (?1, ?2, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET ${field} = ${field} + 1`
  ).bind(uid, day).run();
  await up(msg.from.id, 'msgs');
  const r = msg.reply_to_message;
  if (r && r.from && !r.from.is_bot && r.from.id !== msg.from.id && !r.is_automatic_forward) await up(r.from.id, 'replies');
}

const isAdmStatus = (s) => s === 'administrator' || s === 'creator';

// Someone became or stopped being an admin in the group, the channel or the admin channel.
export async function onAdminChange(env, upd) {
  const u = upd.new_chat_member && upd.new_chat_member.user;
  if (!u || u.is_bot || isOwner(env, u.id)) return;
  const was = isAdmStatus(upd.old_chat_member && upd.old_chat_member.status);
  const now_ = isAdmStatus(upd.new_chat_member.status);
  if (was === now_) return;
  const user = await upsertUser(env, u, { detect: false });
  await syncAdminStatus(env, user, true);
}

export async function onChatMember(env, upd) {
  if (String(upd.chat.id) === String(env.ADMIN_CHAT_ID)) return onAdminChange(env, upd);
  const gid = await groupId(env);
  if (!gid || String(upd.chat.id) !== String(gid)) return;
  const u = upd.new_chat_member && upd.new_chat_member.user;
  if (!u || u.is_bot) return;

  // New member (any way of joining): CAS check, 24h text-only, welcome.
  const inside = (m) => m && (m.status === 'member' || (m.status === 'restricted' && m.is_member));
  const outside = (m) => !m || m.status === 'left' || m.status === 'kicked' || (m.status === 'restricted' && !m.is_member);
  if (outside(upd.old_chat_member) && inside(upd.new_chat_member)) return onJoined(env, gid, u);
  if (inside(upd.old_chat_member) && outside(upd.new_chat_member)) await logEvent(env, 'gr_leave', u.id);

  return onAdminChange(env, upd);
}
