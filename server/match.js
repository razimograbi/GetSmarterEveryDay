// Live duels: two players, the same questions, at the same time.
//
// The server runs one clock for both. A match goes
//
//   lobby -> countdown -> (prepare -> answer -> reveal) x 10 -> done
//
// and the browsers only show where it stands. Every message to a browser is that player's whole
// view of the match with a version number, so a lost message can't break anything: the next one
// has everything. Whether an answer was right is worked out when the question closes, after both
// have answered, and a player is only ever told about their own answers until the end.
//
// Each player's side is an ordinary round in server/play.js, which grades, times and saves it.
// Running matches live in memory (one server process, as the rate limits also assume) and are
// written to the database at every phase change, so they carry on after a restart.

import {
  claimDuel, endDuel, getDuel, liveDuelIds, releaseDuelSeat, saveDuelLive, setDuelQuestions,
} from './db.js';
import { serverNow } from './clock.js';
import { MATCH, PLAY, SCORING } from '../shared/config.js';

const SIDES = ['challenger', 'opponent'];
const otherSide = (side) => (side === 'challenger' ? 'opponent' : 'challenger');
const refuse = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function createMatches(db, { plays, pick, profileOf, reminders, clock = serverNow, log = console.error }) {
  const matches = new Map(); // duel id -> match

  const newSeat = (userId, t) => ({
    userId, profile: profileOf(userId), stream: null, lastSeen: t, wasPresent: false, play: null,
    grace: MATCH.graceMs, voids: 0,
    ...freshQuestion(),
  });

  /** What a seat knows about the question being played. */
  const freshQuestion = () => ({ ready: false, failed: false, opened: null, answered: false, choice: null, away: false, answeredAt: 0, seenAt: null, result: null });

  /**
   * Is the player here? Without a connection they count as here for a few seconds (a page reload,
   * a change of network). With one, they must also have said something lately, because a phone
   * that died leaves a connection that looks open.
   */
  const present = (seat, t) => !!seat && t - seat.lastSeen <= (seat.stream ? MATCH.beatTimeoutMs : MATCH.absentAfterMs);

  const seatsOf = (m) => SIDES.map((side) => m.seats[side]).filter(Boolean);
  const scoreOf = (seat) => (seat.play ? seat.play.answers.reduce((sum, a) => sum + (a.points || 0), 0) : 0);
  const sideOf = (m, seat) => SIDES.find((side) => m.seats[side] === seat);
  const started = (m) => m.phase !== 'lobby' && m.phase !== 'done';

  /** The running match this player is in, if any. */
  function liveFor(userId) {
    for (const m of matches.values()) {
      if (started(m) && seatsOf(m).some((s) => s.userId === userId)) return m.id;
    }
    return null;
  }

  // ── What a player sees ──

  function view(m, side, t = clock()) {
    const me = m.seats[side];
    const them = m.seats[otherSide(side)];
    const out = {
      id: m.id, v: m.v, phase: m.phase, idx: m.idx, total: m.total, category: m.category,
      remainingMs: Math.max(0, m.endsAt - t),
      you: { side, profile: me.profile, score: scoreOf(me), results: me.play ? me.play.answers.map(({ correct, points, skipped }) => ({ correct, points, skipped: !!skipped })) : [] },
      them: them ? { profile: them.profile, connected: present(them, t), answered: m.phase === 'answer' && them.answered } : null,
    };
    if (m.phase === 'lobby') {
      out.invited = m.invited;
      out.joined = !!m.seats.opponent;
    }
    if (me.play && ['countdown', 'prepare', 'answer', 'reveal'].includes(m.phase)) out.previews = plays.previews(me.play);
    if (m.phase === 'prepare') {
      Object.assign(out, plays.peek(me.play, m.idx));
      // A hold ends when its time is up or the absent player's waiting allowance runs out.
      if (m.holdUntil) out.holdMs = Math.max(0, Math.min(m.holdUntil - t, ...seatsOf(m).filter((s) => !present(s, t)).map((s) => s.grace)));
    }
    if (m.phase === 'answer') {
      const { idx, ...question } = me.opened;
      out.question = question;
      out.clockMs = Math.max(0, question.seconds * 1000 - (t - m.openedAt));
      out.answered = me.answered;
      if (me.answered) out.choice = me.choice;
    }
    if (m.phase === 'reveal') out.result = me.result;
    if (m.phase === 'void') out.voidReason = m.voidReason;
    if (m.phase === 'done') {
      out.ended = m.ended;
      out.rematch = m.rematch;
    }
    return out;
  }

  function push(seat, event, data) {
    if (!seat.stream) return;
    try {
      seat.stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      seat.stream = null;
    }
  }

  function broadcast(m, t) {
    for (const side of SIDES) if (m.seats[side]) push(m.seats[side], 'state', view(m, side, t));
  }

  const touch = (m, t) => {
    m.v += 1;
    broadcast(m, t);
  };

  function persist(m) {
    if (m.settled) return;
    saveDuelLive(db, m.id, {
      phase: m.phase, idx: m.idx, v: m.v,
      grace: Object.fromEntries(seatsOf(m).map((s) => [sideOf(m, s), s.grace])),
      voids: Object.fromEntries(seatsOf(m).map((s) => [sideOf(m, s), s.voids])),
    });
  }

  function enter(m, phase, ms, t) {
    m.phase = phase;
    m.endsAt = t + ms;
    m.v += 1;
    persist(m);
    broadcast(m, t);
  }

  // ── Moving through a match ──

  function start(m, t) {
    const [host, guest] = [m.seats.challenger, m.seats.opponent];
    const questionIds = pick(host.userId, guest.userId, m.category, m.avoid);
    if (!questionIds.length) return expire(m, t);
    setDuelQuestions(db, m.id, questionIds);
    m.total = questionIds.length;
    for (const side of SIDES) {
      const seat = m.seats[side];
      seat.play = plays.begin({ kind: 'duel', ref: m.id, side, userId: seat.userId, questionIds });
    }
    enter(m, 'countdown', MATCH.countdownMs, t);
  }

  function enterPrepare(m, t, ms = MATCH.prepareMs) {
    for (const seat of seatsOf(m)) Object.assign(seat, freshQuestion());
    m.holdUntil = 0;
    enter(m, 'prepare', ms, t);
  }

  function openQuestion(m, t) {
    for (const seat of seatsOf(m)) seat.opened = plays.open(seat.play, m.idx, t);
    m.openedAt = t;
    m.holdUntil = 0;
    enter(m, 'answer', seatsOf(m)[0].opened.seconds * 1000 + PLAY.lateAllowanceMs, t);
  }

  /** The question is over for both: only now are the answers graded. */
  function closeQuestion(m, t) {
    for (const seat of seatsOf(m)) {
      // The trip to the player and back, as measured when they said they got the question.
      // It can't be more than the allowance every player used to get.
      const trip = seat.seenAt === null ? PLAY.networkAllowanceMs : Math.min(seat.seenAt - m.openedAt, PLAY.networkAllowanceMs);
      const choice = seat.answered ? seat.choice : null;
      const r = plays.answer(seat.play, m.idx, choice, seat.answered ? seat.answeredAt : t, trip);
      seat.result = {
        ...r, choice, away: seat.away, seconds: seat.opened.seconds,
        base: r.correct ? SCORING.base : 0, speed: r.correct ? r.points - SCORING.base : 0,
      };
    }
    if (m.idx + 1 >= m.total) settle(m, { reason: 'played' }, t);
    enter(m, 'reveal', MATCH.revealMs, t);
  }

  /** Nobody can fairly play this question: it's skipped for both and costs neither any points. */
  function voidQuestion(m, reason, t, ms = MATCH.voidMs) {
    for (const seat of seatsOf(m)) {
      if (seat.play.idx === m.idx) plays.skip(seat.play, m.idx, t, { force: true });
    }
    m.voidReason = reason;
    if (m.idx + 1 >= m.total) settle(m, { reason: 'played' }, t);
    enter(m, 'void', ms, t);
  }

  function nextQuestion(m, t) {
    if (m.idx + 1 >= m.total) return finish(m, t);
    m.idx += 1;
    enterPrepare(m, t);
  }

  /** Saves how the match ended. Does nothing the second time. */
  function settle(m, { reason, forfeitSide = null }, t) {
    if (m.settled) return;
    for (const seat of seatsOf(m)) {
      if (seat.play) (reason === 'abandoned' ? plays.abandon(seat.play) : plays.finish(seat.play));
    }
    m.settled = true;
    m.ended = { reason, forfeitSide };
    if (!getDuel(db, m.id)) return; // an account was deleted and the duel went with it
    // Someone who wasn't there for the end has a result waiting (not whoever left on purpose).
    const counted = reason === 'played' || reason === 'forfeit';
    const missed = counted ? seatsOf(m).find((s) => !present(s, t) && sideOf(m, s) !== m.leftBy) : null;
    endDuel(db, m.id, { reason, forfeitSide, unseenBy: missed?.userId ?? null });
    if (missed) tellAbsent(m, missed, forfeitSide);
  }

  function tellAbsent(m, seat, forfeitSide) {
    const side = sideOf(m, seat);
    const them = m.seats[otherSide(side)];
    const [mine, theirs] = [scoreOf(seat), scoreOf(them)];
    const won = forfeitSide ? forfeitSide !== side : mine > theirs;
    const outcome = !forfeitSide && mine === theirs ? 'Draw' : won ? 'Won' : 'Lost';
    reminders?.duelFinished(seat.userId, m.id, outcome, { name: them.profile.name, their: theirs, yours: mine });
  }

  function finish(m, t) {
    settle(m, { reason: 'played' }, t);
    toDone(m, t);
  }

  function toDone(m, t) {
    m.phase = 'done';
    m.endsAt = t;
    m.evictAt = t + MATCH.doneKeepMs;
    touch(m, t);
  }

  function forfeit(m, side, t) {
    settle(m, { reason: 'forfeit', forfeitSide: side }, t);
    toDone(m, t);
  }

  function abandon(m, t) {
    settle(m, { reason: 'abandoned' }, t);
    toDone(m, t);
  }

  function expire(m, t) {
    settle(m, { reason: 'expired' }, t);
    toDone(m, t);
  }

  /** Nobody was seen in the seat: whoever else is here can wait for a new second player. */
  function freeGuestSeat(m, t) {
    const guest = m.seats.opponent;
    releaseDuelSeat(db, m.id, guest.userId);
    m.seats.opponent = null;
    m.joinedAt = 0;
    if (guest.stream) {
      push(guest, 'gone', {});
      guest.stream.end?.();
    }
    touch(m, t);
  }

  /** Between questions, waits a while for a player who dropped. */
  function holdForAbsent(m, absent, t) {
    if (!m.holdUntil) {
      m.holdUntil = t + MATCH.holdMs;
      m.holdTick = t;
      touch(m, t);
    }
    const passed = t - m.holdTick;
    m.holdTick = t;
    for (const seat of absent) seat.grace -= passed;
    const outOfTime = absent.filter((s) => s.grace <= 0 || t >= m.holdUntil);
    if (!outOfTime.length) return;
    if (absent.length === seatsOf(m).length) return abandon(m, t);
    m.leftBy = null;
    forfeit(m, sideOf(m, outOfTime[0]), t);
  }

  /** Moves the match on if it's time. Called on every message and many times a second. */
  function advance(m, t) {
    const seats = seatsOf(m);
    switch (m.phase) {
      case 'lobby': {
        if (t >= m.endsAt) return expire(m, t);
        const [host, guest] = [m.seats.challenger, m.seats.opponent];
        if (!guest) return;
        if (present(host, t) && present(guest, t) && !liveFor(host.userId) && !liveFor(guest.userId)) return start(m, t);
        if (!present(guest, t) && t - guest.lastSeen >= MATCH.guestWaitMs) return freeGuestSeat(m, t);
        if (!present(host, t) && t >= m.joinedAt + MATCH.hostWaitMs) return expire(m, t);
        return;
      }
      case 'countdown':
        if (t >= m.endsAt) enterPrepare(m, t);
        return;
      case 'prepare': {
        const failed = seats.find((s) => s.failed && s.voids < MATCH.maxVoids);
        if (failed) {
          failed.voids += 1;
          return voidQuestion(m, 'picture', t);
        }
        const absent = seats.filter((s) => !present(s, t));
        if (!absent.length) {
          if (m.holdUntil) {
            // Everyone is back. A moment for the one who returned to get their picture on screen.
            m.holdUntil = 0;
            m.endsAt = t + MATCH.prepareMs;
            return touch(m, t);
          }
          if (seats.every((s) => s.ready) || t >= m.endsAt) openQuestion(m, t);
          return;
        }
        if (t >= m.endsAt || m.holdUntil) holdForAbsent(m, absent, t);
        return;
      }
      case 'answer': {
        const waitingFor = seats.filter((s) => !s.answered && present(s, t));
        const someoneAnswered = seats.some((s) => s.answered);
        if (t >= m.endsAt || !waitingFor.length && someoneAnswered) closeQuestion(m, t);
        return;
      }
      case 'reveal':
      case 'void':
        if (t >= m.endsAt) nextQuestion(m, t);
        return;
      case 'done':
        if (t >= m.evictAt) {
          for (const seat of seats) seat.stream?.end?.();
          matches.delete(m.id);
        }
        return;
    }
  }

  /** The heartbeat of every match. A timer can't get lost when there is only this one. */
  function tick(t = clock()) {
    for (const m of matches.values()) {
      try {
        for (const seat of seatsOf(m)) {
          if (seat.stream && m.phase !== 'done' && t - seat.lastSeen > MATCH.beatTimeoutMs) {
            seat.stream.end?.();
            seat.stream = null;
          }
        }
        if (t >= (m.nextPing ?? 0)) {
          m.nextPing = t + MATCH.pingEveryMs;
          for (const seat of seatsOf(m)) push(seat, 'ping', {});
        }
        let changed = false;
        for (const seat of seatsOf(m)) {
          const now = present(seat, t);
          if (now !== seat.wasPresent) changed = true;
          seat.wasPresent = now;
        }
        const before = m.v;
        advance(m, t);
        if (changed && m.v === before) touch(m, t);
        m.failures = 0;
      } catch (err) {
        log(`Live duel ${m.id}:`, err); // this runs on a timer: an error here must not stop the server
        m.failures = (m.failures || 0) + 1;
        if (m.failures >= 5) giveUp(m, t);
      }
    }
  }

  /** Something keeps going wrong in this match: end it for both rather than leave them stuck. */
  function giveUp(m, t) {
    m.settled = true;
    m.ended = { reason: 'abandoned', forfeitSide: null };
    try {
      for (const seat of seatsOf(m)) if (seat.play) plays.abandon(seat.play);
      endDuel(db, m.id, { reason: 'abandoned' });
    } catch (err) {
      log(`Could not close live duel ${m.id}:`, err);
    }
    try {
      toDone(m, t);
    } catch {
      matches.delete(m.id);
    }
  }

  // ── What players do ──

  /** A new duel, waiting in the lobby for its second player. */
  function open(duel, t = clock()) {
    const m = {
      id: duel.id, category: duel.category, invited: !!duel.invitedId, avoid: new Set(duel.avoid ?? []),
      phase: 'lobby', v: 1, idx: 0, total: duel.questionIds.length || 10, endsAt: t + MATCH.lobbyMs,
      seats: { challenger: newSeat(duel.challengerId, t), opponent: null },
      joinedAt: 0, holdUntil: 0, holdTick: 0, openedAt: 0, settled: false, ended: null, rematch: null, leftBy: null,
    };
    matches.set(m.id, m);
    persist(m);
    return m;
  }

  /** Finds the player's seat in a match and notes that they're here. */
  function locate(id, userId, t) {
    const m = matches.get(id);
    if (!m) throw refuse(404, 'This duel has ended.', { ended: true });
    const side = SIDES.find((s) => m.seats[s]?.userId === userId);
    if (!side) throw refuse(403, "You're not in this duel.");
    m.seats[side].lastSeen = t;
    return { m, side, seat: m.seats[side] };
  }

  /** Takes the second seat. `user` was already told what the duel is. */
  function join(id, userId, t = clock()) {
    const m = matches.get(id);
    if (!m) throw refuse(404, 'This duel has ended.', { ended: true });
    const mine = SIDES.find((s) => m.seats[s]?.userId === userId);
    if (mine) return locate(id, userId, t) && view(m, mine, t);
    if (m.phase !== 'lobby' || m.seats.opponent) throw refuse(409, 'Someone else has already taken this duel.', { taken: true });
    const busy = liveFor(userId);
    if (busy) throw refuse(409, 'You are already in a live duel.', { live: busy });
    if (!claimDuel(db, id, userId)) throw refuse(409, 'Someone else has already taken this duel.', { taken: true });
    m.seats.opponent = newSeat(userId, t);
    m.joinedAt = t;
    const host = m.seats.challenger;
    if (!present(host, t)) reminders?.duelJoined(host.userId, m.id, { name: m.seats.opponent.profile.name });
    const before = m.v;
    advance(m, t);
    if (m.v === before) touch(m, t);
    return view(m, 'opponent', t);
  }

  /** A player's live connection. Returns what to call when it closes. The newest connection wins. */
  function attach(id, userId, stream, t = clock()) {
    const { m, side, seat } = locate(id, userId, t);
    if (seat.stream && seat.stream !== stream) {
      push(seat, 'replaced', {});
      seat.stream.end?.();
    }
    seat.stream = stream;
    stream.write?.(`event: state\ndata: ${JSON.stringify(view(m, side, t))}\n\n`);
    const before = m.v;
    advance(m, t);
    if (m.v === before && !seat.wasPresent) {
      seat.wasPresent = true;
      touch(m, t);
    }
    return () => {
      if (seat.stream !== stream) return;
      seat.stream = null;
      seat.lastSeen = clock();
    };
  }

  const state = (id, userId, t = clock()) => {
    const { m, side } = locate(id, userId, t);
    return view(m, side, t);
  };

  /** The picture is on screen, or `failed`: it can't be shown. */
  function ready(id, userId, idx, failed, t = clock()) {
    const { m, side, seat } = locate(id, userId, t);
    if (m.phase === 'prepare' && idx === m.idx) {
      seat.ready = true;
      seat.failed = !!failed;
      advance(m, t);
    }
    return view(m, side, t);
  }

  /** The player has the question. Measures their connection, so a slow one doesn't lose ties. */
  function seen(id, userId, idx, t = clock()) {
    const { m, side, seat } = locate(id, userId, t);
    if (m.phase === 'answer' && idx === m.idx && seat.seenAt === null) seat.seenAt = t;
    return view(m, side, t);
  }

  /** The first answer to a question stands. Late or repeated ones just get where the match is now. */
  function answer(id, userId, idx, choice, away, t = clock()) {
    const { m, side, seat } = locate(id, userId, t);
    if (m.phase === 'answer' && idx === m.idx && !seat.answered) {
      seat.answered = true;
      seat.choice = typeof choice === 'string' ? choice.slice(0, 500) : null;
      seat.away = !!away;
      seat.answeredAt = t;
      const before = m.v;
      advance(m, t);
      if (m.v === before) touch(m, t);
    }
    return view(m, side, t);
  }

  /** Leaving on purpose: gives up a running match; before the start, just steps out. */
  function leave(id, userId, t = clock()) {
    const { m, side } = locate(id, userId, t);
    if (m.phase === 'done') return view(m, side, t);
    if (m.phase === 'lobby') {
      if (side === 'challenger') expire(m, t);
      else freeGuestSeat(m, t);
      return side === 'challenger' ? view(m, side, t) : { phase: 'done', left: true };
    }
    m.leftBy = side;
    forfeit(m, side, t);
    return view(m, side, t);
  }

  /** A rematch was started: whoever is still on the result screen gets to hear about it. */
  function offerRematch(id, rematchId, t = clock()) {
    const m = matches.get(id);
    if (!m) return;
    m.rematch = rematchId;
    touch(m, t);
  }

  /** The account is going away: its matches end now, while everything they need still exists. */
  function userGone(userId, t = clock()) {
    for (const m of [...matches.values()]) {
      const side = SIDES.find((s) => m.seats[s]?.userId === userId);
      if (!side || m.phase === 'done') continue;
      try {
        leave(m.id, userId, t);
      } catch (err) {
        log(`Could not end live duel ${m.id}:`, err);
      }
    }
  }

  /** Picks up the matches that were running when the server stopped. */
  function restore(t = clock()) {
    for (const id of liveDuelIds(db)) {
      try {
        restoreOne(getDuel(db, id), t);
      } catch (err) {
        log(`Could not restore live duel ${id}:`, err);
        endDuel(db, id, { reason: 'abandoned' });
      }
    }
  }

  function restoreOne(duel, t) {
    const { live } = duel;
    const m = open(duel, t);
    if (duel.opponentId) {
      m.seats.opponent = newSeat(duel.opponentId, t);
      m.joinedAt = t;
    }
    m.v = live.v + 1000; // newer than anything a browser saw before the restart
    for (const seat of seatsOf(m)) {
      const side = sideOf(m, seat);
      seat.grace = live.grace[side] ?? MATCH.graceMs;
      seat.voids = live.voids[side] ?? 0;
      seat.lastSeen = t + MATCH.restartWaitMs; // everyone counts as here while they reconnect
    }
    m.total = duel.questionIds.length || m.total;
    if (live.phase === 'lobby') {
      m.endsAt = duel.createdAt + MATCH.lobbyMs;
      persist(m);
      return;
    }
    for (const seat of seatsOf(m)) {
      seat.play = plays.find('duel', duel.id, seat.userId);
      if (!seat.play) throw new Error('A round of this duel is missing.');
    }
    m.idx = live.idx;
    if (live.phase === 'answer') return voidQuestion(m, 'restart', t, MATCH.restartWaitMs); // both saw it, and nobody can say for how long
    if (live.phase === 'reveal' || live.phase === 'void') {
      if (m.idx + 1 >= m.total) return finish(m, t);
      m.idx += 1;
    }
    enterPrepare(m, t, MATCH.restartWaitMs);
  }

  return { open, join, attach, state, ready, seen, answer, leave, offerRematch, userGone, liveFor, tick, restore, isOpen: (id) => matches.has(id), beat: state };
}
