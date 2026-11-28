// Data helpers for the website: active ads, counters, exchange rates, ordering.

import { tg, now, DAY, getSetting, setSetting, groupId, levelOf } from '../common.js';
import { COUNTRIES, CATEGORIES, categoryByKey, priceText } from '../data.js';

// Country → currency for the "≈ in local money" hint (rates from the National Bank of Ukraine).
export const CURRENCY = {
  PL: ['PLN', 'zł'], DE: ['EUR', '€'], CZ: ['CZK', 'Kč'], RO: ['RON', 'lei'], IT: ['EUR', '€'], ES: ['EUR', '€'],
  GB: ['GBP', '£'], US: ['USD', '$'], CA: ['CAD', 'C$'], FR: ['EUR', '€'], NL: ['EUR', '€'], AT: ['EUR', '€'],
  PT: ['EUR', '€'], IE: ['EUR', '€'], BE: ['EUR', '€'], SK: ['EUR', '€'], LT: ['EUR', '€'], LV: ['EUR', '€'],
  EE: ['EUR', '€'], MD: ['MDL', 'lei'], HU: ['HUF', 'Ft'], BG: ['BGN', 'лв'], SE: ['SEK', 'kr'], NO: ['NOK', 'kr'],
  DK: ['DKK', 'kr'], CH: ['CHF', 'CHF'], GE: ['GEL', '₾'], TR: ['TRY', '₺'], IL: ['ILS', '₪'],
};

export const countryByName = (ua) => COUNTRIES.find((c) => c.ua === ua);
export const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function cityLatin(countryUa, cityUa) {
  const c = countryByName(countryUa);
  const pair = c && c.cities.find((x) => x[0] === cityUa);
  return pair ? pair[1] : cityUa;
}

// Exchange rates: UAH per 1 unit, refreshed once a day.
export async function fxRates(env) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const cached = JSON.parse((await getSetting(env, 'fx')) || 'null');
    if (cached && cached.day === day) return cached.rates;
    const r = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json', { cf: { cacheTtl: 3600 } });
    const list = await r.json();
    const rates = {};
    for (const x of list) if (x.cc && x.rate) rates[x.cc] = x.rate;
    if (Object.keys(rates).length) {
      await setSetting(env, 'fx', JSON.stringify({ day, rates }));
      return rates;
    }
    return cached ? cached.rates : {};
  } catch (e) {
    return {};
  }
}

// Members of the channel and the group, cached for 10 minutes.
export async function memberCounts(env) {
  try {
    const c = JSON.parse((await getSetting(env, 'site_counts')) || 'null');
    if (c && c.ts > now() - 600) return c;
  } catch (e) { /* refresh below */ }
  const ch = await tg(env, 'getChatMemberCount', { chat_id: env.CHANNEL_ID });
  const gid = await groupId(env);
  const gr = gid ? await tg(env, 'getChatMemberCount', { chat_id: gid }) : { ok: false };
  const out = { ch: ch.ok ? ch.result : null, gr: gr.ok ? gr.result : null, ts: now() };
  await setSetting(env, 'site_counts', JSON.stringify(out));
  return out;
}

export async function weekCounts(env) {
  const since = now() - 7 * DAY;
  const a = await env.DB.prepare('SELECT COUNT(*) AS n FROM ads WHERE published_at > ?').bind(since).first();
  const u = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at > ?').bind(since).first();
  return { ads: a.n, users: u.n };
}

// Numbers behind a price code: 's:N', 'r:a:b', 'r:a:', 'r::b'.
function priceNums(p) {
  const s = String(p || '');
  if (s.startsWith('s:')) return { p: Number(s.slice(2)) || 0 };
  if (s.startsWith('r:')) {
    const [, a, b] = s.split(':');
    if (a && b) return { p: Number(a), p2: Number(b) };
    if (a) return { p: Number(a), from: true };
    if (b) return { p: Number(b), upto: true };
  }
  return { p: 0 };
}

const firstLine = (s) => String(s || '').split('\n').find((x) => x.trim()) || '';

// Shape of an ad as the website shows it (the contact is never included: it is revealed on request).
export function publicAd(ad, inviteCount = 0) {
  const c = countryByName(ad.country);
  const photos = JSON.parse(ad.photos || '[]');
  const free = ad.kind === 'free';
  return {
    id: ad.id, no: '#' + String(ad.id).padStart(8, '0'), tags: String(ad.tags || '').split(',').filter(Boolean), cat: ad.category, country: ad.country, cc: c ? c.code : null, city: ad.city,
    title: free ? firstLine(ad.body).slice(0, 90) : ad.title,
    text: ad.body || '', free,
    price: free ? '' : (priceText(ad.price) || ''), ...priceNums(free ? '' : ad.price),
    ts: ad.published_at, h: Math.max(0, Math.floor((now() - ad.published_at) / 3600)),
    star: !!ad.star, boost: inviteCount, views: ad.views || 0,
    photos: photos.map((p) => `/img/${encodeURIComponent(p)}`),
    hasContact: !free && !!ad.contact, exp: ad.expires_at,
  };
}

// Active ads shown on the website, newest first; authors with invites get a gentle boost.
export async function activeAds(env, limit = 500) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM referrals r WHERE r.inviter_id = a.user_id AND r.track = 'limits' AND r.status = 'counted') AS inv
     FROM ads a WHERE a.status = 'published' AND a.on_site = 1 AND (a.expires_at IS NULL OR a.expires_at > ?)
     ORDER BY a.published_at DESC LIMIT ?`
  ).bind(now(), limit).all();
  return results.map((a) => publicAd(a, a.inv || 0));
}

export async function oneAd(env, id) {
  const a = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM referrals r WHERE r.inviter_id = a.user_id AND r.track = 'limits' AND r.status = 'counted') AS inv
     FROM ads a WHERE a.id = ?`
  ).bind(Number(id)).first();
  return a;
}

// Popular "category in city" pages for SEO links and the sitemap.
export function popularCombos(ads, max = 12) {
  const m = new Map();
  for (const a of ads) {
    if (!a.cc) continue;
    const k = `${a.cat}|${a.cc}|${a.city}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k, n]) => {
    const [cat, cc, city] = k.split('|');
    const c = COUNTRIES.find((x) => x.code === cc);
    return { cat, cc, city, n, path: `/c/${cat}/${cc.toLowerCase()}/${slug(cityLatin(c ? c.ua : '', city))}` };
  });
}

// /c/<category|all>/<country code>/<city slug?> → filter
export function parseLanding(parts) {
  const [cat, cc, citySlug] = parts;
  const out = { cat: cat && (cat === 'all' || categoryByKey(cat)) ? cat : 'all', country: null, city: null };
  const c = cc ? COUNTRIES.find((x) => x.code.toLowerCase() === cc.toLowerCase()) : null;
  if (c) {
    out.country = c.ua;
    if (citySlug) {
      const pair = c.cities.find((x) => slug(x[1]) === citySlug);
      if (pair) out.city = pair[0];
    }
  }
  return out;
}

export async function limitsFor(env, user) {
  const lv = await levelOf(env, user.id);
  if (user.isStaff) return { perDay: 999, left: 999, active: 999, lv };
  const day = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first FROM ads WHERE user_id = ? AND created_at > ?')
    .bind(user.id, now() - DAY).first();
  const act = await env.DB.prepare("SELECT COUNT(*) AS n FROM ads WHERE user_id = ? AND status IN ('pending','published')").bind(user.id).first();
  return {
    perDay: lv.perDay, left: Math.max(0, lv.perDay - day.n), activeNow: act.n, active: lv.active,
    nextAt: day.n >= lv.perDay ? day.first + DAY : null, lv,
  };
}

export { COUNTRIES, CATEGORIES };
