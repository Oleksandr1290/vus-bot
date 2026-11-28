// Invite programme: two personal invite links to the channel (path to admin / more ads),
// credited after 3 days in the channel, with anti-abuse rules and a monthly top.

import {
  tg, esc, now, fmtDate, t, DAY, LEVELS, ADMIN_REFS_NEEDED, MAX_PER_DAY,
  getUser, getSetting, setSetting, refCount, levelOf, logAction, logEvent, groupId,
  send, sendHtml, answer, whoName,
} from './common.js';
import { casBanned } from './guard.js';
import { GUIDE, GUIDE_LABELS } from './guide.js';

const CREDIT_AFTER = 3 * DAY;
const BANS_TO_BLOCK = 3;
const TRACKS = ['admin', 'limits'];

const bar = (n, total) => {
  const filled = Math.max(0, Math.min(5, Math.floor((n / total) * 5)));
  return '▓'.repeat(filled) + '░'.repeat(5 - filled);
};

const isBlocked = async (env, uid) => !!(await env.DB.prepare('SELECT 1 AS x FROM ref_blocked WHERE user_id = ?').bind(uid).first());

async function getLink(env, uid, track) {
  const row = await env.DB.prepare('SELECT invite_link FROM ref_links WHERE user_id = ? AND track = ?').bind(uid, track).first();
  return row ? row.invite_link : null;
}

async function createLink(env, uid, track) {
  const existing = await getLink(env, uid, track);
  if (existing) return existing;
  const r = track === 'group'
    ? await tg(env, 'createChatInviteLink', { chat_id: await groupId(env), name: `ref:${uid}:group`, creates_join_request: true })
    : await tg(env, 'createChatInviteLink', { chat_id: env.CHANNEL_ID, name: `ref:${uid}:${track}` });
  if (!r.ok) return null;
  await env.DB.prepare('INSERT INTO ref_links (user_id, track, invite_link, created_at) VALUES (?, ?, ?, ?)')
    .bind(uid, track, r.result.invite_link, now()).run();
  return r.result.invite_link;
}

// ───────────────────────────── screens ─────────────────────────────

function perksText(L, lv) {
  const p = [];
  if (lv.star) p.push(t(L, 'ref_x_star'));
  if (lv.priority) p.push(t(L, 'ref_x_prio'));
  if (lv.bump) p.push(t(L, 'ref_x_bump'));
  return p.length ? '\n' + p.join('\n') : '';
}

// Personal link to the group: counted for the owner's statistics and admin applications.
async function showGroupLink(env, user) {
  const L = user.lang;
  if (!(await groupId(env))) return send(env, user.id, t(L, 'ref_no_link'));
  const link = await createLink(env, user.id, 'group');
  if (!link) return send(env, user.id, t(L, 'ref_no_link'));
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM group_invites WHERE inviter_id = ? AND status = 'joined'").bind(user.id).first()).n;
  return send(env, user.id, t(L, 'ref_group_card', { n, link }));
}

export async function showInvite(env, user) {
  const L = user.lang;
  if (await isBlocked(env, user.id)) return send(env, user.id, t(L, 'ref_blocked'));
  const { results } = await env.DB.prepare("SELECT track FROM ref_links WHERE user_id = ? AND track != 'group'").bind(user.id).all();
  if (!results.length) {
    return send(env, user.id, t(L, 'ref_intro'), {
      reply_markup: { inline_keyboard: [
        [{ text: t(L, 'ref_track_admin'), callback_data: 'ref:join:admin' }],
        [{ text: t(L, 'ref_track_limits'), callback_data: 'ref:join:limits' }],
        [{ text: (GUIDE_LABELS[L] || GUIDE_LABELS.ua).open, callback_data: 'ref:g:0' }],
      ] },
    });
  }
  for (const r of results) await showTrack(env, user, r.track);
}

async function showTrack(env, user, track) {
  const L = user.lang;
  const link = await createLink(env, user.id, track);
  if (!link) return send(env, user.id, t(L, 'ref_no_link'));
  const pending = await refCount(env, user.id, track, 'pending');
  const other = track === 'admin' ? 'limits' : 'admin';
  const hasOther = !!(await getLink(env, user.id, other));
  const kb = [
    [{ text: t(L, 'ref_group_btn'), callback_data: 'ref:group' }],
    [{ text: (GUIDE_LABELS[L] || GUIDE_LABELS.ua).open, callback_data: 'ref:g:0' }],
  ];
  if (!hasOther) kb.unshift([{ text: t(L, other === 'admin' ? 'ref_join_admin' : 'ref_join_limits'), callback_data: `ref:join:${other}` }]);

  let text;
  if (track === 'admin') {
    const n = await refCount(env, user.id, 'admin');
    text = t(L, 'ref_admin_card', { bar: bar(n, ADMIN_REFS_NEEDED), n: Math.min(n, ADMIN_REFS_NEEDED), need: ADMIN_REFS_NEEDED, p: pending, link });
    if (n >= ADMIN_REFS_NEEDED) text += '\n\n' + t(L, 'ref_admin_done');
  } else {
    const lv = await levelOf(env, user.id);
    const next = LEVELS.slice(2).find((l) => l.need > lv.n);
    text = t(L, 'ref_limits_card', {
      n: lv.n, perDay: lv.perDay, max: MAX_PER_DAY, active: lv.active, days: lv.days,
      extra: perksText(L, lv),
      next: next ? t(L, 'ref_next', { bonus: t(L, `ref_bonus_${next.level}`), bar: bar(lv.n, next.need), n: lv.n, need: next.need }) : t(L, 'ref_max'),
      p: pending, link,
    });
  }
  return send(env, user.id, text, { reply_markup: { inline_keyboard: kb } });
}

export async function onRefButton(env, user, cq, parts) {
  const L = user.lang;
  await answer(env, cq);
  if (await isBlocked(env, user.id)) return send(env, user.id, t(L, 'ref_blocked'));
  if (parts[1] === 'rules') return showGuide(env, user, 5, null);
  if (parts[1] === 'g') return showGuide(env, user, Number(parts[2]) || 0, parts[3] === 'e' ? cq.message : null);
  if (parts[1] === 'links') return showInvite(env, user);
  if (parts[1] === 'group') return showGroupLink(env, user);
  if (parts[1] === 'join' && TRACKS.includes(parts[2])) return showTrack(env, user, parts[2]);
}

// Step-by-step guide: 7 pages, the arrows edit the same message.
async function showGuide(env, user, page, msg) {
  const pages = GUIDE[user.lang] || GUIDE.ua;
  const labels = GUIDE_LABELS[user.lang] || GUIDE_LABELS.ua;
  const i = Math.max(0, Math.min(pages.length - 1, page));
  const nav = [];
  if (i > 0) nav.push({ text: '◀️', callback_data: `ref:g:${i - 1}:e` });
  nav.push({ text: `${i + 1} / ${pages.length}`, callback_data: `ref:g:${i}:e` });
  if (i < pages.length - 1) nav.push({ text: '▶️', callback_data: `ref:g:${i + 1}:e` });
  const reply_markup = { inline_keyboard: [nav, [{ text: labels.links, callback_data: 'ref:links' }]] };
  if (msg) {
    const r = await tg(env, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, text: pages[i], parse_mode: 'HTML', disable_web_page_preview: true, reply_markup,
    });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  return sendHtml(env, user.id, pages[i], { reply_markup });
}

// ───────────────────────────── channel joins ─────────────────────────────

const inside = (m) => m && (m.status === 'member' || (m.status === 'restricted' && m.is_member));

export async function onChannelMember(env, upd) {
  const u = upd.new_chat_member && upd.new_chat_member.user;
  if (!u || u.is_bot) return;
  const joined = !inside(upd.old_chat_member) && inside(upd.new_chat_member);
  const left = inside(upd.old_chat_member) && !inside(upd.new_chat_member);

  if (joined) await logEvent(env, 'ch_join', u.id);
  if (left) {
    await logEvent(env, 'ch_leave', u.id);
    // Left before being credited — the invite is lost.
    await env.DB.prepare("UPDATE referrals SET status = 'void' WHERE invitee_id = ? AND status = 'pending'").bind(u.id).run();
    return;
  }
  if (!joined) return;

  const seen = await env.DB.prepare('SELECT 1 AS x FROM channel_seen WHERE user_id = ?').bind(u.id).first();
  await env.DB.prepare('INSERT INTO channel_seen (user_id, first_seen) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING').bind(u.id, now()).run();

  const linkUrl = upd.invite_link && upd.invite_link.invite_link;
  if (!linkUrl || seen) return;   // не за посиланням або вже був у каналі раніше
  const ref = await env.DB.prepare('SELECT * FROM ref_links WHERE invite_link = ?').bind(linkUrl).first();
  if (!ref || ref.user_id === u.id) return;
  if (await isBlocked(env, ref.user_id)) return;
  if (await casBanned(u.id)) return;

  const r = await env.DB.prepare(
    "INSERT INTO referrals (inviter_id, track, invitee_id, status, joined_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(invitee_id) DO NOTHING"
  ).bind(ref.user_id, ref.track, u.id, now()).run();
  if (!r.meta || !r.meta.changes) return;

  const inviter = await getUser(env, ref.user_id);
  const L = (inviter && inviter.lang) || 'ua';
  await send(env, ref.user_id, t(L, 'ref_joined', { name: u.first_name || '', track: t(L, `ref_track_${ref.track}`) }));
}

// Called when someone is banned: the people who invited them lose that invite.
export async function onInviteeBanned(env, uid) {
  const r = await env.DB.prepare("SELECT * FROM referrals WHERE invitee_id = ? AND status IN ('pending','counted')").bind(uid).first();
  if (!r) return;
  await env.DB.prepare("UPDATE referrals SET status = 'banned' WHERE id = ?").bind(r.id).run();
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE inviter_id = ? AND status = 'banned'").bind(r.inviter_id).first();
  if (c.n >= BANS_TO_BLOCK && !(await isBlocked(env, r.inviter_id))) {
    await env.DB.prepare('INSERT INTO ref_blocked (user_id, created_at) VALUES (?, ?)').bind(r.inviter_id, now()).run();
    const { results } = await env.DB.prepare('SELECT invite_link, track FROM ref_links WHERE user_id = ?').bind(r.inviter_id).all();
    const gid = await groupId(env);
    for (const l of results) {
      await tg(env, 'revokeChatInviteLink', { chat_id: l.track === 'group' ? gid : env.CHANNEL_ID, invite_link: l.invite_link });
    }
    await logAction(env, 0, 'ref_block', r.inviter_id, `${c.n} запрошених порушників`);
    const u = await getUser(env, r.inviter_id);
    await send(env, r.inviter_id, t((u && u.lang) || 'ua', 'ref_blocked'));
  }
}

// ───────────────────────────── cron ─────────────────────────────

export async function cronReferral(env) {
  const { results } = await env.DB.prepare("SELECT * FROM referrals WHERE status = 'pending' AND joined_at < ? LIMIT 200")
    .bind(now() - CREDIT_AFTER).all();
  for (const r of results) {
    const m = await tg(env, 'getChatMember', { chat_id: env.CHANNEL_ID, user_id: r.invitee_id });
    if (!m.ok || !inside(m.result)) {
      await env.DB.prepare("UPDATE referrals SET status = 'void' WHERE id = ?").bind(r.id).run();
      continue;
    }
    const before = r.track === 'limits' ? await levelOf(env, r.inviter_id) : null;
    await env.DB.prepare("UPDATE referrals SET status = 'counted', counted_at = ? WHERE id = ?").bind(now(), r.id).run();
    const u = await getUser(env, r.inviter_id);
    const L = (u && u.lang) || 'ua';
    const n = await refCount(env, r.inviter_id, r.track);
    await send(env, r.inviter_id, t(L, 'ref_counted', { track: t(L, `ref_track_${r.track}`), n }));
    if (r.track === 'admin' && n === ADMIN_REFS_NEEDED) await send(env, r.inviter_id, t(L, 'ref_admin_ready'));
    if (before) {
      const after = await levelOf(env, r.inviter_id);
      if (after.perDay > before.perDay) await send(env, r.inviter_id, t(L, 'ref_plus_one', { perDay: after.perDay }));
      if (after.level > before.level && after.level >= 2) {
        await send(env, r.inviter_id, t(L, 'ref_bonus_got', { bonus: t(L, `ref_bonus_${after.level}`), active: after.active, days: after.days }));
      }
    }
  }
  await monthlyTop(env);
}

const MONTHS_UA = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];

// On the 1st of each month: top 5 inviters of the previous month, posted to the channel.
async function monthlyTop(env) {
  const d = new Date();
  if (d.getUTCDate() !== 1 || d.getUTCHours() < 10) return;
  const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
  if ((await getSetting(env, 'top_posted')) === key) return;
  await setSetting(env, 'top_posted', key);

  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) / 1000;
  const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  const { results } = await env.DB.prepare(
    "SELECT inviter_id, COUNT(*) AS n FROM referrals WHERE status = 'counted' AND counted_at >= ? AND counted_at < ? GROUP BY inviter_id ORDER BY n DESC LIMIT 5"
  ).bind(from, to).all();
  if (!results.length) return;

  const prev = new Date(from * 1000);
  const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
  let text = `🏆 <b>Топ запрошень за ${MONTHS_UA[prev.getUTCMonth()]}</b>\n\n`;
  for (let i = 0; i < results.length; i++) {
    const u = await getUser(env, results[i].inviter_id);
    text += `${medals[i]} ${esc(u ? (u.first_name || whoName(u)) : 'Учасник')} — ${results[i].n}\n`;
  }
  text += `\nДякуємо, що розвиваєте ВУС 💛\nСвоє посилання — у боті @${env.BOT_USERNAME || 'vus_ua_bot'} → «🤝 Запросити друзів»`;
  await sendHtml(env, env.CHANNEL_ID, text);
}
