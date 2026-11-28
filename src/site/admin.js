// Owner-only admin panel API for the website (/api/admin/*). The same actions as the bot panel.

import {
  tg, now, DAY, t, esc, getUser, getAd, publishAd, removeFromChannel, sendPost, channelKeyboard, buildPost,
  adminCard, postLink, logAction, logEvent, send, levelOf, adNo, whoName,
} from '../common.js';
import { notifyAlerts } from '../community.js';
import { closeReport, applyBan, deleteReportedAd, RR_UA } from '../staff.js';
import { publicAd, memberCounts } from './data.js';

const REASONS = ['spam', 'forbidden', 'incomplete', 'duplicate', 'rules'];

function authorInfo(u, id) {
  return { id, name: u ? (u.first_name || '') : '', nick: u && u.username ? u.username : null, banned: !!(u && u.banned) };
}

async function fullAd(env, ad) {
  const author = await getUser(env, ad.user_id);
  const reports = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE ad_id = ? AND status != 'closed'").bind(ad.id).first();
  const ids = JSON.parse(ad.channel_msg_ids || '[]');
  return {
    ...publicAd({ ...ad, published_at: ad.published_at || ad.created_at }),
    status: ad.status, reason: ad.reject_reason || null, contact: ad.contact || '', clicks: ad.contact_clicks || 0,
    created: ad.created_at, expires: ad.expires_at, onSite: !!ad.on_site, kind: ad.kind,
    channel: ids.length ? postLink(env, ids[0]) : null, openReports: reports ? reports.n : 0,
    author: authorInfo(author, ad.user_id),
  };
}

// Re-renders the channel post in place (after the star changes).
async function refreshChannelPost(env, ad) {
  const ids = JSON.parse(ad.channel_msg_ids || '[]');
  if (!ids.length) return;
  const html = buildPost(ad, env);
  if (ad.channel_kind === 'text' || ad.channel_kind === 'mixed') {
    await tg(env, 'editMessageText', { chat_id: env.CHANNEL_ID, message_id: ids[ids.length - 1], text: html, parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup: channelKeyboard(env, ad.id) });
  } else {
    await tg(env, 'editMessageCaption', { chat_id: env.CHANNEL_ID, message_id: ids[0], caption: html, parse_mode: 'HTML',
      ...(ad.channel_kind === 'photo' ? { reply_markup: channelKeyboard(env, ad.id) } : {}) });
  }
}

async function markAdminCard(env, ad, status) {
  if (!ad.admin_msg_id || !env.ADMIN_CHAT_ID) return;
  const author = await getUser(env, ad.user_id);
  await tg(env, 'editMessageText', { chat_id: env.ADMIN_CHAT_ID, message_id: ad.admin_msg_id, parse_mode: 'HTML',
    disable_web_page_preview: true, text: adminCard(env, ad, author, status) });
}

const siteLine = (env, ad) => (env.SITE_URL && ad.on_site ? `\n\n🌐 На сайті: ${env.SITE_URL}/ad/${ad.id}` : '');

async function stats(env) {
  const one = async (sql, ...b) => ((await env.DB.prepare(sql).bind(...b).first()) || {}).n || 0;
  const week = now() - 7 * DAY;
  const ev = (type) => one('SELECT COUNT(*) AS n FROM events WHERE type = ? AND created_at > ?', type, week);
  const counts = await memberCounts(env);
  return {
    channel: counts.ch, group: counts.gr,
    users: await one('SELECT COUNT(*) AS n FROM users'),
    active: await one("SELECT COUNT(*) AS n FROM ads WHERE status = 'published'"),
    pending: await one("SELECT COUNT(*) AS n FROM ads WHERE status = 'pending'"),
    reports: await one("SELECT COUNT(*) AS n FROM reports WHERE status != 'closed'"),
    week: {
      ads: await one('SELECT COUNT(*) AS n FROM ads WHERE created_at > ?', week),
      published: await one('SELECT COUNT(*) AS n FROM ads WHERE published_at > ?', week),
      rejected: await ev('ad_rejected'),
      newUsers: await one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', week),
      siteViews: await ev('site_view'), adViews: await ev('ad_view'), contacts: await ev('contact_click'),
      siteAds: await ev('site_ad'), logins: await ev('site_login'),
    },
  };
}

export async function handleAdmin(env, request, path, owner, json, fail) {
  const method = request.method;
  const body = async () => { try { return await request.json(); } catch (e) { return {}; } };
  const staff = owner; // closeReport/applyBan expect a user row with id, username, first_name

  if (path === '/api/admin/stats') return json({ ok: true, stats: await stats(env) });

  if (path === '/api/admin/queue') {
    const { results } = await env.DB.prepare("SELECT * FROM ads WHERE status = 'pending' ORDER BY id LIMIT 50").all();
    const ads = [];
    for (const a of results) ads.push(await fullAd(env, a));
    return json({ ok: true, ads, reasons: REASONS.map((r) => ({ key: r, label: t('ua', `reason_${r}`) })) });
  }

  if (path === '/api/admin/reports') {
    const { results } = await env.DB.prepare("SELECT * FROM reports WHERE status != 'closed' ORDER BY id DESC LIMIT 50").all();
    const list = [];
    for (const r of results) {
      const target = r.target_id ? await getUser(env, r.target_id) : null;
      const ad = r.ad_id ? await getAd(env, r.ad_id) : null;
      list.push({
        id: r.id, reason: RR_UA[r.reason] || r.reason, note: r.note || '', count: r.count, created: r.created_at,
        msgText: r.msg_text || '', msgLink: r.msg_link || null,
        target: r.target_id ? authorInfo(target, r.target_id) : null,
        ad: ad ? { id: ad.id, no: '#' + adNo(ad.id), title: ad.title, status: ad.status } : null,
      });
    }
    return json({ ok: true, reports: list });
  }

  let m = path.match(/^\/api\/admin\/report\/(\d+)\/(dismiss|delad|ban)$/);
  if (m && method === 'POST') {
    const rid = Number(m[1]);
    const rep = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(rid).first();
    if (!rep || rep.status === 'closed') return fail('not_found', 404);
    if (m[2] === 'dismiss') {
      await logAction(env, owner.id, 'reject_report', rep.target_id, `#${rid} (сайт)`);
      await closeReport(env, rid, 'reject', '✅ Відхилено, порушень немає (сайт)', staff);
      return json({ ok: true, msg: 'Скаргу відхилено' });
    }
    if (m[2] === 'delad') return json({ ok: true, msg: await deleteReportedAd(env, staff, rid) });
    if (!rep.target_id) return fail('no_target');
    return json({ ok: true, msg: await applyBan(env, staff, rep.target_id, rep.reason, rid, true) });
  }

  m = path.match(/^\/api\/admin\/ad\/(\d+)$/);
  if (m) {
    const ad = await getAd(env, Number(m[1]));
    if (!ad) return fail('not_found', 404);
    return json({ ok: true, ad: await fullAd(env, ad) });
  }

  m = path.match(/^\/api\/admin\/ad\/(\d+)\/(approve|reject|delete|extend|bump|star|ban)$/);
  if (m && method === 'POST') {
    const ad = await getAd(env, Number(m[1]));
    if (!ad) return fail('not_found', 404);
    const act = m[2];
    const author = await getUser(env, ad.user_id);
    const who = esc(whoName(owner));

    if (act === 'approve') {
      if (ad.status !== 'pending') return fail('state');
      const r = await publishAd(env, ad, owner.id);
      if (!r.ok) return fail('publish', 500, { msg: r.error });
      await notifyAlerts(env, ad, r.ids);
      await markAdminCard(env, ad, `✅ Опубліковано — ${who} (сайт)`);
      await logAction(env, owner.id, 'publish_ad', ad.user_id, `#${adNo(ad.id)}`);
      if (author) await send(env, author.id, t(author.lang || 'ua', 'published_user', { id: ad.id, link: postLink(env, r.ids[0]) }) + siteLine(env, ad));
      return json({ ok: true, msg: 'Опубліковано' });
    }
    if (act === 'reject') {
      if (ad.status !== 'pending') return fail('state');
      const { reason } = await body();
      const code = REASONS.includes(reason) ? reason : 'rules';
      await env.DB.prepare("UPDATE ads SET status = 'rejected', reject_reason = ?, moderated_by = ? WHERE id = ?").bind(code, owner.id, ad.id).run();
      await logEvent(env, 'ad_rejected', ad.user_id, code);
      await markAdminCard(env, ad, `❌ Відхилено (${t('ua', `reason_${code}`)}) — ${who} (сайт)`);
      await logAction(env, owner.id, 'reject_ad', ad.user_id, `#${adNo(ad.id)}`);
      if (author) await send(env, author.id, t(author.lang || 'ua', 'rejected_user', { id: ad.id, reason: t(author.lang || 'ua', `reason_${code}`) }));
      return json({ ok: true, msg: 'Відхилено' });
    }
    if (act === 'delete') {
      if (ad.status === 'deleted') return json({ ok: true, msg: 'Вже видалено' });
      if (ad.status === 'published') await removeFromChannel(env, ad);
      await env.DB.prepare("UPDATE ads SET status = 'deleted' WHERE id = ?").bind(ad.id).run();
      if (ad.status === 'pending') await markAdminCard(env, ad, `🗑 Видалено — ${who} (сайт)`);
      await logAction(env, owner.id, 'delete_ad', ad.user_id, `#${adNo(ad.id)} (сайт)`);
      if (author && author.id !== owner.id) await send(env, author.id, t(author.lang || 'ua', 'ad_removed_mod', { id: ad.id }));
      return json({ ok: true, msg: `#${adNo(ad.id)} видалено з каналу і сайту` });
    }
    if (act === 'extend') {
      if (ad.status !== 'published') return fail('state');
      const lv = await levelOf(env, ad.user_id);
      const exp = Math.max(ad.expires_at || 0, now()) + lv.days * DAY;
      await env.DB.prepare('UPDATE ads SET expires_at = ?, reminded = 0 WHERE id = ?').bind(exp, ad.id).run();
      await logAction(env, owner.id, 'extend_ad', ad.user_id, `#${adNo(ad.id)} (сайт)`);
      return json({ ok: true, msg: `Продовжено на ${lv.days} дн.` });
    }
    if (act === 'bump') {
      if (ad.status !== 'published') return fail('state');
      await removeFromChannel(env, ad);
      const r = await sendPost(env, env.CHANNEL_ID, ad, channelKeyboard(env, ad.id));
      if (!r.ids.length) return fail('publish', 500, { msg: r.error });
      await env.DB.prepare('UPDATE ads SET channel_msg_ids = ?, channel_kind = ?, published_at = ? WHERE id = ?').bind(JSON.stringify(r.ids), r.kind, now(), ad.id).run();
      await logAction(env, owner.id, 'bump_ad', ad.user_id, `#${adNo(ad.id)} (сайт)`);
      return json({ ok: true, msg: 'Піднято нагору в каналі й на сайті' });
    }
    if (act === 'star') {
      ad.star = ad.star ? 0 : 1;
      await env.DB.prepare('UPDATE ads SET star = ? WHERE id = ?').bind(ad.star, ad.id).run();
      if (ad.status === 'published') await refreshChannelPost(env, ad);
      return json({ ok: true, msg: ad.star ? '⭐ Додано' : '⭐ Знято' });
    }
    if (act === 'ban') {
      if (String(ad.user_id) === String(owner.id)) return fail('self');
      return json({ ok: true, msg: await applyBan(env, staff, ad.user_id, 'rules', null, true) });
    }
  }
  return fail('not_found', 404);
}
