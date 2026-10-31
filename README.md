# Smarts

A picture quiz built for phones (it works on laptops too). Sign in with Google, play
10-question rounds against a 15-second clock, and track what you've mastered.

**715 questions in 24 topics:** flags (40), capitals (30), seas & oceans (25),
road signs (70: 20 European, 50 Israeli), animals (25), cars (15), programming languages (20), landmarks (25),
dog breeds (40), world food (40), countries (40), chemical elements (40),
musical instruments (40), paintings (30), famous books (15: bestsellers published after
2000 with over 1.5 million Goodreads ratings, named from a plot description),
human body (20), famous people (20), beauty products (10),
professions (10), history (40) and interesting questions (30), which mix
photo and text-only questions, and three book topics with text-only questions:
*Sapiens* by Yuval Noah Harari (30), *Atomic Habits* by James Clear (30) and
*The Art of Saying No* by Damon Zahariades (30).

## Run it

You need **Node.js 22.13 or newer** (`node -v`). There is nothing to install: the app
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
| POST | `/api/rounds` | `{ mode, category, answers: [{ id, choice, ms }] }` — graded on the server |
| GET | `/api/stats` | Totals, per-topic mastery, streaks, last 14 days, recent rounds |
| GET | `/api/account/export` | Everything stored about the user, as a JSON download |
| DELETE | `/api/account` | Deletes the user and all their data |

The server grades every answer itself from `shared/questions.js`, so the browser
can't post a fake score.

### Pictures

| Topic | Source |
|---|---|
| Flags, capitals | [flagcdn.com](https://flagcdn.com) by country code |
| Seas & oceans | Esri World Imagery satellite tiles with a marker (no labels, so the map doesn't give the answer away) |
| Countries | The country's outline, drawn from the free [world-atlas](https://github.com/topojson/world-atlas) map data (Natural Earth). Far-off territories such as Easter Island or the Canary Islands are left out so the shape stays recognisable. |
| Elements | A periodic-table tile drawn in SVG (symbol, atomic number, mass) |
| Road signs | European signs are drawn in SVG in `public/js/signs.js`. Israeli signs are the official Ministry of Transport drawings (public domain, from Wikimedia Commons), saved in `public/signs/il/` under their official number (`npm run fetch-signs` downloads any that are missing). Both work offline. |
| Animals, cars, landmarks, dogs, food, instruments | The lead image of the matching English Wikipedia article, fetched in the browser and cached |
| Programming | The code snippet itself |
| Paintings, human body, famous people, beauty products, professions | A specific Wikipedia/Commons image pinned by file name (`'File:…'`), each checked so no caption or label gives the answer away |
| Famous books | No picture (their covers show the title and are copyrighted): a plot description that never uses a word from the title |
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
- 100 points for a right answer, plus up to 50 for speed.
- **Auto next** (on by default) moves to the next question by itself after a delay the
  player picks: 1 to 7 seconds, default 4. Change it during a game by tapping the
  **Auto 4s** button at the top (the game pauses while that panel is open), or under
  Settings on the Progress page. The delay is read when each countdown starts and stays
  fixed until it ends; a countdown interrupted by the panel restarts with the new value.
  The Next button fills up while it counts down, and tapping it skips the wait. Turn it off with the **Auto** switch at the top of the game
  or under Settings on the Progress page; then you tap Next yourself. The choice is saved
  to the player's account, so it follows them to every device.
- The next question's picture starts downloading as soon as the current question is on
  screen. It's requested again after you answer and when 2 seconds are left, in case the
  first try failed (the browser cache makes repeats free).
- Rounds prefer questions you haven't seen, then ones you got wrong, then ones you
  already know. Questions from the round you just played come last, so they don't
  come straight back. Quick rounds take at most 2 questions per topic, bring back 3–5
  questions you got wrong in your last 10 rounds (never from the round just played),
  and leave out the three book topics, which are only played from their own tiles.
- On a laptop, press **1–5** to answer, **Enter** for next and **Esc** to quit.

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
users, sessions, settings, rounds and answers. Delete that file to reset all progress.
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
