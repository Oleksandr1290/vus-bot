// Server-rendered HTML of the website (content is in the page for search engines; the client script adds interactivity).

import { esc } from '../common.js';
import { COUNTRIES, CATEGORIES, categoryByKey } from '../data.js';
import { tt } from './i18n.js';
import { DOCS } from './docs.js';
import { CURRENCY, cityLatin, slug } from './data.js';

export const ASSET_VERSION = '3';

const catName = (lang, key) => { const c = categoryByKey(key); return c ? (c[lang] || c.ua).replace(/^\S+\s/, '') : key; };
const countryName = (lang, ua) => { const c = COUNTRIES.find((x) => x.ua === ua); return c ? (c[lang] || c.ua) : ua; };
const plural = (n, forms) => { const f = forms.split('|'); const a = n % 100, b = a % 10; return (a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]).replace('{n}', n); };

function ago(lang, h) {
  if (h < 1) return tt(lang, 'ago_now');
  if (h < 24) return tt(lang, 'ago_h', { n: h });
  if (h < 48) return tt(lang, 'ago_y');
  return tt(lang, 'ago_d', { n: Math.floor(h / 24) });
}

export function approxHtml(ad, fx) {
  const cur = ad.cc && CURRENCY[ad.cc];
  if (!cur || !ad.p || !fx || !fx[cur[0]]) return '';
  const f = (v) => { const x = v / fx[cur[0]]; return (x >= 100 ? Math.round(x / 10) * 10 : Math.round(x)).toLocaleString('uk-UA').replace(/,/g, ' '); };
  const pre = ad.from ? '≈ від ' : ad.upto ? '≈ до ' : '≈ ';
  return `<span class="approx">${pre}${f(ad.p)}${ad.p2 ? ' – ' + f(ad.p2) : ''} ${cur[1]}</span>`;
}

const CAT_LOOK = { job: '#DCEBDF', jobseek: '#E3E8F2', housing: '#F2E6D9', houseseek: '#EFE3D6', services: '#EBE1EF', sell: '#E6EEDF', buy: '#E0EAEC', free: '#F4EBD3', auto: '#DDE3E8', transport: '#E6E2D8', help: '#E4EEE8', other: '#E8EBE6' };

export function cardHtml(lang, ad, fx) {
  const tabs = ad.hasContact ? `<div class="tabs">${Array.from({ length: 5 }, () => `<button type="button" aria-label="${tt(lang, 'tab')}">${tt(lang, 'tab_s')}</button>`).join('')}</div>` : '';
  const thumb = ad.photos.length ? `<div class="thumb"><img class="bg" src="${ad.photos[0]}" alt="" aria-hidden="true" loading="lazy"><img class="fg" src="${ad.photos[0]}" alt="" loading="lazy"><small>📷 ${ad.photos.length}</small></div>` : '';
  const tagLinks = ad.tags && ad.tags.length ? `<p class="tags">${ad.tags.map((x) => `<a href="/?tag=${encodeURIComponent(x)}" data-tag="${esc(x)}">#${esc(x)}</a>`).join('')}</p>` : '';
  return `<article class="ad${ad.star ? ' star' : ''}" data-id="${ad.id}"><span class="no" title="${ad.no}">${ad.no}</span>${thumb}
    <p class="where"><b>${esc(ad.city)}</b>, ${esc(countryName(lang, ad.country))} · ${esc(catName(lang, ad.cat))}</p>
    <h4>${ad.h < 24 ? `<span class="new">${tt(lang, 'newb')}</span>` : ''}<a href="/ad/${ad.id}">${esc(ad.title)}</a></h4>
    ${ad.price ? `<p class="price">${esc(ad.price)}${approxHtml(ad, fx)}</p>` : ''}
    <p class="text">${esc((ad.text.split('\n').find((x) => x.trim()) || '').slice(0, 220))}</p>${tagLinks}
    <div class="meta"><span>${ago(lang, ad.h)} · <span class="views">👁 ${ad.views}</span></span>${ad.star ? `<span class="badge">${tt(lang, 'star')}</span>` : ''}</div>
    ${ad.hasContact ? `<p class="contact" aria-live="polite"></p>` : ''}${tabs}
  </article>`;
}

const TG_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.5 3.6 2.9 10.8c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.8.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.3-1.5zM9.6 14.2l8.3-7.5-6.9 8.6-.3 3.1-1.1-4.2z"/></svg>';

function header(lang) {
  const lb = (l, n) => `<button type="button" aria-pressed="${lang === l}" data-lang="${l}">${n}</button>`;
  return `<header class="wrap top">
  <a class="brand" href="/" aria-label="ВУС"><b><span>В</span><span>У</span><span>С</span></b><span data-t="tagline">${tt(lang, 'tagline')}</span></a>
  <nav>
    <a class="hide-s" href="/#how" data-t="nav_how">${tt(lang, 'nav_how')}</a>
    <div class="lang" role="group" aria-label="Мова / Language">${lb('ua', 'UA')}${lb('en', 'EN')}</div>
    <span id="auth"><button class="tg-login" type="button" data-login>${TG_ICON}<span data-t="login">${tt(lang, 'login')}</span></button></span>
    <button class="btn" type="button" data-open-post data-t="post">${tt(lang, 'post')}</button>
  </nav>
</header>`;
}

function footer(lang, env) {
  const ch = env.CHANNEL_USERNAME || 'vus_ogoloshennya_ua', gr = env.GROUP_USERNAME || 'vus_chat', bot = env.BOT_USERNAME || 'vus_ua_bot';
  return `<footer class="wrap">
  <b>ВУС</b>
  <a href="https://t.me/${ch}" data-t="l_channel">${tt(lang, 'l_channel')}</a>
  <a href="https://t.me/${gr}" data-t="l_chat">${tt(lang, 'l_chat')}</a>
  <a href="https://t.me/${bot}">@${bot}</a>
  <a href="/rules" data-t="f_rules">${tt(lang, 'f_rules')}</a>
  <a href="/privacy" data-t="f_privacy">${tt(lang, 'f_privacy')}</a>
  <a href="#" data-idea data-t="f_idea">${tt(lang, 'f_idea')}</a>
  <a href="#" data-thanks data-t="f_thanks" hidden>${tt(lang, 'f_thanks')}</a>
</footer>
<button class="btn fab" type="button" data-open-post data-t="post">${tt(lang, 'post')}</button>
<dialog id="dlg-post"><div class="sheet" id="post-sheet"></div></dialog>
<dialog id="dlg-cab"><div class="sheet" id="cab-sheet"></div></dialog>
<dialog id="dlg-idea"><div class="sheet" id="idea-sheet"></div></dialog>
<dialog id="dlg-notify"><div class="sheet" id="notify-sheet"></div></dialog>
<dialog id="dlg-report"><div class="sheet" id="report-sheet"></div></dialog>
<dialog id="dlg-thanks"><div class="sheet" id="thanks-sheet"></div></dialog>`;
}

export function layout(env, { lang, title, desc, path, ogImage, body, data, noindex = false, jsonld = null }) {
  const site = env.SITE_URL || '';
  return `<!doctype html>
<html lang="${lang === 'ua' ? 'uk' : lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${site}${path}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="ВУС">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${site}${path}">
${ogImage ? `<meta property="og:image" content="${site}${ogImage}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231D6B4C'/%3E%3Ctext x='32' y='43' font-size='26' font-family='Arial Black,Arial' font-weight='900' text-anchor='middle' fill='%23FFD84A'%3EВУС%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Golos+Text:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/app.css?v=${ASSET_VERSION}">
<script>try{if(!localStorage.getItem('vus_seen')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('anim-logo')}localStorage.setItem('vus_seen','1')}catch(e){}</script>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
${header(lang)}
<script>(function(){try{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;var b=document.querySelector('.brand b');if(!b)return;var go=function(){b.classList.remove('go');void b.offsetWidth;b.classList.add('go')};go();setInterval(go,15000)}catch(e){}})()</script>
${body}
${footer(lang, env)}
<script id="vus-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script src="/assets/app.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

function baseData(env, lang, extra) {
  return {
    lang, bot: env.BOT_USERNAME || 'vus_ua_bot', channel: env.CHANNEL_USERNAME || 'vus_ogoloshennya_ua', group: env.GROUP_USERNAME || 'vus_chat',
    countries: COUNTRIES.map((c) => ({ code: c.code, ua: c.ua, ru: c.ru, en: c.en, cities: c.cities.map((x) => x[0]) })),
    cats: CATEGORIES.map((c) => ({ key: c.key, ua: c.ua, ru: c.ru, en: c.en, price: c.price })),
    currency: CURRENCY, ...extra,
  };
}

export function homePage(env, { lang, ads, fx, counts, week, popular, preset = null, donate }) {
  const filtered = ads.filter((a) => (!preset || ((preset.cat === 'all' || a.cat === preset.cat) && (!preset.country || a.country === preset.country) && (!preset.city || a.city === preset.city))));
  let h1 = tt(lang, 'h1');
  let title = tt(lang, 'title_home');
  let path = '/';
  if (preset) {
    const what = preset.cat === 'all' ? tt(lang, 'all') : catName(lang, preset.cat);
    const where = preset.city || countryName(lang, preset.country || '');
    h1 = where ? tt(lang, 'land_in', { a: what, b: where }) : what;
    title = tt(lang, 'title_land', { x: h1 });
    path = preset.path;
  }
  const feed = filtered.slice(0, 60).map((a) => cardHtml(lang, a, fx)).join('');
  const body = `<main>
  <section class="wrap hero">
    <div>
      <h1 ${preset ? 'class="landing-h1"' : 'data-t="h1"'}>${esc(h1)}</h1>
      <p class="lead" data-t="lead">${tt(lang, 'lead')}</p>
      <form class="search" id="search" role="search">
        <label><span data-t="s_what">${tt(lang, 's_what')}</span><input id="q" type="search" autocomplete="off" placeholder="${esc(tt(lang, 's_ph'))}"></label>
        <label><span data-t="s_where">${tt(lang, 's_where')}</span><select id="where"><option value="all">${tt(lang, 'all_countries')}</option></select></label>
        <button class="btn" type="submit" data-t="s_btn">${tt(lang, 's_btn')}</button>
      </form>
    </div>
    <div class="board" aria-hidden="true">
      <div class="note n1"><h3>Здам кімнату</h3><p>Варшава, Mokotów. Світла, тиха, поруч метро.</p><div class="tabs"><i>Варшава</i><i class="gone">Варшава</i><i>Варшава</i><i>Варшава</i><i>Варшава</i></div></div>
      <div class="note n2"><h3>Потрібні водії</h3><p>Бухарест. Категорія C, офіційне працевлаштування.</p><div class="tabs"><i>Бухарест</i><i>Бухарест</i><i class="gone">Бухарест</i><i class="gone">Бухарест</i><i>Бухарест</i></div></div>
      <div class="note n3"><h3>Віддам даром</h3><p>Дитяча коляска, гарний стан. Прага, самовивіз.</p><div class="tabs"><i>Прага</i><i>Прага</i><i>Прага</i><i class="gone">Прага</i><i>Прага</i></div></div>
    </div>
  </section>
  ${preset ? '' : `<section class="wrap why">
    <div>
      <h2 data-t="why_t">${tt(lang, 'why_t')}</h2>
      <ul>
        <li><i>🤖</i><div><b data-t="why1">${tt(lang, 'why1')}</b><span data-t="why1p">${tt(lang, 'why1p')}</span></div></li>
        <li><i>☁️</i><div><b data-t="why2">${tt(lang, 'why2')}</b><span data-t="why2p">${tt(lang, 'why2p')}</span></div></li>
        <li><i>🤝</i><div><b data-t="why3">${tt(lang, 'why3')}</b><span data-t="why3p">${tt(lang, 'why3p')}</span></div></li>
      </ul>
    </div>
    <div class="letter"><p data-t="letter1">${tt(lang, 'letter1')}</p><p data-t="letter2">${tt(lang, 'letter2')}</p><p class="sign">— Олександр</p></div>
  </section>`}
  <section class="wrap" aria-label="Рубрики"><div class="cats" id="cats"></div></section>
  <section class="wrap main">
    <aside class="side">
      <h2 data-t="countries">${tt(lang, 'countries')}</h2>
      <ul class="countries" id="countries"></ul>
      <div class="post-cta">
        <strong data-t="cta_t">${tt(lang, 'cta_t')}</strong>
        <p data-t="cta_p">${tt(lang, 'cta_p')}</p>
        <button class="btn" type="button" data-open-post data-t="post">${tt(lang, 'post')}</button>
      </div>
    </aside>
    <div>
      <div class="mycity" id="mycity"></div>
      <div class="featured" id="featured-box" hidden>
        <h3 data-t="feat_t">${tt(lang, 'feat_t')}</h3>
        <p data-t="feat_p">${tt(lang, 'feat_p')}</p>
        <div class="grid" id="featured"></div>
      </div>
      <div class="feed-head">
        <div>
          <h2 id="feed-title" data-t="fresh">${tt(lang, 'fresh')}</h2>
          <p id="count">${plural(filtered.length, tt(lang, 'found'))}</p>
          <p class="weekline" id="weekline">${tt(lang, 'week', { a: week.ads, b: week.users })}</p>
        </div>
        <div class="feed-tools">
          <select class="sort" id="sort" aria-label="Sort">
            <option value="new" data-t="sort_new">${tt(lang, 'sort_new')}</option>
            <option value="cheap" data-t="sort_cheap">${tt(lang, 'sort_cheap')}</option>
            <option value="dear" data-t="sort_dear">${tt(lang, 'sort_dear')}</option>
          </select>
          <button class="ghost" type="button" id="notify">🔔 <span data-t="notify">${tt(lang, 'notify')}</span></button>
        </div>
      </div>
      <div class="grid" id="feed">${feed || `<div class="zero"><p class="big">${tt(lang, 'zero_t')}</p><p>${tt(lang, 'zero_p')}</p></div>`}</div>
    </div>
  </section>
  <section class="wrap">
    <div class="community">
      <div class="nums">
        <div><span class="num" id="n-ch">${counts.ch ?? '—'}</span><small data-t="com_ch">${tt(lang, 'com_ch')}</small></div>
        <div><span class="num" id="n-gr">${counts.gr ?? '—'}</span><small data-t="com_gr">${tt(lang, 'com_gr')}</small></div>
      </div>
      <div><h2 data-t="com_t">${tt(lang, 'com_t')}</h2><p data-t="com_p">${tt(lang, 'com_p')}</p></div>
      <div class="links">
        <a href="https://t.me/${env.CHANNEL_USERNAME || 'vus_ogoloshennya_ua'}" data-t="l_channel">${tt(lang, 'l_channel')}</a>
        <a href="https://t.me/${env.GROUP_USERNAME || 'vus_chat'}" data-t="l_chat">${tt(lang, 'l_chat')}</a>
        ${env.TIKTOK_URL ? `<a href="${esc(env.TIKTOK_URL)}">TikTok</a>` : ''}
        ${env.INSTAGRAM_URL ? `<a href="${esc(env.INSTAGRAM_URL)}">Instagram</a>` : ''}
        ${env.YOUTUBE_URL ? `<a href="${esc(env.YOUTUBE_URL)}">YouTube</a>` : ''}
      </div>
    </div>
  </section>
  <section class="wrap" id="how">
    <div class="how">
      <div>
        <h2 data-t="how_t">${tt(lang, 'how_t')}</h2>
        <p data-t="how_p">${tt(lang, 'how_p')}</p>
        <button class="btn" type="button" data-open-post data-t="post">${tt(lang, 'post')}</button>
      </div>
      <ol>
        <li><b data-t="st1">${tt(lang, 'st1')}</b><span data-t="st1p">${tt(lang, 'st1p')}</span></li>
        <li><b data-t="st2">${tt(lang, 'st2')}</b><span data-t="st2p">${tt(lang, 'st2p')}</span></li>
        <li><b data-t="st3">${tt(lang, 'st3')}</b><span data-t="st3p">${tt(lang, 'st3p')}</span></li>
      </ol>
    </div>
  </section>
  ${popular.length ? `<section class="wrap popular"><h2 data-t="popular">${tt(lang, 'popular')}</h2><div>${popular.map((p) =>
    `<a href="${p.path}">${esc(tt(lang, 'land_in', { a: catName(lang, p.cat), b: p.city }))}</a>`).join('')}</div></section>` : ''}
</main>`;
  return layout(env, {
    lang, title, desc: tt(lang, 'desc_home'), path, body,
    data: baseData(env, lang, { page: 'home', ads, fx, week, counts, preset, donate }),
    jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'ВУС', url: env.SITE_URL || '' },
  });
}

export function adPage(env, { lang, ad, raw, fx, similar, donate }) {
  if (!ad) {
    const body = `<main class="wrap detail"><p class="crumbs"><a href="/" data-t="back_home">${tt(lang, 'back_home')}</a></p>
      <div class="sheet"><h1 class="landing-h1" data-t="gone_t">${tt(lang, 'gone_t')}</h1><p class="sub" data-t="gone_p">${tt(lang, 'gone_p')}</p>
      <a class="btn" href="/" data-t="back_home">${tt(lang, 'back_home')}</a></div></main>`;
    return layout(env, { lang, title: tt(lang, 'gone_t') + ' | ВУС', desc: tt(lang, 'gone_p'), path: '/', body, data: baseData(env, lang, { page: 'gone', donate }), noindex: true });
  }
  const gallery = ad.photos.length ? `<div class="gallery">${ad.photos.map((p) => `<a href="${p}" target="_blank" rel="noopener"><img src="${p}" alt="${esc(ad.title)}" loading="lazy"></a>`).join('')}</div>` : '';
  const c = COUNTRIES.find((x) => x.ua === ad.country);
  const landing = c ? `/c/${ad.cat}/${c.code.toLowerCase()}/${slug(cityLatin(ad.country, ad.city))}` : '/';
  const body = `<main class="wrap detail">
  <p class="crumbs"><a href="/" data-t="back_home">${tt(lang, 'back_home')}</a> · <a href="${landing}">${esc(tt(lang, 'land_in', { a: catName(lang, ad.cat), b: ad.city }))}</a></p>
  <article class="sheet" data-id="${ad.id}">
    <button type="button" class="no no-copy" id="copy-no" title="${ad.no}">${ad.no}</button>
    <p class="where" style="margin:0 0 8px;color:var(--graphite);font-size:14px"><b style="color:var(--ink)">${esc(ad.city)}</b>, ${esc(countryName(lang, ad.country))} · ${esc(catName(lang, ad.cat))}</p>
    <h1 class="landing-h1">${ad.h < 24 ? `<span class="new">${tt(lang, 'newb')}</span>` : ''}${esc(ad.title)}</h1>
    ${gallery}
    ${ad.price ? `<p class="detail-price">${esc(ad.price)}${approxHtml(ad, fx)}</p>` : ''}
    <p class="detail-text">${esc(ad.text)}</p>
    ${ad.tags && ad.tags.length ? `<p class="tags">${ad.tags.map((x) => `<a href="/?tag=${encodeURIComponent(x)}">#${esc(x)}</a>`).join('')}</p>` : ''}
    <div class="detail-meta"><span>${ago(lang, ad.h)}</span><span id="views">👁 ${ad.views}</span>${ad.star ? `<span style="color:var(--ink);font-weight:600">${tt(lang, 'star')}</span>` : ''}</div>
    ${ad.hasContact ? `<div class="reveal"><button class="btn" type="button" id="show-contact" data-t="show">${tt(lang, 'show')}</button><span id="contact-val" hidden></span></div>` : ''}
    <div class="safety"><b data-t="safety_t">${tt(lang, 'safety_t')}</b><ul>${[1, 2, 3, 4].map((i) => `<li data-t="safety${i}">${tt(lang, 'safety' + i)}</li>`).join('')}</ul></div>
    <div class="row-actions"><button class="ghost" type="button" id="share" data-t="share">${tt(lang, 'share')}</button><button class="ghost" type="button" id="report" data-t="report">${tt(lang, 'report')}</button><button class="ghost" type="button" id="own-del-ad" hidden>🗑</button><a class="ghost" id="own-adm-ad" href="/admin?ad=${ad.id}" hidden>🛠</a></div>
    ${similar.length ? `<div class="similar"><h3 data-t="similar">${tt(lang, 'similar')}</h3><ul>${similar.map((s) => `<li><a href="/ad/${s.id}">${esc(s.title)}</a><span>${esc(s.price || '')}</span></li>`).join('')}</ul></div>` : ''}
  </article>
</main>`;
  const desc = `${ad.price ? ad.price + ' · ' : ''}${ad.city}, ${countryName(lang, ad.country)}. ${(ad.text || '').replace(/\s+/g, ' ').slice(0, 140)}`;
  return layout(env, {
    lang, title: `${ad.title} — ${ad.city} | ВУС`, desc, path: `/ad/${ad.id}`, ogImage: ad.photos[0] || null, body,
    data: baseData(env, lang, { page: 'ad', ad, fx, donate }),
    jsonld: { '@context': 'https://schema.org', '@type': 'Product', name: ad.title, description: (ad.text || '').slice(0, 500),
      ...(ad.photos[0] ? { image: (env.SITE_URL || '') + ad.photos[0] } : {}),
      ...(ad.p ? { offers: { '@type': 'Offer', price: ad.p, priceCurrency: 'UAH' } } : {}) },
  });
}

export function docPage(env, { lang, kind, donate }) {
  const html = (DOCS[kind] || DOCS.rules)[lang] || DOCS[kind].ua;
  const body = `<main class="wrap detail"><p class="crumbs"><a href="/" data-t="back_home">${tt(lang, 'back_home')}</a></p><div class="sheet doc">${html}</div></main>`;
  const title = (html.match(/<h1>(.*?)<\/h1>/) || [])[1] || 'ВУС';
  return layout(env, { lang, title: `${title} | ВУС`, desc: title, path: `/${kind}`, body, data: baseData(env, lang, { page: 'doc', donate }) });
}

export function sitemap(env, ads, combos) {
  const site = env.SITE_URL || '';
  const urls = ['/', '/rules', '/privacy', ...combos.map((c) => c.path), ...ads.map((a) => `/ad/${a.id}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${site}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}

// Owner admin panel shell; the client script loads everything through /api/admin/*.
export function adminPage(env, { lang, adId = null }) {
  const body = `<main class="wrap detail adm-wrap">
  <p class="crumbs"><a href="/">← ВУС</a></p>
  <div class="sheet">
    <h1 class="landing-h1">🛠 Адмін-панель</h1>
    <div class="cab-tabs" role="group" id="adm-tabs">
      <button type="button" data-admtab="queue" aria-pressed="true">Модерація <em id="adm-n-queue"></em></button>
      <button type="button" data-admtab="reports" aria-pressed="false">Скарги <em id="adm-n-reports"></em></button>
      <button type="button" data-admtab="find" aria-pressed="false">Пошук за номером</button>
      <button type="button" data-admtab="stats" aria-pressed="false">Статистика</button>
    </div>
    <div id="adm-body"><p class="sub">Завантаження…</p></div>
  </div>
</main>`;
  return layout(env, { lang, title: 'Адмін-панель | ВУС', desc: 'ВУС', path: '/admin', body, data: baseData(env, lang, { page: 'admin', adId }), noindex: true });
}
