// Every role has one card, except Villager and Werewolf (`multi`), which have several.
// Role and team definitions for the custom Werewolves role set.
// `team` is the team a role plays for. `selectable: false` roles can't be put
// in the deck directly; they're only created by another role's power
// (Follower by the Cultist, Sidekick by the Jackal).

export const TEAMS = {
  village:     { name: 'Villagers',    color: '#4fa36b' },
  wolves:      { name: 'Werewolves',   color: '#c0392b' },
  jester:      { name: 'Jester',       color: '#c76bd6' },
  executioner: { name: 'Executioner',  color: '#8e8e8e' },
  amnesiac:    { name: 'Amnesiac (undecided)', color: '#5aa9c9' },
  arsonist:    { name: 'Arsonist',     color: '#e67e22' },
  jackal:      { name: 'Jackal',       color: '#d4ac0d' },
  juggernaut:  { name: 'Juggernaut',   color: '#7f3f98' },
  glitch:      { name: 'Glitch',       color: '#2ecc71' },
  thief:       { name: 'Undecided',    color: '#999999' },
};

// Teams that kill at night. The Villagers can't win while any of these are alive.
export const KILLER_TEAMS = ['wolves', 'arsonist', 'jackal', 'juggernaut', 'glitch'];
// Neutral killers. The Cultist can't recruit them.
export const NEUTRAL_KILLER_TEAMS = ['arsonist', 'jackal', 'juggernaut', 'glitch'];
// Roles that wake up with the werewolves. A Sidekick who used to be a
// werewolf also wakes with them; that's handled separately.
export const WOLF_WAKERS = ['werewolf', 'assassin', 'morphling', 'cultist', 'follower'];

export const ROLES = {
  // ---- Villager team ----
  villager:    { name: 'Villager', team: 'village', multi: true,
    desc: 'No special ability. Find the werewolves and vote them out.' },
  hunter:      { name: 'Hunter', team: 'village',
    desc: 'When you die, you get to kill someone along with yourself.' },
  seer:        { name: 'Seer', team: 'village',
    desc: "Each night, you see one player's role." },
  witch:       { name: 'Witch', team: 'village',
    desc: 'You have one save potion and one kill potion for the whole game, used at night. You see who the werewolves and neutral killers are about to kill before you choose.' },
  cupid:       { name: 'Cupid', team: 'village',
    desc: 'On the first night, you secretly choose two Lovers. If one Lover dies, the other dies of a broken heart. If both Lovers are alive in the final 3, they win together, and you win with them.' },
  wizard:      { name: 'Wizard', team: 'village',
    desc: 'Each night, choose two players and learn whether they are on the same team or different teams.' },
  medic:       { name: 'Medic', team: 'village',
    desc: "On the first night, shield one other player (not yourself). They are protected from all kills until you die." },
  vigilante:   { name: 'Vigilante', team: 'village',
    desc: 'Once per game, on any night, you may kill someone with no consequences.' },
  sheriff:     { name: 'Sheriff', team: 'village',
    desc: 'Each night you may try to kill someone. If they are on the Villager team, you die instead.' },
  dictator:    { name: 'Dictator', team: 'village',
    desc: 'Your vote never counts, unless you announce you are using your power. Then whoever you vote for is lynched immediately, and you die too.' },
  swapper:     { name: 'Swapper', team: 'village',
    desc: "Each night you may pick two players. In the next day's vote, the votes cast against those two are swapped." },
  oracle:      { name: 'Oracle', team: 'village',
    desc: "On the first night, choose a target. When you die, your target's role is revealed to everyone." },
  detective:   { name: 'Detective', team: 'village',
    desc: 'Each night, investigate a player to learn whether they have killed someone.' },
  niceGuesser: { name: 'Nice Guesser', team: 'village',
    desc: "Each night you may guess a player's role. If you're right, they die. If you're wrong, you die." },
  mayor:       { name: 'Mayor', team: 'village',
    desc: 'Your vote secretly counts as 3 votes.' },
  mortician:   { name: 'Mortician', team: 'village',
    desc: "While a Mortician is in the game, roles aren't revealed when players die. Each night, you learn the roles of all dead players." },
  altruist:    { name: 'Altruist', team: 'village',
    desc: "Each morning, after the night's victims are named but before their roles are revealed, you may sacrifice yourself to revive one of them." },

  // ---- Werewolf team ----
  werewolf:    { name: 'Werewolf', team: 'wolves', multi: true,
    desc: 'Each night, wake up with the werewolves and agree on someone to kill. You can even target a fellow werewolf.' },
  assassin:    { name: 'Assassin', team: 'wolves',
    desc: "Wakes up with the werewolves. Each night you may also guess a player's role. If you're right, they die. If you're wrong, you die." },
  morphling:   { name: 'Morphling', team: 'wolves',
    desc: 'Wakes up with the werewolves. The Seer, Wizard and Detective see you as an innocent Villager.' },
  cultist:     { name: 'Cultist', team: 'wolves',
    desc: "Wakes up with the werewolves. On the first night, recruit one player to become your Follower. Recruiting a neutral killer does nothing." },
  follower:    { name: 'Follower', team: 'wolves', selectable: false,
    desc: 'You were recruited by the Cultist. You lost your old power and are now a werewolf. You wake up with the werewolves.' },

  // ---- Neutral ----
  jester:      { name: 'Jester', team: 'jester',
    desc: 'If you get voted out, you win.' },
  executioner: { name: 'Executioner', team: 'executioner',
    desc: 'You are given a random Villager-team target. If they get voted out, you win. If they die any other way, you become an Amnesiac.' },
  amnesiac:    { name: 'Amnesiac', team: 'amnesiac',
    desc: "Each night, predict who will die. If you're right, you become that player's role and join their team." },
  thief:       { name: 'Thief', team: 'thief',
    desc: 'On the first night, choose one of the two unused role cards and become that role. Your team is decided by what you pick.' },

  // ---- Neutral killers ----
  arsonist:    { name: 'Arsonist', team: 'arsonist',
    desc: "Each night, douse a player or ignite everyone you've doused. Doused players don't know it. Up to 3 living players can be doused at a time." },
  jackal:      { name: 'Jackal', team: 'jackal',
    desc: 'On the first night, recruit one player as your Sidekick. Each night, you and your Sidekick choose someone to kill.' },
  sidekick:    { name: 'Sidekick', team: 'jackal', selectable: false,
    desc: "You were recruited by the Jackal. You lost your old abilities. Each night you help the Jackal choose a victim. If you used to be a werewolf, you still wake up with the werewolves, but you're not on their team anymore." },
  juggernaut:  { name: 'Juggernaut', team: 'juggernaut',
    desc: 'Each night, kill 1 player. For every 2 kills you get, you can kill 1 more player per night.' },
  glitch:      { name: 'Glitch', team: 'glitch',
    desc: "Each night, you may kill someone and hack a player. Hacked players can't wake up that night." },
};

// Order roles are listed in the setup screen.
export const ROLE_GROUPS = [
  { label: 'Villager team', roles: ['villager', 'hunter', 'seer', 'witch', 'cupid', 'wizard', 'medic', 'vigilante', 'sheriff', 'dictator', 'swapper', 'oracle', 'detective', 'niceGuesser', 'mayor', 'mortician', 'altruist'] },
  { label: 'Werewolf team', roles: ['werewolf', 'assassin', 'morphling', 'cultist'] },
  { label: 'Neutral', roles: ['jester', 'executioner', 'amnesiac', 'thief'] },
  { label: 'Neutral killers', roles: ['arsonist', 'jackal', 'juggernaut', 'glitch'] },
];

export function roleName(id) { return (ROLES[id] && ROLES[id].name) || id; }
export function teamName(id) { return (TEAMS[id] && TEAMS[id].name) || id; }
