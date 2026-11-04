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
export const AUTO_DELAY = { min: 1, max: 7, fallback: 4 };

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

// Duels: two players answer the same questions, each when they like.
export const DUEL = { questions: 10, maxOpen: 20 };

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
  { id: 'novels', name: 'Famous books', blurb: 'Bestsellers since 2000', hue: '#7048E8', seconds: 20 }, // plot descriptions take longer to read
  { id: 'body', name: 'Human body', blurb: 'Muscles, bones and organs', hue: '#E03131' },
  { id: 'people', name: 'Famous people', blurb: 'Know them by their face', hue: '#1971C2' },
  { id: 'beauty', name: 'Beauty products', blurb: 'From mascara to bobby pins', hue: '#F06595' },
  { id: 'jobs', name: 'Professions', blurb: 'Name the job', hue: '#2F9E44' },
  { id: 'logos', name: 'Company logos', blurb: 'Know the brand by its symbol', hue: '#0B7285' },
  { id: 'clubs', name: 'Football clubs', blurb: 'Know the club by its crest', hue: '#087F5B' },
  { id: 'footballers', name: 'Football players', blurb: 'From Pelé to Lamine Yamal', hue: '#A61E4D' },
  { id: 'currencies', name: 'Currencies', blurb: 'Know the money by its look', hue: '#5C940D' },
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

/** Seconds allowed for a question: its topic's own limit if it has one, else the mode's. */
export function secondsFor(q, mode = MODES[DEFAULT_MODE]) {
  return CATEGORY_BY_ID[q.cat]?.seconds ?? mode.secondsPerQuestion;
}
