// Owner's "⚙️ Налаштування": switch the bot's behaviour with buttons, no code changes.

import {
  tg, esc, getCfg, setCfg, getSetting, setSetting, setSession, clearSession,
  logAction, send, sendHtml, answer,
} from './common.js';
import { getStopWords } from './guard.js';
import { classify, quotaOut, AUTO_DELETE_CONF, REVIEW_CONF } from './ai.js';

const onOff = (v) => (v === '1' ? '✅ увімк.' : '⛔ вимк.');
const NEWBIE_STEPS = ['0', '12', '24', '48'];

const LOG_NAMES = {
  ai_on: 'нейромережа', ai_mode: 'режим нейромережі', night_on: 'нічний режим', newbie_hours: 'обмеження новачків',
  welcome_on: 'привітання', weekly_post_on: 'недільний пост', captcha_on: 'капча',
};

async function settingsView(env) {
  const c = {};
  for (const k of Object.keys(LOG_NAMES)) c[k] = await getCfg(env, k);
  const quota = (await quotaOut(env)) ? '⚠️ на сьогодні вичерпано' : '✅ є';
  const closed = (await getSetting(env, 'night_closed')) === '1' ? '\n🔒 Зараз чат закрито нічним режимом' : '';
  const text = [
    '⚙️ <b>Налаштування ВУС</b>',
    `🤖 Нейромережа-модератор: ${onOff(c.ai_on)}\nКвота на сьогодні: ${quota}`,
    `🎚 Режим нейромережі: ${c.ai_mode === 'auto'
      ? `видаляє сама від ${AUTO_DELETE_CONF}% впевненості, від ${REVIEW_CONF}% — адмінам`
      : `нічого не видаляє сама, усе від ${REVIEW_CONF}% — адмінам`}`,
    `🌙 Нічний режим (з 23:00, лише коли квоту вичерпано): ${onOff(c.night_on)}${closed}`,
    `🆕 Обмеження новачків: ${c.newbie_hours === '0' ? 'вимкнено' : c.newbie_hours + ' год лише текст'}`,
    `👋 Привітання нових учасників: ${onOff(c.welcome_on)}`,
    `📣 Недільний пост у групу: ${onOff(c.weekly_post_on)}`,
    `🔐 Заявки в групу з капчею: ${onOff(c.captcha_on)}`,
    `🧹 Стоп-слів: ${(await getStopWords(env)).length}`,
  ].join('\n\n');
  const kb = [
    [{ text: `🤖 Нейромережа: ${c.ai_on === '1' ? 'вимкнути' : 'увімкнути'}`, callback_data: 'cfg:t:ai_on' }],
    [{ text: `🎚 Режим: ${c.ai_mode === 'auto' ? '→ усе адмінам' : '→ видаляти сама'}`, callback_data: 'cfg:mode' }],
    [{ text: `🌙 Нічний режим: ${c.night_on === '1' ? 'вимкнути' : 'увімкнути'}`, callback_data: 'cfg:t:night_on' }],
    [{ text: `🆕 Новачки: ${c.newbie_hours} год → ${NEWBIE_STEPS[(NEWBIE_STEPS.indexOf(c.newbie_hours) + 1) % NEWBIE_STEPS.length]}`, callback_data: 'cfg:nb' }],
    [{ text: `👋 Привітання: ${c.welcome_on === '1' ? 'вимкн.' : 'увімкн.'}`, callback_data: 'cfg:t:welcome_on' },
     { text: `📣 Недільний пост: ${c.weekly_post_on === '1' ? 'вимкн.' : 'увімкн.'}`, callback_data: 'cfg:t:weekly_post_on' }],
    [{ text: `🔐 Капча: ${c.captcha_on === '1' ? 'вимкнути' : 'увімкнути'}`, callback_data: 'cfg:t:captcha_on' }],
    [{ text: '🧹 Стоп-слова', callback_data: 'cfg:sw' }, { text: '🧪 Перевірити нейромережу', callback_data: 'cfg:test' }],
  ];
  return { text, kb };
}

export async function showSettings(env, user, msg = null) {
  const { text, kb } = await settingsView(env);
  if (msg) {
    const r = await tg(env, 'editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb },
    });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  return sendHtml(env, user.id, text, { reply_markup: { inline_keyboard: kb } });
}

async function showStopWords(env, user, msg = null) {
  const words = await getStopWords(env);
  const text = `🧹 <b>Стоп-слова</b>\n\nПовідомлення з цими словами бот видаляє одразу, без нейромережі. Натисніть слово, щоб видалити його.\n\n` +
    (words.length ? words.map((w) => `• ${esc(w)}`).join('\n') : 'Список порожній.');
  const btns = words.slice(0, 60).map((w, i) => ({ text: `✖️ ${w}`, callback_data: `cfg:swdel:${i}` }));
  const kb = [];
  for (let i = 0; i < btns.length; i += 3) kb.push(btns.slice(i, i + 3));
  kb.push([{ text: '➕ Додати слово', callback_data: 'cfg:swadd' }, { text: '◀️ Назад', callback_data: 'cfg:back' }]);
  if (msg) {
    const r = await tg(env, 'editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  return sendHtml(env, user.id, text, { reply_markup: { inline_keyboard: kb } });
}

export async function onSettingsButton(env, user, cq, parts) {
  if (!user.isOwner) return answer(env, cq, 'Налаштування доступні лише власнику', true);
  const [, action, arg] = parts;
  const msg = cq.message;
  await answer(env, cq);
  if (action === 't' && LOG_NAMES[arg]) {
    const v = (await getCfg(env, arg)) === '1' ? '0' : '1';
    await setCfg(env, arg, v);
    await logAction(env, user.id, 'settings', null, `${LOG_NAMES[arg]}: ${v === '1' ? 'увімк.' : 'вимк.'}`);
    return showSettings(env, user, msg);
  }
  if (action === 'mode') {
    const v = (await getCfg(env, 'ai_mode')) === 'auto' ? 'review' : 'auto';
    await setCfg(env, 'ai_mode', v);
    await logAction(env, user.id, 'settings', null, `режим нейромережі: ${v === 'auto' ? 'видаляє сама' : 'усе адмінам'}`);
    return showSettings(env, user, msg);
  }
  if (action === 'nb') {
    const cur = await getCfg(env, 'newbie_hours');
    const v = NEWBIE_STEPS[(NEWBIE_STEPS.indexOf(cur) + 1) % NEWBIE_STEPS.length];
    await setCfg(env, 'newbie_hours', v);
    await logAction(env, user.id, 'settings', null, `обмеження новачків: ${v} год`);
    return showSettings(env, user, msg);
  }
  if (action === 'back') return showSettings(env, user, msg);
  if (action === 'sw') return showStopWords(env, user, msg);
  if (action === 'swdel') {
    const words = await getStopWords(env);
    const w = words[Number(arg)];
    if (w != null) {
      words.splice(Number(arg), 1);
      await setSetting(env, 'stop_words', JSON.stringify(words));
      await logAction(env, user.id, 'settings', null, `стоп-слово видалено: ${w}`);
    }
    return showStopWords(env, user, msg);
  }
  if (action === 'swadd') {
    await setSession(env, user.id, 'adm:cfg_sw', {});
    return send(env, user.id, 'Надішліть слово або фразу (можна кілька через кому). Бот шукає їх у будь-якому місці повідомлення, без урахування регістру.');
  }
  if (action === 'test') {
    await setSession(env, user.id, 'adm:cfg_test', {});
    return send(env, user.id, '🧪 Надішліть текст, і я покажу, що про нього думає нейромережа. Нічого не видаляється.');
  }
}

// Text replies for the two settings prompts. Returns true if handled.
export async function onSettingsInput(env, user, session, msg) {
  const text = (msg.text || '').trim();
  if (session.state === 'adm:cfg_sw') {
    await clearSession(env, user.id);
    const add = text.split(',').map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2);
    const words = await getStopWords(env);
    for (const w of add) if (!words.includes(w)) words.push(w);
    await setSetting(env, 'stop_words', JSON.stringify(words));
    await logAction(env, user.id, 'settings', null, `стоп-слова додано: ${add.join(', ')}`);
    await send(env, user.id, add.length ? `✅ Додано: ${add.join(', ')}` : 'Нічого не додано.');
    await showStopWords(env, user);
    return true;
  }
  if (session.state === 'adm:cfg_test') {
    await clearSession(env, user.id);
    const v = await classify(env, text);
    let out;
    if (v.quota) out = '⚠️ Квоту нейромережі на сьогодні вичерпано. Вона оновиться о 00:00 за UTC.';
    else if (v.error) out = `❌ Нейромережа не відповіла${v.reason ? ': ' + v.reason : ''}. Перевірте, що в wrangler.toml є блок [ai].`;
    else {
      const action = !v.ad || v.confidence < REVIEW_CONF ? 'залишив би повідомлення'
        : v.confidence >= AUTO_DELETE_CONF && (await getCfg(env, 'ai_mode')) === 'auto' ? 'видалив би одразу' : 'надіслав би адмінам на перевірку';
      out = `🧪 Результат\n\nРеклама: ${v.ad ? 'так' : 'ні'}\nВпевненість: ${v.confidence}%\nПричина: ${v.reason || '—'}\n\nБот ${action}.`;
    }
    await send(env, user.id, out, { reply_markup: { inline_keyboard: [[{ text: '🧪 Ще текст', callback_data: 'cfg:test' }, { text: '⚙️ Налаштування', callback_data: 'cfg:back' }]] } });
    return true;
  }
  return false;
}
