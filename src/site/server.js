// Website router: runs in the same worker as the bot, on its own domain (SITE_URL).

import { tg, getSetting, logEvent } from '../common.js';
import { donationsOn } from '../community.js';
import { handleApi, currentUser } from './api.js';
import { activeAds, oneAd, publicAd, fxRates, memberCounts, weekCounts, popularCombos, parseLanding } from './data.js';
import { homePage, adPage, docPage, sitemap, adminPage, ASSET_VERSION } from './page.js';
import { SITE_T } from './i18n.js';
import APP_CSS from './app.css.txt';
import APP_JS from './app.js.txt';

const LANGS = ['ua', 'en']; // Russian removed from the website (owner's decision)

export function siteHosts(env) {
  const main = env.SITE_URL ? new URL(env.SITE_URL).hostname : null;
  const aliases = String(env.SITE_ALIASES || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { main, aliases };
}

export function isSiteRequest(env, url) {
  const { main, aliases } = siteHosts(env);
  return url.hostname === main || aliases.includes(url.hostname);
}

function langOf(request, url) {
  const q = url.searchParams.get('lang');
  if (LANGS.includes(q)) return q;
  const c = (request.headers.get('cookie') || '').match(/(?:^|;\s*)vus_lang=(ua|en)/);
  if (c) return c[1];
  const al = (request.headers.get('accept-language') || '').toLowerCase();
  if (al.startsWith('en')) return 'en';
  return 'ua';
}

const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

async function donateInfo(env) {
  if (!(await donationsOn(env))) return { on: false };
  return { on: true, mono: (await getSetting(env, 'donate_mono')) || null, paypal: (await getSetting(env, 'donate_paypal')) || null };
}

// Telegram photo by file_id, cached at the edge for a week.
async function photo(env, request, fileId, ctx) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const f = await tg(env, 'getFile', { file_id: decodeURIComponent(fileId) });
  if (!f.ok) return new Response('not found', { status: 404 });
  const img = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`);
  if (!img.ok) return new Response('not found', { status: 404 });
  const res = new Response(img.body, { headers: { 'content-type': img.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=604800, immutable' } });
  if (ctx) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export async function handleSite(request, env, ctx) {
  const url = new URL(request.url);
  const { main, aliases } = siteHosts(env);

  // Old domain → new domain (keeps links and search positions).
  if (aliases.includes(url.hostname) && main) {
    return Response.redirect(`https://${main}${url.pathname}${url.search}`, 301);
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/api/')) return handleApi(env, request, path);

  if (path === '/assets/app.css') {
    return new Response(APP_CSS, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  if (path === '/assets/app.js') {
    return new Response(`window.VUS_T=${JSON.stringify(SITE_T)};\n${APP_JS}`, {
      headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  }
  if (path.startsWith('/img/')) return photo(env, request, path.slice(5), ctx);
  if (path === '/robots.txt') {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nSitemap: ${env.SITE_URL || ''}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain' } });
  }

  const lang = langOf(request, url);
  const donate = await donateInfo(env);

  if (path === '/sitemap.xml') {
    const ads = await activeAds(env, 2000);
    return new Response(sitemap(env, ads, popularCombos(ads, 200)), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
  }
  if (path === '/rules' || path === '/privacy') return html(docPage(env, { lang, kind: path.slice(1), donate }));

  if (path === '/admin') {
    const u = await currentUser(env, request);
    if (!u || !u.isOwner) return html(adPage(env, { lang, ad: null, donate }), 404);
    const adId = Number(url.searchParams.get('ad')) || null;
    return html(adminPage(env, { lang, adId }));
  }

  let m = path.match(/^\/ad\/(\d+)$/);
  if (m) {
    const raw = await oneAd(env, m[1]);
    const live = raw && raw.status === 'published' && raw.on_site && (!raw.expires_at || raw.expires_at > Math.floor(Date.now() / 1000));
    const fx = await fxRates(env);
    if (!live) return html(adPage(env, { lang, ad: null, donate }), 404);
    const ad = publicAd(raw, raw.inv || 0);
    const all = await activeAds(env, 300);
    const similar = all.filter((a) => a.id !== ad.id && (a.cat === ad.cat || a.city === ad.city)).slice(0, 5);
    await logEvent(env, 'site_view', null, 'ad');
    return html(adPage(env, { lang, ad, raw, fx, similar, donate }));
  }

  let preset = null;
  m = path.match(/^\/c\/(.+)$/);
  if (m) {
    preset = parseLanding(m[1].split('/'));
    preset.path = path;
  } else if (path !== '/') {
    return html(adPage(env, { lang, ad: null, donate }), 404);
  }

  const [ads, fx, counts, week] = await Promise.all([activeAds(env), fxRates(env), memberCounts(env), weekCounts(env)]);
  await logEvent(env, 'site_view', null, preset ? 'landing' : 'home');
  return html(homePage(env, { lang, ads, fx, counts, week, popular: popularCombos(ads), preset, donate }));
}

export { ASSET_VERSION };
