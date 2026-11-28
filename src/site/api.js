// JSON API of the website.

import {
  tg, now, DAY, t, getUser, upsertUser, logEvent, logAction, getAd, publishAd, sendAdminCard, postLink,
  removeFromChannel, send, isOwner, normTags,
} from '../common.js';
import { handleAdmin } from './admin.js';
import { parsePrice, categoryByKey, COUNTRIES } from '../data.js';
import { membership, notifyAlerts, createIdea, donationsOn } from '../community.js';
import { createReport } from '../staff.js';
import { verifyTelegramLogin, makeSessionCookie, clearSessionCookie, sessionUserId, visitorHash } from './auth.js';
import { limitsFor, publicAd, oneAd, countryByName } from './data.js';
import { LEVELS } from '../common.js';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (code, status = 400, extra = {}) => json({ ok: false, error: code, ...extra }, status);

export async function currentUser(env, request) {
  const uid = await sessionUserId(env, request);
  if (!uid) return null;
  const u = await getUser(env, uid);
  if (!u) return null;
  u.isOwner = isOwner(env, u.id);
  const a = await env.DB.prepare('SELECT 1 FROM admins WHERE user_id = ?').bind(u.id).first();
  u.isStaff = u.isOwner || !!a;
  return u;
}

// Profile photo: taken from Telegram through the bot (served by the site at /img/<file_id>),
// with the photo link from the login widget as a fallback. Rechecked at most once a day.
async function refreshPhoto(env, u, loginUrl, force = false) {
  if (!force && u.photo_at && now() - u.photo_at < 86400) return u.photo_url || null;
  let photo = null;
  try {
    const r = await tg(env, 'getUserProfilePhotos', { user_id: u.id, limit: 1 });
    const sizes = r.ok && r.result && r.result.photos && r.result.photos[0];
    if (sizes && sizes.length) photo = '/img/' + (sizes[1] || sizes[0]).file_id;
  } catch (e) { /* keep the fallback */ }
  if (!photo && /^https:\/\/[^\s"'<>]+$/.test(loginUrl || '')) photo = loginUrl;
  if (!photo && !force && u.photo_url) photo = u.photo_url;
  await env.DB.prepare('UPDATE users SET photo_url = ?, photo_at = ? WHERE id = ?').bind(photo, now(), u.id).run();
  u.photo_url = photo;
  return photo;
}

async function meInfo(env, u) {
  await refreshPhoto(env, u, null);
  const m = u.isStaff ? { ch: true, gr: true } : await membership(env, u.id);
  const lim = await limitsFor(env, u);
  return {
    ok: true, user: { id: u.id, name: u.first_name || u.username || 'Учасник', nick: u.username || null, lang: u.lang || null, staff: !!u.isStaff,
      owner: !!u.isOwner, photo: u.photo_url || null },
    member: m, limits: { perDay: lim.perDay, left: lim.left, active: lim.active, activeNow: lim.activeNow, nextAt: lim.nextAt },
  };
}

// Rate limit by event type and visitor fingerprint.
async function tooMany(env, type, who, max, secs = DAY) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ? AND ref = ? AND created_at > ?').bind(type, who, now() - secs).first();
  return r.n >= max;
}

// Photos from the website are stored in Telegram: send to the admin channel silently, keep file_id, delete the message.
async function uploadPhoto(env, file) {
  const fd = new FormData();
  fd.append('chat_id', String(env.ADMIN_CHAT_ID));
  fd.append('disable_notification', 'true');
  fd.append('photo', file, file.name || 'photo.jpg');
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({ ok: false }));
  if (!r.ok) return null;
  await tg(env, 'deleteMessage', { chat_id: env.ADMIN_CHAT_ID, message_id: r.result.message_id });
  const sizes = r.result.photo || [];
  return sizes.length ? sizes[sizes.length - 1].file_id : null;
}

async function submitFromSite(env, request, u) {
  const form = await request.formData();
  const f = (k) => String(form.get(k) || '').trim();
  const mode = f('mode') === 'free' ? 'free' : 'form';
  const country = COUNTRIES.find((c) => c.code === f('cc'));
  const cat = categoryByKey(f('cat'));
  const city = f('city').slice(0, 60);
  if (!country || !cat || !city) return fail('fields');

  const replaceId = Number(f('replace')) || null;
  const old = replaceId ? await getAd(env, replaceId) : null;
  if (replaceId && (!old || old.user_id !== u.id)) return fail('not_found', 404);

  if (!u.isStaff) {
    const m = await membership(env, u.id);
    if (!m.ch || !m.gr) return fail('membership', 403, { member: m });
    const lim = await limitsFor(env, u);
    if (!old && lim.left <= 0) return fail('limit_day', 429, { nextAt: lim.nextAt, perDay: lim.perDay });
    if (!old && lim.activeNow >= lim.active) return fail('limit_active', 429, { active: lim.active });
  }

  let title = '', body = '', price = 'none', contact = '';
  if (mode === 'free') {
    body = f('text').slice(0, 3500);
    if (body.length < 10) return fail('text');
    title = (body.split('\n').find((x) => x.trim()) || '').slice(0, 60);
  } else {
    title = f('title').slice(0, 80);
    body = f('text').slice(0, 3000);
    if (title.length < 3 || body.length < 5) return fail('text');
    if (cat.price !== 'none') {
      if (f('neg') === '1') price = 'neg';
      else if (cat.price === 'range') {
        const a = Number(f('from').replace(/\D/g, '')) || 0, b = Number(f('to').replace(/\D/g, '')) || 0;
        price = a && b ? `r:${Math.min(a, b)}:${Math.max(a, b)}` : a ? `r:${a}:` : b ? `r::${b}` : 'neg';
      } else {
        price = parsePrice(f('price')) || (cat.key === 'free' ? 'free' : 'neg');
        if (price.startsWith('r:')) price = `s:${price.split(':').filter(Boolean)[1] || price.split(':')[2]}`;
      }
    }
    const parts = [];
    if (f('tg') === '1' && u.username) parts.push('@' + u.username);
    const phone = f('phone');
    if (phone) {
      if (!/^\+?[\d\s()\-]{7,20}$/.test(phone)) return fail('phone');
      parts.push(phone);
    }
    if (!parts.length) return fail('contact');
    contact = parts.join(' · ');
  }

  const photos = [];
  for (const file of form.getAll('photos').slice(0, 10)) {
    if (!file || typeof file === 'string' || !file.size) continue;
    if (file.size > 10 * 1024 * 1024) return fail('photo_big');
    const id = await uploadPhoto(env, file);
    if (id) photos.push(id);
  }
  if (old && !photos.length) photos.push(...JSON.parse(old.photos || '[]'));

  const res = await env.DB.prepare(
    `INSERT INTO ads (user_id, kind, country, city, category, title, body, price, photos, contact, on_site, tags, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(u.id, mode, country.ua, city, cat.key, title, body, price, JSON.stringify(photos), contact, f('site') === '0' ? 0 : 1,
    normTags(f('tags')).join(',') || null, now()).run();
  const id = res.meta.last_row_id;
  await logEvent(env, 'site_ad', u.id, id);

  if (old) {
    if (old.status === 'published') await removeFromChannel(env, old);
    await env.DB.prepare("UPDATE ads SET status = 'deleted' WHERE id = ?").bind(old.id).run();
  }

  const ad = await getAd(env, id);
  const L = u.lang || 'ua';
  if (u.isOwner) {
    const r = await publishAd(env, ad, u.id);
    if (r.ok) {
      await notifyAlerts(env, ad, r.ids);
      await send(env, u.id, t(L, 'published_user', { id, link: postLink(env, r.ids[0]) }));
      return json({ ok: true, id, published: true });
    }
  }
  await sendAdminCard(env, ad, u);
  await send(env, u.id, t(L, 'submitted', { id }));
  return json({ ok: true, id, published: false });
}

async function myData(env, u) {
  const { results } = await env.DB.prepare("SELECT * FROM ads WHERE user_id = ? AND status != 'deleted' ORDER BY id DESC LIMIT 30").bind(u.id).all();
  const lim = await limitsFor(env, u);
  const next = LEVELS.slice(2).find((l) => l.need > lim.lv.n);
  const link = await env.DB.prepare("SELECT invite_link FROM ref_links WHERE user_id = ? AND track = 'limits'").bind(u.id).first();
  const { results: alerts } = await env.DB.prepare('SELECT * FROM alerts WHERE user_id = ? ORDER BY id').bind(u.id).all();
  return json({
    ok: true,
    ads: results.map((a) => ({
      ...publicAd({ ...a, published_at: a.published_at || a.created_at }), status: a.status, reason: a.reject_reason || null,
      clicks: a.contact_clicks || 0, contact: a.contact, daysLeft: a.expires_at ? Math.max(0, Math.ceil((a.expires_at - now()) / DAY)) : null,
      raw: { title: a.title, body: a.body, price: a.price, kind: a.kind, tags: a.tags || '' },
    })),
    level: { n: lim.lv.n, perDay: lim.perDay, active: lim.active, days: lim.lv.days, star: lim.lv.star, priority: lim.lv.priority, bump: lim.lv.bump,
      next: next ? { need: next.need, level: next.level } : null },
    refLink: link ? link.invite_link : null,
    alerts: alerts.map((a) => ({ id: a.id, cat: a.category, country: a.country, city: a.city })),
  });
}

export async function handleApi(env, request, path) {
  const method = request.method;
  const u = await currentUser(env, request);
  const body = async () => { try { return await request.json(); } catch (e) { return {}; } };

  if (path.startsWith('/api/admin/')) {
    if (!u || !u.isOwner) return fail('forbidden', 403);
    return handleAdmin(env, request, path, u, json, fail);
  }

  if (path === '/api/login' && method === 'POST') {
    const tgUser = await verifyTelegramLogin(env, await body());
    if (!tgUser) return fail('login', 401);
    const user = await upsertUser(env, { id: tgUser.id, first_name: tgUser.first_name, username: tgUser.username }, { detect: true });
    await refreshPhoto(env, user, tgUser.photo_url, true);
    user.isOwner = isOwner(env, user.id);
    await logEvent(env, 'site_login', user.id);
    return json(await meInfo(env, user), 200, { 'set-cookie': await makeSessionCookie(env, user.id) });
  }
  if (path === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  if (path === '/api/me') return u ? json(await meInfo(env, u)) : json({ ok: true, user: null });

  // Contact reveal and view counters (no login needed).
  let m = path.match(/^\/api\/ad\/(\d+)\/(contact|view)$/);
  if (m && method === 'POST') {
    const ad = await getAd(env, Number(m[1]));
    if (!ad || ad.status !== 'published') return fail('not_found', 404);
    if (m[2] === 'view') {
      await env.DB.prepare('UPDATE ads SET views = COALESCE(views, 0) + 1 WHERE id = ?').bind(ad.id).run();
      await logEvent(env, 'ad_view', null, ad.id);
      return json({ ok: true });
    }
    await env.DB.prepare('UPDATE ads SET contact_clicks = COALESCE(contact_clicks, 0) + 1 WHERE id = ?').bind(ad.id).run();
    await logEvent(env, 'contact_click', null, ad.id);
    return json({ ok: true, contact: ad.contact || '' });
  }

  m = path.match(/^\/api\/ad\/(\d+)\/report$/);
  if (m && method === 'POST') {
    const ad = await getAd(env, Number(m[1]));
    if (!ad) return fail('not_found', 404);
    const who = await visitorHash(env, request);
    if (await tooMany(env, 'site_report', who, 5)) return fail('too_many', 429);
    const b = await body();
    const reason = ['scam', 'spam', 'forbidden', 'other'].includes(b.reason) ? b.reason : 'other';
    await logEvent(env, 'site_report', u ? u.id : null, who);
    await createReport(env, u || { id: 0 }, { targetId: ad.user_id, adId: ad.id, reason, note: `З сайту${b.note ? ': ' + String(b.note).slice(0, 300) : ''}` });
    return json({ ok: true });
  }

  if (path === '/api/idea' && method === 'POST') {
    const who = await visitorHash(env, request);
    if (await tooMany(env, 'site_idea', who, 5)) return fail('too_many', 429);
    const b = await body();
    const text = String(b.text || '').trim();
    if (text.length < 3) return fail('text');
    await logEvent(env, 'site_idea', u ? u.id : null, who);
    await createIdea(env, u ? u.id : null, text, 'site', String(b.kind || '').slice(0, 20) || null);
    return json({ ok: true });
  }

  // Everything below needs login.
  if (!u) return fail('auth', 401);
  if (u.banned) return fail('banned', 403);

  if (path === '/api/membership') return json({ ok: true, member: u.isStaff ? { ch: true, gr: true } : await membership(env, u.id) });
  if (path === '/api/ads' && method === 'POST') return submitFromSite(env, request, u);
  if (path === '/api/my') return myData(env, u);

  m = path.match(/^\/api\/my\/(\d+)\/(extend|delete)$/);
  if (m && method === 'POST') {
    const ad = await getAd(env, Number(m[1]));
    if (!ad || ad.user_id !== u.id) return fail('not_found', 404);
    if (m[2] === 'extend') {
      if (ad.status !== 'published') return fail('state');
      const lim = await limitsFor(env, u);
      const exp = now() + lim.lv.days * DAY;
      await env.DB.prepare('UPDATE ads SET expires_at = ?, reminded = 0 WHERE id = ?').bind(exp, ad.id).run();
      await logEvent(env, 'ad_extended', u.id, ad.id);
      return json({ ok: true, days: lim.lv.days });
    }
    if (ad.status === 'published') await removeFromChannel(env, ad);
    await env.DB.prepare("UPDATE ads SET status = 'deleted' WHERE id = ?").bind(ad.id).run();
    await logEvent(env, 'ad_deleted_author', u.id, ad.id);
    return json({ ok: true });
  }

  m = path.match(/^\/api\/alerts\/(\d+)\/delete$/);
  if (m && method === 'POST') {
    await env.DB.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').bind(Number(m[1]), u.id).run();
    return json({ ok: true });
  }

  return fail('not_found', 404);
}
