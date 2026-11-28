// "Log in with Telegram" for the website: verifies the login widget data and keeps a signed cookie.

import { now, DAY } from '../common.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const COOKIE = 'vus_s';
const SESSION_DAYS = 30;

async function hmacHex(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// https://core.telegram.org/widgets/login#checking-authorization
export async function verifyTelegramLogin(env, data) {
  if (!data || !data.hash || !data.id || !data.auth_date) return null;
  if (now() - Number(data.auth_date) > DAY) return null;
  const check = Object.keys(data).filter((k) => k !== 'hash' && data[k] != null).sort().map((k) => `${k}=${data[k]}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', enc.encode(env.BOT_TOKEN));
  const calc = await hmacHex(secret, check);
  if (calc !== String(data.hash)) return null;
  return { id: Number(data.id), first_name: data.first_name || '', username: data.username || null, photo_url: data.photo_url || null };
}

const sessionKey = (env) => enc.encode('vus-site-session:' + env.BOT_TOKEN);

export async function makeSessionCookie(env, uid) {
  const exp = now() + SESSION_DAYS * DAY;
  const sig = await hmacHex(sessionKey(env), `${uid}.${exp}`);
  return `${COOKIE}=${uid}.${exp}.${sig}; Path=/; Max-Age=${SESSION_DAYS * DAY}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearSessionCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export async function sessionUserId(env, request) {
  const raw = (request.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [uid, exp, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!uid || !exp || !sig || Number(exp) < now()) return null;
  const calc = await hmacHex(sessionKey(env), `${uid}.${exp}`);
  return calc === sig ? Number(uid) : null;
}

// Short anonymous fingerprint of the visitor for rate limits (never stored in clear).
export async function visitorHash(env, request) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'x';
  return (await hmacHex(sessionKey(env), 'ip:' + ip)).slice(0, 16);
}
