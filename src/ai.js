// AI moderator (Cloudflare Workers AI, free daily allowance) and the night mode
// that closes the group only when the AI allowance is used up.

import {
  tg, esc, now, DAY, kyivDate, getSetting, setSetting, getCfg, groupId,
  isStaffId, logAction, logEvent, send, sendHtml, userLabel,
} from './common.js';

// Models: the first is tried first; the second is a fallback if the first is unavailable.
const MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-4-scout-17b-16e-instruct'];
// Gemma 4 and GLM "think out loud" before answering — ask them not to.
const THINKERS = ['gemma-4', 'glm-4'];
export const AUTO_DELETE_CONF = 85;   // ≥ 85% — remove at once (in "auto" mode)
export const REVIEW_CONF = 60;        // 60–84% — send to admins
const QUIET_SECS = 15 * 60;           // night close waits for 15 minutes of quiet
const TALK_PEOPLE = 2;                // 2+ different people in 15 minutes = a live conversation

const utcDay = (ts = now()) => new Date(ts * 1000).toISOString().slice(0, 10);

// ───────────────────────────── which messages go to the AI ─────────────────────────────

const PHONE_RE = /(?:\+?\d[\s\-().]*){9,}/;
const PRICE_RE = /\d[\d\s.,]*\s?(?:грн|uah|₴|€|eur|євро|евро|\$|usd|дол|lei|лей|леї|zł|pln|злот|руб|kč|czk)|ціна|цена|вартість|стоимость|прайс|недорого|дешево|дешёво/i;
const WORDS_RE = /пиш(?:іть|ите|и)|звертай|обращай|телефонуй|звони|пропоную|предлагаю|послуг|услуг|ваканс|потрібн[іа] (?:працівник|люди)|требуются|заробі|зарабо|доставк|продам|продаю|куплю|оренд|аренд|здам|сдаю|сдам|знижк|скидк|акці|акци|бонус|підписуйт|подписывайт|переходь|переходи|мій канал|мой канал|instagram|інстаграм|инстаграм|viber|вайбер|whatsapp|ватсап|tiktok|тікток|запис|манікюр|маникюр|ремонт|перевез|кредит|займ|позик/i;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function suspicion(msg, isNewcomer) {
  const text = msg.text || msg.caption || '';
  if (text.length < 15) return null;
  if (text.length > 300) return 'довгий текст';
  if (text.split('\n').length > 5) return 'багато рядків';
  if ((text.match(EMOJI_RE) || []).length >= 6) return 'багато емодзі';
  if (PHONE_RE.test(text)) return 'номер телефону';
  if (/(^|\s)@[A-Za-z0-9_]{4,}/.test(text)) return 'згадка акаунта';
  if (PRICE_RE.test(text)) return 'ціна';
  if (WORDS_RE.test(text)) return 'рекламні слова';
  if (isNewcomer && text.length > 80) return 'новачок';
  return null;
}

// ───────────────────────────── classification ─────────────────────────────

const SYSTEM = `You are a moderator of a Telegram chat of Ukrainians living around the world.
The chat is ONLY for conversation. Any advertising is forbidden in the chat: ads must be submitted for free through the community bot and are published in a separate channel.

Count as ADVERTISING:
- offering goods, services, jobs, vacancies, housing, rentals, transport, lessons, beauty services, repairs, etc.;
- "write me in DM / call me / contact me" with an offer;
- promoting channels, groups, accounts, websites, apps, referral links;
- earnings schemes, crypto, investments, loans, casinos, adult content;
- giving away items (this also belongs to the ads channel);
- phone numbers, prices or contacts attached to an offer, even written with spaces or in words.

NOT advertising:
- questions ("where can I buy...", "who knows a good dentist?", "is anyone selling a stroller?");
- ordinary conversation, opinions, news, jokes, greetings, thanks;
- asking for help or advice, sharing personal experience;
- answering someone's question with a recommendation of a well-known place, without contacts of one's own business.

Messages may be in Ukrainian, Russian, surzhyk or English.
Do not think step by step, do not analyse, do not explain.
Reply with ONLY one line of JSON, nothing else:
{"ad": true or false, "confidence": number 0-100, "reason": "short reason in Ukrainian, max 8 words"}`;

async function examples(env) {
  const { results } = await env.DB.prepare('SELECT text FROM ai_examples ORDER BY id DESC LIMIT 6').all();
  if (!results.length) return '';
  return '\n\nThese messages were checked by admins and are NOT advertising:\n' +
    results.map((r) => '- ' + r.text.replace(/\s+/g, ' ').slice(0, 200)).join('\n');
}

// Workers AI models answer in different shapes: { response: "..." } (older models)
// or OpenAI style { choices: [{ message: { content: "..." } }] } (Gemma 4 and newer).
function replyText(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const c = r.choices && r.choices[0];
  if (c) {
    const m = c.message || {};
    if (typeof m.content === 'string' && m.content.trim()) return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => p.text || '').join('');
    if (typeof c.text === 'string') return c.text;
    if (typeof m.reasoning_content === 'string') return m.reasoning_content;
  }
  if (r.result) return replyText(r.result);
  return JSON.stringify(r);
}

function parseVerdict(raw) {
  if (raw && typeof raw === 'object' && typeof raw.ad === 'boolean') return raw;
  const s = replyText(raw).replace(/```(?:json)?/gi, '');
  const all = s.match(/\{[^{}]*"ad"\s*:[^{}]*\}/g);
  const m = all && [all[all.length - 1]];
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) {
    const ad = /"ad"\s*:\s*true/i.test(m[0]);
    const conf = Number((m[0].match(/"confidence"\s*:\s*(\d+)/) || [])[1]);
    const reason = (m[0].match(/"reason"\s*:\s*"([^"]*)"/) || [])[1] || '';
    return Number.isFinite(conf) ? { ad, confidence: conf, reason } : null;
  }
}

const isQuotaError = (e) => /4006|daily free allocation|neurons|quota|exceeded|rate limit|too many/i.test(String(e && (e.message || e)));

// → { ad, confidence, reason } | { quota: true } | { error: true }
export async function classify(env, text) {
  if (!env.AI) return { error: true, reason: 'нейромережа не підключена' };
  const messages = [
    { role: 'system', content: SYSTEM + (await examples(env)) },
    { role: 'user', content: `Message:\n"""${text.slice(0, 1500)}"""\n\nAnswer with the JSON line only.` },
  ];
  const problems = [];
  for (const model of MODELS) {
    try {
      const thinker = THINKERS.some((x) => model.includes(x));
      // 1st try: thinking switched off, short answer. 2nd try: let it think, more room, take the final JSON.
      const tries = thinker
        ? [{ max_tokens: 300, chat_template_kwargs: { enable_thinking: false, thinking: false } }, { max_tokens: 1500 }]
        : [{ max_tokens: 300 }];
      let lastText = '';
      let v = null;
      for (const extra of tries) {
        let r;
        try {
          r = await env.AI.run(model, { messages, temperature: 0, ...extra });
        } catch (e) {
          if (isQuotaError(e) || !extra.chat_template_kwargs) throw e;
          continue; // the model refused the option — try without it
        }
        v = parseVerdict(r);
        if (v && typeof v.ad === 'boolean') break;
        lastText = replyText(r);
      }
      if (v && typeof v.ad === 'boolean') {
        return { ad: v.ad, confidence: Math.max(0, Math.min(100, Number(v.confidence) || 0)), reason: String(v.reason || '').slice(0, 80), model };
      }
      problems.push(`${model.split('/').pop()}: незрозуміла відповідь «${lastText.slice(-160)}»`);
    } catch (e) {
      if (isQuotaError(e)) {
        await setSetting(env, 'ai_quota_day', utcDay());
        await logEvent(env, 'ai_quota');
        return { quota: true };
      }
      problems.push(`${model.split('/').pop()}: ${String((e && e.message) || e).slice(0, 160)}`);
      console.log('AI error', model, e && e.message);
    }
  }
  await setSetting(env, 'ai_last_error', problems.join(' | ').slice(0, 900));
  return { error: true, details: problems.join('\n') };
}

export const quotaOut = async (env) => (await getSetting(env, 'ai_quota_day')) === utcDay();

// ───────────────────────────── moderation of a group message ─────────────────────────────

// Returns true if the message was removed. `punish(env, msg, reason)` removes it and counts a violation.
export async function aiModerate(env, msg, punish) {
  if ((await getCfg(env, 'ai_on')) !== '1') return false;
  if (!msg.from || msg.from.is_bot || msg.sender_chat || msg.is_automatic_forward) return false;
  if (await isStaffId(env, msg.from.id)) return false;
  if (await quotaOut(env)) return false;

  const joined = await env.DB.prepare("SELECT MAX(created_at) AS t FROM events WHERE type = 'gr_join' AND user_id = ?").bind(msg.from.id).first();
  const isNewcomer = joined && joined.t && joined.t > now() - 3 * DAY;
  const why = suspicion(msg, isNewcomer);
  if (!why) return false;

  const text = msg.text || msg.caption || '';
  const v = await classify(env, text);
  await logEvent(env, 'ai_check', msg.from.id, why);
  if (v.quota || v.error || !v.ad) return false;

  const mode = await getCfg(env, 'ai_mode');
  if (mode === 'auto' && v.confidence >= AUTO_DELETE_CONF) {
    await logEvent(env, 'ai_delete', msg.from.id, v.confidence);
    const res = await env.DB.prepare('INSERT INTO ai_log (user_id, text, confidence, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(msg.from.id, text.slice(0, 1000), v.confidence, v.reason, now()).run();
    await punish(env, msg, 'схоже на рекламу');
    if (env.ADMIN_CHAT_ID) {
      await sendHtml(env, env.ADMIN_CHAT_ID,
        `🤖 <b>Нейромережа видалила рекламу</b> (впевненість ${v.confidence}%)\n` +
        `Автор: ${userLabel(msg.from, msg.from.id)}\nПричина: ${esc(v.reason || '—')}\n\n<i>${esc(text.slice(0, 600))}</i>`,
        { reply_markup: { inline_keyboard: [[{ text: '↩️ Це була помилка', callback_data: `ai:mistake:${res.meta.last_row_id}` }]] } });
    }
    return true;
  }
  if (v.confidence >= REVIEW_CONF) {
    await logEvent(env, 'ai_review', msg.from.id, v.confidence);
    return { review: true, verdict: v };
  }
  return false;
}

// "↩️ Це була помилка" under an auto-removal: remember the example and cancel the violation.
export async function onAiButton(env, user, cq, parts) {
  const [, action, arg] = parts;
  if (action !== 'mistake') return;
  const row = await env.DB.prepare('SELECT * FROM ai_log WHERE id = ?').bind(Number(arg)).first();
  if (!row) return tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Запис не знайдено' });
  await addExample(env, row.text);
  await env.DB.prepare(
    "DELETE FROM violations WHERE rowid = (SELECT rowid FROM violations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1)"
  ).bind(row.user_id).run();
  await logAction(env, user.id, 'ai_mistake', row.user_id, 'помилка нейромережі');
  await tg(env, 'editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Дякую! Нейромережа врахує цей приклад.' });
  return sendHtml(env, cq.message.chat.id, `↩️ ${esc(user.first_name || 'Адмін')} позначив: це не реклама. Приклад збережено, порушення автору скасовано.`,
    { reply_to_message_id: cq.message.message_id });
}

export async function addExample(env, text) {
  if (!text) return;
  await env.DB.prepare('INSERT INTO ai_examples (text, created_at) VALUES (?, ?)').bind(text.slice(0, 400), now()).run();
  await env.DB.prepare('DELETE FROM ai_examples WHERE id NOT IN (SELECT id FROM ai_examples ORDER BY id DESC LIMIT 30)').run();
}

// ───────────────────────────── night mode ─────────────────────────────

export async function noteGroupMessage(env, uid) {
  await env.DB.prepare('INSERT INTO group_recent (user_id, ts) VALUES (?, ?)').bind(uid, now()).run();
}

// Kyiv time of the next AI allowance reset (00:00 UTC): "02:00" in winter, "03:00" in summer.
function reopenTime() {
  const next = Math.ceil((now() + 1) / DAY) * DAY;
  const k = kyivDate(next);
  return `${String(k.getUTCHours()).padStart(2, '0')}:00`;
}

const CLOSED = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false,
};

async function closeChat(env, gid) {
  const chat = await tg(env, 'getChat', { chat_id: gid });
  if (chat.ok && chat.result.permissions) await setSetting(env, 'night_perms', JSON.stringify(chat.result.permissions));
  const r = await tg(env, 'setChatPermissions', { chat_id: gid, permissions: CLOSED, use_independent_chat_permissions: true });
  if (!r.ok) return console.log('night close failed', r.description);
  await setSetting(env, 'night_closed', '1');
  const prevOpen = await getSetting(env, 'night_open_msg');
  if (prevOpen) await tg(env, 'deleteMessage', { chat_id: gid, message_id: Number(prevOpen) });
  const bot = env.BOT_USERNAME || 'vus_ua_bot';
  const m = await send(env, gid,
    `🔒 Нічний режим: чат тимчасово закрито для захисту від спаму. Відкриється о ${reopenTime()} за київським часом.\n\nОголошення можна подавати через бота цілодобово: @${bot}`);
  if (m.ok) await setSetting(env, 'night_msg', m.result.message_id);
  await logAction(env, 0, 'night_close', null, 'квоту нейромережі вичерпано');
}

async function openChat(env, gid) {
  let perms = null;
  try { perms = JSON.parse((await getSetting(env, 'night_perms')) || 'null'); } catch (e) { perms = null; }
  if (!perms) perms = Object.fromEntries(Object.keys(CLOSED).map((k) => [k, true]));
  const r = await tg(env, 'setChatPermissions', { chat_id: gid, permissions: perms, use_independent_chat_permissions: true });
  if (!r.ok) return console.log('night open failed', r.description);
  await setSetting(env, 'night_closed', '0');
  const nightMsg = await getSetting(env, 'night_msg');
  if (nightMsg) await tg(env, 'deleteMessage', { chat_id: gid, message_id: Number(nightMsg) });
  const m = await send(env, gid, '🔓 Чат знову відкрито. Доброї ночі тим, хто не спить 🙂');
  if (m.ok) await setSetting(env, 'night_open_msg', m.result.message_id);
  await logAction(env, 0, 'night_open', null, 'квота оновилась');
}

// Runs every 5 minutes.
export async function cronNight(env) {
  await env.DB.prepare('DELETE FROM group_recent WHERE ts < ?').bind(now() - 3600).run();
  const gid = await groupId(env);
  if (!gid) return;
  const closed = (await getSetting(env, 'night_closed')) === '1';
  const out = await quotaOut(env);
  const enabled = (await getCfg(env, 'night_on')) === '1' && (await getCfg(env, 'ai_on')) === '1';

  if (closed) {
    if (!out || !enabled) await openChat(env, gid);
    return;
  }
  if (!enabled || !out) return;
  const h = kyivDate().getUTCHours();
  if (!(h >= 23 || h < 7)) return;  // close only from 23:00 Kyiv time

  const talk = await env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM group_recent WHERE ts > ?').bind(now() - QUIET_SECS).first();
  if (talk.n >= TALK_PEOPLE) return; // people are talking — wait for 15 minutes of quiet
  await closeChat(env, gid);
}
