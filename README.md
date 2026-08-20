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
suspicions even during phases where they're not the one acting.

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
fix ships.

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
   skip. A strict majority for one player arrests them (they sit out the
   next Mission Phase and next Information Phase, and must reveal their
   secret name). Arresting Kira ends the round immediately and moves to
   the final guess.
4. **Information** — L (if not sitting out) and Kira's team act **at the
   same time**, each on their own device, rather than waiting on each
   other — the round only advances once both sides are finished. L (if
   acting this round) is shown 4 suspects, one of whom is truly Kira, and
   taps Done when finished reviewing them. Meanwhile Kira and the Follower have **2 minutes** to strategize — a
   countdown is visible to everyone in the phase — and once it runs out
   their turn ends automatically (same as tapping "Finished") so a slow
   Kira team can't stall the game. They may swap the Death Note (not
   twice in a row), and may make kill guesses
   (guessing a target's secret first + last name) up to **2 successful
   kills per Information Phase** — the form locks once that cap is hit,
   though wrong guesses don't count against it. Two wrong guesses on the
   same player makes them immune for the rest of the game. Kira and the
   Follower also know each other's identity from the very start (shown on
   the role reveal screen), and get a private text chat, visible only on
   their two devices, that persists for the whole game rather than
   resetting each phase.

## Win conditions

- **Kira's team** wins at 10 points, or if L is killed.
- **L's team** wins at 10 points, or if Kira is arrested and L survives
  (Kira's team then gets one shared final guess at L's full secret name;
  guessing correctly flips the win back to Kira).

## Expansions

Before dealing roles, the host can tap **🎭 Expansions & Roles** in the
lobby to opt into extra roles. This panel is host-only — everyone else
just sees a note if an expansion is active, so there's no confusion about
who controls it. Choices are locked in once **Deal Roles & Start** is
tapped.

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
  suspicious.) The Task Force expansion will eventually add two more
  roles; only Watari is implemented so far.

## Notes

- **Players**: 7–10. Always exactly 1 L, 1 Kira, 1 Kira Follower, with the
  rest as Investigators (e.g. a 7-player game is 1/1/1/4). Add 1 Watari
  if the Task Force expansion is enabled.
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
