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
4. The host checks off the cards you're playing with and sets the options.
   Then shuffle and deal your physical cards. With a Thief, put the 2 leftover
   cards face down in the middle. Every role has one card, except Villager.
5. The host taps **Start: everyone enters their card**. Each player privately
   taps the role on their card. The app won't let two people enter the same
   role (unless it's Villager). When everyone's done, the host taps
   **Begin the game**.
6. On the speaker phone, tap **▶ Start narration**. Browsers only allow
   speech after a tap. Turn the volume up and keep that screen open.
7. During the game, anyone can tap **👁 Show my role** to check their role and
   private info (Lovers, targets, potions, messages).

At night, a player's phone only lights up with choices when it's their turn.
Otherwise it stays dark. Keep phones on silent.

The speaker has **Pause**, **Repeat** and **Skip** buttons. Skip moves on if
someone is stuck, or ends the discussion or vote early. The host's phone has
the same Skip under **Host controls**.

## Night order

**First night only:** Thief → Cupid → Lovers → Medic → Oracle → Executioner →
Cultist → Jackal (recruits a Sidekick)

**Every night (including the first, right after the list above):** Glitch →
Werewolves (all of them together) → Assassin → Juggernaut → Arsonist → Jackal
and Sidekick → Seer → Wizard → Detective → Sheriff → Witch → Nice Guesser →
Vigilante → Swapper → Mortician (from night 2) → Amnesiac

**Extra turns on later nights:**
- The Medic or Oracle is called at the start of the night after someone newly
  becomes one (an Amnesiac copying a dead one), so they can place their shield
  or choose a target.
- From night 2 on, the Executioner is called again after the Amnesiac every
  night. If their target died outside a vote, they're an Amnesiac now and make
  their prediction then.

Because recruits take effect immediately, a Follower the Cultist recruits on
night 1 already wakes with the werewolves that night. Likewise, a new Sidekick
joins the Jackal's kill that night.

Every role in the deck is called each night, including the Thief's two unused
cards and roles whose players are dead. When nobody can answer, the speaker
waits a random 9–18 seconds, so the silence doesn't give away which roles
are gone.

## Rule decisions the app makes

These are the places where the role descriptions left a choice open. Change
them in `engine.js` if you play differently.

- **Werewolf / Jackal kills**: each member votes on their phone, and teammates
  see each other's votes live. Most votes wins. Ties are broken randomly.
- **Medic shield** is placed on the first night. If someone becomes the Medic
  later (an Amnesiac copying a dead Medic), they wake the next night to place
  their own shield. The shield blocks every kill (night kills and the Hunter's shot),
  but not being voted out. It ends when the Medic dies or loses the role.
- **Witch** sees who is about to be killed by the werewolves or a neutral
  killer, and can save one of them. She never sees or saves victims of
  Villager-team killers (Sheriff, Vigilante, Nice Guesser), her own kill potion,
  or a guesser who dies from a wrong guess. If a saved player was also
  targeted by a Villager-team killer, they still die.
- **Sheriff**: "villager" means anyone on the Villager team.
- **Assassin / Nice Guesser**: one guess per night. A wrong guess kills the
  guesser.
- **Cultist / Jackal recruits** take effect immediately. The recruited player
  loses their old power right away, even if that role hasn't woken up yet that
  night.
- **Detective** sees whether a player has ever successfully killed someone.
- **Swapper** swaps the votes *received* by the two chosen players.
- **Votes**: most votes wins. A tie, or "Skip" winning, means nobody is voted
  out. The total for each player is announced (after any Swapper swap), but
  not who voted for whom, so attentive players can try to spot the Mayor's
  extra votes.
- **Executioner**: if their target dies any way other than a vote, the
  Executioner becomes an Amnesiac. The Executioner has their own turn every
  night ("Executioner, wake up"), right after the Amnesiac. While their target
  is alive, their phone just says there's nothing to do. Once they've become an
  Amnesiac, they make their prediction there, so they never wake with the
  original Amnesiac.
- **Oracle** works like the Medic: if someone becomes the Oracle later (an
  Amnesiac copying a dead Oracle), they wake the next night to choose a target.
- **Jester / Executioner wins** end the game immediately.
- **Lovers**: if one dies, the other dies of a broken heart. If both Lovers are
  alive when 3 or fewer players are left, they win together.
- **Winning**: Villagers win when no killers are left. A killer team
  (Werewolves, Arsonist, Jackal, Juggernaut, Glitch) wins when it's the only
  killer team left and has at least as many living players as everyone else.
- **Hunter**: the win check waits until any dead Hunter has taken their shot.

## Testing on one computer

Add `?local` to the URL (e.g. `http://localhost:8000/werewolves/?local`) to use
a fake database that lives in your browser. Open several tabs, each one a
different player, to try the game without Firebase.
