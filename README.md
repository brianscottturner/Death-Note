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
all times — autosaves as they type, persists for the whole game, and
isn't shared with anyone else, so investigators have somewhere to track
suspicions even during phases where they're not the one acting. The one
exception: a player sitting out an Information Phase after being
arrested can't write notes during that phase either — see Voting below.

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
2. **Missions** — the app randomly picks a Leading Investigator. The
   physical mission card for the round — not the leader — dictates team
   size (typically 3–8), difficulty, and which names get shared; the
   leader's actual choice is only who fills the team. Enter the mission's
   pass/fail result (determined by the physical cards) to award the
   point, then enter the mission card's name-sharing setting (first
   names, last names, or both) — the app then pairs everyone on the
   mission up (each
   person learns exactly one teammate's name, and has their own name
   learned by exactly one teammate), automatically avoiding pairing
   someone with a name they already know from an earlier mission whenever
   a valid rearrangement exists. Each player only sees their own pairing
   (who they learned from, and who learned from them) — never the whole
   mission's mapping.
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
   acting this round) is shown 4 suspects, one of whom is truly Kira, and
   taps Done when finished reviewing them. Meanwhile Kira and the Follower have **2 minutes** to strategize — a
   countdown is visible to everyone in the phase — and once it runs out
   their turn ends automatically (same as Kira tapping "Finished") so a
   slow Kira team can't stall the game. Only Kira — whoever currently
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
   whole game rather than resetting each phase.

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
  conditions but a different investigative tool. Instead of 4 suspects
  shown every round, N privately accuses one player per Information
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
- **Voting**: majority is a strict majority of alive players who voted
  (more than half). Ties or no majority = nothing happens.
- **Mission team size**: not validated by the app — it's whatever your
  physical mission card says, the app just lets the leader pick which
  players fill the team.
- **Death reveal**: revealing a death does not reveal the dead player's
  secret role, only that they died.
- **Name-sharing pairing**: the app randomizes single-cycle arrangements
  (everyone on the mission forms one loop of "who learns from whom") and
  keeps the best one found in ~300 tries, preferring zero repeats of
  already-known names. On a 2-person mission there's only one possible
  pairing, so a repeat there is unavoidable if they already know each
  other's name from before.

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
