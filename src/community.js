// Community features: membership check before posting, ideas to the owner, /deletedata,
// optional donations (switched on automatically at 5 000 channel subscribers) and search alerts.

import {
  tg, esc, now, DAY, getUser, getSetting, setSetting, getCfg, setCfg, groupId,
  setSession, clearSession, logAction, logEvent, send, sendHtml, answer, removeButtons,
  removeFromChannel, postLink, menuFor, userLabel, whoName,
} from './common.js';
import { COUNTRIES, CATEGORIES, countryByCode, categoryByKey, priceText } from './data.js';

export const DONATE_AT = 5000;
const MAX_ALERTS = 5;
const STARS = [50, 100, 250];

const TXT = {
  ua: {
    join_need: '💙 Подавати оголошення можуть учасники спільноти ВУС.\n\n{ch} Канал оголошень — {chs}\n{gr} Група спілкування — {grs}\n\nПідпишіться, вступіть у групу (бот надішле просте завдання з емодзі) і натисніть «Перевірити».',
    yes: 'підписані', no: 'ще ні', btn_ch: '📢 Підписатися на канал', btn_gr: '💬 Вступити в групу', btn_check: '🔄 Я підписався, перевірити',
    still: 'Поки що не бачу вас в усіх чатах. Telegram інколи оновлює це хвилину — спробуйте ще раз.',
    idea_ask: '💡 Напишіть свою ідею, побажання або проблему одним повідомленням. Ми читаємо кожне повідомлення.',
    idea_ok: '💡 Дякуємо! Ідею надіслано. Ми повідомимо, коли її розглянуть.',
    idea_reply: '💬 Відповідь від власника ВУС на вашу ідею #{id}:\n\n{text}',
    idea_taken: '✅ Вашу ідею #{id} взято в роботу. Дякуємо, що допомагаєте робити ВУС кращим!',
    idea_declined: '🙏 Дякуємо за ідею #{id}! Поки що вона не підходить, але ми все одно вдячні за допомогу.',
    del_ask: '⚠️ Видалити всі ваші дані з ВУС?\n\nБуде видалено: ваші оголошення (і з каналу теж), сповіщення, ідеї, статистику активності. Запрошення, які ви зробили, зникнуть.\n\nДані про блокування, якщо вони є, зберігаються, щоб захищати спільноту. Цю дію не можна скасувати.',
    del_yes: '🗑 Так, видалити все', del_no: '✖️ Ні, залишити',
    del_done: '✅ Ваші дані видалено. Якщо захочете повернутися — просто натисніть /start.',
    del_cancel: 'Добре, нічого не видаляємо.',
    don_off: 'Донати ще не увімкнені. Вони з’являться, коли в каналі буде {n} підписників. А поки найкраща подяка — розповісти про ВУС друзям 💙',
    don_text: '☕ Подякувати ВУС\n\nВУС безкоштовний і таким залишиться. Донат — це просто «дякую», він не дає жодних переваг: ні підняття, ні значків, ні лімітів.\n\nГроші підуть на домен, розвиток сайту і час, який команда вкладає в спільноту.',
    don_title: 'Дякую ВУС', don_desc: 'Добровільна подяка власнику спільноти ВУС. Не дає жодних переваг.',
    don_thanks: '💙 Дякуємо за підтримку! Це дуже важливо для ВУС.',
    btn_mono: '🫙 Банка Monobank', btn_paypal: '💳 PayPal / Buy Me a Coffee',
    al_title: '🔔 Ваші сповіщення про нові оголошення\n\nБот напише вам, щойно з’явиться оголошення за вашим пошуком.',
    al_none: 'Сповіщень поки немає.', al_add: '➕ Додати сповіщення', al_del: '✖️', al_max: 'Можна мати до {n} сповіщень. Видаліть одне, щоб додати нове.',
    al_cat: 'Яка рубрика вас цікавить?', al_country: 'У якій країні?', al_any_cat: '🗂 Будь-яка рубрика', al_any_country: '🌍 Будь-яка країна',
    al_saved: '✅ Сповіщення збережено: {what}. Бот напише, щойно з’явиться підходяще оголошення.',
    al_new: '🔔 Нове оголошення за вашим пошуком «{what}»:\n\n<b>{title}</b>\n{where} · {price}', al_open: '👁 Відкрити', al_off: '🔕 Вимкнути це сповіщення',
    al_removed: 'Сповіщення вимкнено.', any: 'будь-що',
  },
  ru: {
    join_need: '💙 Подавать объявления могут участники сообщества ВУС.\n\n{ch} Канал объявлений — {chs}\n{gr} Группа общения — {grs}\n\nПодпишитесь, вступите в группу (бот пришлёт простое задание с эмодзи) и нажмите «Проверить».',
    yes: 'подписаны', no: 'ещё нет', btn_ch: '📢 Подписаться на канал', btn_gr: '💬 Вступить в группу', btn_check: '🔄 Я подписался, проверить',
    still: 'Пока не вижу вас во всех чатах. Telegram иногда обновляет это минуту — попробуйте ещё раз.',
    idea_ask: '💡 Напишите свою идею, пожелание или проблему одним сообщением. Мы читаем каждое сообщение.',
    idea_ok: '💡 Спасибо! Идея отправлена. Мы сообщим, когда её рассмотрят.',
    idea_reply: '💬 Ответ владельца ВУС на вашу идею #{id}:\n\n{text}',
    idea_taken: '✅ Вашу идею #{id} взяли в работу. Спасибо, что помогаете делать ВУС лучше!',
    idea_declined: '🙏 Спасибо за идею #{id}! Пока она не подходит, но мы всё равно благодарны за помощь.',
    del_ask: '⚠️ Удалить все ваши данные из ВУС?\n\nБудут удалены: ваши объявления (и из канала тоже), уведомления, идеи, статистика активности. Ваши приглашения исчезнут.\n\nДанные о блокировках, если они есть, сохраняются, чтобы защищать сообщество. Это действие нельзя отменить.',
    del_yes: '🗑 Да, удалить всё', del_no: '✖️ Нет, оставить',
    del_done: '✅ Ваши данные удалены. Если захотите вернуться — просто нажмите /start.',
    del_cancel: 'Хорошо, ничего не удаляем.',
    don_off: 'Донаты ещё не включены. Они появятся, когда в канале будет {n} подписчиков. А пока лучшая благодарность — рассказать о ВУС друзьям 💙',
    don_text: '☕ Поблагодарить ВУС\n\nВУС бесплатный и таким останется. Донат — это просто «спасибо», он не даёт никаких преимуществ: ни поднятия, ни значков, ни лимитов.\n\nДеньги пойдут на домен, развитие сайта и время, которое команда вкладывает в сообщество.',
    don_title: 'Спасибо ВУС', don_desc: 'Добровольная благодарность владельцу сообщества ВУС. Не даёт преимуществ.',
    don_thanks: '💙 Спасибо за поддержку! Это очень важно для ВУС.',
    btn_mono: '🫙 Банка Monobank', btn_paypal: '💳 PayPal / Buy Me a Coffee',
    al_title: '🔔 Ваши уведомления о новых объявлениях\n\nБот напишет вам, как только появится объявление по вашему поиску.',
    al_none: 'Уведомлений пока нет.', al_add: '➕ Добавить уведомление', al_del: '✖️', al_max: 'Можно иметь до {n} уведомлений. Удалите одно, чтобы добавить новое.',
    al_cat: 'Какая рубрика вас интересует?', al_country: 'В какой стране?', al_any_cat: '🗂 Любая рубрика', al_any_country: '🌍 Любая страна',
    al_saved: '✅ Уведомление сохранено: {what}. Бот напишет, как только появится подходящее объявление.',
    al_new: '🔔 Новое объявление по вашему поиску «{what}»:\n\n<b>{title}</b>\n{where} · {price}', al_open: '👁 Открыть', al_off: '🔕 Отключить это уведомление',
    al_removed: 'Уведомление отключено.', any: 'что угодно',
  },
  en: {
    join_need: '💙 Ads can be posted by VUS community members.\n\n{ch} Ads channel — {chs}\n{gr} Community chat — {grs}\n\nSubscribe, join the group (the bot will send a simple emoji task) and tap “Check”.',
    yes: 'subscribed', no: 'not yet', btn_ch: '📢 Subscribe to the channel', btn_gr: '💬 Join the group', btn_check: '🔄 Done, check again',
    still: 'I can’t see you in all chats yet. Telegram sometimes takes a minute — try again.',
    idea_ask: '💡 Send your idea, wish or problem in one message. We read every message.',
    idea_ok: '💡 Thank you! Your idea has been sent. We’ll let you know when it’s reviewed.',
    idea_reply: '💬 The VUS owner replied to your idea #{id}:\n\n{text}',
    idea_taken: '✅ Your idea #{id} has been taken on. Thank you for helping make VUS better!',
    idea_declined: '🙏 Thank you for idea #{id}! It doesn’t fit right now, but we’re grateful for your help.',
    del_ask: '⚠️ Delete all your data from VUS?\n\nThis removes your ads (from the channel too), alerts, ideas and activity statistics. Your invites will be gone.\n\nBan records, if any, are kept to protect the community. This cannot be undone.',
    del_yes: '🗑 Yes, delete everything', del_no: '✖️ No, keep it',
    del_done: '✅ Your data has been deleted. To come back, just tap /start.',
    del_cancel: 'OK, nothing was deleted.',
    don_off: 'Donations aren’t on yet. They’ll appear when the channel reaches {n} subscribers. Until then, the best thanks is telling your friends about VUS 💙',
    don_text: '☕ Thank VUS\n\nVUS is free and will stay free. A donation is just a “thank you” and gives no advantages: no bumps, badges or extra limits.\n\nThe money goes to the domain, the website and the time the team puts into the community.',
    don_title: 'Thank you VUS', don_desc: 'A voluntary thank-you to the VUS community owner. Gives no advantages.',
    don_thanks: '💙 Thank you for your support! It means a lot to VUS.',
    btn_mono: '🫙 Monobank jar', btn_paypal: '💳 PayPal / Buy Me a Coffee',
    al_title: '🔔 Your new-ad alerts\n\nThe bot will message you as soon as an ad matching your search appears.',
    al_none: 'No alerts yet.', al_add: '➕ Add an alert', al_del: '✖️', al_max: 'You can have up to {n} alerts. Delete one to add a new one.',
    al_cat: 'Which category?', al_country: 'Which country?', al_any_cat: '🗂 Any category', al_any_country: '🌍 Any country',
    al_saved: '✅ Alert saved: {what}. The bot will message you when a matching ad appears.',
    al_new: '🔔 New ad matching “{what}”:\n\n<b>{title}</b>\n{where} · {price}', al_open: '👁 Open', al_off: '🔕 Turn off this alert',
    al_removed: 'Alert turned off.', any: 'anything',
  },
};
const tx = (lang, key, vars = {}) => {
  let s = (TXT[lang] || TXT.ua)[key] ?? TXT.ua[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
};

// ───────────────────────────── membership check before posting ─────────────────────────────

const inside = (s, m) => s === 'member' || s === 'administrator' || s === 'creator' || (s === 'restricted' && m && m.is_member);

export async function membership(env, uid) {
  const out = { ch: true, gr: true };
  const r1 = await tg(env, 'getChatMember', { chat_id: env.CHANNEL_ID, user_id: uid });
  if (r1.ok) out.ch = inside(r1.result.status, r1.result);
  const gid = await groupId(env);
  if (gid) {
    const r2 = await tg(env, 'getChatMember', { chat_id: gid, user_id: uid });
    if (r2.ok) out.gr = inside(r2.result.status, r2.result);
  }
  return out;
}

// Returns true if the person may post; otherwise shows what is missing and returns false.
export async function requireMembership(env, user, cq = null) {
  if (user.isStaff) return true;
  const m = await membership(env, user.id);
  if (m.ch && m.gr) return true;
  const L = user.lang || 'ua';
  const kb = [];
  if (!m.ch && env.CHANNEL_USERNAME) kb.push([{ text: tx(L, 'btn_ch'), url: `https://t.me/${env.CHANNEL_USERNAME}` }]);
  if (!m.gr && env.GROUP_USERNAME) kb.push([{ text: tx(L, 'btn_gr'), url: `https://t.me/${env.GROUP_USERNAME}` }]);
  kb.push([{ text: tx(L, 'btn_check'), callback_data: 'join:check' }]);
  const text = tx(L, 'join_need', {
    ch: m.ch ? '✅' : '❌', chs: tx(L, m.ch ? 'yes' : 'no'), gr: m.gr ? '✅' : '❌', grs: tx(L, m.gr ? 'yes' : 'no'),
  });
  if (cq) {
    await answer(env, cq, tx(L, 'still'), true);
    await tg(env, 'editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text, reply_markup: { inline_keyboard: kb } });
  } else {
    await send(env, user.id, text, { reply_markup: { inline_keyboard: kb } });
  }
  return false;
}

// ───────────────────────────── ideas ─────────────────────────────

export async function askIdea(env, user) {
  await setSession(env, user.id, 'idea:text', {});
  return send(env, user.id, tx(user.lang, 'idea_ask'), { reply_markup: { inline_keyboard: [[{ text: '✖️', callback_data: 'nav:cancel' }]] } });
}

const ideaButtons = (id) => ({ inline_keyboard: [
  [{ text: '💬 Відповісти автору', callback_data: `idea:reply:${id}` }],
  [{ text: '✅ Беру в роботу', callback_data: `idea:take:${id}` }, { text: '❌ Не підходить', callback_data: `idea:no:${id}` }],
] });

function ideaCard(idea, author, status = '') {
  const src = idea.source === 'site' ? 'з сайту' : 'з бота';
  return `💡 <b>Ідея #${idea.id}</b> ${src}${idea.kind ? ' · ' + esc(idea.kind) : ''}\n` +
    `Від: ${author ? userLabel(author, author.id) : 'анонімно'}\n\n${esc(idea.text)}` + (status ? `\n────────────\n${status}` : '');
}

// Saves an idea and posts it to the ideas channel (or to the owner if no channel is set).
export async function createIdea(env, userId, text, source = 'bot', kind = null) {
  const res = await env.DB.prepare('INSERT INTO ideas (user_id, source, kind, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, source, kind, text.slice(0, 3000), now()).run();
  const idea = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(res.meta.last_row_id).first();
  const author = userId ? await getUser(env, userId) : null;
  const chat = env.IDEAS_CHAT_ID || env.OWNER_ID;
  const r = await sendHtml(env, chat, ideaCard(idea, author), { reply_markup: ideaButtons(idea.id) });
  if (r.ok) await env.DB.prepare('UPDATE ideas SET card_chat = ?, card_msg_id = ? WHERE id = ?').bind(String(chat), r.result.message_id, idea.id).run();
  await logEvent(env, 'idea', userId, source);
  return idea.id;
}

export async function onIdeaText(env, user, msg) {
  const text = (msg.text || msg.caption || '').trim();
  if (text.length < 3) return send(env, user.id, tx(user.lang, 'idea_ask'));
  await clearSession(env, user.id);
  await createIdea(env, user.id, text, 'bot');
  return send(env, user.id, tx(user.lang, 'idea_ok'), { reply_markup: menuFor(env, user) });
}

async function refreshIdeaCard(env, idea, status) {
  if (!idea.card_msg_id) return;
  const author = idea.user_id ? await getUser(env, idea.user_id) : null;
  await tg(env, 'editMessageText', {
    chat_id: idea.card_chat, message_id: idea.card_msg_id, parse_mode: 'HTML', text: ideaCard(idea, author, status),
    reply_markup: idea.status === 'new' ? ideaButtons(idea.id) : { inline_keyboard: [] },
  });
}

export async function onIdeaButton(env, user, cq, parts) {
  if (!user.isOwner) return answer(env, cq, 'Ідеї розглядає власник', true);
  const [, action, arg] = parts;
  const idea = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(Number(arg)).first();
  if (!idea) return answer(env, cq, 'Ідею не знайдено', true);
  const author = idea.user_id ? await getUser(env, idea.user_id) : null;
  const L = (author && author.lang) || 'ua';
  if (action === 'reply') {
    if (!author) return answer(env, cq, 'Ідея анонімна — відповісти неможливо', true);
    await answer(env, cq);
    await setSession(env, user.id, 'adm:idea_reply', { id: idea.id });
    return send(env, user.id, `💬 Напишіть відповідь автору ідеї #${idea.id} (${whoName(author)}). Я перешлю її від імені ВУС.`);
  }
  if (action === 'take' || action === 'no') {
    await env.DB.prepare('UPDATE ideas SET status = ? WHERE id = ?').bind(action === 'take' ? 'taken' : 'declined', idea.id).run();
    idea.status = action === 'take' ? 'taken' : 'declined';
    await refreshIdeaCard(env, idea, action === 'take' ? '✅ Взято в роботу' : '❌ Не підходить');
    if (author) await send(env, author.id, tx(L, action === 'take' ? 'idea_taken' : 'idea_declined', { id: idea.id }));
    await logAction(env, user.id, action === 'take' ? 'idea_take' : 'idea_decline', idea.user_id, `#${idea.id}`);
    return answer(env, cq, action === 'take' ? 'Взято в роботу' : 'Відхилено');
  }
}

export async function onIdeaReplyInput(env, user, session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return send(env, user.id, 'Надішліть відповідь текстом.');
  await clearSession(env, user.id);
  const idea = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(session.data.id).first();
  if (!idea || !idea.user_id) return send(env, user.id, 'Ідею не знайдено.');
  const author = await getUser(env, idea.user_id);
  const r = await send(env, idea.user_id, tx((author && author.lang) || 'ua', 'idea_reply', { id: idea.id, text }));
  await refreshIdeaCard(env, idea, `💬 Відповідь надіслано: «${text.slice(0, 200)}»`);
  return send(env, user.id, r.ok ? `✅ Відповідь на ідею #${idea.id} надіслано.` : `⚠️ Не вдалося надіслати: ${r.description || 'автор заблокував бота'}`);
}

// ───────────────────────────── /deletedata ─────────────────────────────

export async function askDeleteData(env, user) {
  return send(env, user.id, tx(user.lang, 'del_ask'), { reply_markup: { inline_keyboard: [
    [{ text: tx(user.lang, 'del_yes'), callback_data: 'deldata:yes' }], [{ text: tx(user.lang, 'del_no'), callback_data: 'deldata:no' }],
  ] } });
}

export async function onDeleteDataButton(env, user, cq, parts) {
  const L = user.lang || 'ua';
  await removeButtons(env, cq.message);
  if (parts[1] !== 'yes') { await answer(env, cq); return send(env, user.id, tx(L, 'del_cancel')); }
  await answer(env, cq);
  const uid = user.id;
  const { results: ads } = await env.DB.prepare("SELECT * FROM ads WHERE user_id = ? AND status = 'published'").bind(uid).all();
  for (const ad of ads) await removeFromChannel(env, ad);
  const run = (sql) => env.DB.prepare(sql).bind(uid).run();
  await run('DELETE FROM ads WHERE user_id = ?');
  await run('DELETE FROM sessions WHERE user_id = ?');
  await run('DELETE FROM alerts WHERE user_id = ?');
  await run('DELETE FROM ideas WHERE user_id = ?');
  await run('DELETE FROM member_days WHERE user_id = ?');
  await run('DELETE FROM referrals WHERE inviter_id = ?');
  await run('DELETE FROM ref_links WHERE user_id = ?');
  await run('DELETE FROM group_invites WHERE inviter_id = ?1 OR invitee_id = ?1');
  await run('DELETE FROM applications WHERE user_id = ?');
  await run('DELETE FROM channel_seen WHERE user_id = ?');
  const banned = await env.DB.prepare("SELECT COUNT(*) AS n FROM punishments WHERE user_id = ? AND type = 'ban'").bind(uid).first();
  if (banned.n || user.banned) {
    await env.DB.prepare("UPDATE users SET username = NULL, first_name = '' WHERE id = ?").bind(uid).run();
  } else {
    await run('DELETE FROM users WHERE id = ?');
  }
  await logAction(env, 0, 'delete_data', uid, 'на прохання користувача');
  return send(env, uid, tx(L, 'del_done'), { reply_markup: { remove_keyboard: true } });
}

// ───────────────────────────── donations ─────────────────────────────

export const donationsOn = async (env) => (await getSetting(env, 'donate_on')) === '1' && (await getCfg(env, 'donate_enabled')) !== '0';

export async function showDonate(env, user) {
  const L = user.lang || 'ua';
  if (!(await donationsOn(env))) return send(env, user.id, tx(L, 'don_off', { n: DONATE_AT.toLocaleString('uk-UA') }));
  const kb = [STARS.map((n) => ({ text: `⭐ ${n}`, callback_data: `don:stars:${n}` }))];
  const mono = await getSetting(env, 'donate_mono');
  const paypal = await getSetting(env, 'donate_paypal');
  if (mono) kb.push([{ text: tx(L, 'btn_mono'), url: mono }]);
  if (paypal) kb.push([{ text: tx(L, 'btn_paypal'), url: paypal }]);
  return send(env, user.id, tx(L, 'don_text'), { reply_markup: { inline_keyboard: kb } });
}

export async function onDonateButton(env, user, cq, parts) {
  const L = user.lang || 'ua';
  const n = Number(parts[2]);
  if (parts[1] !== 'stars' || !STARS.includes(n) || !(await donationsOn(env))) return answer(env, cq);
  await answer(env, cq);
  return tg(env, 'sendInvoice', {
    chat_id: user.id, title: tx(L, 'don_title'), description: tx(L, 'don_desc'),
    payload: `donate:${user.id}:${n}`, currency: 'XTR', prices: [{ label: '⭐', amount: n }],
  });
}

export const onPreCheckout = (env, q) => tg(env, 'answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: true });

export async function onPayment(env, user, msg) {
  const p = msg.successful_payment;
  await logEvent(env, 'donation', user.id, `${p.total_amount} ${p.currency}`);
  await send(env, user.id, tx(user.lang || 'ua', 'don_thanks'));
  if (env.OWNER_ID) await send(env, env.OWNER_ID, `☕ Новий донат: ${p.total_amount} ⭐ від ${whoName(user)}. Дякую спільноті!`);
}

// Once a day: switch donations on when the channel reaches 5 000 subscribers. Never switches them off by itself.
export async function cronDonations(env) {
  if ((await getSetting(env, 'donate_on')) === '1') return;
  const day = new Date().toISOString().slice(0, 10);
  if ((await getSetting(env, 'donate_checked')) === day) return;
  await setSetting(env, 'donate_checked', day);
  const r = await tg(env, 'getChatMemberCount', { chat_id: env.CHANNEL_ID });
  if (!r.ok || r.result < DONATE_AT) return;
  await setSetting(env, 'donate_on', '1');
  await logAction(env, 0, 'donate_on', null, `${r.result} підписників`);
  if (env.OWNER_ID) {
    await send(env, env.OWNER_ID, `🎉 У каналі вже ${r.result} підписників! Донати увімкнено автоматично: кнопка «☕ Подякувати» з’явилася в боті.\n\nДодайте посилання на банку Monobank і PayPal у ⚙️ Налаштування → ☕ Донати. Telegram Stars працюють уже зараз.`);
  }
}

// ───────────────────────────── search alerts ─────────────────────────────

function alertLabel(L, a) {
  const cat = a.category ? categoryByKey(a.category) : null;
  const c = a.country ? COUNTRIES.find((x) => x.ua === a.country) : null;
  const parts = [cat ? cat[L] || cat.ua : null, c ? c[L] || c.ua : null, a.city].filter(Boolean);
  return parts.length ? parts.join(' · ') : tx(L, 'any');
}

export async function showAlerts(env, user) {
  const L = user.lang || 'ua';
  const { results } = await env.DB.prepare('SELECT * FROM alerts WHERE user_id = ? ORDER BY id').bind(user.id).all();
  const kb = results.map((a) => [{ text: `${tx(L, 'al_del')} ${alertLabel(L, a)}`, callback_data: `alrt:del:${a.id}` }]);
  if (results.length < MAX_ALERTS) kb.push([{ text: tx(L, 'al_add'), callback_data: 'alrt:new' }]);
  return send(env, user.id, tx(L, 'al_title') + '\n\n' + (results.length ? results.map((a) => '• ' + alertLabel(L, a)).join('\n') : tx(L, 'al_none')),
    { reply_markup: { inline_keyboard: kb } });
}

async function saveAlert(env, user, category, countryCode, city = null) {
  const L = user.lang || 'ua';
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ?').bind(user.id).first();
  if (n.n >= MAX_ALERTS) return send(env, user.id, tx(L, 'al_max', { n: MAX_ALERTS }));
  const country = countryCode ? (countryByCode(countryCode) || {}).ua || null : null;
  const cat = category && categoryByKey(category) ? category : null;
  const dup = await env.DB.prepare('SELECT id FROM alerts WHERE user_id = ? AND category IS ? AND country IS ? AND city IS ?')
    .bind(user.id, cat, country, city).first();
  if (!dup) {
    await env.DB.prepare('INSERT INTO alerts (user_id, category, country, city, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, cat, country, city, now()).run();
  }
  return send(env, user.id, tx(L, 'al_saved', { what: alertLabel(L, { category: cat, country, city }) }), { reply_markup: menuFor(env, user) });
}

// Deep link from the website: /start sub-<category|all>-<COUNTRY|all>[-<city index>]
export async function alertFromStart(env, user, payload) {
  const [, cat, cc, ci] = payload.split('-');
  const code = cc && cc !== 'all' ? cc.toUpperCase() : null;
  const country = code ? countryByCode(code) : null;
  const city = country && ci != null && country.cities[Number(ci)] ? country.cities[Number(ci)][0] : null;
  return saveAlert(env, user, cat && cat !== 'all' ? cat : null, country ? code : null, city);
}

export async function onAlertButton(env, user, cq, parts) {
  const L = user.lang || 'ua';
  const [, action, a1, a2] = parts;
  await answer(env, cq);
  if (action === 'del' || action === 'off') {
    await env.DB.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').bind(Number(a1), user.id).run();
    if (action === 'off') { await removeButtons(env, cq.message); return send(env, user.id, tx(L, 'al_removed')); }
    return showAlerts(env, user);
  }
  if (action === 'new') {
    const btns = CATEGORIES.map((c) => ({ text: c[L] || c.ua, callback_data: `alrt:cat:${c.key}` }));
    const kb = [[{ text: tx(L, 'al_any_cat'), callback_data: 'alrt:cat:all' }]];
    for (let i = 0; i < btns.length; i += 2) kb.push(btns.slice(i, i + 2));
    return send(env, user.id, tx(L, 'al_cat'), { reply_markup: { inline_keyboard: kb } });
  }
  if (action === 'cat') {
    const btns = COUNTRIES.map((c) => ({ text: c[L] || c.ua, callback_data: `alrt:cc:${a1}:${c.code}` }));
    const kb = [[{ text: tx(L, 'al_any_country'), callback_data: `alrt:cc:${a1}:all` }]];
    for (let i = 0; i < btns.length; i += 3) kb.push(btns.slice(i, i + 3));
    return tg(env, 'editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: tx(L, 'al_country'), reply_markup: { inline_keyboard: kb } });
  }
  if (action === 'cc') {
    await removeButtons(env, cq.message);
    return saveAlert(env, user, a1 === 'all' ? null : a1, a2 === 'all' ? null : a2);
  }
}

// After an ad is published: tell everyone whose alert matches (except the author).
export async function notifyAlerts(env, ad, ids) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM alerts WHERE user_id != ?1 AND (category IS NULL OR category = ?2) AND (country IS NULL OR country = ?3)
     AND (city IS NULL OR city = ?4)`
  ).bind(ad.user_id, ad.category, ad.country, ad.city).all();
  const seen = new Set();
  for (const a of results) {
    if (seen.has(a.user_id)) continue;
    seen.add(a.user_id);
    const u = await getUser(env, a.user_id);
    if (!u || u.banned) continue;
    const L = u.lang || 'ua';
    const cat = categoryByKey(ad.category);
    const kb = [];
    if (ids && ids.length) kb.push([{ text: tx(L, 'al_open'), url: postLink(env, ids[0]) }]);
    kb.push([{ text: tx(L, 'al_off'), callback_data: `alrt:off:${a.id}` }]);
    await sendHtml(env, u.id, tx(L, 'al_new', {
      what: esc(alertLabel(L, a)), title: esc(ad.title || (ad.body || '').slice(0, 60)),
      where: esc(`${ad.city}, ${(cat && (cat[L] || cat.ua)) || ''}`), price: esc(priceText(ad.price) || '—'),
    }), { reply_markup: { inline_keyboard: kb } });
  }
  if (seen.size) await logEvent(env, 'alerts_sent', ad.user_id, seen.size);
}
