// Owner-only statistics: community overview by period, per-member stats with a rating,
// the weekly summary for the owner and the weekly post for the group (Sundays 21:00 Kyiv time).

import {
  tg, esc, now, fmtDate, DAY, kyivDate,
  getUser, getSetting, setSetting, groupId, levelOf, getCfg,
  send, sendHtml, answer, whoName,
} from './common.js';
import { categoryByKey } from './data.js';

const PERIODS = {
  day:   { secs: DAY,      label: 'за добу',     btn: 'Доба' },
  week:  { secs: 7 * DAY,  label: 'за 7 днів',   btn: '7 днів' },
  month: { secs: 30 * DAY, label: 'за 30 днів',  btn: '30 днів' },
  all:   { secs: null,     label: 'за весь час', btn: 'Весь час' },
};

const REASON_UA = {
  spam: 'спам', forbidden: 'заборонений товар', incomplete: 'неповне оголошення', duplicate: 'дублікат', rules: 'порушення правил',
};

const LANG_UA = { ua: 'українська', ru: 'російська', en: 'англійська' };

const p2 = (n) => String(n).padStart(2, '0');
const dm = (ts) => { const d = kyivDate(ts); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}`; };

// "+5 ↑" / "−2 ↓" compared with the previous period of the same length.
function delta(cur, prev) {
  if (prev == null || cur === prev) return '';
  const d = cur - prev;
  return d > 0 ? ` (+${d} ↑)` : ` (−${-d} ↓)`;
}

// Ukrainian plural: 1 людина, 2 людини, 5 людей.
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

async function memberCount(env, chatId) {
  if (!chatId) return null;
  const r = await tg(env, 'getChatMemberCount', { chat_id: chatId });
  return r.ok ? r.result : null;
}

// ───────────────────────────── counters for a time window ─────────────────────────────

async function windowCounts(env, from, to) {
  const one = async (sql, ...b) => ((await env.DB.prepare(sql).bind(...b).first()) || {}).n || 0;
  const ev = (type) => one('SELECT COUNT(*) AS n FROM events WHERE type = ? AND created_at >= ? AND created_at < ?', type, from, to);
  const pun = (type) => one('SELECT COUNT(*) AS n FROM punishments WHERE type = ? AND created_at >= ? AND created_at < ?', type, from, to);
  return {
    published: await one('SELECT COUNT(*) AS n FROM ads WHERE published_at >= ? AND published_at < ?', from, to),
    rejected: await ev('ad_rejected'),
    expired: await ev('ad_expired'),
    extended: await ev('ad_extended'),
    delAuthor: await ev('ad_deleted_author'),
    delMod: await one("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'delete_ad' AND created_at >= ? AND created_at < ?", from, to),
    newUsers: await one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?', from, to),
    chJoin: await ev('ch_join'),
    chLeave: await ev('ch_leave'),
    grJoin: await ev('gr_join'),
    grLeave: await ev('gr_leave'),
    viaRef: await one('SELECT COUNT(*) AS n FROM referrals WHERE joined_at >= ? AND joined_at < ?', from, to) +
      await one("SELECT COUNT(*) AS n FROM group_invites WHERE status = 'joined' AND created_at >= ? AND created_at < ?", from, to),
    jrOk: await ev('jr_ok'),
    jrFail: await ev('jr_fail'),
    cas: await ev('cas_block'),
    filters: await ev('filter'),
    aiChecks: await ev('ai_check'),
    aiDeleted: await ev('ai_delete'),
    aiReview: await ev('ai_review'),
    nights: await one("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'night_close' AND created_at >= ? AND created_at < ?", from, to),
    warns: await pun('warn'),
    mutes: await pun('mute'),
    bans: await pun('ban'),
    repNew: await one('SELECT COUNT(*) AS n FROM reports WHERE created_at >= ? AND created_at < ?', from, to),
    repClosed: await one('SELECT COUNT(*) AS n FROM reports WHERE closed_at >= ? AND closed_at < ?', from, to),
    invites: await one("SELECT COUNT(*) AS n FROM referrals WHERE status = 'counted' AND counted_at >= ? AND counted_at < ?", from, to),
  };
}

async function topInviters(env, from, to, limit = 3) {
  const { results } = await env.DB.prepare(
    "SELECT inviter_id, COUNT(*) AS n FROM referrals WHERE status = 'counted' AND counted_at >= ? AND counted_at < ? GROUP BY inviter_id ORDER BY n DESC LIMIT ?"
  ).bind(from, to, limit).all();
  const out = [];
  for (const r of results) {
    const u = await getUser(env, r.inviter_id);
    out.push({ id: r.inviter_id, name: u ? (u.first_name || whoName(u)) : 'Учасник', n: r.n });
  }
  return out;
}

// ───────────────────────────── community statistics (owner) ─────────────────────────────

async function statsText(env, period) {
  const P = PERIODS[period] || PERIODS.week;
  const to = now() + 1;
  const from = P.secs ? to - P.secs : 0;
  const c = await windowCounts(env, from, to);
  const pr = P.secs ? await windowCounts(env, from - P.secs, from) : null;
  const d = (k) => delta(c[k], pr && pr[k]);
  const one = async (sql, ...b) => ((await env.DB.prepare(sql).bind(...b).first()) || {}).n || 0;

  const pending = await env.DB.prepare("SELECT COUNT(*) AS n, AVG(? - created_at) AS w FROM ads WHERE status = 'pending'").bind(to).first();
  const waitH = pending.n ? Math.max(1, Math.round((pending.w || 0) / 3600)) : 0;
  const reason = await env.DB.prepare(
    "SELECT ref, COUNT(*) AS n FROM events WHERE type = 'ad_rejected' AND created_at >= ? GROUP BY ref ORDER BY n DESC LIMIT 1"
  ).bind(from).first();
  const { results: cats } = await env.DB.prepare(
    'SELECT category, COUNT(*) AS n FROM ads WHERE published_at >= ? GROUP BY category ORDER BY n DESC LIMIT 3'
  ).bind(from).all();
  const { results: cities } = await env.DB.prepare(
    'SELECT city, country, COUNT(*) AS n FROM ads WHERE published_at >= ? GROUP BY city, country ORDER BY n DESC LIMIT 3'
  ).bind(from).all();
  const { results: langs } = await env.DB.prepare('SELECT lang, COUNT(*) AS n FROM users WHERE lang IS NOT NULL GROUP BY lang ORDER BY n DESC').all();

  const chTotal = await memberCount(env, env.CHANNEL_ID);
  const grTotal = await memberCount(env, await groupId(env));
  const botTotal = await one('SELECT COUNT(*) AS n FROM users');
  const active = await one('SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?', P.secs ? from : to - 30 * DAY);
  const openReps = await one("SELECT COUNT(*) AS n FROM reports WHERE status != 'closed'");
  const top = await topInviters(env, from, to, 3);

  // Invite levels: how many people have reached each milestone.
  const { results: inv } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM referrals WHERE track = 'limits' AND status = 'counted' GROUP BY inviter_id"
  ).all();
  const lv = { a: 0, b: 0, c: 0, d: 0 };
  for (const r of inv) { if (r.n >= 30) lv.d++; else if (r.n >= 15) lv.c++; else if (r.n >= 5) lv.b++; else lv.a++; }

  const range = P.secs ? ` (${dm(from)}–${dm(to)})` : '';
  const L = [];
  L.push(`📊 <b>Статистика ВУС</b>\n${P.label}${range}`);

  L.push('<b>📢 Оголошення</b>');
  L.push(`✅ Опубліковано: ${c.published}${d('published')}`);
  L.push(`❌ Відхилено: ${c.rejected}${d('rejected')}` + (reason ? `\nнайчастіша причина: ${REASON_UA[reason.ref] || reason.ref}` : ''));
  L.push(`⏳ На модерації зараз: ${pending.n}` + (pending.n ? ` (чекають у середньому ${waitH} год)` : ''));
  if (cats.length) L.push('🏷 Рубрики: ' + cats.map((r) => `${(categoryByKey(r.category) || {}).ua || r.category} ${r.n}`).join(', '));
  if (cities.length) L.push('📍 Міста: ' + cities.map((r) => `${esc(r.city)} ${r.n}`).join(', '));
  L.push(`⌛ Термін минув: ${c.expired}${d('expired')}`);
  L.push(`🔄 Продовжено: ${c.extended}${d('extended')}`);
  L.push(`🗑 Видалили автори: ${c.delAuthor} · за скаргами: ${c.delMod}`);

  L.push('<b>👥 Люди</b>');
  L.push(`🆕 Нових у боті: ${c.newUsers}${d('newUsers')}`);
  L.push(`📢 Канал: ${chTotal ?? '?'} підписників\nприйшло ${c.chJoin}${d('chJoin')}, пішло ${c.chLeave}`);
  L.push(`💬 Група: ${grTotal ?? '?'} учасників\nприйшло ${c.grJoin}${d('grJoin')}, пішло ${c.grLeave}`);
  L.push(`🔗 Прийшли за запрошенням: ${c.viaRef}${d('viaRef')}`);
  L.push(`🟢 Активні ${P.secs ? P.label : 'за 30 днів'}: ${active} з ${botTotal}`);
  if (langs.length) L.push('🌐 Мови: ' + langs.map((r) => `${LANG_UA[r.lang] || r.lang} ${r.n}`).join(', '));

  L.push('<b>🛡 Безпека</b>');
  L.push(`✅ Заявки в групу схвалено: ${c.jrOk}${d('jrOk')}`);
  L.push(`🚫 Не пройшли капчу: ${c.jrFail}${d('jrFail')}`);
  L.push(`🛡 Заблоковано базою CAS: ${c.cas}${d('cas')}`);
  L.push(`🧹 Спрацювань фільтрів: ${c.filters}${d('filters')}`);
  L.push(`🤖 Нейромережа: перевірила ${c.aiChecks}, видалила ${c.aiDeleted}${d('aiDeleted')}, на перевірку адмінам ${c.aiReview}` +
    (c.nights ? `\n🌙 Нічних закриттів чату: ${c.nights}` : ''));
  L.push(`⚠️ Попереджень: ${c.warns} · 🔇 мутів: ${c.mutes} · ⛔ банів: ${c.bans}`);
  L.push(`📨 Скарг подано: ${c.repNew}${d('repNew')} · вирішено: ${c.repClosed} · чекають: ${openReps}`);

  L.push('<b>🤝 Запрошення</b>');
  L.push(`✅ Зараховано: ${c.invites}${d('invites')}`);
  L.push(`📈 Рубежі: 1–4 запрошення ${lv.a} · 5+ ${lv.b} · 15+ ${lv.c} · 30+ ${lv.d}`);
  if (top.length) L.push('🏆 Топ запрошувачів\n' + top.map((x, i) => `${i + 1}. ${esc(x.name)} · ${x.n}`).join('\n'));

  if (period === 'week' || !P.secs) L.push('<i>Перегляди постів у каналі Telegram ботам не показує — їх видно в статистиці самого каналу.</i>');
  return L.join('\n\n');
}

const periodButtons = (cur) => ({
  inline_keyboard: [Object.entries(PERIODS).map(([k, v]) => ({ text: (k === cur ? '• ' : '') + v.btn, callback_data: `st:p:${k}` }))],
});

export async function showStats(env, user, period = 'week', msg = null) {
  const text = await statsText(env, period);
  if (msg) {
    const r = await tg(env, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, text, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: periodButtons(period),
    });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  return sendHtml(env, user.id, text, { reply_markup: periodButtons(period) });
}

// ───────────────────────────── per-member statistics (owner) ─────────────────────────────

export async function memberStats(env, uid) {
  const one = async (sql, ...b) => ((await env.DB.prepare(sql).bind(...b).first()) || {}).n || 0;
  const today = Math.floor(now() / DAY);
  const md = (days, field = 'msgs') => one(`SELECT COALESCE(SUM(${field}), 0) AS n FROM member_days WHERE user_id = ? AND day > ?`, uid, today - days);
  const inList = "instr(',' || trim(reporters, '[]') || ',', ',' || ? || ',') > 0";
  const s = {
    msgsDay: await md(1),
    msgsWeek: await md(7),
    msgsMonth: await md(30),
    activeDays: await one('SELECT COUNT(*) AS n FROM member_days WHERE user_id = ? AND day > ? AND msgs > 0', uid, today - 30),
    replies: await md(30, 'replies'),
    firstDay: ((await env.DB.prepare('SELECT MIN(day) AS d FROM member_days WHERE user_id = ?').bind(uid).first()) || {}).d,
    chCounted: await one("SELECT COUNT(*) AS n FROM referrals WHERE inviter_id = ? AND status = 'counted'", uid),
    chPending: await one("SELECT COUNT(*) AS n FROM referrals WHERE inviter_id = ? AND status = 'pending'", uid),
    chLost: await one("SELECT COUNT(*) AS n FROM referrals WHERE inviter_id = ? AND status = 'void'", uid),
    chBanned: await one("SELECT COUNT(*) AS n FROM referrals WHERE inviter_id = ? AND status = 'banned'", uid),
    grInvites: await one("SELECT COUNT(*) AS n FROM group_invites WHERE inviter_id = ? AND status = 'joined'", uid),
    adsAll: await one('SELECT COUNT(*) AS n FROM ads WHERE user_id = ?', uid),
    adsPub: await one('SELECT COUNT(*) AS n FROM ads WHERE user_id = ? AND published_at IS NOT NULL', uid),
    adsRej: await one("SELECT COUNT(*) AS n FROM ads WHERE user_id = ? AND status = 'rejected'", uid),
    repFiled: await one('SELECT COUNT(*) AS n FROM report_events WHERE reporter_id = ?', uid),
    repConfirmed: await one(`SELECT COUNT(*) AS n FROM reports WHERE status = 'closed' AND decision NOT LIKE '✅ Відхилено%' AND ${inList}`, uid),
    repAgainst: await one('SELECT COUNT(*) AS n FROM reports WHERE target_id = ?', uid),
    warns: await one("SELECT COUNT(*) AS n FROM punishments WHERE user_id = ? AND type = 'warn'", uid),
    mutes: await one("SELECT COUNT(*) AS n FROM punishments WHERE user_id = ? AND type = 'mute'", uid),
    bans: await one("SELECT COUNT(*) AS n FROM punishments WHERE user_id = ? AND type = 'ban'", uid),
    filters: await one("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND type = 'filter'", uid),
  };
  s.rating = Math.max(0, Math.round(
    s.activeDays * 3 + Math.min(s.msgsMonth, 300) / 10 + Math.min(s.replies, 100) / 5 +
    s.chCounted * 5 + s.grInvites * 3 + s.repConfirmed * 4 + s.adsPub -
    s.warns * 5 - s.mutes * 10 - s.bans * 50 - s.filters * 2 - s.chBanned * 5,
  ));
  return s;
}

export async function memberStatsBlock(env, uid) {
  const s = await memberStats(env, uid);
  const u = await getUser(env, uid);
  const lv = await levelOf(env, uid);
  return [
    `📊 <b>Статистика учасника</b> (бачите лише ви)`,
    `🏅 Рейтинг кандидата в адміни: <b>${s.rating}</b>`,
    `<b>💬 Активність у групі</b>\nПовідомлень: сьогодні ${s.msgsDay} · 7 днів ${s.msgsWeek} · 30 днів ${s.msgsMonth}\nПисав у ${s.activeDays} з 30 днів\nВідповідали на його повідомлення: ${s.replies} за 30 днів` +
      (s.firstDay ? `\nПерше повідомлення: ${fmtDate(s.firstDay * DAY)}` : '') +
      (u && u.last_seen ? `\nОстання активність: ${fmtDate(u.last_seen)}` : ''),
    `<b>🤝 Запрошення</b>\nУ канал: зараховано ${s.chCounted}, чекають ${s.chPending}, пішли ${s.chLost}, забанені ${s.chBanned}\nУ групу: ${s.grInvites}\nЛіміт оголошень на добу: ${lv.perDay}`,
    `<b>📢 Оголошення</b>\nПодано ${s.adsAll} · опубліковано ${s.adsPub} · відхилено ${s.adsRej}`,
    `<b>🛡 Порядок</b>\nПодав скарг: ${s.repFiled} (підтвердилось ${s.repConfirmed})\nСкарг на нього: ${s.repAgainst}\nПопереджень ${s.warns} · мутів ${s.mutes} · банів ${s.bans} · фільтрів ${s.filters}`,
  ].join('\n\n');
}

const memberMenu = () => ({
  inline_keyboard: [
    [{ text: '🏅 Рейтинг', callback_data: 'st:top:rating' }, { text: '💬 Активність', callback_data: 'st:top:active' }],
    [{ text: '🤝 Запрошення', callback_data: 'st:top:invites' }, { text: '🔎 Знайти учасника', callback_data: 'st:find' }],
  ],
});

export async function showMembers(env, user) {
  return sendHtml(env, user.id,
    '👥 <b>Учасники ВУС</b>\n\nТоп-10 за рейтингом, активністю або запрошеннями. Натисніть номер у списку, щоб відкрити картку учасника.',
    { reply_markup: memberMenu() });
}

async function showTop(env, user, kind) {
  const today = Math.floor(now() / DAY);
  // Candidates: active in the group in the last 30 days or anyone who invited people.
  const { results } = await env.DB.prepare(
    `SELECT user_id FROM member_days WHERE day > ? GROUP BY user_id
     UNION SELECT inviter_id FROM referrals WHERE status = 'counted'
     UNION SELECT inviter_id FROM group_invites WHERE status = 'joined' LIMIT 300`
  ).bind(today - 30).all();
  const rows = [];
  for (const r of results) {
    const id = r.user_id;
    if (String(id) === String(env.OWNER_ID)) continue;
    const s = await memberStats(env, id);
    const value = kind === 'active' ? s.msgsMonth : kind === 'invites' ? s.chCounted + s.grInvites : s.rating;
    if (value > 0) rows.push({ id, value, s });
  }
  rows.sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 10);
  const title = { rating: '🏅 Топ за рейтингом', active: '💬 Топ активності (30 днів)', invites: '🤝 Топ запрошень' }[kind];
  if (!top.length) return sendHtml(env, user.id, `${title}\n\nПоки що даних немає.`, { reply_markup: memberMenu() });
  const lines = [];
  for (let i = 0; i < top.length; i++) {
    const u = await getUser(env, top[i].id);
    const s = top[i].s;
    const extra = kind === 'active' ? `${s.msgsMonth} повідомл., ${s.activeDays} дн.`
      : kind === 'invites' ? `канал ${s.chCounted}, група ${s.grInvites}`
      : `${s.rating} ${plural(s.rating, 'бал', 'бали', 'балів')}`;
    lines.push(`${i + 1}. ${esc(whoName(u) || 'ID ' + top[i].id)} · ${extra}`);
  }
  const nums = top.map((x, i) => ({ text: String(i + 1), callback_data: `st:u:${x.id}` }));
  const kb = [];
  for (let i = 0; i < nums.length; i += 5) kb.push(nums.slice(i, i + 5));
  kb.push(...memberMenu().inline_keyboard);
  return sendHtml(env, user.id, `<b>${title}</b>\n\n${lines.join('\n\n')}`, { reply_markup: { inline_keyboard: kb } });
}

export async function onStatsButton(env, user, cq, parts) {
  const [, action, arg] = parts;
  await answer(env, cq);
  if (action === 'p') return showStats(env, user, PERIODS[arg] ? arg : 'week', cq.message);
  if (action === 'top') return showTop(env, user, arg);
}

// ───────────────────────────── weekly reports ─────────────────────────────

const MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

async function weeklyGroupPost(env, from, to) {
  const gid = await groupId(env);
  if (!gid) return;
  const one = async (sql, ...b) => ((await env.DB.prepare(sql).bind(...b).first()) || {}).n || 0;
  const newPeople = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT user_id AS uid FROM events WHERE type IN ('ch_join', 'gr_join') AND created_at >= ?1 AND created_at < ?2 AND user_id IS NOT NULL
       UNION SELECT id FROM users WHERE created_at >= ?1 AND created_at < ?2)`, from, to);
  const published = await one('SELECT COUNT(*) AS n FROM ads WHERE published_at >= ? AND published_at < ?', from, to);
  const total = (await memberCount(env, env.CHANNEL_ID)) ?? (await one('SELECT COUNT(*) AS n FROM users'));
  const top = await topInviters(env, from, to, 3);
  const channel = env.CHANNEL_USERNAME ? `t.me/${env.CHANNEL_USERNAME}` : '';

  const last = Number((await getSetting(env, 'milestone')) || 0);
  const reached = MILESTONES.filter((m) => total >= m && m > last).pop();
  if (reached) await setSetting(env, 'milestone', reached);

  const L = [];
  if (newPeople > 0) {
    L.push(reached ? `🎉 <b>Друзі, нас уже ${reached}!</b>` : '🎉 <b>Друзі, у нас гарні новини!</b>');
    L.push(newPeople === 1
      ? 'За цей тиждень до ВУС приєдналась ще 1 людина. Кожен новий учасник для нас дуже важливий 💙'
      : `За цей тиждень до ВУС приєдналося ${newPeople} ${plural(newPeople, 'нова людина', 'нові людини', 'нових людей')} 🔥`);
    L.push(`📢 Опубліковано оголошень: ${published}`);
    L.push(`👥 Нас уже: ${total}`);
    if (top.length) {
      const names = top.map((x) => esc(x.name));
      const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' і ' + names[names.length - 1];
      L.push(`🏆 ${top.length === 1 ? 'Найбільше друзів привів(ла)' : 'Найбільше друзів привели'}: ${list}. Дякуємо вам 💙`);
    }
    L.push('Кожен із вас робить ВУС більшим. Чим більше нас, тим швидше знаходяться покупці, робота і житло.');
    if (channel) L.push(`👉 Перешли посилання хоча б одному знайомому українцю: ${channel}`);
  } else {
    L.push('💙 <b>Підсумки тижня у ВУС</b>');
    L.push(`📢 Опубліковано оголошень: ${published}`);
    L.push(`👥 Нас уже: ${total}`);
    L.push('Ми тільки на початку шляху, і кожна нова людина для нас дуже важлива. Якщо ВУС тобі подобається, розкажи про нас друзям: одне повідомлення від тебе важить більше, ніж будь-яка реклама.');
    if (channel) L.push(`👉 ${channel}`);
  }
  await sendHtml(env, gid, L.join('\n\n'));
}

export async function cronWeekly(env, force = false) {
  const k = kyivDate();
  if (!force && (k.getUTCDay() !== 0 || k.getUTCHours() !== 21)) return;
  const key = `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())}`;
  if (!force && (await getSetting(env, 'weekly_sent')) === key) return;
  await setSetting(env, 'weekly_sent', key);

  const to = now() + 1;
  const from = to - 7 * DAY;
  if (env.OWNER_ID) {
    await sendHtml(env, env.OWNER_ID, '🗓 <b>Щотижневий звіт</b>\n\n' + (await statsText(env, 'week')), { reply_markup: periodButtons('week') });
  }
  if ((await getCfg(env, 'weekly_post_on')) === '1') await weeklyGroupPost(env, from, to);
}
