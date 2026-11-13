// Game configuration shared by client and server.
// Add a new mode here to change the timer or round length for a game style.

export const MODES = {
  classic: { name: 'Classic', secondsPerQuestion: 15, questionsPerRound: 10 },
  // Examples for later:
  // blitz:   { name: 'Blitz',   secondsPerQuestion: 7,  questionsPerRound: 15 },
  // relaxed: { name: 'Relaxed', secondsPerQuestion: 30, questionsPerRound: 10 },
};

export const DEFAULT_MODE = 'classic';

// Languages the app can be shown in. English is the default; questions and answers are
// stored and graded in English, and translated only for display.
export const LANGUAGES = ['en', 'he', 'ar'];

// How long the result stays on screen before auto next moves on (whole seconds).
export const AUTO_DELAY = { min: 1, max: 7, fallback: 2 };

// When the Back arrow shows at the top of a screen: on phones (touch screens) only, always, or never.
export const BACK_BUTTON = ['phones', 'always', 'never'];

// What a player can say is wrong when reporting a question. `picture` reasons are only
// offered for questions that show a picture.
export const REPORT_REASONS = [
  { id: 'picture-wrong', label: 'The picture is wrong or gives the answer away', picture: true },
  { id: 'picture-missing', label: "The picture didn't load", picture: true },
  { id: 'answer-wrong', label: 'The right answer is wrong' },
  { id: 'unclear', label: 'The question or answers are unclear' },
  { id: 'other', label: 'Something else' },
];
export const REPORT_NOTE_MAX = 500;

// The Daily Challenge: the same questions for everyone on a calendar day (each player's own
// day, like Wordle). Daily #1 was played on `start`. Picked from easy to hard.
export const DAILY = { start: '2026-11-01', questions: 10 };

// The Daily's boards: rows shown at first, rows added by "Show more", and how many players
// above and below you stay in view when you're further down the board.
export const BOARD = { first: 10, step: 20, around: 2 };

// Duels: two players answer the same questions at the same time (see server/match.js).
export const DUEL = { questions: 10, maxOpen: 5 };

// How a live duel is paced and how long it waits for people. All in milliseconds.
export const MATCH = {
  lobbyMs: 10 * 60_000, // how long an invitation stays open
  hostWaitMs: 60_000, // someone joined while the sender was away: how long to wait for the sender to come back
  guestWaitMs: 20_000, // the seat goes free again if whoever took it disappears before the start
  countdownMs: 3000, // the 3-2-1
  prepareMs: 4000, // the longest both players wait for each other's picture
  revealMs: 3500, // how long the result of a question stays up
  voidMs: 2000, // how long "this question was cancelled" stays up
  restartWaitMs: 6000, // after a server restart, how long players get to reconnect
  pingEveryMs: 5000, // the server says it's alive this often, so a dead connection can be noticed
  beatEveryMs: 10_000, // the browser says it's alive this often
  absentAfterMs: 5000, // no connection for this long: the player is away
  beatTimeoutMs: 25_000, // connected, but silent for this long: the connection is dead
  holdMs: 15_000, // between questions, the longest one wait for a player who dropped
  graceMs: 30_000, // all the waiting a player can cost the other in one duel
  maxVoids: 2, // questions one player can report a picture failure on
  forfeitXpMin: 5, // questions the winner must have played for a forfeited duel to earn XP
  doneKeepMs: 2 * 60_000, // a finished duel stays connected this long, so a rematch can be offered
};

// How the server plays and times Daily and duel questions (see server/play.js).
export const PLAY = {
  networkAllowanceMs: 400, // taken off each measured time: the trip to the player and back
  lateAllowanceMs: 1500, // how far past the limit an answer may arrive and still count
  idleMs: 15 * 60_000, // a round nobody has touched for this long ends, with the rest counted wrong
  lookahead: 2, // how many upcoming pictures a player may download ahead of their question
};

// Profiles shown to other players.
export const PROFILE = { nameMax: 20, maxFriends: 200 };

// Push reminders: "Today's Daily is ready" goes out at this local hour.
export const REMINDER_HOUR = 9;

/** Today's date in a time zone (minutes behind UTC, as from getTimezoneOffset()), as "YYYY-MM-DD". */
export const localDate = (tzOffsetMin = 0, now = Date.now()) => new Date(now - tzOffsetMin * 60_000).toISOString().slice(0, 10);

/** The Daily's number for a date: #1 on DAILY.start. */
export const dailyNumber = (date) => Math.round((Date.parse(date) - Date.parse(DAILY.start)) / 86_400_000) + 1;

// Things players do, logged in the `events` table and counted on the admin Players page.
// `client: true` events are sent by the browser (POST /api/events); the rest are recorded
// by the server itself, so nobody can fake them: a round is "finished" when the server
// grades it, and ads and purchases count only once the ad network or payment provider confirms.
export const EVENTS = {
  home_viewed: { client: true }, // props.variant: 'first' (no finished rounds yet) or 'returning'
  round_started: { client: true },
  round_finished: {},
  helper_used: { client: true },
  ad_offered: { client: true },
  ad_watched: {},
  purchase: {},
};

// Points: a right answer is worth `base`, plus a speed bonus of `speedBonus` points shared out
// evenly over the time: answer in the first third of the time for 2, the middle third for 1,
// the last third for 0. A wrong answer or running out of time scores 0. So 0–3 per question.
export const SCORING = { base: 1, speedBonus: 2 };

export function pointsFor(correct, ms, seconds) {
  if (!correct) return 0;
  const limit = seconds * 1000;
  const band = Math.floor((Math.max(0, ms) * (SCORING.speedBonus + 1)) / limit); // 0 = first third of the time
  return SCORING.base + Math.max(0, SCORING.speedBonus - band);
}

/** The most points one question can give. */
export const MAX_POINTS = SCORING.base + SCORING.speedBonus;

// Player levels. A finished round earns its points as XP, plus `finished`, plus a bonus for the
// modes the server plays (a round quit halfway earns nothing). Reaching level L takes
// 12 × L × (L − 1) − 14 XP in total, so each level costs 24 XP more than the one before. The − 14
// keeps level 2 at 10 XP: one finished round always reaches it. Levels unlock avatar parts (see UNLOCKS in shared/avatars.js).
export const XP = { finished: 10, bonus: { daily: 20, duel: 10 }, stageClear: 50 };
export const MAX_LEVEL = 99;

// Coins: earned by playing, spent on what levels unlock (a level makes an item available; coins
// buy it). All the numbers that set the balance are here.
export const COINS = {
  finished: 5, // on top of the round's score, when it scored anything
  bonus: { daily: 15 },
  duel: { win: 20, draw: 10, loss: 5 },
  levelUp: 50,
  stageClear: 50,
  streak: { 7: 50, 30: 200 }, // day streaks: paid once per streak
  quickFullPerDay: 20, // Quick and topic rounds pay half after this many in a day
  price: { base: 30, perLevel: 12, skin: 1.5 }, // an item costs base + perLevel × its level; skins cost more
};

/** The coins a finished round earns. A round with no points earns none, so nothing pays for tapping through. */
export function roundCoins(category, score, halved = false) {
  if (score <= 0) return 0;
  const coins = score + COINS.finished + (COINS.bonus[category] || 0);
  return halved ? Math.ceil(coins / 2) : coins;
}

// Leveling: stages an admin writes on the dashboard and players clear in order. A stage is cleared
// with at least `clearPercent` of its questions right. The first clear of each stage earns
// XP.stageClear on top of the round's usual XP; a later try earns only the usual XP.
export const STAGE = { clearPercent: 70, minQuestions: 5, maxQuestions: 20, wrongOptions: 4, seconds: 20, titleMax: 60, promptMax: 300, optionMax: 120, pictureMax: 500 };

// Where a stage's picture may come from. These hosts are also in the Content Security Policy
// (server/index.js builds it from this list), so anything allowed here loads in the browser.
export const STAGE_PICTURE_HOSTS = ['flagcdn.com', 'upload.wikimedia.org', 'thumb.wikimedia.org'];

/** Whether this many right answers clear a stage of `total` questions. */
export const stageCleared = (correct, total) => total > 0 && correct * 100 >= total * STAGE.clearPercent;

// The Levels: ten built-in rounds of bank questions, played in order (server/quests.js; "quest" in
// the code, because "level" already means a player's own level). One wrong answer, running out of
// time or leaving ends the try. Finishing a level pays base + perQuestion × its questions, and
// `firstTry` times that when the player's very first try does it. A try that ends early pays
// `failShare` for each question solved, rounded down: always less than the number solved.
// Coins are kept low (a 10-question level pays 25, about a Quick round), so levels can't flood
// the shop; the XP is what makes them worth it.
export const QUEST = {
  xp: { base: 20, perQuestion: 8 },
  coins: { base: 5, perQuestion: 2 },
  firstTry: 2,
  failShare: { xp: 0.5, coins: 0.25 },
  acedShown: 3, // friends named on a level for finishing it first try
};

/** What finishing a level of `questions` questions pays: { xp, coins }. */
export function questPrize(questions, firstTry = false) {
  const times = firstTry ? QUEST.firstTry : 1;
  return { xp: (QUEST.xp.base + QUEST.xp.perQuestion * questions) * times, coins: (QUEST.coins.base + QUEST.coins.perQuestion * questions) * times };
}

/** What a try that ended early pays for the questions it solved: { xp, coins }. */
export const questConsolation = (solved) => ({ xp: Math.floor(solved * QUEST.failShare.xp), coins: Math.floor(solved * QUEST.failShare.coins) });

// A level's tier sets the cover around the player's avatar (public/js/covers.js).
export const LEVEL_TIERS = [
  { id: 'rookie', from: 1 },
  { id: 'bronze', from: 5 },
  { id: 'silver', from: 10 },
  { id: 'gold', from: 20 },
  { id: 'platinum', from: 30 },
  { id: 'diamond', from: 40 },
  { id: 'legend', from: 50 },
];

/** The XP a finished round earns. */
export const xpForRound = (category, score) => score + XP.finished + (XP.bonus[category] || 0);

/** The total XP it takes to reach a level. */
export const xpForLevel = (level) => (level <= 1 ? 0 : 12 * level * (level - 1) - 14);

/** The level a total of XP puts a player on. */
export const levelFor = (xp) => Math.min(MAX_LEVEL, Math.floor((1 + Math.sqrt(1 + (xp + 14) / 3)) / 2));

export const tierFor = (level) => LEVEL_TIERS.findLast((tier) => level >= tier.from);

/** How far a player is through their level: XP earned in it, and what the whole level takes (0 at the top). */
export function levelProgress(xp) {
  const level = levelFor(xp);
  const start = xpForLevel(level);
  return { level, into: level < MAX_LEVEL ? xp - start : 0, need: level < MAX_LEVEL ? xpForLevel(level + 1) - start : 0 };
}

export const CATEGORIES = [
  { id: 'flags', name: 'Flags', blurb: 'Tell the tricolours apart', hue: '#E8414F' },
  { id: 'capitals', name: 'Capitals', blurb: 'Not always the biggest city', hue: '#2A3BD1' },
  { id: 'seas', name: 'Seas & oceans', blurb: 'Read the map from orbit', hue: '#0F8FA8' },
  { id: 'signs', name: 'Road signs', blurb: 'European and Israeli signs', hue: '#E89B0C' },
  { id: 'animals', name: 'Animals', blurb: 'From axolotl to wombat', hue: '#3E9B4F' },
  { id: 'cars', name: 'Cars', blurb: 'Classics and icons', hue: '#7A4FD6' },
  { id: 'code', name: 'Programming', blurb: 'Name the language', hue: '#1F2A44', quick: false }, // played from its own tile only
  { id: 'landmarks', name: 'Landmarks', blurb: 'Wonders of the world', hue: '#C2593A' },
  { id: 'dogs', name: 'Dog breeds', blurb: 'From pug to borzoi', hue: '#8C5A2B' },
  { id: 'food', name: 'World food', blurb: 'Dishes from every kitchen', hue: '#F76707' },
  { id: 'countries', name: 'Countries', blurb: 'Know them by their shape', hue: '#12A594' },
  { id: 'elements', name: 'Elements', blurb: 'Read the periodic table', hue: '#6B7A0F' },
  { id: 'music', name: 'Instruments', blurb: 'Strings, brass, drums and more', hue: '#C2255C' },
  { id: 'paintings', name: 'Paintings', blurb: 'Masterpieces of art', hue: '#B5651D' },
  { id: 'body', name: 'Human body', blurb: 'Muscles, bones and organs', hue: '#E03131' },
  { id: 'people', name: 'Famous people', blurb: 'Know them by their face', hue: '#1971C2' },
  { id: 'beauty', name: 'Beauty products', blurb: 'From mascara to bobby pins', hue: '#F06595' },
  { id: 'jobs', name: 'Professions', blurb: 'Name the job', hue: '#2F9E44' },
  { id: 'logos', name: 'Company logos', blurb: 'Know the brand by its symbol', hue: '#0B7285' },
  { id: 'clubs', name: 'Football clubs', blurb: 'Know the club by its crest', hue: '#087F5B' },
  { id: 'footballers', name: 'Football players', blurb: 'From Pelé to Lamine Yamal', hue: '#A61E4D', quick: false }, // own tile only: not in Quick, Daily or mixed duels
  { id: 'currencies', name: 'Currencies', blurb: 'Know the money by its look', hue: '#5C940D' },
  { id: 'guns', name: 'Guns', blurb: 'From revolver to bazooka', hue: '#495057' },
  // Topics with their own question wording, some with a photo: a little more time to read.
  { id: 'history', name: 'History', blurb: 'Wars, revolutions and turning points', hue: '#5C677D', seconds: 20 },
  { id: 'trivia', name: 'Interesting questions', blurb: 'Records, rankings and surprises', hue: '#9C36B5', seconds: 20 },
  { id: 'unexpected', name: 'Not what you think', blurb: 'The obvious answer is wrong', hue: '#D9480F', seconds: 20 },
  // Book topics: text-only questions with long answers, so they get more reading time.
  // `book: true` also keeps them out of Quick rounds (as `quick: false` does for any topic);
  // they're played from their own tile.
  { id: 'sapiens', name: 'Sapiens', blurb: 'Yuval Noah Harari', hue: '#A35C1E', seconds: 25, book: true },
  { id: 'habits', name: 'Atomic Habits', blurb: 'James Clear', hue: '#0B7A75', seconds: 25, book: true },
  { id: 'sayno', name: 'The Art of Saying No', blurb: 'Damon Zahariades', hue: '#5F3DC4', seconds: 25, book: true },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/** Book topics and any topic with `quick: false` are only played from their own tile. */
export const inQuickRounds = (q) => !CATEGORY_BY_ID[q.cat]?.book && CATEGORY_BY_ID[q.cat]?.quick !== false;

/** Seconds allowed for a question: its topic's own limit if it has one, else the mode's. */
export function secondsFor(q, mode = MODES[DEFAULT_MODE]) {
  return q.seconds ?? CATEGORY_BY_ID[q.cat]?.seconds ?? mode.secondsPerQuestion;
}
