# Death Note: Kira's Game — Companion App

A multiplayer companion app for a Death Note–themed social deduction card
game (7–10 players), each on their own phone. The app is the "moderator":
it deals secret roles and names, runs the round structure, and handles the
information-phase night actions. Missions themselves are resolved with
physical cards. Game state is synced in real time across devices via
Firebase Realtime Database; there's still no build step — it's static
HTML/CSS/JS, hosted on GitHub Pages.

## How it works

One player creates a game and gets a 6-character room code (or the host
can type their own custom code, 3-12 letters/numbers, instead — handy for
something memorable like a movie night theme; rejected if that code is
already taken by another active game); everyone else opens the app on
their own phone and enters that code to join the same session. Anyone can tap **Leave Lobby** to back out before the game
starts — if the host leaves, host status automatically transfers to
another remaining player, and if the last player leaves, the room is
deleted. Once 7–10 players have joined, the host deals roles — each phone
then privately shows only that player's own secret role and name, with no
passing required. From there the app drives the same four-phase round loop
as before, but now every device shows the view appropriate to that specific
player (e.g. only the Leading Investigator's phone shows mission team
selection; only Kira and the Follower's phones show the night-phase
strategize panel). Every player also has a private "My Notes" scratchpad
(collapsed by default, tap to open) visible below the phase content at
all times — autosaves as they type (up to 2000 characters), persists
for the whole game, and isn't shared with anyone else, so investigators
have somewhere to track suspicions even during phases where they're not
the one acting. Autosave normally waits until you stop typing for a
moment, but also saves immediately the instant you tap away from the
notes box or the app/tab gets backgrounded, so a name you jot down and
immediately act on isn't at risk of being lost before the debounce
would otherwise have fired. The one exception: a player sitting out an
Information Phase after being arrested can't write notes during that
phase either — see Voting below.

**Security note**: rooms are locked to whoever knows the room code (not
publicly listable/enumerable), but there's no true per-field secrecy
enforced server-side — Firebase's free tier has no way to verify a
"guess a name" action without exposing the underlying secret data at some
point, short of paid Cloud Functions. This matches the trust level of the
original pass-and-play design (an honor system among people already in the
room), not something built to resist a technically motivated cheater.

## Running it locally

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. For real play, though, just use the
GitHub Pages URL so everyone can join from their own phone without needing
to be on the same machine/network.

`index.html` loads `app.js` and `style.css` with a `?v=N` cache-busting
query string. GitHub Pages doesn't reliably bust browser caches on its
own, so bump that version number on any deploy that changes `app.js` or
`style.css` — otherwise some phones may keep running stale JS after a
fix ships. The landing screen shows the running `APP_VERSION` (set near
the top of `app.js`) in small text below the Join Game button — when a
bug report only affects some players' phones, checking that number is the
fastest way to tell a stale-cache issue apart from a real one. Bump
`APP_VERSION` in `app.js` together with the `?v=N` numbers in `index.html`
so the on-screen label always matches what's actually being served.

## Round structure

Each round has four phases, in order:

1. **Deaths** — reveals anyone killed during the previous Information Phase.
2. **Missions** — the app randomly picks a Leading Investigator and draws
   two Mission Cards from a shuffled digital deck (Black or White,
   sized to the game's player count). The leader picks one of the two
   to play this round — the other is discarded, permanently, not
   returned to the deck. The chosen card is then shown to everyone,
   along with the exact team size it requires, its points threshold, and
   which names get shared once it resolves. The leader's only other real
   choice is *who* fills the team; the app enforces the card's team
   size directly (the Confirm button won't unlock until exactly that
   many are picked). Once confirmed, **every player** (not just the
   proposed team) votes Yes or No on whether it goes forward — a public
   vote, so everyone sees who voted which way. A strict majority
   approves it (a tie counts as No). If it's voted down, that team
   dissolves and the app picks a new Leading Investigator — same
   Mission Card, same requirements, fresh team — for another attempt.
   Reject a *second* team on the same card and it auto-fails outright
   (Kira's team scores the point as normal) rather than trying a third
   time. Once a team is approved, every player on the mission secretly
   plays one or more Supply Cards from their own hand face-down (at
   least one each, unless their hand is empty) into the mission — Gray
   always helps the running total, and Black/White help when they match
   the Mission Card's color and hurt when they don't, which is the
   Kira team's quiet way to sabotage a mission without ever being
   identified. Once everyone's played, the app reveals the total count
   of each color played and the resulting total against the card's
   points threshold — never who played what — and awards the point
   automatically. The leader then draws (team size + 1) fresh Supply
   Cards and hands them back out to the team (including themself,
   capped at 3 cards per person); anything left over is discarded.
   Finally, every player on the mission privately picks *one* teammate
   to share their own name with (the Mission Card's name-share type
   determines what part gets shared — first name, last name, or both).
   Only teammates who don't already know that part of your name from an
   earlier mission are offered as valid picks; picking is a private,
   one-shot choice — once submitted it can't be changed. Because it's a
   free choice rather than an app-computed pairing, the outcome isn't
   symmetric: someone can end up learned by several teammates at once,
   or by no one at all, which is the point — it turns name-sharing into
   a trust decision instead of a random draw. A player with no valid
   targets (everyone already knows their name) is silently skipped.
   Each player only sees their own pick and whoever chose to share with
   them — never the whole mission's picks.
3. **Voting** — every alive player secretly votes to arrest a player or
   skip. A strict majority for one player arrests them, and must reveal
   their secret name. Since Information Phase is the very next phase
   after Voting, "sitting out the next Information Phase" means *this*
   round's — arrested players lose all access to it for that one phase:
   no acting (no L/N suspects, no Kira-team panel, no Mello steal
   attempt), and even private notes are locked (read-only becomes
   unavailable entirely) until the phase ends. They also can't be picked
   for the *following* round's Mission team — the leader won't even see
   them as an option. Both restrictions are one-time; normal access
   returns immediately after. Arresting Kira ends the round immediately
   and moves to the final guess instead of a normal Information Phase.
4. **Information** — L (if not sitting out) and Kira's team act **at the
   same time**, each on their own device, rather than waiting on each
   other — the round only advances once both sides are finished. L (if
   acting this round) is shown a suspect list, one of whom is truly
   Kira, and taps Done when finished reviewing them — **4 suspects**
   (Kira + 3 others) once 8+ players are alive, but only **3** (Kira +
   2 others) once the game is down to 7 alive, so L doesn't end up
   knowing nearly everyone in a small game. If deaths ever shrink the
   eligible pool (alive, not L, not Kira, not Watari) below even that,
   the list just shrinks to fit whoever's actually left rather than
   padding it out. Meanwhile Kira and the Follower have **2 minutes** to strategize — it
   runs silently in the background rather than as a live-updating
   countdown on screen (that turned out to be disruptive during real
   playtesting), so all anyone sees is a single "30 seconds left" notice
   near the end. Once time actually runs out, their turn ends
   automatically (same as Kira tapping "Finished") so a slow Kira team
   can't stall the game. Only Kira — whoever currently
   holds the Death Note — can act: swap the Note with the Follower (not
   twice in a row), make kill guesses (guessing a target's secret first +
   last name) up to **2 successful kills per Information Phase** — the
   form locks once that cap is hit, though wrong guesses don't count
   against it — or end the team's turn early. Two wrong guesses on the
   same player makes them immune for the rest of the game. The Follower
   can't do any of that; their role during this phase is to chat and
   strategize, not to act directly — if Kira swaps the Note with them,
   *then* they can. Kira and the Follower know each other's identity from
   the very start (shown on the role reveal screen), and get a private
   text chat, visible only on their two devices, that persists for the
   whole game rather than resetting each phase. The chat panel itself is
   available for the entire game, not just during the Information Phase
   (the **2 minute timer stays Information-Phase-only** and governs
   Kira's kill guesses/swap/ending the phase, same as before) — Kira and
   the Follower can message each other at any point during Deaths,
   Missions, or Voting too.

## Win conditions

- **Kira's team** wins at 10 points, or if L is killed.
- **L's team** wins at 10 points, or if Kira is arrested and L survives
  (Kira's team then gets one shared final guess at L's full secret name;
  guessing correctly flips the win back to Kira).

## Expansions

Before dealing roles, the host can tap **🎭 Expansions & Roles** in the
lobby to opt into extra roles. This panel is host-only. Choices are
locked in once **Deal Roles & Start** is tapped.

Each expansion role has three settings, not just an on/off switch:

- **On** — guaranteed to be in the game.
- **Off** — guaranteed not to be in the game.
- **Random** — a 50/50 coin flip, decided independently for that role
  the moment roles are dealt. The app never announces which way a
  Random role landed — not to the host, not to anyone — so a game with
  a role set to Random carries real uncertainty about whether it's in
  play at all. (Non-host players only see a lobby hint for roles set to
  **On**; Random and Off both stay silent pre-game, on purpose.)

- **Task Force — Watari**: an Investigator in every practical sense
  (votes, joins missions, has a secret name to protect) with one twist —
  Watari knows L's identity from the start, and L knows Watari's. Because
  L already knows Watari isn't Kira, Watari is never one of the 4
  suspects L is shown each Information Phase. If Kira successfully kills
  Watari, L's team immediately loses 3 points (never dropping below 0),
  and everyone — including L, Kira, and the Follower — sees a special
  notice in the next Deaths Phase: "Watari has died... All data
  deletion." (It's shown to everyone rather than just the Investigators
  so that L/Kira/Follower not reacting to it doesn't itself look
  suspicious.)
- **Task Force — NPA Chief**: a normal Investigator on L/N's team, bound
  to their post — they can **never vote to skip**, always naming someone.
  If a vote ever fails to reach a majority, the Chief may force an
  arrest anyway, choosing only from whoever actually led that vote (the
  tied-for-most non-skip candidates) — or let it go, if they don't like
  the odds. This only ever fires when the town's own vote produced
  nothing (no majority); it never overrides an actual majority decision,
  so a decisive town keeps full control and the Chief only steps in to
  turn a wasted round into action. A forced arrest carries every normal
  consequence — sit-out, the Kira endgame trigger, Mello's elimination —
  identically to a majority arrest.
- **Task Force — Misa**: replaces the Kira Follower. Knows Kira's
  identity from the start and plays like a normal Follower (chat, Death
  Note swap, everything) — with one added power: **Shinigami Eyes**,
  usable **once for the entire game**. Misa picks any other player
  (including L/N or Watari — nothing is off-limits) and picks either
  their first name or their last name; the app reveals it to her
  instantly, no mission needed. Using it costs her **the rest of that
  Information Phase** — no chat, no kill guess, no Death Note swap for
  her that round, though Kira can still act and end the team's turn
  normally. It's genuinely a one-time trade: once spent, it's gone for
  the rest of the game, even across later Death Note swaps. Structurally
  Misa *is* the Follower (same seat as any Kira Follower), so she
  requires an actual Follower to exist — she has no effect in a game
  where X-Kira ends up active, since X-Kira starts without one.

This expansion's three roles — Watari, NPA Chief, and Misa — are all
implemented.
- **Special Provisions for Kira — X-Kira**: replaces the normal Kira
  role. Plays exactly like Kira (same kill guesses, same win conditions)
  but starts with **no Follower** — X-Kira is alone. Once L's team
  reaches 3 points, a **Recruit a Follower** panel appears once on
  X-Kira's phone during that round's Voting Phase: X-Kira picks 2
  players, and the app randomly recruits one of them. This is a
  **one-time power** — whether or not X-Kira uses it that round, the
  panel never reappears afterward. L and Watari can't be recruited — if
  exactly one of the two picks is L or Watari, the app recruits the
  other pick instead of rolling randomly; if X-Kira happens to pick
  *both* L and Watari, the app recruits a random third player instead
  and tells X-Kira only that "the two people you chose to recruit were
  L and Watari" (naming the two picks, but not which one is which — no
  identities are revealed). Once someone is recruited, they become a
  normal Kira Follower for the rest of the game (chat, Death Note swap,
  everything). Only one of this expansion's Kira-replacing roles can be
  active per game.
- **Special Provisions for Kira — Mello**: a third, neutral role — not
  L's team, not Kira's. Mello wins alone, by stealing the Death Note and
  becoming the new Kira. During each Information Phase, Mello can guess
  which player currently holds it; guess right, and roles swap — Mello
  becomes Kira, and the old Kira becomes the new Mello, with a fresh set
  of attempts of their own (this can go back and forth more than once).
  The old Kira's Follower stays put and simply keeps following whoever
  the *current* Kira is. Mello gets **2 attempts total, for as long as
  the role is theirs** — fail both, and they're eliminated; get
  arrested, and they're eliminated too (a neutral has no round to "sit
  out"). Combines freely with Watari or X-Kira.
- **Special Provisions for Kira — N**: replaces L, with the same win
  conditions but a different investigative tool. Instead of a suspect
  list shown every round, N privately accuses one player per Information
  Phase: an innocent is **cleared for good** (permanent, cumulative,
  shown as a running list on N's own phone); Kira or the Follower gives
  **no confirmation either way** — silence is itself a clue, since it
  narrows things to "one of these two"; and Mello (if he's in the game)
  is **identified by name** to N outright. N gets a limited number of
  **Definitive Clears** for the whole game — **2 with 7-8 players, 3
  with 9-10** — but accusing Kira, the Follower, or Mello never spends
  one, since none of those produce an ordinary "clear." Once the budget
  of ordinary clears is spent, further accusations of innocents just
  return no new information, so N can always keep investigating without
  risk, they just stop learning anything new about regular players.
  Structurally N *is* L (same seat, same Watari bond, same
  recruit-immunity for X-Kira, same "sit out a round" arrest, same
  endgame guess) — only the Information Phase and some display text
  change. Combines freely with the rest of this expansion.

This expansion's three roles — X-Kira, Mello, and N — are all
implemented.

- **House Rules — Event Cards**: a deck of 5 narrative twists, each keyed
  to a specific L/N score (**2, 4, 5, 6, 8**) — the moment that many
  points is reached, the matching card fires **automatically and
  exactly once**, revealed to everyone the instant the threshold is
  actually crossed, not whenever the next Deaths Phase happens to come
  around. In practice that's one of two exact moments: right after the
  Mission Phase ends (a mission's own success is the normal way L's/N's
  score moves), or right after the Information Phase ends (the only other
  way it can move, via Card #6's own +2 penalty below). Either way the
  reveal interrupts whatever phase would normally come next — Voting or
  Deaths — until it's dismissed. If a single jump crosses more than one
  untriggered threshold at once (Card #6's own +2 penalty can do this),
  every newly-crossed card queues up and gets revealed one at a time,
  lowest-numbered first, before the round can continue. Uses the same
  three-way toggle as every other expansion: On = every card is live for
  the whole game; Off = none of them exist; Random = a single coin flip
  at deal time decides whether the whole deck is in play, never
  announced either way.
  - **#2 — Kira Video Messages**: for the mission that follows, every
    Supply Card played counts as a flat **+1**, no matter its color —
    the normal +2 (matches the Mission Card's color) / −2 (doesn't
    match) / +1 (Gray) split is suspended for that one mission only.
  - **#4 — Shinigami Eyes**: the whole team votes on who they trust
    most (highest vote count wins, ties broken randomly) — no majority
    required, just plurality. The winner then privately picks one other
    player and instantly learns their **full real name** (first and
    last together, unlike Misa's power which only ever reveals one
    part). Who they looked at, and what they learned, is never shown to
    anyone else.
  - **#5 — Voluntary Confinement**: the whole team votes for one player
    each (again by plurality, ties broken randomly); the two
    highest-voted are locked up — same practical consequence as an
    arrest (sit out the next mission and Information Phase) but with
    neither of an arrest's usual teeth: **no secret name is ever
    revealed**, and **the game doesn't end** even if one of the two
    happens to be Kira.
  - **#6 — Lint L Taylor Trap**: for the Information Phase that follows,
    if Kira's team doesn't land a successful kill (whether they don't
    try, or try and guess wrong), L's/N's team gets **+2 points** —
    checked once, right as that phase ends.
  - **#8 — Vindicating Evidence**: the very next Voting Phase has no
    Skip option. If it still doesn't produce a true majority, whoever
    got the most votes is arrested anyway (random tie-break if needed)
    — someone is always named that round.

## Notes

- **Players**: 7–10. Always exactly 1 L, 1 Kira, 1 Kira Follower, with the
  rest as Investigators (e.g. a 7-player game is 1/1/1/4). Add 1 Watari
  and/or 1 NPA Chief if the Task Force expansion is enabled, and 1 Mello
  if enabled. If Misa is enabled (and X-Kira isn't), she simply takes
  the Kira Follower slot. If
  X-Kira is enabled instead of normal Kira, there's no Follower
  until/unless one gets recruited mid-game, so the initial split is 1 L,
  1 X-Kira, and everyone else an Investigator (plus Watari/Mello, if
  those are also enabled) — Misa has no effect in this case, since she
  needs a Follower to replace. If N is enabled, N simply takes the L
  slot — everything else about the split is unchanged.
- **Playtest cheat mode**: creating a game with the exact custom room
  code `04KI26` quietly turns on a host-only panel for manually picking
  which player gets which role, instead of the normal random deal —
  handy for setting up a specific scenario without redrawing until it
  happens by chance. Nothing about it is visible to anyone but the host:
  other players just see the ordinary "waiting for the host to start"
  lobby text throughout, with no indication a cheat panel exists or is
  open. The confirm button stays disabled until every player has a role
  and the counts exactly match what the game's expansion settings
  require (still resolving On/Off/Random the normal way first); a
  Cancel button backs out to the ordinary lobby without dealing
  anything.
- **Voting**: majority is a strict majority of alive players who voted
  (more than half). Ties or no majority = nothing happens.
- **Mission team size**: enforced by the app, driven by the round's
  drawn Mission Card — the leader can only confirm a team once it's
  exactly the required size.
- **Mission Card deck**: 52 cards (26 Black + 26 White, White a straight
  mirror of Black), filtered per game to only the cards whose team size
  fits the current player count, then shuffled. Two cards are drawn
  fresh each round and offered to the leader, who picks one to play —
  the unpicked card is discarded and never returns to the deck. The
  chosen card stays fixed for the round regardless of how many team
  proposals get rejected. If a game somehow outlasts the deck, it
  reshuffles and keeps going.
- **Supply Card deck**: 45 cards (15 Black, 15 White, 15 Gray), shared
  by the whole table for the entire game. Every player is dealt 3 cards
  at game start and holds a hand of at most 3 at any time. Gray always
  adds +1 to a mission's running total; Black/White add +2 when they
  match the Mission Card's color and subtract 2 when they don't. Played
  cards go to a shared discard pile; if the deck ever runs dry mid-draw,
  the discard pile is shuffled into a fresh deck automatically.
- **Card art**: Mission and Supply Cards render using the actual
  designed artwork (`cards/mission-black.png`, `mission-white.png`,
  `supply-black.png`, `supply-white.png`, `supply-gray.png`), not plain
  buttons. The Mission Card's variable values (team size, points, and
  who gets named) are overlaid live on top of the printed blanks; the
  Supply Cards need no overlay since each color's value never changes.
- **Death reveal**: revealing a death does not reveal the dead player's
  secret role, only that they died.
- **Phase-advance "Continue" buttons**: every button that moves the whole
  table forward (after Deaths, after a team vote resolves, after a
  mission result, after name-sharing resolves, after a Voting Phase
  resolves) is host-only — everyone else sees a plain "Waiting for the
  host to continue..." message instead. Earlier, any player's phone
  showed that button and any tap by anyone advanced the round for the
  whole table, which made it easy for two people to both reach for it at
  once. Buttons for a specific role's own action (Kira finishing the
  Information Phase, N accusing, Mello attempting a steal, the mission
  leader redistributing cards) are unaffected — those still belong to
  whoever holds that role, not the host.
- **Name-sharing picks**: each player privately chooses which teammate
  to share their own name with, offered only teammates who don't
  already know that name part — the app never assigns pairings. Picks
  are recorded via a submission marker separate from the pick itself
  (a player with zero valid targets is still marked "submitted" with no
  real pick), since an empty pick and a not-yet-made pick both look
  like "nothing here" to Firebase. Once every team member has
  submitted, all picks resolve together, at which point players learn
  who chose to share with them and see their own confirmed pick.

## Firebase setup

`firebase-config.js` holds the project's public web config (safe to be
public — Firebase's actual security is enforced by its Rules, not by
hiding this file). `firebase-init.js` wires that config up to the
Realtime Database + Anonymous Auth SDKs loaded from Google's CDN.

Requires, in the Firebase console for this project:
- **Authentication → Sign-in method → Anonymous**: enabled.
- **Realtime Database → Rules**, set to:
  ```json
  {
    "rules": {
      "rooms": {
        "$roomCode": {
          ".read": "auth != null",
          ".write": "auth != null"
        }
      },
      ".read": false,
      ".write": false
    }
  }
  ```
  This locks every room to people who know its 6-character code (Realtime
  Database has no way to list/enumerate `/rooms` without a rule granting
  that separately, which this doesn't), while keeping the app serverless.
