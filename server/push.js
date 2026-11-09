// Push reminders (Web Push), with only Node's built-in crypto: messages are encrypted for each
// browser (RFC 8291, "aes128gcm") and signed with this server's VAPID key (RFC 8292).
//
// Two kinds, each switched on by the player in Settings:
//   daily   "Today's Daily is ready", once a day at REMINDER_HOUR in the player's time zone
//   friends News from friends: a friend beat their Daily score, sent them a duel, or finished one with them

import { createECDH, createHmac, createCipheriv, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { REMINDER_HOUR, localDate, dailyNumber } from '../shared/config.js';
import {
  pushSubscriptions, deletePushSubscription, markNotified, reminderTargets, dailyResult, purgeOldNotifications, getSettings,
} from './db.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// ── Keys ───────────────────────────────────────────────────────

/**
 * The server's VAPID key pair: from VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, else from `file`,
 * else made now and saved to `file`. Browsers subscribe with the public key, so it must stay
 * the same: if it changes, every player has to switch reminders on again.
 */
export function loadVapidKeys(file) {
  let keys = null;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY.trim(), privateKey: process.env.VAPID_PRIVATE_KEY.trim() };
  } else {
    try {
      keys = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = privateKey.export({ format: 'jwk' });
      keys = { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])), privateKey: jwk.d };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
    }
  }
  const raw = unb64u(keys.publicKey);
  const keyObject = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d: keys.privateKey },
    format: 'jwk',
  });
  return { publicKey: keys.publicKey, keyObject };
}

// ── Encrypting and sending ─────────────────────────────────────

/**
 * Encrypts `payload` for one browser subscription (RFC 8291). `fixed` (a private key and salt)
 * is only for checking against the RFC's worked example; normally both are random.
 */
export function encryptPayload({ p256dh, auth }, payload, fixed = null) {
  const uaPublic = unb64u(p256dh);
  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(unb64u(fixed.privateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = hmac(hmac(unb64u(auth), shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = fixed ? unb64u(fixed.salt) : randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16); // record size
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, sealed]);
}

function vapidHeader(endpoint, keys, subject) {
  const unsigned = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  }))}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: keys.keyObject, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** Sends one message to one browser. Resolves to { ok, gone } (gone: the browser unsubscribed). */
export async function sendPush(sub, message, keys, subject) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(sub.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(12 * 3600),
      Urgency: 'normal',
    },
    body: encryptPayload(sub, JSON.stringify(message)),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}

// ── Messages ───────────────────────────────────────────────────

const TEXT = {
  en: {
    dailyTitle: "Today's Daily is ready",
    dailyBody: 'Smarts #{n}: 10 questions, one try. How high can you get on the board?',
    beatDailyTitle: '{name} beat you',
    beatDailyBody: '{name} scored {their} in today\'s Daily. You scored {yours}.',
    duelSentTitle: '{name} challenged you to a duel',
    duelSentBody: 'Join now to play the same 10 questions at the same time.',
    duelJoinedTitle: '{name} joined your duel',
    duelJoinedBody: 'Come back now. They are waiting for you.',
    duelLostTitle: '{name} won your duel',
    duelLostBody: '{name} {their}, you {yours}. Time for a rematch?',
    duelWonTitle: 'You won your duel with {name}',
    duelWonBody: 'You {yours}, {name} {their}. Tap to see how it went.',
    duelDrawTitle: 'Your duel with {name} is a draw',
    duelDrawBody: 'You both scored {yours}. Time for a rematch?',
  },
  he: {
    dailyTitle: 'האתגר היומי של היום מחכה',
    dailyBody: 'Smarts #{n}: עשר שאלות, ניסיון אחד. לאיזה מקום תגיעו בטבלה?',
    beatDailyTitle: '{name} עקף/ה אותך',
    beatDailyBody: '{name} השיג/ה {their} נקודות באתגר היומי. לך יש {yours}.',
    duelSentTitle: '{name} הזמין/ה אותך לדו־קרב',
    duelSentBody: 'הצטרפו עכשיו ושחקו באותן עשר שאלות באותו הזמן.',
    duelJoinedTitle: '{name} הצטרף/ה לדו־קרב',
    duelJoinedBody: 'חזרו עכשיו, מחכים לכם.',
    duelLostTitle: '{name} ניצח/ה בדו־קרב',
    duelLostBody: '{name} {their}, את/ה {yours}. מה דעתך על משחק חוזר?',
    duelWonTitle: 'ניצחת בדו־קרב מול {name}',
    duelWonBody: 'את/ה {yours}, {name} {their}. לחצו כדי לראות איך היה.',
    duelDrawTitle: 'הדו־קרב מול {name} הסתיים בתיקו',
    duelDrawBody: 'לשניכם {yours}. מה דעתך על משחק חוזר?',
  },
  ar: {
    dailyTitle: 'تحدّي اليوم جاهز',
    dailyBody: 'Smarts #{n}: عشرة أسئلة، محاولة واحدة. إلى أي مرتبة ستصل؟',
    beatDailyTitle: '{name} تفوّق عليك',
    beatDailyBody: 'حصل {name} على {their} في تحدّي اليوم. نتيجتك {yours}.',
    duelSentTitle: '{name} يتحدّاك في مبارزة',
    duelSentBody: 'انضم الآن والعبا الأسئلة العشرة نفسها في الوقت نفسه.',
    duelJoinedTitle: 'انضم {name} إلى مبارزتك',
    duelJoinedBody: 'عد الآن، إنه ينتظرك.',
    duelLostTitle: '{name} فاز في المبارزة',
    duelLostBody: '{name} {their}، وأنت {yours}. ما رأيك في مباراة ثأرية؟',
    duelWonTitle: 'فزت في مبارزتك مع {name}',
    duelWonBody: 'أنت {yours}، {name} {their}. اضغط لترى كيف سارت.',
    duelDrawTitle: 'انتهت مبارزتك مع {name} بالتعادل',
    duelDrawBody: 'حصل كلاكما على {yours}. ما رأيك في مباراة ثأرية؟',
  },
};

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

// ── The reminder service ───────────────────────────────────────

/**
 * Sends reminders from this server. `subject` is a contact address (mailto: or https:) that
 * push services can use to reach whoever runs the server.
 */
export function createReminders({ db, keys, subject }) {
  async function deliver(userId, message) {
    for (const sub of pushSubscriptions(db, userId)) {
      try {
        const r = await sendPush(sub, message, keys, subject);
        if (r.gone) deletePushSubscription(db, sub.endpoint);
        else if (!r.ok) console.warn(`  Push to ${new URL(sub.endpoint).host} failed: HTTP ${r.status}`);
      } catch (err) {
        console.warn(`  Push failed: ${err.message}`);
      }
    }
  }

  const langOf = (userId) => TEXT[getSettings(db, userId)?.language] ? getSettings(db, userId).language : 'en';

  /** News from a friend, if the player asked for it and hasn't had this one. Never waits for the push service. */
  function tell(userId, kind, ref, message) {
    if (!getSettings(db, userId)?.notifyFriends) return;
    if (!markNotified(db, userId, kind, ref)) return;
    deliver(userId, message(TEXT[langOf(userId)])).catch(() => {});
  }

  /** "{friend} beat you" in the Daily: at most once per friend and day (`ref` holds both). */
  const friendBeatYou = (userId, ref, vars) =>
    tell(userId, 'beat-daily', ref, (T) => ({ title: fill(T.beatDailyTitle, vars), body: fill(T.beatDailyBody, vars), url: '/#/daily', tag: 'daily-board' }));

  /** A friend is waiting to play this player live. */
  const duelSent = (userId, duelId, vars) =>
    tell(userId, 'duel-sent', duelId, (T) => ({ title: fill(T.duelSentTitle, vars), body: fill(T.duelSentBody, vars), url: `/#/duel/${duelId}`, tag: `duel-${duelId}` }));

  /** Someone joined a duel the player started and then left the app for. */
  const duelJoined = (userId, duelId, vars) =>
    tell(userId, 'duel-joined', duelId, (T) => ({ title: fill(T.duelJoinedTitle, vars), body: fill(T.duelJoinedBody, vars), url: `/#/duel/${duelId}`, tag: `duel-${duelId}` }));

  /** A duel ended while this player was away. `outcome` is how it went for this player: 'Won', 'Lost' or 'Draw'. */
  const duelFinished = (userId, duelId, outcome, vars) =>
    tell(userId, 'duel-done', duelId, (T) => ({ title: fill(T[`duel${outcome}Title`], vars), body: fill(T[`duel${outcome}Body`], vars), url: `/#/duel/${duelId}`, tag: `duel-${duelId}` }));

  /** Morning reminders for everyone who asked for them and hasn't played today's Daily yet. */
  async function sendDailyReminders() {
    for (const t of reminderTargets(db, 'daily')) {
      const local = new Date(Date.now() - t.tz_offset * 60_000);
      const hour = local.getUTCHours();
      if (hour < REMINDER_HOUR || hour >= 21) continue; // not at night, even if the server was down all morning
      const day = localDate(t.tz_offset);
      if (dailyResult(db, day, t.user_id)) continue;
      if (!markNotified(db, t.user_id, 'daily', day)) continue;
      const T = TEXT[TEXT[t.language] ? t.language : 'en'];
      await deliver(t.user_id, { title: T.dailyTitle, body: fill(T.dailyBody, { n: dailyNumber(day) }), url: '/#/daily', tag: 'daily' });
    }
  }

  function start() {
    const run = () => {
      purgeOldNotifications(db);
      sendDailyReminders().catch((err) => console.warn(`  Daily reminders failed: ${err.message}`));
    };
    run();
    setInterval(run, 5 * 60_000).unref();
  }

  return { publicKey: keys.publicKey, friendBeatYou, duelSent, duelJoined, duelFinished, sendDailyReminders, deliver, start };
}
