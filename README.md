# Death Note: Kira's Game — Companion App

A single-device, pass-and-play companion app for a Death Note–themed social
deduction card game (5–10 players). The app is the "moderator": it deals
secret roles and names, runs the round structure, and handles the
information-phase night actions. Missions themselves are resolved with
physical cards.

## Running it

No build step or server required — it's static HTML/CSS/JS.

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` on the one device being passed around
the table.

## Round structure

Each round has four phases, in order:

1. **Deaths** — reveals anyone killed during the previous Information Phase.
2. **Missions** — the app randomly picks a Leading Investigator, who
   selects teammates for the mission (team size comes from your physical
   mission cards, typically 3–8). Enter the mission's pass/fail result
   (determined by the physical cards) to award the point.
3. **Voting** — every alive player secretly votes to arrest a player or
   skip. A strict majority for one player arrests them (they sit out the
   next Mission Phase and next Information Phase, and must reveal their
   secret name). Arresting Kira ends the round immediately and moves to
   the final guess.
4. **Information** — L (if not sitting out) is shown 4 suspects, one of
   whom is truly Kira. Then Kira and the Follower wake, may swap the Death
   Note (not twice in a row), and may make any number of kill guesses
   (guessing a target's secret first + last name). Two wrong guesses on
   the same player makes them immune for the rest of the game.

## Win conditions

- **Kira's team** wins at 10 points, or if L is killed.
- **L's team** wins at 10 points, or if Kira is arrested and L survives
  (Kira's team then gets one shared final guess at L's full secret name;
  guessing correctly flips the win back to Kira).

## Assumptions made while building this (adjust in `app.js` if wrong)

- **Role scaling for < 10 players**: always exactly 1 L, 1 Kira, 1 Kira
  Follower, with the rest as Investigators (e.g. a 5-player game is
  1/1/1/2).
- **Voting**: majority is a strict majority of alive players who voted
  (more than half). Ties or no majority = nothing happens.
- **Mission team size**: not validated by the app — it's whatever your
  physical mission card says, the app just lets the leader pick names.
- **Death reveal**: revealing a death does not reveal the dead player's
  secret role, only that they died.
