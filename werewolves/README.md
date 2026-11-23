# Werewolves Moderator

A phone-based moderator for a custom Werewolves role set. Everyone plays on
their own phone, and one phone is the **speaker**. It sits in the middle of
the table and reads the game out loud ("Werewolves, wake up…"). Night actions
are tapped silently on each player's own phone, so there's no rustling.

It's static HTML/JS like the Death Note game, and it uses the same Firebase
project. Rooms are stored under `/rooms` with `edition: "werewolves"`, so the
existing database rules work unchanged and Death Note can't join a werewolf
room (or the other way round).

Once this is on GitHub Pages it lives at `<your pages URL>/werewolves/`.

## How to run a game

1. One person taps **Create New Game** and shares the room code.
2. Everyone else enters their name and the code, then taps **Join Game**.
3. Pick the speaker phone. Either:
   - on a spare phone or tablet, tap **Join as the speaker phone only**, or
   - the host taps **🔊 Make speaker** next to a player, and that player's phone talks.
4. The host picks the roles and options, then taps **Deal Roles & Start**.
5. On the speaker phone, tap **▶ Start narration**. Browsers only allow
   speech after a tap. Turn the volume up and keep that screen open.
6. Each player taps **👁 Show my role** to peek at their role privately.

At night, a player's phone only lights up with choices when it's their turn.
Otherwise it stays dark. Keep phones on silent.

The speaker has **Pause**, **Repeat** and **Skip** buttons. Skip moves on if
someone is stuck, or ends the discussion or vote early. The host's phone has
the same Skip under **Host controls**.

## Night order

Thief → Cupid → Lovers → Medic → Oracle (first night only) → Glitch →
Werewolves (with Assassin, Morphling, Cultist, Follower) → Jackal (+ Sidekick)
→ Juggernaut → Arsonist → Vigilante → Sheriff → Nice Guesser → Seer → Wizard →
Detective → Swapper → Mortician (from night 2) → Amnesiac → Witch.

Every role in the deck is called each night, including the Thief's two unused
cards and roles whose players are dead. When nobody can answer, the speaker
waits a random 9–18 seconds, so the silence doesn't give away which roles
are gone.

## Rule decisions the app makes

These are the places where the role descriptions left a choice open. Change
them in `engine.js` if you play differently.

- **Werewolf / Jackal kills**: each member votes on their phone, and teammates
  see each other's votes live. Most votes wins. Ties are broken randomly.
- **Medic shield** blocks every kill (night kills and the Hunter's shot),
  but not being voted out. It ends when the Medic dies or loses the role.
- **Witch** sees who is about to die, and can save one of them. Her own kill
  potion can't be saved.
- **Sheriff**: "villager" means anyone on the Villager team.
- **Assassin / Nice Guesser**: one guess per night. A wrong guess does nothing,
  unless the "Wrong guesses kill the guesser" option is on.
- **Cultist / Jackal recruits** take effect the next morning, so the recruited
  player still uses their old power that first night.
- **Detective** sees whether a player has ever successfully killed someone.
- **Swapper** swaps the votes *received* by the two chosen players.
- **Votes**: most votes wins. A tie, or "Skip" winning, means nobody is voted
  out. The total for each player is announced (after any Swapper swap), but
  not who voted for whom, so attentive players can try to spot the Mayor's
  extra votes.
- **Executioner**: if their target dies any way other than a vote, the
  Executioner becomes a Jester.
- **Jester / Executioner wins** end the game immediately.
- **Lovers**: if one dies, the other dies of a broken heart. If the two Lovers
  are the last two alive, they win together.
- **Winning**: Villagers win when no killers are left. A killer team
  (Werewolves, Arsonist, Jackal, Juggernaut, Glitch) wins when it's the only
  killer team left and has at least as many living players as everyone else.
- **Hunter**: the win check waits until any dead Hunter has taken their shot.

## Testing on one computer

Add `?local` to the URL (e.g. `http://localhost:8000/werewolves/?local`) to use
a fake database that lives in your browser. Open several tabs, each one a
different player, to try the game without Firebase.
