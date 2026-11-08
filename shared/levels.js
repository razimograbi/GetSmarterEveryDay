// Builds a Quick round as a level: 10 questions with a set shape and random content. It opens
// with easy wins, dips into harder questions, peaks at a boss near the end and closes on
// something winnable. Difficulty is the hand-rated 0 to 10 from shared/difficulty.js.

export const LEVEL_SLOTS = [
  { band: [0, 2], known: true }, //  1. Warm-up
  { band: [0, 3] }, //               2. Easy (the only new-question slot that reaches difficulty 0)
  { band: [3, 5] }, //               3. Medium
  { band: [5, 6], retry: 'older' }, //  4. An older mistake (or a tough medium if there are none)
  { band: [4, 5] }, //               5. Medium
  { band: [6, 7] }, //               6. Stretch
  { band: [0, 3], known: true }, //  7. Breather
  { band: [4, 6], retry: 'latest' }, // 8. Second chance at a mistake from the last level (else an older one, else a medium)
  { band: [7, 10] }, //              9. Boss
  { band: [1, 3], known: true }, // 10. Closer
];

const MAX_PER_TOPIC = 2;

// `known` slots only reuse questions you've answered right once there are this many to choose
// from. With fewer, a player would keep meeting the same few questions.
const KNOWN_MIN = 20;

// When a slot has nothing to offer, the rules give way in this order: the difficulty band widens
// one step at a time, then the same topic may sit side by side, then last round's questions return.
const LOOSENING = [
  ...Array.from({ length: 11 }, (_, widen) => ({ widen, apart: true, fresh: true })),
  { widen: 10, apart: false, fresh: true },
  { widen: 10, apart: false, fresh: false },
];

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

/** Chooses a topic first, then a question in it, so topics with many questions don't crowd out small ones. */
function pickByTopic(list) {
  const topic = pickOne([...new Set(list.map((q) => q.cat))]);
  return pickOne(list.filter((q) => q.cat === topic));
}

/**
 * What a question gives away. Never two about the same country in one round: "What's the
 * capital of Japan?" shows Japan's flag and names Japan, giving away its flag and shape questions.
 */
export const subjectOf = (q) => (q.about ? `country:${q.about.toLowerCase()}` : q.id);

/**
 * The questions of a level, in playing order. `history` holds Sets of question ids:
 * `seen` (answered before), `known` (answered right and not waiting to come back), `mastered`
 * (right on two different days), `missed` (mistakes ready to come back) and `recent` (the round
 * just played).
 */
export function pickLevel(pool, count, { seen = new Set(), known = new Set(), mastered = new Set(), missed = new Set(), recent = new Set() } = {}) {
  const slots = Array.from({ length: count }, (_, i) => LEVEL_SLOTS[Math.floor((i * LEVEL_SLOTS.length) / count)]);
  const level = Array(count).fill(null);
  const perTopic = {};
  const subjects = new Set();

  const allowed = (q, i, apart) =>
    !subjects.has(subjectOf(q))
    && (perTopic[q.cat] || 0) < MAX_PER_TOPIC
    && !(apart && (level[i - 1]?.cat === q.cat || level[i + 1]?.cat === q.cat));

  /**
   * New questions first, then ones you've missed, then ones you know. `known` slots start with
   * what you know, and with what isn't mastered yet, because a second right answer on another
   * day is what masters it.
   */
  function bestGroup(options, slot) {
    const right = options.filter((q) => known.has(q.id));
    if (slot.known && right.length >= KNOWN_MIN) {
      const learning = right.filter((q) => !mastered.has(q.id));
      return learning.length >= KNOWN_MIN ? learning : right;
    }
    const unseen = options.filter((q) => !seen.has(q.id));
    if (unseen.length) return unseen;
    const wrong = options.filter((q) => !known.has(q.id));
    return wrong.length ? wrong : options;
  }

  /** Mistakes this slot can bring back. Only a `latest` slot may reach into the round just played. */
  function retriesFor(i) {
    const open = pool.filter((q) => missed.has(q.id) && allowed(q, i, true));
    const older = open.filter((q) => !recent.has(q.id));
    if (slots[i].retry === 'older') return older;
    const latest = open.filter((q) => recent.has(q.id));
    return latest.length ? latest : older;
  }

  function choose(i) {
    const slot = slots[i];
    if (slot.retry) {
      const retries = retriesFor(i);
      if (retries.length) return pickByTopic(retries);
    }
    for (const { widen, apart, fresh } of LOOSENING) {
      const options = pool.filter(
        (q) =>
          q.difficulty >= slot.band[0] - widen
          && q.difficulty <= slot.band[1] + widen
          && (!fresh || !recent.has(q.id))
          && allowed(q, i, apart),
      );
      if (options.length) return pickByTopic(bestGroup(options, slot));
    }
    return null;
  }

  // Past mistakes get their slots first, then the hardest slots, because hard questions are scarcest.
  const fillOrder = slots
    .map((_, i) => i)
    .sort((a, b) => Number(Boolean(slots[b].retry)) - Number(Boolean(slots[a].retry)) || slots[b].band[0] - slots[a].band[0]);

  for (const i of fillOrder) {
    const q = choose(i);
    if (!q) continue;
    level[i] = q;
    perTopic[q.cat] = (perTopic[q.cat] || 0) + 1;
    subjects.add(subjectOf(q));
  }
  return level.filter(Boolean);
}
