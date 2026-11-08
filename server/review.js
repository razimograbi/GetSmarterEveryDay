// Works out from a player's answers which past mistakes are ready to come back in a Quick
// round, and which questions they know or have mastered.
//
// A missed question can return in the very next level. Each right answer after that sends it
// further away, and one more right answer after the last wait ends it. A wrong answer starts over.

// Levels (Quick rounds) to wait after the 1st, 2nd and 3rd right answer since the last mistake.
export const REVIEW_GAPS = [3, 10, 30];

// A level only has room for a couple of mistakes, so only the most urgent go to the game: mostly
// ones on their schedule, plus the one that has waited longest, so no mistake is forgotten.
const SHORTLIST_SCHEDULED = 4;
const SHORTLIST_WAITING = 1;

/**
 * `history` is the player's answers, oldest first: { id, correct, at, roundId, roundKind }, where a
 * `roundKind` of 'mixed' is a Quick round. `dayOf` turns a time into the player's local day, and
 * `canReturn` says whether a question plays in Quick rounds. Returns lists of question ids:
 *  - knownIds: answered right and not waiting to come back
 *  - masteredIds: answered right on at least two different days
 *  - dueMistakes: ready to come back now
 */
export function reviewState(history, dayOf, canReturn = () => true) {
  const questions = new Map();
  let levels = 0;
  let lastLevel = null;
  let lastRound = null;
  for (const a of history) {
    if (a.roundKind === 'mixed' && a.roundId !== lastLevel) {
      levels++;
      lastLevel = a.roundId;
    }
    lastRound = a.roundId;
    let s = questions.get(a.id);
    if (!s) questions.set(a.id, (s = { id: a.id, everMissed: false, streak: 0, rightDays: new Set(), atLevel: 0, roundId: null }));
    if (a.correct) {
      s.streak++;
      s.rightDays.add(dayOf(a.at));
    } else {
      s.everMissed = true;
      s.streak = 0;
    }
    s.atLevel = levels;
    s.roundId = a.roundId;
  }

  const knownIds = [];
  const masteredIds = [];
  const justMissed = [];
  const waiting = [];
  const reviews = [];
  for (const s of questions.values()) {
    const comingBack = s.everMissed && s.streak <= REVIEW_GAPS.length;
    if (s.rightDays.size && !comingBack) knownIds.push(s.id);
    if (s.rightDays.size >= 2) masteredIds.push(s.id);
    if (!comingBack || !canReturn(s.id)) continue;
    const waited = levels - s.atLevel;
    if (s.streak === 0) (s.roundId === lastRound ? justMissed : waiting).push({ id: s.id, urgency: waited });
    else if (waited >= REVIEW_GAPS[s.streak - 1]) reviews.push({ id: s.id, urgency: waited / REVIEW_GAPS[s.streak - 1] }); // how many times over its wait
  }

  const mostUrgent = (list, n) => list.sort((a, b) => b.urgency - a.urgency).slice(0, n).map((x) => x.id);
  return {
    knownIds,
    masteredIds,
    dueMistakes: [...justMissed.map((x) => x.id), ...mostUrgent(reviews, SHORTLIST_SCHEDULED), ...mostUrgent(waiting, SHORTLIST_WAITING)],
  };
}
