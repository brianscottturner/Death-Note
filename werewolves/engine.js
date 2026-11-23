// Pure game logic. Every function takes the whole room object `r` (as
// stored in Firebase) and reads or mutates it in place, so it can run inside
// a database transaction. No UI and no network code lives here.

import { ROLES, WOLF_WAKERS, KILLER_TEAMS, NEUTRAL_KILLER_TEAMS, roleName, teamName } from './roles.js';

/* ---------------- helpers ---------------- */

// Firebase turns arrays into objects (and drops empty ones), so always read
// lists through arr() and maps through obj().
export const arr = (x) => Array.isArray(x) ? x.filter(v => v != null)
  : (x && typeof x === 'object') ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]).filter(v => v != null) : [];
export const obj = (x) => (x && typeof x === 'object') ? x : {};

export function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const uniq = (a) => [...new Set(a)];

export function playerIds(r) {
  return Object.keys(obj(r.players)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}
export function pname(r, pid) { return (obj(r.players)[pid] || {}).name || '?'; }
export function roleOf(r, pid) { return obj(r.g.roles)[pid]; }
export function isAlive(r, pid) { return !!obj(r.g.alive)[pid]; }
export function alivePlayers(r) { return playerIds(r).filter(p => isAlive(r, p)); }
export function teamOf(r, pid) { const ro = ROLES[roleOf(r, pid)]; return ro ? ro.team : 'village'; }
function others(r, pid) { return alivePlayers(r).filter(p => p !== pid); }
function inDeck(r, roles) { const d = arr(r.g.deck); return roles.some(x => d.includes(x)); }
function used(r, pid) { r.g.used = obj(r.g.used); r.g.used[pid] = obj(r.g.used[pid]); return r.g.used[pid]; }
function isUsed(r, pid, what) { return !!obj(obj(r.g.used)[pid])[what]; }
export function lovers(r) { return arr(r.g.lovers); }
export function loverOf(r, pid) { const l = lovers(r); return l.length === 2 && l.includes(pid) ? l.find(x => x !== pid) : null; }
function namesList(r, ids) {
  const n = ids.map(id => pname(r, id));
  if (n.length <= 1) return n.join('');
  return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}
function aRole(role) {
  const n = roleName(role);
  return (/^[AEIOU]/.test(n) ? 'an ' : 'a ') + n;
}
export function note(r, pid, text) {
  r.g.notes = obj(r.g.notes);
  const list = arr(r.g.notes[pid]);
  list.push({ night: r.g.night, text });
  r.g.notes[pid] = list;
}
export function actionKey(r, stepId) { return `n${r.g.night}_${stepId}`; }
export function actionsFor(r, stepId) { return obj(obj(r.g.actions)[actionKey(r, stepId)]); }

// What the Seer / Wizard / Detective see. The Morphling looks like a Villager.
function apparentRole(r, pid) { return roleOf(r, pid) === 'morphling' ? 'villager' : roleOf(r, pid); }
function apparentTeam(r, pid) { return roleOf(r, pid) === 'morphling' ? 'village' : teamOf(r, pid); }

export function wakesWithWolves(r, pid) {
  const role = roleOf(r, pid);
  return WOLF_WAKERS.includes(role) || (role === 'sidekick' && !!obj(r.g.exWolf)[pid]);
}
export function shieldActive(r, pid) {
  const s = r.g.shield;
  return !!(s && s.t === pid && isAlive(r, s.by) && roleOf(r, s.by) === 'medic');
}
function dousedAlive(r, arsonist) {
  return arr(obj(r.g.doused)[arsonist]).filter(p => isAlive(r, p));
}
export function juggernautKillsPerNight(r, pid) {
  return 1 + Math.floor((obj(r.g.jugKills)[pid] || 0) / 2);
}

/* ---------------- setup ---------------- */

export function deckFromSettings(settings) {
  const counts = obj(obj(settings).roles);
  const deck = [];
  Object.keys(counts).forEach(role => { for (let i = 0; i < (counts[role] || 0); i++) deck.push(role); });
  return deck;
}
export function deckSizeNeeded(r) {
  const deck = deckFromSettings(r.settings);
  return playerIds(r).length + (deck.includes('thief') ? 2 : 0);
}
export function validateSetup(r) {
  const n = playerIds(r).length;
  const deck = deckFromSettings(r.settings);
  const s = obj(r.settings);
  if (n < 4) return 'You need at least 4 players.';
  const need = deckSizeNeeded(r);
  if (deck.length !== need) {
    return deck.includes('thief')
      ? `With a Thief you need ${need} roles (${n} players + 2 unused cards). You have ${deck.length}.`
      : `You need exactly ${need} roles for ${n} players. You have ${deck.length}.`;
  }
  if (s.trueLovers && deck.includes('cupid')) return "Cupid can't be used in True Lovers mode.";
  if (!deck.some(role => KILLER_TEAMS.includes(ROLES[role].team))) return 'Add at least one killer (a werewolf or neutral killer).';
  return null;
}

export function dealGame(r) {
  const ids = playerIds(r);
  const deck = shuffle(deckFromSettings(r.settings));
  const s = obj(r.settings);
  const g = {
    night: 1, phase: 'night', stepIdx: -1, stepOpen: false,
    roles: {}, origRoles: {}, alive: {}, publicRoles: {},
    deck: uniq(deck), center: deck.slice(ids.length),
    revealRoles: s.revealRoles !== false && !deck.includes('mortician'),
    discussSec: s.discussSec || 180,
    used: {}, notes: {}, actions: {}, kills: [], announce: [],
  };
  ids.forEach((p, i) => { g.roles[p] = deck[i]; g.origRoles[p] = deck[i]; g.alive[p] = true; });
  r.g = g;
  if (s.trueLovers) g.lovers = shuffle(ids).slice(0, 2);
  ids.forEach(p => { if (g.roles[p] === 'executioner') assignExecTarget(r, p); });
  g.steps = buildSteps(r);
  r.status = 'playing';
}

function assignExecTarget(r, pid) {
  const options = alivePlayers(r).filter(p => p !== pid && teamOf(r, p) === 'village');
  r.g.execTarget = obj(r.g.execTarget);
  r.g.execTarget[pid] = options.length ? pick(options) : null;
}

/* ---------------- night steps ---------------- */

// The order roles wake in. `first` = first night only.
export const STEP_ORDER = ['thief', 'cupid', 'lovers', 'medic', 'oracle', 'glitch', 'werewolves', 'jackal',
  'juggernaut', 'arsonist', 'vigilante', 'sheriff', 'niceGuesser', 'seer', 'wizard', 'detective',
  'swapper', 'mortician', 'amnesiac', 'amnesiacExec', 'witch'];

export const STEPS = {
  thief:      { first: true, roles: ['thief'], wake: 'Thief, wake up. Look at your phone and choose one of the two unused roles.', sleep: 'Thief, go back to sleep.' },
  cupid:      { first: true, roles: ['cupid'], wake: 'Cupid, wake up. Choose the two players who will fall in love.', sleep: 'Cupid, go back to sleep.' },
  lovers:     { first: true, roles: [], wake: 'Lovers, wake up. Look at your phone to see who you are in love with.', sleep: 'Lovers, go back to sleep.' },
  medic:      { roles: ['medic'], wake: 'Medic, wake up. Choose a player to protect with your shield.', sleep: 'Medic, go back to sleep.' },
  oracle:     { roles: ['oracle'], wake: 'Oracle, wake up. Choose your target. If you die, their role will be revealed.', sleep: 'Oracle, go back to sleep.' },
  glitch:     { roles: ['glitch'], wake: 'Glitch, wake up. You may choose someone to kill, and someone to hack.', sleep: 'Glitch, go back to sleep.' },
  werewolves: { roles: WOLF_WAKERS, wake: 'Werewolves, wake up. Look at each other, and choose your victim on your phones.', sleep: 'Werewolves, go back to sleep.' },
  jackal:     { roles: ['jackal'], wake: 'Jackal, wake up. Choose your victim.', sleep: 'Jackal, go back to sleep.' },
  juggernaut: { roles: ['juggernaut'], wake: 'Juggernaut, wake up. Choose who to kill.', sleep: 'Juggernaut, go back to sleep.' },
  arsonist:   { roles: ['arsonist'], wake: "Arsonist, wake up. Douse a player, or ignite everyone you've doused.", sleep: 'Arsonist, go back to sleep.' },
  vigilante:  { roles: ['vigilante'], wake: 'Vigilante, wake up. You may use your one shot tonight.', sleep: 'Vigilante, go back to sleep.' },
  sheriff:    { roles: ['sheriff'], wake: "Sheriff, wake up. You may try to kill someone. If they're a villager, you will die instead.", sleep: 'Sheriff, go back to sleep.' },
  niceGuesser:{ roles: ['niceGuesser'], wake: "Nice Guesser, wake up. You may guess someone's role.", sleep: 'Nice Guesser, go back to sleep.' },
  seer:       { roles: ['seer'], wake: 'Seer, wake up. Choose a player whose role you want to see.', sleep: 'Seer, go back to sleep.' },
  wizard:     { roles: ['wizard'], wake: 'Wizard, wake up. Choose two players to compare.', sleep: 'Wizard, go back to sleep.' },
  detective:  { roles: ['detective'], wake: 'Detective, wake up. Choose a player to investigate.', sleep: 'Detective, go back to sleep.' },
  swapper:    { roles: ['swapper'], wake: "Swapper, wake up. You may choose two players whose votes will be swapped tomorrow.", sleep: 'Swapper, go back to sleep.' },
  mortician:  { roles: ['mortician'], wake: 'Mortician, wake up. Look at your phone to see the roles of the dead.', sleep: 'Mortician, go back to sleep.' },
  amnesiac:   { roles: ['amnesiac'], wake: 'Amnesiac, wake up. Predict who will die tonight.', sleep: 'Amnesiac, go back to sleep.' },
  // An Executioner who turned into an Amnesiac wakes separately, so they never see the original Amnesiac.
  amnesiacExec: { roles: ['executioner'], wake: 'Amnesiac, wake up. Predict who will die tonight.', sleep: 'Amnesiac, go back to sleep.' },
  witch:      { roles: ['witch'], wake: "Witch, wake up. Look at your phone to see tonight's victims. You may use your potions.", sleep: 'Witch, go back to sleep.' },
};

export function wakeLine(r, id) {
  if (id === 'jackal') {
    return r.g.night === 1
      ? 'Jackal, wake up. Choose someone to recruit as your Sidekick, and choose your victim.'
      : 'Jackal and Sidekick, wake up. Choose your victim together.';
  }
  if (id === 'werewolves' && r.g.night === 1 && inDeck(r, ['cultist'])) {
    return 'Werewolves, wake up. Look at each other, and choose your victim on your phones. Cultist, you may also recruit a follower.';
  }
  return STEPS[id].wake;
}
export function sleepLine(r, id) {
  if (id === 'jackal' && r.g.night > 1) return 'Jackal and Sidekick, go back to sleep.';
  return STEPS[id].sleep;
}

// Steps for the current night. Every role in the deck (including the
// Thief's two unused cards) is called, even if nobody alive has it, so the
// narration never gives away which roles are out of the game.
export function buildSteps(r) {
  const n = r.g.night;
  return STEP_ORDER.filter(id => {
    const st = STEPS[id];
    if (st.first && n > 1) return false;
    if (id === 'lovers') return !!r.g.lovers || inDeck(r, ['cupid']);
    if (id === 'mortician' && n === 1) return false;
    // The Medic and Oracle wake on the first night, and again on any later
    // night when someone has newly become one (an Amnesiac copying a dead one).
    if (id === 'medic' || id === 'oracle') return n === 1 ? inDeck(r, [id]) : needsSetup(r, id).length > 0;
    return inDeck(r, st.roles);
  });
}

// Living Medics who haven't placed their shield yet / Oracles who haven't chosen a target.
function needsSetup(r, role) {
  const placed = role === 'medic' ? r.g.shield : r.g.oracle;
  return alivePlayers(r).filter(p => roleOf(r, p) === role && !(placed && placed.by === p));
}
const isExecAmnesiac = (r, p) => roleOf(r, p) === 'amnesiac' && !!obj(r.g.fromExec)[p];

// Players who are actually awake and acting during a step.
export function stepActors(r, id) {
  const g = r.g;
  const ok = (p) => isAlive(r, p) && g.hacked !== p;
  const ids = playerIds(r).filter(ok);
  if (id === 'lovers') return lovers(r).filter(ok);
  if (id === 'medic' || id === 'oracle') return needsSetup(r, id).filter(ok);
  if (id === 'amnesiac') return ids.filter(p => roleOf(r, p) === 'amnesiac' && !isExecAmnesiac(r, p));
  if (id === 'amnesiacExec') return ids.filter(p => isExecAmnesiac(r, p));
  if (id === 'werewolves') return ids.filter(p => wakesWithWolves(r, p));
  if (id === 'jackal') return ids.filter(p => roleOf(r, p) === 'jackal' || roleOf(r, p) === 'sidekick');
  return ids.filter(p => STEPS[id].roles.includes(roleOf(r, p)));
}
export function stepDone(r, id) {
  const acts = actionsFor(r, id);
  return stepActors(r, id).every(p => acts[p] && acts[p].done);
}

// Kills that would happen if the night ended now, minus shielded players.
// The Witch sees this list.
export function pendingVictims(r) {
  return uniq(arr(r.g.kills).filter(k => isAlive(r, k.t) && !blocked(r, k)).map(k => k.t));
}
function blocked(r, k) { return k.kind !== 'backfire' && shieldActive(r, k.t); }

// The form a player fills in during a step. Each field:
//   key, label, type ('players' | 'choice' | 'role'), candidates/options,
//   count (how many players), min (0 = optional), showIf(values), live (save every tap)
export function stepForm(r, id, pid) {
  const g = r.g, role = roleOf(r, pid), info = [];
  const fields = [];
  const P = (key, label, candidates, extra = {}) => fields.push({ key, label, type: 'players', candidates, count: 1, min: 1, ...extra });

  switch (id) {
    case 'thief':
      fields.push({ key: 'pick', type: 'choice', label: 'Choose your new role', min: 1,
        options: arr(g.center).map((ro, i) => ({ value: String(i), label: roleName(ro) })) });
      break;
    case 'cupid':
      P('pair', 'Choose the two Lovers', alivePlayers(r), { count: 2, min: 2 });
      break;
    case 'lovers': {
      const l = loverOf(r, pid);
      info.push(l ? `You are in love with <b>${pname(r, l)}</b>. If one of you dies, the other dies of a broken heart.` : 'You have no lover.');
      break;
    }
    case 'medic':
      P('t', 'Choose a player to shield', alivePlayers(r));
      break;
    case 'oracle':
      P('t', 'Choose your target', others(r, pid));
      break;
    case 'glitch':
      P('kill', 'Kill someone (optional)', others(r, pid), { min: 0 });
      P('hack', 'Hack someone (optional)', others(r, pid), { min: 0 });
      break;
    case 'werewolves': {
      const pack = stepActors(r, id).filter(p => p !== pid);
      info.push(pack.length ? `Awake with you: ${pack.map(p => `<b>${pname(r, p)}</b> (${roleName(roleOf(r, p))})`).join(', ')}` : "You're the only one awake.");
      if (teamOf(r, pid) === 'wolves') {
        P('t', 'Vote for the victim. The pack can see your vote.', alivePlayers(r).filter(p => teamOf(r, p) !== 'wolves'), { live: true });
        if (role === 'assassin') {
          P('gp', "Assassin: guess a player's role (optional)", others(r, pid), { min: 0 });
          fields.push({ key: 'gr', type: 'role', label: 'Their role is…', min: 1, options: roleOptions(r), showIf: v => !!v.gp });
        }
        if (role === 'cultist' && g.night === 1) {
          P('rec', 'Cultist: recruit a Follower (optional)', alivePlayers(r).filter(p => teamOf(r, p) !== 'wolves'), { min: 0 });
        }
      } else {
        info.push("You're the Jackal's Sidekick now, not a werewolf. You can't vote with the pack, so just blend in.");
      }
      break;
    }
    case 'jackal': {
      const partner = stepActors(r, id).filter(p => p !== pid);
      if (partner.length) info.push(`Awake with you: ${partner.map(p => `<b>${pname(r, p)}</b> (${roleName(roleOf(r, p))})`).join(', ')}`);
      P('t', 'Vote for the victim', alivePlayers(r).filter(p => teamOf(r, p) !== 'jackal'), { live: true });
      if (role === 'jackal' && g.night === 1) P('rec', 'Recruit a Sidekick (optional)', others(r, pid), { min: 0 });
      break;
    }
    case 'juggernaut': {
      const n = juggernautKillsPerNight(r, pid);
      info.push(`Kills so far: ${obj(g.jugKills)[pid] || 0}. You can kill ${n} tonight.`);
      P('ts', n > 1 ? `Choose up to ${n} players` : 'Choose who to kill', others(r, pid), { count: n, min: 0 });
      break;
    }
    case 'arsonist': {
      const d = dousedAlive(r, pid);
      info.push(d.length ? `Doused: ${d.map(p => `<b>${pname(r, p)}</b>`).join(', ')}` : 'Nobody is doused yet.');
      const opts = [];
      if (d.length < 3) opts.push({ value: 'douse', label: 'Douse someone' });
      if (d.length) opts.push({ value: 'ignite', label: `Ignite (kills ${d.length})` });
      opts.push({ value: 'none', label: 'Do nothing' });
      fields.push({ key: 'mode', type: 'choice', label: 'Tonight', options: opts, min: 1 });
      P('t', 'Douse who?', others(r, pid).filter(p => !d.includes(p)), { showIf: v => v.mode === 'douse' });
      break;
    }
    case 'vigilante':
      if (isUsed(r, pid, 'vig')) info.push("You've already used your shot.");
      else P('t', 'Shoot someone (optional, one time only)', others(r, pid), { min: 0 });
      break;
    case 'sheriff':
      P('t', 'Try to kill someone (optional)', others(r, pid), { min: 0 });
      break;
    case 'niceGuesser':
      P('gp', "Guess a player's role (optional)", others(r, pid), { min: 0 });
      fields.push({ key: 'gr', type: 'role', label: 'Their role is…', min: 1, options: roleOptions(r), showIf: v => !!v.gp });
      break;
    case 'seer':
      P('t', 'See whose role?', others(r, pid));
      break;
    case 'wizard':
      P('ts', 'Choose two players', others(r, pid), { count: 2, min: 2 });
      break;
    case 'detective':
      P('t', 'Investigate who?', others(r, pid));
      break;
    case 'swapper':
      P('ts', 'Choose two players to swap (or skip)', alivePlayers(r), { count: 2, min: 0 });
      break;
    case 'mortician': {
      const dead = playerIds(r).filter(p => !isAlive(r, p));
      info.push(dead.length ? dead.map(p => `<b>${pname(r, p)}</b> was ${aRole(roleOf(r, p))}`).join('<br>') : 'Nobody has died yet.');
      break;
    }
    case 'amnesiac':
    case 'amnesiacExec':
      P('t', 'Who will die tonight? (optional)', others(r, pid), { min: 0 });
      break;
    case 'witch': {
      const victims = pendingVictims(r);
      info.push(victims.length ? `About to die tonight: ${victims.map(p => `<b>${pname(r, p)}</b>`).join(', ')}` : 'Nobody is about to die tonight.');
      if (!isUsed(r, pid, 'save') && victims.length) P('save', 'Use your save potion? (optional)', victims, { min: 0 });
      if (!isUsed(r, pid, 'kill')) P('kill', 'Use your kill potion? (optional)', others(r, pid), { min: 0 });
      if (isUsed(r, pid, 'save') && isUsed(r, pid, 'kill')) info.push("You've used both potions.");
      break;
    }
  }
  return { info, fields };
}

function roleOptions(r) {
  // Every role that could be in play: the deck plus roles created during the game.
  const set = uniq([...arr(r.g.deck), ...(arr(r.g.deck).includes('cultist') ? ['follower'] : []), ...(arr(r.g.deck).includes('jackal') ? ['sidekick'] : [])]);
  return set.map(ro => ({ value: ro, label: roleName(ro) }));
}

// Private result a player sees right after submitting (Seer, Wizard, etc.).
export function stepResult(r, id, pid) {
  const a = actionsFor(r, id)[pid];
  if (!a) return null;
  if (id === 'seer' && a.t) return `<b>${pname(r, a.t)}</b> is ${aRole(apparentRole(r, a.t))}.`;
  if (id === 'wizard') {
    const ts = arr(a.ts);
    if (ts.length === 2) {
      const same = apparentTeam(r, ts[0]) === apparentTeam(r, ts[1]);
      return `<b>${pname(r, ts[0])}</b> and <b>${pname(r, ts[1])}</b> are on <b>${same ? 'the SAME team' : 'DIFFERENT teams'}</b>.`;
    }
  }
  if (id === 'detective' && a.t) {
    const killed = roleOf(r, a.t) !== 'morphling' && !!obj(r.g.hasKilled)[a.t];
    return `<b>${pname(r, a.t)}</b> <b>${killed ? 'HAS killed' : 'has NOT killed'}</b> someone.`;
  }
  return null;
}

function addKill(r, t, by, kind) {
  if (!t) return;
  const k = arr(r.g.kills);
  k.push({ t, by: arr(by), kind });
  r.g.kills = k;
}
function plurality(votes) {
  const tally = {};
  votes.forEach(v => { if (v) tally[v] = (tally[v] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally));
  if (!max) return null;
  return pick(Object.keys(tally).filter(t => tally[t] === max));
}
function resolveGuess(r, guesser, a) {
  if (!a || !a.gp || !a.gr) return;
  if (roleOf(r, a.gp) === a.gr) addKill(r, a.gp, [guesser], 'guess');
  else addKill(r, guesser, [guesser], 'backfire'); // a wrong guess always kills the guesser
}

// Applied when the speaker closes a step.
export function applyStepEnd(r, id) {
  const g = r.g;
  const acts = actionsFor(r, id);
  const actors = stepActors(r, id);
  actors.forEach(pid => {
    const a = acts[pid] || {};
    const role = roleOf(r, pid);
    switch (id) {
      case 'thief': {
        const center = arr(g.center);
        const i = a.pick != null ? Number(a.pick) : Math.floor(Math.random() * center.length);
        const newRole = center[i];
        center[i] = 'thief';
        g.center = center;
        g.roles[pid] = newRole;
        if (newRole === 'executioner') assignExecTarget(r, pid);
        note(r, pid, `You are now the ${roleName(newRole)}.`);
        break;
      }
      case 'cupid': {
        const pair = arr(a.pair);
        if (pair.length === 2) g.lovers = pair;
        break;
      }
      case 'medic': if (a.t) g.shield = { by: pid, t: a.t }; break;
      case 'oracle': if (a.t) g.oracle = { by: pid, t: a.t }; break;
      case 'glitch':
        if (a.hack) g.hacked = a.hack;
        addKill(r, a.kill, [pid], 'kill');
        break;
      case 'werewolves':
        if (role === 'assassin') resolveGuess(r, pid, a);
        if (role === 'cultist' && a.rec) recruit(r, 'cult', pid, a.rec);
        break;
      case 'jackal':
        if (role === 'jackal' && a.rec) recruit(r, 'jackal', pid, a.rec);
        break;
      case 'juggernaut': arr(a.ts).forEach(t => addKill(r, t, [pid], 'jug')); break;
      case 'arsonist': {
        g.doused = obj(g.doused);
        if (a.mode === 'douse' && a.t) g.doused[pid] = uniq([...dousedAlive(r, pid), a.t]);
        if (a.mode === 'ignite') { dousedAlive(r, pid).forEach(t => addKill(r, t, [pid], 'fire')); g.doused[pid] = []; }
        break;
      }
      case 'vigilante': if (a.t && !isUsed(r, pid, 'vig')) { used(r, pid).vig = true; addKill(r, a.t, [pid], 'kill'); } break;
      case 'sheriff':
        if (a.t) {
          if (teamOf(r, a.t) === 'village') addKill(r, pid, [pid], 'backfire');
          else addKill(r, a.t, [pid], 'kill');
        }
        break;
      case 'niceGuesser': resolveGuess(r, pid, a); break;
      case 'swapper': { const ts = arr(a.ts); g.swap = ts.length === 2 ? ts : null; break; }
      case 'amnesiac': case 'amnesiacExec': if (a.t) { g.amnesiacGuess = obj(g.amnesiacGuess); g.amnesiacGuess[pid] = a.t; } break;
      case 'witch':
        if (a.save && !isUsed(r, pid, 'save')) { used(r, pid).save = true; g.witchSave = a.save; }
        if (a.kill && !isUsed(r, pid, 'kill')) { used(r, pid).kill = true; addKill(r, a.kill, [pid], 'witch'); }
        break;
    }
  });
  // Group kills: one victim per pack, picked by plurality (ties broken randomly).
  if (id === 'werewolves' || id === 'jackal') {
    const voters = actors.filter(p => id === 'jackal' || teamOf(r, p) === 'wolves');
    const t = plurality(voters.map(p => (acts[p] || {}).t));
    if (t) addKill(r, t, voters.filter(p => (acts[p] || {}).t === t), id === 'jackal' ? 'jackal' : 'wolves');
  }
}

// Recruits take effect immediately: the recruited player loses their old
// power right away, even if their role hasn't woken up yet tonight.
function recruit(r, kind, by, t) {
  const g = r.g;
  if (!isAlive(r, t)) return;
  if (kind === 'cult') {
    if (NEUTRAL_KILLER_TEAMS.includes(teamOf(r, t)) || teamOf(r, t) === 'wolves') {
      note(r, by, `Your recruit failed. ${pname(r, t)} could not be recruited.`);
      return;
    }
    g.roles[t] = 'follower';
    note(r, t, 'The Cultist recruited you! You are now a Follower on the Werewolf team. You lost your old power and wake up with the werewolves.');
    note(r, by, `${pname(r, t)} is now your Follower.`);
  } else {
    const wasWolf = teamOf(r, t) === 'wolves' || wakesWithWolves(r, t);
    g.roles[t] = 'sidekick';
    if (wasWolf) { g.exWolf = obj(g.exWolf); g.exWolf[t] = true; }
    note(r, t, `The Jackal (${pname(r, by)}) recruited you! You are now the Sidekick on the Jackal team. You lost your old abilities.${wasWolf ? " You still wake up with the werewolves, but you're no longer on their team." : ''}`);
    note(r, by, `${pname(r, t)} is now your Sidekick.`);
  }
}

/* ---------------- night resolution & morning ---------------- */

export function resolveNight(r) {
  const g = r.g;
  const dead = [];
  arr(g.kills).forEach(k => {
    if (!isAlive(r, k.t) || blocked(r, k)) return;
    if (g.witchSave === k.t && k.kind !== 'witch') return;
    if (!dead.includes(k.t)) dead.push(k.t);
    g.hasKilled = obj(g.hasKilled);
    arr(k.by).forEach(b => { if (b !== k.t) g.hasKilled[b] = true; });
    if (k.kind === 'jug') { g.jugKills = obj(g.jugKills); arr(k.by).forEach(b => { g.jugKills[b] = (g.jugKills[b] || 0) + 1; }); }
  });
  g.kills = [];
  g.witchSave = null;
  g.morning = { dead, sub: 'announce' };
  g.phase = 'morning';
}

export function morningDeathLine(r) {
  const dead = arr(r.g.morning && r.g.morning.dead);
  if (!dead.length) return 'Nobody died last night.';
  return `Last night, ${namesList(r, dead)} ${dead.length > 1 ? 'were' : 'was'} killed.`;
}
export function altruistAvailable(r) {
  return inDeck(r, ['altruist']) && arr(r.g.morning && r.g.morning.dead).length > 0;
}

// After the altruist window: apply deaths, role changes and win checks.
export function finishMorning(r) {
  const g = r.g;
  let dead = arr(g.morning.dead);
  const lines = [];
  const alt = g.altruistChoice;
  if (alt && isAlive(r, alt.by) && roleOf(r, alt.by) === 'altruist' && !dead.includes(alt.by) && dead.includes(alt.t)) {
    dead = dead.filter(p => p !== alt.t);
    lines.push(`The Altruist, ${pname(r, alt.by)}, gave their life to bring ${pname(r, alt.t)} back!`);
    dead.push(alt.by);
  }
  g.altruistChoice = null;
  lines.push(...killPlayers(r, dead, 'night'));

  // Amnesiac copies a correctly predicted victim's role.
  Object.entries(obj(g.amnesiacGuess)).forEach(([pid, t]) => {
    if (isAlive(r, pid) && roleOf(r, pid) === 'amnesiac' && !isAlive(r, t) && dead.includes(t)) {
      const newRole = roleOf(r, t);
      g.roles[pid] = newRole;
      if (g.fromExec) delete g.fromExec[pid];
      if (newRole === 'executioner') assignExecTarget(r, pid);
      note(r, pid, `You predicted correctly! You are now the ${roleName(newRole)}.`);
    }
  });
  g.amnesiacGuess = null;

  g.hacked = null;
  g.morning = null;
  maybeCheckWin(r);
  return lines;
}

// Marks players dead and handles everything that triggers on death.
// Returns lines for the speaker to read out.
export function killPlayers(r, ids, cause) {
  const g = r.g;
  const lines = [];
  const queue = arr(ids).map(p => ({ p, cause }));
  while (queue.length) {
    const { p, cause: c } = queue.shift();
    if (!isAlive(r, p)) continue;
    g.alive[p] = false;
    const role = roleOf(r, p);
    if (c === 'heartbreak') lines.push(`${pname(r, p)} died of a broken heart.`);
    if (g.revealRoles) { g.publicRoles = obj(g.publicRoles); g.publicRoles[p] = role; lines.push(`${pname(r, p)} was ${aRole(role)}.`); }
    const l = loverOf(r, p);
    if (l && isAlive(r, l)) queue.push({ p: l, cause: 'heartbreak' });
    if (role === 'oracle' && g.oracle && g.oracle.by === p && g.oracle.t) {
      const t = g.oracle.t;
      g.publicRoles = obj(g.publicRoles); g.publicRoles[t] = roleOf(r, t);
      lines.push(`The Oracle has died. Their target, ${pname(r, t)}, is ${aRole(roleOf(r, t))}.`);
    }
    if (role === 'hunter') { const q = arr(g.hunterQueue); q.push(p); g.hunterQueue = q; }
    // An Executioner whose target dies any way other than a vote becomes an Amnesiac.
    if (c !== 'lynch') {
      Object.entries(obj(g.execTarget)).forEach(([ex, t]) => {
        if (t === p && isAlive(r, ex) && roleOf(r, ex) === 'executioner') {
          g.roles[ex] = 'amnesiac';
          g.fromExec = obj(g.fromExec); g.fromExec[ex] = true;
          note(r, ex, `Your target ${pname(r, p)} died before being voted out. You are now the Amnesiac: predict who will die each night to take their role.`);
        }
      });
    }
  }
  return lines;
}

export function resolveHunterShot(r) {
  const g = r.g;
  const q = arr(g.hunterQueue);
  const hunter = q.shift();
  g.hunterQueue = q;
  const shot = g.hunterShot;
  g.hunterShot = null;
  const lines = [];
  if (shot && shot.by === hunter && shot.t && isAlive(r, shot.t)) {
    if (shieldActive(r, shot.t)) {
      lines.push(`The Hunter shot at ${pname(r, shot.t)}, but they were protected by a shield!`);
    } else {
      lines.push(`The Hunter shot ${pname(r, shot.t)}.`);
      g.hasKilled = obj(g.hasKilled); g.hasKilled[hunter] = true;
      lines.push(...killPlayers(r, [shot.t], 'hunter'));
    }
  } else {
    lines.push('The Hunter chose not to shoot anyone.');
  }
  maybeCheckWin(r);
  return lines;
}

/* ---------------- day vote ---------------- */

export function voteWeight(r, pid) {
  const role = roleOf(r, pid);
  if (role === 'mayor') return 3;
  if (role === 'dictator') return 0;
  return 1;
}

export function resolveVote(r) {
  const g = r.g;
  const votes = obj(g.votes);
  const lines = [];
  const voters = alivePlayers(r);
  // Dictator power overrides everything.
  const dict = voters.find(p => roleOf(r, p) === 'dictator' && votes[p] && votes[p].power && votes[p].t && votes[p].t !== 'skip');
  let lynched = null;
  if (dict) {
    lynched = votes[dict].t;
    lines.push(`The Dictator, ${pname(r, dict)}, has used their power! ${pname(r, lynched)} is executed, and the Dictator dies with them.`);
  } else {
    const tally = {};
    voters.forEach(p => {
      const v = votes[p];
      if (!v || !v.t) return;
      tally[v.t] = (tally[v.t] || 0) + voteWeight(r, p);
    });
    const sw = arr(g.swap);
    if (sw.length === 2) { const a = tally[sw[0]] || 0; tally[sw[0]] = tally[sw[1]] || 0; tally[sw[1]] = a; }
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter(t => tally[t] === max);
    // Totals are public (after any Swapper swap), so sharp players can spot the Mayor's extra votes.
    const shown = Object.keys(tally).filter(t => tally[t] > 0).sort((a, b) => tally[b] - tally[a]);
    if (shown.length) {
      lines.push('The votes: ' + shown.map(t => `${t === 'skip' ? 'Skip' : pname(r, t)}, ${tally[t]} vote${tally[t] === 1 ? '' : 's'}`).join('. ') + '.');
    }
    if (!max) lines.push('Nobody voted. Nobody is voted out today.');
    else if (top.length > 1) lines.push("It's a tie. Nobody is voted out today.");
    else if (top[0] === 'skip') lines.push('The town chose not to vote anyone out today.');
    else { lynched = top[0]; lines.push(`The town has voted out ${pname(r, lynched)}.`); }
  }
  g.swap = null;
  g.votes = {};
  if (lynched) {
    const role = roleOf(r, lynched);
    const execWinner = Object.entries(obj(g.execTarget)).find(([ex, t]) => t === lynched && roleOf(r, ex) === 'executioner');
    lines.push(...killPlayers(r, [lynched], 'lynch'));
    if (role === 'jester') {
      g.winner = { team: 'jester', players: [lynched], text: `${pname(r, lynched)} was the Jester! The Jester wins!` };
    } else if (execWinner) {
      g.winner = { team: 'executioner', players: [execWinner[0]], text: `${pname(r, lynched)} was the Executioner's target! ${pname(r, execWinner[0])}, the Executioner, wins!` };
    }
  }
  if (dict) lines.push(...killPlayers(r, [dict], 'dictator'));
  maybeCheckWin(r);
  return lines;
}

/* ---------------- win check ---------------- */

// Wait for any dead Hunters to take their shot before deciding the game.
export function maybeCheckWin(r) {
  if (!arr(r.g.hunterQueue).length) checkWin(r);
}

export function checkWin(r) {
  const g = r.g;
  if (g.winner) return g.winner;
  const al = alivePlayers(r);
  const all = playerIds(r);
  const teamMembers = (t) => all.filter(p => teamOf(r, p) === t);
  if (!al.length) { g.winner = { team: 'none', players: [], text: 'Everyone is dead. Nobody wins!' }; return g.winner; }
  const l = lovers(r);
  if (l.length === 2 && al.length <= 3 && l.every(p => al.includes(p))) {
    g.winner = { team: 'lovers', players: l, text: `The Lovers, ${namesList(r, l)}, made it to the final ${al.length}. The Lovers win!` };
    return g.winner;
  }
  const killers = uniq(al.map(p => teamOf(r, p)).filter(t => KILLER_TEAMS.includes(t)));
  if (!killers.length) {
    g.winner = { team: 'village', players: teamMembers('village'), text: 'All the killers are dead. The Villagers win!' };
  } else if (killers.length === 1) {
    const k = killers[0];
    const n = al.filter(p => teamOf(r, p) === k).length;
    if (n >= al.length - n) g.winner = { team: k, players: teamMembers(k), text: `The ${teamName(k)} ${k === 'wolves' ? 'win' : 'wins'}!` };
  }
  return g.winner || null;
}

// Moves to the next night.
export function startNight(r) {
  const g = r.g;
  g.night += 1;
  g.phase = 'night';
  g.stepIdx = -1;
  g.stepOpen = false;
  g.hacked = null;
  g.kills = [];
  g.steps = buildSteps(r);
  g.announce = [];
}
