# Smarts

A picture quiz built for phones (it works on laptops too). Sign in with Google, play
10-question rounds against a 15-second clock, and track what you've mastered.

**2,125 questions in 28 topics:** flags (100), capitals (100), seas & oceans (25),
road signs (100: 20 European, 80 Israeli), animals (100), cars (100), programming languages (20), landmarks (100),
dog breeds (100), world food (100), countries (100), chemical elements (40),
musical instruments (100), paintings (100), human body (100), famous people (100),
beauty products (100), professions (50),
company logos (100, symbol-only logos that don't spell the name), football clubs (40),
football players (40), currencies (20), history (100),
interesting questions (100) and not what you think (100, where the obvious answer is
wrong), which mix photo and text-only questions, and three book topics with text-only questions:
*Sapiens* by Yuval Noah Harari (30), *Atomic Habits* by James Clear (30) and
*The Art of Saying No* by Damon Zahariades (30).

## Run it

You need **Node.js 26 or newer** (`node -v`). There is nothing to install: the app
uses only Node's built-in modules (HTTP server, `node:sqlite`, `node:crypto`).

```bash
cp .env.example .env      # then add your Google client ID (below)
npm start                 # http://localhost:3000
```

`npm run dev` does the same but restarts the server when you edit server code.
Frontend files in `public/` are served fresh on every reload.

Without a `GOOGLE_CLIENT_ID`, the sign-in screen offers a name-only **dev sign-in** so
you can play straight away.

## Set up Google sign-in

1. Open <https://console.cloud.google.com/apis/credentials> and create a project if needed.
2. **Configure consent screen** → External → fill in the app name and your email. While
   in "Testing", add your own Google account under *Test users*.
3. **Create credentials → OAuth client ID → Web application.**
4. Under **Authorized JavaScript origins** add `http://localhost:3000`
   (and `http://localhost` too; Google recommends both). No redirect URI is needed.
5. Copy the client ID into `.env`:
   ```
   GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   ```
6. Restart `npm start`.

The browser gets a signed ID token from Google; the server checks its signature
against Google's public keys, its audience, issuer and expiry, then starts a session:
a random token in an HTTP-only cookie (30 days), stored in the database as a hash.
Signing out deletes that session, and **Sign out on all devices** deletes all of them,
so a copied cookie stops working straight away.

### Playing on your phone during development

Google only allows sign-in from `localhost` or an `https://` address, so on your phone
over Wi-Fi (`http://192.168.x.x:3000`) set `DEV_LOGIN=1` in `.env` and use the name
sign-in there. Dev sign-in matches accounts by name, so it's for testing only: with
`NODE_ENV=production` it is always off, and the server won't start if `DEV_LOGIN=1`. For real Google sign-in on a phone, put the app behind HTTPS (for
example a tunnel such as `cloudflared` or `ngrok`) and add that URL to the authorized
origins.

## How it works

```
server/
  index.js     HTTP server, API routes, static files, security headers
  auth.js      Google ID-token verification + signed session cookies
  db.js        SQLite schema and queries (data/smarts.db)
shared/
  questions.js the question bank (used by browser and server)
  config.js    game modes, scoring, topics
public/
  index.html, css/app.css
  js/app.js      screens: sign in, home, play, results, progress
  js/visuals.js  picture renderers (flag, photo, satellite map, sign, code)
  js/signs.js    road signs drawn in SVG
  js/covers.js   the level covers around avatars
scripts/
  validate.js      checks the question bank
  check-images.js  checks every Wikipedia photo resolves (needs internet)
```

**API**

| Method | Path | |
|---|---|---|
| GET | `/api/config` | Google client ID, whether dev sign-in is on |
| POST | `/api/auth/google` | `{ credential }` → session |
| POST | `/api/auth/dev` | `{ name }` → session (only when dev sign-in is on) |
| GET | `/api/me` | Current user and their settings (or `null`) |
| POST | `/api/auth/logout` | Ends this session |
| POST | `/api/auth/logout-all` | Ends every session of this user, on all devices |
| PUT | `/api/settings` | `{ autoNext?, autoNextDelay? }` → saved settings |
| POST | `/api/questions` | `{ ids }` (up to 20) → the words, options and answers of a Quick or topic round |
| POST | `/api/rounds` | `{ mode, category, answers: [{ id, choice, ms }] }` — saves a Quick or topic round |
| GET | `/api/stats` | Totals, per-topic mastery, streaks, last 14 days, recent rounds |
| POST | `/api/events` | `{ name, props? }` → logs an event the browser may report (see Events below) |
| GET | `/api/admin/retention` | Admins only: daily and monthly players, returns after 1, 7 and 30 days, event counts |
| PUT | `/api/profile` | `{ name?, avatar?, country?, hidden? }` → the player's public profile (an avatar above their level is refused) |
| GET | `/api/friends?tz=` | Your friend code, friends (with streaks and today's Daily score) and duels |
| POST | `/api/friends` | `{ code }` → adds the player with that friend code (both ways) |
| DELETE | `/api/friends/:id` | Removes a friend (both ways) |
| GET | `/api/invite/:code` | Who an invite link is from (no sign-in needed) |
| GET | `/api/daily?date=` | The Daily for the player's date: number, how many questions, and their result (the questions only once finished) |
| POST | `/api/daily/start` | `{ date }` → starts the one try, or picks up one still open (`started: false` once played) |
| POST | `/api/daily/finish` | `{ date }` → ends the try now: anything unanswered counts as wrong |
| GET | `/api/daily/board?date=` | Top 50, the player's own place with the 2 players above and below, and their friends |
| GET/POST | `/api/duels` | List your duels / `{ category, friendId? }` → a new duel |
| GET | `/api/duels/:id` | One duel as you see it (questions and answers once you've played) |
| GET | `/api/duels/:id/preview` | Who sent a duel link and their score (no sign-in needed) |
| POST | `/api/duels/:id/join`, `/rematch` | Take the seat of a duel that's waiting, start or join a rematch |
| GET | `/api/duels/:id/stream`, `/state` | A live duel as you see it: pushed as it changes (Server-Sent Events), or once |
| POST | `/api/duels/:id/ready`, `/seen`, `/answer`, `/beat`, `/leave` | What a player does in a live duel (see Live duels) |
| POST | `/api/plays/:id/open`, `/answer`, `/skip` | `{ idx, choice? }` → one Daily or Leveling question at a time (see Fair play) |
| GET | `/api/stages` | The published Leveling stages as this player stands on them (never the questions) |
| POST | `/api/stages/:id/start`, `/finish` | Start or pick up a try at an open stage, end the open try now |
| GET/POST | `/api/admin/stages` | Admins only: list the stages / `{ title }` → a new draft |
| GET/PUT/DELETE | `/api/admin/stages/:id` | Admins only: a stage with its questions / `{ title?, published? }` / delete it |
| POST | `/api/admin/stages/:id/move` | Admins only: `{ direction: 'up' \| 'down' }` |
| POST, PUT, DELETE | `/api/admin/stages/:id/questions[/:qid]` | Admins only: `{ prompt, answer, wrong: [4], picture? }`; `POST .../:qid/move` reorders |
| POST | `/api/push/subscribe`, `/unsubscribe` | A browser's push subscription for reminders |
| GET | `/api/account/export` | Everything stored about the user, as a JSON download |
| DELETE | `/api/account` | Deletes the user and all their data |

### Fair play

Other players see Daily and duel scores, so those rounds run on the server (`server/play.js`).

- **Browsers never get the question bank.** `shared/questions.js` stays on the server. The address
  `/shared/questions.js` serves an index made by `server/bank.js`: ids, topics and difficulty, enough
  to choose a Quick round. A Quick or topic round asks for its own questions when it starts
  (`POST /api/questions`), so it needs a connection then.
- **One question at a time.** A round has a row in the `plays` table. The browser asks to open the
  current question, and only then gets its words and options, with no id and no answer. Pictures
  come from `/pic/<round>/<n>`, an address that doesn't name them; up to two later pictures can be
  downloaded ahead (`PLAY.lookahead`), so the next question still appears at once.
- **The server times and grades.** A question's clock starts when the server opens it, opening it
  again doesn't restart it, and sheets don't pause it. The time is what the server measured minus
  400 ms for the network, and an answer may arrive up to 1.5 s past the limit (`PLAY` in
  `shared/config.js`). The browser sends only its choice; the first answer to a question stands.
- **Forward only, once.** One round per player per Daily or duel side, and a question that has been
  seen can't be skipped. A round can be picked up again, but only where it stands.
- **Leaving ends the round fairly.** Leave and closing the page tell the server. If the phone kills
  the app, the next visit does, from `localStorage` that holds only which round to end. If nobody
  comes back, the server ends it after 15 idle minutes. Either way the rest counts as wrong and the
  points already earned stay.

Duels are stricter still: see "Live duels" below. Their rounds can't be played through `/api/plays`.

Quick and topic rounds are still graded from what the browser reports (`POST /api/rounds`). They
only count towards a player's own progress and day streak, never a board or a duel.

**What this doesn't stop.** The answers still exist in the game, so someone determined can:

- build an answer key, by scripting `POST /api/questions` or just by playing, and then have a bot
  play the Daily with it. This takes minutes and scores full marks. Only questions kept out of Quick
  rounds altogether would prevent it;
- let a second account play first, since every result screen shows that round's answers;
- look an answer up in another app or ask a friend during the clock. Leaving the app counts as
  wrong, but that rule runs in the browser, so a script can ignore it (the server's clock still runs);
- see upcoming pictures, without their words, before their clock starts. Questions whose picture
  has no local copy (`npm run fetch-images`) would show its real title, so they are left out of
  the Daily and duels, and a topic with too few others can't be played as a duel.

### Pictures

| Topic | Source |
|---|---|
| Flags, capitals | [flagcdn.com](https://flagcdn.com) by country code |
| Seas & oceans | Esri World Imagery satellite tiles with a marker (no labels, so the map doesn't give the answer away) |
| Countries | The country's outline, drawn from the free [world-atlas](https://github.com/topojson/world-atlas) map data (Natural Earth). Far-off territories such as Easter Island or the Canary Islands are left out so the shape stays recognisable. |
| Elements | A periodic-table tile drawn in SVG (symbol, atomic number, mass) |
| Road signs | European signs are drawn in SVG in `public/js/signs.js`. Israeli signs are drawings of the official Ministry of Transport signs from Wikimedia Commons (public domain or CC BY-SA, see `/credits`), saved in `public/signs/il/` under their official number (`npm run fetch-signs` downloads any that are missing). Both work offline. |
| Animals, cars, landmarks, dogs, food, instruments | The lead image of the matching English Wikipedia article, fetched in the browser and cached |
| Programming | The code snippet itself |
| Paintings, human body, famous people, beauty products, professions | A specific Wikipedia/Commons image pinned by file name (`'File:…'`), each checked so no caption or label gives the answer away |
| Books | No picture: the question is shown on its own card, with five long answers |

**Download the pictures once (recommended):**

```bash
npm run fetch-images
```

This saves every Wikipedia photo, every flag and every country outline into `public/img/` (about 30 MB) and
the game then loads them from your own server: faster, works offline, and doesn't
depend on Wikipedia allowing hotlinking. It's safe to stop and re-run; finished files
are skipped (`-- --force` re-downloads everything). If a picture keeps failing, the
script tells you which Wikipedia title to fix in `shared/questions.js`.

Pictures that haven't been downloaded are still fetched live as a fallback. If a picture
fails to load mid-game, the player can skip that question and it isn't counted.
Satellite map tiles are always loaded live from Esri.

## Gameplay

- 10 questions per round, 15 seconds each (25 seconds for the book topics, which have
  long answers to read). The timer starts only once the picture has loaded.
- **1 point** for a right answer, plus a **speed bonus of 0–2**: answer in the first third of
  the time for 2, the middle third for 1, the last third for 0. A wrong answer or running out of
  time scores 0. So each question is worth 0–3 and a 10-question round up to 30 (`SCORING` in
  `shared/config.js`). Rounds played under the old 100 + 50 scoring were scored again with these
  rules when the database was upgraded.
- **Auto next** (on by default) moves to the next question by itself after a delay the
  player picks: 1 to 7 seconds, default 2. Change it during a game by tapping the
  **Auto 2s** button at the top (the game pauses while that panel is open), or under
  Settings on the Progress page. The delay is read when each countdown starts and stays
  fixed until it ends; a countdown interrupted by the panel restarts with the new value.
  The Next button fills up while it counts down, and tapping it skips the wait. Turn it off with the **Auto** switch at the top of the game
  or under Settings on the Progress page; then you tap Next yourself. The choice is saved
  to the player's account, so it follows them to every device.
- The next question's picture starts downloading as soon as the current question is on
  screen. It's requested again after you answer and when 2 seconds are left, in case the
  first try failed (the browser cache makes repeats free).
- Topic rounds prefer questions you haven't seen, then ones you got wrong, then ones you
  already know. Questions from the round you just played come last, so they don't
  come straight back.
- Quick rounds are built as a level with a set shape (`LEVEL_SLOTS` in `shared/levels.js`):
  easy openers, harder questions in the middle, a boss at question 9 and an easy closer.
  Each slot picks a topic first and then a question in its difficulty band, so big topics
  don't crowd out small ones. A level has at most 2 questions per topic, never the same topic
  twice in a row, and never two about the same country. The easy slots (1, 7 and 10) reuse
  questions you already know once there are at least 20 to choose from, starting with ones
  you haven't mastered yet. Quick rounds leave out the three book topics, programming and
  football players (`book: true` or `quick: false` in `shared/config.js`), which are only
  played from their own tiles.
- Mistakes come back in Quick rounds, marked "Back for another try", on a schedule
  (`server/review.js`). Question 8 gives a second chance at a mistake from the round you just
  played. Question 4 brings back older ones: after each right answer the next return waits at
  least 3, then 10, then 30 levels, and one more right answer ends it. A wrong answer starts
  over. A level only has these two places, so with many mistakes the returns run later: most
  of the list is mistakes on their schedule, plus the one that has waited longest. A question
  is **mastered** once it's been answered right on two different days.
- On a laptop, press **1–5** to answer, **Enter** for next and **Esc** to quit.

### How hard each question is

Every question has a difficulty from **0** (almost everyone gets it) to **10** (very few do),
judged by hand for an average adult player, in `shared/difficulty.js`. It shows as Easy (0–3),
Medium (4–6) or Hard (7–10) on the results screens, and the Daily Challenge and duels use it to
go from easy to hard. It doesn't change the points. `npm run validate` checks that every
question has exactly one rating. Once there are enough players, the share of wrong answers per
question in the `answers` table is a good way to check and adjust these ratings.

### Statistics

The Progress page shows: answers right and accuracy; day streak (and best); questions
mastered; rounds played and perfect rounds; best and average round score; most right
answers in a row; average and fastest time when right; total time played; how often you
ran out of time; this week's accuracy against the week before; your strongest and
weakest topic; per-topic mastery, accuracy and speed; the last 14 days; the questions
you miss most, with a **Practise these** button that starts a review round of them; and
recent rounds.

### Per-topic time limits

A topic can override the mode's time with `seconds` in `shared/config.js` (the book
topics use `seconds: 25`). The server grades with the same limit.

### Adding a game mode

Add an entry to `MODES` in `shared/config.js`:

```js
blitz: { name: 'Blitz', secondsPerQuestion: 7, questionsPerRound: 15 },
```

The server validates answer times against the mode's limit. Then pass the mode
into `startRound()` in `public/js/app.js` (it currently uses `DEFAULT_MODE`).

### Adding questions

Add questions to `shared/questions.js` with the helper for the matching topic, then run:

```bash
npm run validate
```

The validator checks for unique ids and five distinct options. It also checks
**answer-length fairness**: if any option is longer than five words, all five must be
similar in length (within 25% of the longest by characters, and within 4 words), so the
right answer can't be spotted by its length. Across each topic, the right answer may be
the longest (or the shortest) option in at most 30% of questions (chance is 20%), so
players can't learn to pick by length.

Text-only questions use the `book(...)` helpers in `shared/questions.js`:

```js
sapiens('slug', 'The question?', 'The right answer', ['Wrong 1', 'Wrong 2', 'Wrong 3', 'Wrong 4']),
```

History and Interesting questions use the `ask(...)` helpers (`history`, `trivia`). Add an
English Wikipedia article title as the last argument to show its lead image above the
question; leave it out for a text-only question. Pick a photo that doesn't give the
answer away (no caption or labelled map), then run `npm run fetch-images`:

```js
history('slug', 'The question?', 'The right answer', ['Wrong 1', 'Wrong 2', 'Wrong 3', 'Wrong 4'], 'Berlin Wall'),
trivia('slug', 'A text-only question?', 'The right answer', ['Wrong 1', 'Wrong 2', 'Wrong 3', 'Wrong 4']),
```

A new question also needs its Hebrew and Arabic text (see below); the validator lists
every string that is missing a translation.

## Languages

Smarts speaks English, Hebrew and Arabic. Hebrew and Arabic switch the whole layout to
right-to-left.

- **Which language shows:** the language saved on the player's account, else the one
  picked earlier on this device, else the phone or browser language, else the Google
  account's language, else English.
- **Changing it:** the language row on the sign-in screen, or the globe button on the home
  screen. There is no switch during a round.
- **Where it's saved:** in the browser (`localStorage`) and, once signed in, on the account
  (`settings.language`), so it follows the player to other devices. A language picked on
  the sign-in screen just before signing in replaces the account's saved one.

Questions are stored and graded in English. The browser shows each prompt and option
through a translation, so scores, reports and the admin page don't depend on the
language. Car models and programming-language names stay in English, and anything
without letters (years, numbers) needs no translation.

| File | What's in it |
| --- | --- |
| `public/lang/en.js` | English interface text, and the fallback for any missing key |
| `public/lang/<id>/ui.js` | Interface text (`ui`) and topic names and blurbs (`cats`) |
| `public/lang/<id>/q-*.js` | Question strings, keyed by their exact English text |
| `public/js/i18n.js` | `t()`, plurals (`tn()`), `qt()` for questions, and dates |

When one English word needs a different translation in one topic, prefix the key with the
topic id: `'trivia|Mercury'` (the planet) beats a plain `'Mercury'`. Plural keys end in
the language's plural forms (`_one`, `_two`, `_few`, `_many`, `_other`); `_other` is the
fallback.

`npm run validate` checks every language the same way it checks English: no missing
strings or interface keys, the same `{placeholders}`, five distinct options, and the
answer-length fairness rules applied to the translated options. To add a language, add
its id to `LANGUAGES` in `shared/config.js` and to the list in `public/js/i18n.js`,
create `public/lang/<id>/`, add its Google Fonts link to `FONTS` in `i18n.js` and a
`:root:lang(<id>)` font rule in `app.css`, and add it to the validator's language list.

## Data

Everything is stored in one SQLite file, `data/smarts.db` (or `$DATA_DIR/smarts.db`):
users, sessions, settings, rounds, answers, question reports, events, profiles, friends,
the Daily's questions and results, duels, Leveling stages and push subscriptions. Schema changes that need
more than a new table run once, in order, from `MIGRATIONS` in `server/db.js`
(`PRAGMA user_version` remembers which have run).

SQLite is tuned for this size: WAL mode, a 16 MB page cache, indexes for every board and list
query, and `PRAGMA optimize` every hour and at shutdown. At 100 players the busiest query (the
Daily board) reads a few hundred rows. Delete that file to reset all progress.
`data/` is git-ignored. Players can download everything stored about them, or delete
their account, at the bottom of the Progress page.

### Running it for real

Smarts is built for one server process with one SQLite database, which comfortably
handles the expected load of up to about 100 players at once: a round writes once per
10 questions, SQLite in WAL mode lets reads run alongside that write, and the server
waits up to 5 seconds for a busy database instead of failing. A separate database
server would add cost and moving parts without making it faster at this size.

1. Set `NODE_ENV=production` and `GOOGLE_CLIENT_ID`, and serve the app over HTTPS
   (cookies are marked Secure in production).
2. Keep the database on a disk that survives restarts and redeploys: set `DATA_DIR`
   to a persistent volume. On hosts with a throwaway file system, mount a volume there.
3. Back it up on a schedule, for example nightly with cron:
   ```bash
   npm run backup -- /mnt/backups 14   # copy to /mnt/backups, keep the newest 14
   ```
   The backup is safe while the server is running. Keep the copies on another disk or
   sync them off the machine. To restore, stop the server and copy a backup over
   `smarts.db` (removing `smarts.db-wal` and `smarts.db-shm`).
4. Run exactly **one** copy of the server against the database, and don't put the
   database on a network share (NFS, SMB), where SQLite's locking isn't reliable.
5. Behind a reverse proxy (Caddy, nginx, Fly.io, Railway), set `TRUST_PROXY=1` so rate
   limits count each player's own address, and `HOST=127.0.0.1` so only the proxy can
   reach Node. The server warns in its log about either setting when it looks wrong.
6. Download the question pictures on the server once (they aren't in the repository,
   since each keeps its own Wikimedia licence):
   ```bash
   npm run fetch-images
   ```
   Wikimedia rate limits downloads, so this can pause for a few minutes; leave it running.
   Or copy your local `public/img/` folder to the server instead. The Israeli road signs
   are in the repository already (`npm run fetch-signs` only repairs missing ones).
7. Point the host's health check at `GET /api/health`. It answers even when the server is
   full, and reports how many players are active.
8. Run it under a process manager that restarts it if it stops (systemd, Docker's
   `restart: always`, or the host's own).

### Player limit

At most `MAX_PLAYERS` (default 100) players use Smarts at once. A player is active from
their first request until 10 minutes pass without one. When the limit is reached, players
already in keep playing, and new visitors see a "Smarts is full right now" page that
retries every minute (API calls get `503` with a `Retry-After` header). Visitors who
haven't signed in are counted by IP address; signing in keeps the same slot.

### Profiles and avatars

Each player has a public profile: a display name (their Google first name to start with), an
avatar and, if they choose, a country. Avatars are drawn in SVG by `shared/avatars.js`: 26 skins
(animals and creatures), 9 faces, 21 backgrounds and 27 accessories, stored as a code such as
`fox-happy-lilac-crown`. 12 animals, 3 faces, 11 backgrounds and 9 accessories are open to everyone;
the 14 creature skins and the other add-ons unlock with levels, and every add-on works on every
skin. Every new player starts with a random open avatar picked from their id. Google profile photos
are never shown to other players.

The profile screen shows one list at a time (Skin, Face, Colour, Add-ons, Details). The avatar and
the tabs stay in view while a list scrolls, and Save stays above the tab bar.

### Levels

A finished round earns XP: 1 for each point, 10 for finishing it, 20 more for the Daily and 10 more
for a duel (`XP` in `shared/config.js`). A round quit halfway earns nothing. Level L takes
5 × L × (L − 1) XP in total, up to level 99:

| Level | 2 | 3 | 5 | 10 | 20 | 30 | 50 |
|---|---|---|---|---|---|---|---|
| Total XP | 10 | 30 | 100 | 450 | 1900 | 4350 | 12250 |

One finished round always reaches level 2. XP is stored on the profile, added in the same
transaction that saves the round, and players started with what their earlier rounds earned.

Each level from 2 to 20 unlocks an add-on (a face, a background or an accessory), then every 2
levels up to Ascended at 50. The 14 creature skins unlock along the way, from the wolf at level 3
to the dragon at 50. The ladders are `LADDER` and `SKIN_LEVELS` in `shared/avatars.js`. A locked skin
or add-on can be tried on in the picker but not saved, and the server refuses it too. Save then says
which level it needs, and **Take it off** puts back what was saved. An avatar a player already wears
is never taken away.

The level shows as a cover around the avatar with the number on it (`public/js/covers.js`), on the
Home header, the Daily boards, the Friends list and duels. The cover changes with the tier:
Rookie, Bronze (5), Silver (10), Gold (20), Platinum (30), Diamond (40) and Legend (50). Hidden
players' levels stay hidden on public boards. Levels never affect a board's ranking.

**Show me on public boards** (on the profile page) turns a player into a "Hidden player" on the
Daily board for everyone except their friends; friends and duel partners still see them.

### Friends

Every player has a 6-character friend code and an invite link, `/f/CODE`. Opening the link (and
signing in, if needed) asks "Add … as a friend?". Friends are mutual. The Friends tab lists them
with their current day streak and today's Daily score, plus your duels. Playing someone's duel
also makes you friends.

### Daily Challenge

The same 10 questions for everyone on a calendar day, the player's own day like Wordle (Daily #1
was 1 November 2026). The server picks them the first time someone asks for that date
(`server/pick.js`): one per topic, never two about the same country, 3 easy, 4 medium and 3 hard,
played from easy to hard, and not used in the last 90 Dailies. Book topics and programming are
left out, as in Quick rounds.

**One try:** starting it records the try; leaving halfway counts the answers given so far, and the
rest as wrong (see Fair play).
The board ranks by points, then by less time taken. A Daily round also counts in the player's
statistics and streak.

Boards stay short however many people play (`BOARD` in `shared/config.js`). Each tab starts with
10 rows, and a player further down also sees themselves with the 2 players above and below.
**Show more** adds 20 rows at a time, up to the top 50 on the Everyone tab and all friends on the
Friends tab. Only the open tab is drawn.

### Duels

Two players play the same 10 questions at the same time. A player picks mixed topics or one topic
and sends the link, `/duel/ID` (or invites a friend from the Friends tab, who gets a push). Whoever
opens it first takes the second seat, and the match starts once both are there. An invitation
stays open for 10 minutes, and the sender can leave the app to share it: if someone joins while
they're away, they get a push and the other player waits up to a minute.

Every question goes through three phases, the same for both players:

| Phase | Ends when | What a player sees |
| --- | --- | --- |
| Get ready | Both pictures are up, or after 4 s | The picture, no words yet |
| Answer | Both have answered, or the question's time limit is up | The words and options. After tapping, "Waiting for Ana…" |
| Reveal | After 3.5 s | Only their own result: right or wrong, a speed bar, the points landing on the score |

The server moves both players on, so there's no Next button. Nobody is told anything about the
other player's answers or score until the end, only that they've answered. The result screen then
compares both players question by question, with a **Rematch** button. More points wins; on equal
points, less time, and the screen then shows both times. Timings are `MATCH` in `shared/config.js`.

New duels stay away from questions either player met in their last 30 rounds. A rematch never
repeats the duel it follows unless the topic is too small.

#### Live duels: how they stay in step

`server/match.js` runs one clock for both players. Each player's side is an ordinary round in
`server/play.js`, which grades, times and saves it. Answers are only graded when the question
closes. Each player's own connection delay, measured when they acknowledge the question and capped
at 400 ms, comes off their time.

Browsers get a stream of messages (Server-Sent Events) and answer with ordinary POST requests. Every
message is that player's whole view of the match with a version number, so nothing depends on any
one message arriving.

| When | What happens |
| --- | --- |
| The signal drops for a moment | The browser reconnects and gets the current state. The clock doesn't stop |
| The connection dies silently | Both sides notice from missing heartbeats (12 s in the browser, 25 s on the server) |
| The network blocks the stream | The browser asks for the state every 2 s instead |
| A reply to an answer gets lost | The browser sends it again; the first answer stands |
| A player drops during a question | The other isn't kept waiting. The absent player scores 0 |
| A player drops between questions | Get ready waits up to 15 s, 30 s in total per player per duel, then they forfeit |
| Both players disappear | The duel ends with no winner and isn't saved as a round |
| A player switches to another app | They count as away at once: the other isn't kept waiting, and they get the same time to return as after a drop |
| A player gives up, or stays away | Only the questions played are saved. The one who left earns no XP, and the winner earns it only after at least 5 questions |
| A picture won't load for one player | That player gets no points for the question, at most twice per duel. The other plays on |
| A picture won't load for both | The question is cancelled for both |
| A second tab or device | The newest takes over |
| The server restarts | Matches carry on (they're saved at every phase change). The open question is cancelled for both |

Clocks are never compared between machines. The server times everything with a clock that only
runs forward (`server/clock.js`), so a correction to the server's time of day can't affect a question.
Browsers only ever get "this many milliseconds left" and count down on their own clock, so a phone
set to the wrong time plays the same as any other.

The whole design relies on one server process, like the rate limits. `npm test` plays all of this
with simulated players and a fake clock.

### Leveling

A path of **stages** that admins write on the dashboard (**Progress → Leveling stages**,
`#/admin/stages`). Smarts ships with none: until a stage is published, players see no sign of it.

A stage has a name and 5 to 20 questions (`STAGE` in `shared/config.js`). A question has a prompt,
one right answer, four wrong ones and, if wanted, a picture at an address the Content Security Policy
allows. New stages start as drafts, and only a stage with at least 5 questions can be published. They
live in the database (`stages`, `stage_questions`), not in `shared/questions.js`, and the text is
shown exactly as typed in whichever language it's written.

Stages open in order: clearing one opens the next, and a cleared stage can be played again. **Clearing
takes at least 70% right**, counted out of every question in the stage, so skipping can't make it
easier. A round earns its usual XP (points + 10) and the first clear of each stage earns **50 XP more**
(`XP.stageClear`), so a first clear is always worth more than a Daily. Later tries earn only the usual
XP. Trying a stage and answering nothing earns nothing.

Stages are played on the server like the Daily and duels. Each try keeps its own copy of the questions
(`plays.content`), so editing or deleting a stage can't disturb a round in progress. Results are in
`stage_results`, where setting `cleared_at` is what pays the bonus, so it can only happen once.
Stage answers count in a player's totals and day streak, but stay out of "the questions you miss most"
and the mistakes that come back in Quick rounds, and can't be reported (that's for the bank).

### Sharing

The Daily's result screen has **Share** (the phone's share sheet, or a copy on laptops),
**Copy**, and **Story image**: a 1080×1920 picture for Instagram, WhatsApp or Telegram stories,
drawn in the browser (`public/js/share.js`). The text result looks like:

```
Smarts Daily #2: 18/30 (6/10 right)
🟩🟩🟩🟩🟥🟩🟨🟥🟥⬜
https://your-site/daily
```

🟩 is a right answer in the fastest third of the time (3 points), 🟨 a slower right answer, 🟥 wrong,
⬜ not answered.

Shared links get a proper preview in WhatsApp, Telegram and other apps: the server fills in the
page's Open Graph tags for `/duel/ID` ("Ana challenged you to a duel… scored 18 out of 30"),
`/f/CODE` and `/daily`, in the sender's language, with `public/og.jpg` as the picture (kept
under 300 KB, which WhatsApp needs). Previews only work once the site is on a public address:
set `PUBLIC_URL` to it.

### Reminders

Players can turn on two push notifications under **Progress → Reminders**: "Today's Daily is
ready" (once a day at 9:00 in their time zone, if they haven't played yet, never after 21:00) and
"Friends and duels" (when a friend beats their Daily score, at most once per friend per day; when
a friend sends them a duel; and when the other player finishes a duel with them). They're sent with the standard Web Push protocol, using only Node's
built-in crypto (`server/push.js`). The server makes its push key pair once and keeps it in
`DATA_DIR/vapid.json`; keep that file (and back it up), or every player has to turn reminders on
again. Set `VAPID_SUBJECT` to a contact address. Reminders need HTTPS. On iPhone they work only
once Smarts is added to the home screen (iOS 16.4 or later).

### Events and the Players page

The `events` table logs what players do, so each new feature can be judged by its numbers.
The names are listed in `EVENTS` in `shared/config.js`:

| Event | Logged by | When |
|---|---|---|
| `round_started` | browser | a round's questions are picked and it begins |
| `round_finished` | server | a whole round is saved (quitting halfway isn't counted) |
| `helper_used` | browser | for later: a hint, skip, extra life or streak saver is used |
| `ad_offered` | browser | for later: a "Watch ad" button is shown |
| `ad_watched` | server | for later: the ad network confirms an ad was watched to the end |
| `purchase` | server | for later: the payment provider confirms a purchase |

The browser may only send the events marked `client: true`; the server logs the rest itself,
so nobody can fake a finished round, an ad view or a purchase. From server code, call
`logEvent(db, userId, name, props)` from `server/db.js`. `props` is a flat object of up to 10
short values. Events are deleted with the player's account and are in their data download.

Admins open **Progress → Players and retention** (`#/admin/players`) to see:

- players today, in the last 7 and 30 days, and daily ÷ monthly players;
- **coming back**: of the players who first played on some day, the share who played again
  exactly 1, 7 and 30 days later (only days that are over count), against the plan's goals;
- players each day for 30 days (new and returning), each calendar month for 6 months, and a
  table by the week players first played;
- each event's count for 7 and 30 days, and how many players it came from.

A player is active on a day when they played a round or logged any event. Days follow the
admin's own time zone. The page works from rounds already in the database, so it has history
from before events were added.

### Privacy policy, terms of use and photo credits

`/privacy`, `/terms` and `/credits` are plain pages (no JavaScript or sign-in needed), each in
English, Hebrew and Arabic. They pick the language from `?lang=he`, else the browser's
languages, else English. The app links to them from the sign-in screen and the Progress page
in the player's language. Give the `/privacy` and `/terms` addresses to Google's OAuth consent
screen, ad networks and app stores.

- The text of the privacy policy and terms is in `legal/<page>.<lang>.html`. Change all three
  languages together, and the "Last updated" date.
- The credits page is drawn from `legal/credits.json`: the author and licence of every
  Wikimedia picture the questions use. After adding or changing a picture, run:
  ```bash
  npm run fetch-credits
  ```
  It also lists files that aren't freely licensed (Wikipedia shows them under "fair use":
  most club crests, a few logos and some banknotes). Those need replacing or permission before
  the game earns money.

### Installing on phones

Smarts is an installable web app: `public/manifest.webmanifest` with icons in `public/icons/`
and a service worker, `public/sw.js`. On Android, Chrome offers **Install app**; on iPhone,
Safari's **Share → Add to Home Screen**.

The Progress page also shows a **Get the Smarts app** card with an **Install app** button. In
Chrome and on Android it opens the browser's install prompt; on iPhone (which has no prompt)
it shows the Add to Home Screen steps. It's hidden when Smarts is already installed or the
browser can't install it, and each player sees it on at most 20 visits to the Progress page
(`INSTALL_SHOWS` in `public/js/app.js`, counted on each device). After that, or once they
install, it doesn't come back. The service worker always loads from the network first
(so players get new versions straight away) and keeps a copy of the app's files for when
there's no connection. It needs HTTPS (or `localhost`). If you change what it caches, change
`CACHE` in `sw.js` so old copies are cleared.

### Marketing Studio

**Progress → Marketing Studio** (`#/marketing`) makes promo videos from the game itself. It's open
only to the accounts in `MARKETING_USERS` (comma-separated Google emails), and the server checks
this on every request, because the data includes right answers. Use desktop Chrome or Edge.

A video is one timeline drawn frame by frame (`public/js/studio.js`), using real questions, avatars,
level covers and translations. Arabic, English and Hebrew are the same video with identical timing,
so an editor adds sound once and it fits all three. The files have no sound on purpose.

- **Videos:** Main promo, Can you get all 3? and Levels and looks, each in 9:16, 1:1 or 16:9.
- **Your videos:** the team can put their own together from the same scene blocks (`SCENE_KINDS`
  in `studio.js`: hook, question with a tap, question the viewer guesses, level up, daily board,
  duel, skins, covers, a text-only title card and the end card). Start blank or copy a built-in
  video, then add, remove, reorder, duplicate and rename scenes. Up to 20 scenes a video. They
  save with the project, under `custom`.
- **Look:** five colour themes for the backdrop around the phone (the phone itself always shows the
  real app's colours). Each video keeps its own.
- **Editing:** turn scenes on or off, change their length, edit the words in all three languages
  (too-long text is flagged), choose the questions and set the link on the end card. Changes save
  to the server. `{questions}`, `{topics}`, `{skins}` and `{players}` fill in live numbers.
- **Preview:** one language or all three side by side, with safe zones for the apps' own buttons.
  Space plays and pauses, the arrow keys step a frame (a second with Shift), Home and End jump.
- **Record:** choose which languages and sizes to record, then one click records them all in turn,
  in real time, as MP4 (WebM if the browser can't), and checks each file's size and length. Keep
  the window in front: if it stops drawing, the recording stops and says so.
- **Post text:** a caption with hashtags for each language, saved with the video, with a copy
  button. Until you write one, it suggests one made from the video's words and link.
- **For the editor:** a timing sheet (CSV) with every cut and place a sound could go, subtitles
  (SRT) in each language, and a **storyboard** (one PNG per language with a frame from every
  scene). **Save stills** exports the current frame as a PNG in each language.
- **Project backup:** download the whole project as JSON and load it again, here or on another
  server.

Only questions with a local picture (`npm run fetch-images`) and full Hebrew and Arabic text can be
used, since a picture from another site would stop the canvas from being recorded.

### Question reports

After answering, players can tap the flag (in the answer bar or next to each answer on
the results page) to report a question: wrong or revealing picture, picture didn't
load, wrong answer, unclear wording, or something else, with an optional note. Reports
are stored in the `question_reports` table.

Admins see them under **Progress → Review question reports**, grouped by question, and
mark each one fixed or dismissed. Admins are listed in `ADMIN_USERS` (comma-separated
Google emails; dev sign-in accounts by id, such as `dev:razi`).

### Rate limits

Requests are rate limited in memory (`server/ratelimit.js`). Over a limit, the server
answers `429` with a `Retry-After` header, and the game shows the message.

| What | Limit | Counted per |
|---|---|---|
| Any API request | 300 a minute | IP address (allows a class or office sharing one Wi-Fi) |
| Any API request | 60 a minute | browser session (or IP when signed out) |
| Pages, scripts and pictures | 600 a minute | IP address |
| Sign-in | 30 per 10 minutes | IP address |
| Saving a round | 15 per 10 minutes | browser session |
| Reporting a question | 10 per 10 minutes | browser session |
| Downloading your data | 3 an hour | browser session |

### Other protections

- Security headers on every response: a strict Content Security Policy, no framing by
  other sites, `nosniff`, and in production `Strict-Transport-Security`.
- Requests that change data are refused when they come from another website.
- Request headers must arrive within 15 seconds and whole requests within 30, so slow
  clients can't tie up connections; at most 1000 connections are open at once.
- Static files are gzipped and cached: pictures for a day, everything else revalidated
  cheaply (`304 Not Modified`).

Change the numbers in `LIMITS` in `server/index.js`.

If Smarts ever needs several servers at once, the place to change is `server/db.js`:
every query is in that one file, so it can move to PostgreSQL without touching the
rest of the app.
