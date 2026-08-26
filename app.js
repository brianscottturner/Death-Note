import {
  auth, db, signInAnonymously, onAuthStateChanged,
  ref, get, set, update, onValue, runTransaction
} from "./firebase-init.js";

const FIRST_NAMES = ["Harry", "Ron", "Katniss", "Peeta", "Percy", "Sherlock", "Peter", "Tony", "Bruce", "Clark"];
const LAST_NAMES = ["Potter", "Weasley", "Everdeen", "Mellark", "Jackson", "Holmes", "Parker", "Stark", "Wayne", "Kent"];
const LABELS = "ABCDEFGHIJ".split("");
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const KIRA_TURN_MS = 2 * 60 * 1000;
const APP_VERSION = 25;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function el(id) { return document.getElementById(id); }

// Mission Card deck: 26 base cards, each valid for specific player counts
// (a card's team size has to fit within that player count's range). Every
// base card exists in both Black and White, doubling the deck to 52 --
// White is a straight mirror of Black, per the physical card set.
const MISSION_CARD_BASE = [
  { teamSize: 2, points: 4, nameShare: 'first', decks: [7] },
  { teamSize: 2, points: 5, nameShare: 'last', decks: [7] },
  { teamSize: 3, points: 5, nameShare: 'first', decks: [7, 8, 9, 10] },
  { teamSize: 3, points: 6, nameShare: 'last', decks: [7, 8, 9, 10] },
  { teamSize: 4, points: 6, nameShare: 'first', decks: [7, 8, 9, 10] },
  { teamSize: 4, points: 7, nameShare: 'last', decks: [7, 8, 9, 10] },
  { teamSize: 5, points: 7, nameShare: 'first', decks: [7, 8, 9, 10] },
  { teamSize: 5, points: 8, nameShare: 'last', decks: [7, 8, 9, 10] },
  { teamSize: 6, points: 8, nameShare: 'first', decks: [8, 9, 10] },
  { teamSize: 6, points: 9, nameShare: 'last', decks: [8, 9, 10] },
  { teamSize: 7, points: 9, nameShare: 'first', decks: [9, 10] },
  { teamSize: 7, points: 10, nameShare: 'last', decks: [9, 10] },
  { teamSize: 2, points: 4, nameShare: 'last', decks: [7] },
  { teamSize: 2, points: 5, nameShare: 'first', decks: [7] },
  { teamSize: 3, points: 5, nameShare: 'last', decks: [7, 8, 9, 10] },
  { teamSize: 3, points: 6, nameShare: 'first', decks: [7, 8, 9, 10] },
  { teamSize: 4, points: 6, nameShare: 'last', decks: [7, 8, 9, 10] },
  { teamSize: 4, points: 7, nameShare: 'first', decks: [7, 8, 9, 10] },
  { teamSize: 5, points: 7, nameShare: 'last', decks: [7, 8, 9, 10] },
  { teamSize: 5, points: 8, nameShare: 'first', decks: [7, 8, 9, 10] },
  { teamSize: 6, points: 8, nameShare: 'last', decks: [8, 9, 10] },
  { teamSize: 6, points: 9, nameShare: 'first', decks: [8, 9, 10] },
  { teamSize: 7, points: 9, nameShare: 'last', decks: [9, 10] },
  { teamSize: 7, points: 10, nameShare: 'first', decks: [9, 10] },
  { teamSize: 4, points: 5, nameShare: 'both', decks: [7, 8, 9, 10] },
  { teamSize: 3, points: 5, nameShare: 'both', decks: [7, 8, 9, 10] },
];

function buildMissionDeck(playerCount) {
  const cards = [];
  MISSION_CARD_BASE.forEach((base) => {
    if (!base.decks.includes(playerCount)) return;
    cards.push({ teamSize: base.teamSize, points: base.points, nameShare: base.nameShare, color: 'black' });
    cards.push({ teamSize: base.teamSize, points: base.points, nameShare: base.nameShare, color: 'white' });
  });
  return shuffle(cards);
}

// Draws the next card from room.missionDeck (an object-map keyed by draw
// order, since Firebase doesn't preserve arrays), advancing missionDeckIndex.
// If the deck's been fully drawn, reshuffles a fresh copy of the same
// player-count deck and starts over -- equivalent to reshuffling a discard
// pile, without needing to actually track one.
function drawMissionCard(room) {
  const deck = obj(room.missionDeck);
  const total = Object.keys(deck).length;
  let idx = room.missionDeckIndex || 0;
  if (idx >= total) {
    const playerCount = Object.keys(obj(room.players)).length;
    const fresh = buildMissionDeck(playerCount);
    room.missionDeck = {};
    fresh.forEach((c, i) => { room.missionDeck[i] = c; });
    idx = 0;
  }
  const card = obj(room.missionDeck)[idx];
  room.missionDeckIndex = idx + 1;
  return card;
}

// Supply Cards: a 45-card deck (15 each of Black/White/Gray) shared by every
// player for the whole game. Gray always helps a mission's running total;
// Black/White help when they match the mission card's color and hurt when
// they don't -- this is where a Kira-aligned player on the team can quietly
// sabotage without ever being identified (only the totals are public, never
// who played what).
const SUPPLY_DECK_COMPOSITION = { black: 15, white: 15, gray: 15 };
function buildSupplyDeck() {
  const cards = [];
  let n = 0;
  Object.entries(SUPPLY_DECK_COMPOSITION).forEach(([color, count]) => {
    for (let i = 0; i < count; i++) { cards.push({ id: `sc${n}`, color }); n++; }
  });
  return shuffle(cards);
}
function supplyCardValue(cardColor, missionColor) {
  if (cardColor === 'gray') return 1;
  return cardColor === missionColor ? 2 : -2;
}
// Draws `count` cards from room.supplyDeck, reshuffling the discard pile
// into a fresh deck mid-draw if it runs out (mirroring a real reshuffle).
// Mutates room in place, same style as drawMissionCard.
function drawSupplyCards(room, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    let deck = obj(room.supplyDeck);
    let deckIdx = room.supplyDeckIndex || 0;
    if (deckIdx >= Object.keys(deck).length) {
      const discardCards = Object.entries(obj(room.supplyDiscard)).map(([id, color]) => ({ id, color }));
      if (discardCards.length === 0) break;
      const fresh = shuffle(discardCards);
      room.supplyDeck = {};
      fresh.forEach((c, i2) => { room.supplyDeck[i2] = c; });
      room.supplyDiscard = {};
      deckIdx = 0;
      deck = room.supplyDeck;
    }
    const card = deck[deckIdx];
    if (!card) break;
    drawn.push(card);
    room.supplyDeckIndex = deckIdx + 1;
  }
  return drawn;
}
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// Renders the actual Mission Card artwork with the round's real values
// overlaid on top of the card's printed blanks (team size / points / who
// gets named). `tag` controls the wrapper element and any extra classes/
// attributes needed by the caller (a plain display vs. a clickable choice).
function missionCardFaceHtml(card, { tag = 'div', extraClass = '', extraAttrs = '' } = {}) {
  const shareLabel = { first: 'FIRST', last: 'LAST', both: 'BOTH' }[card.nameShare] || '';
  const colorClass = card.color === 'white' ? 'mission-white' : 'mission-black';
  const cls = `card-face ${colorClass} ${extraClass}`.trim();
  return `<${tag} class="${cls}" ${extraAttrs}>
    <span class="field field-investigators">${card.teamSize}</span>
    <span class="field field-points">${card.points}</span>
    <span class="field field-name">${shareLabel}</span>
  </${tag}>`;
}
function supplyCardFaceHtml(color, { tag = 'div', extraClass = '', extraAttrs = '' } = {}) {
  const cls = `card-face supply-${color} ${extraClass}`.trim();
  return `<${tag} class="${cls}" ${extraAttrs}></${tag}>`;
}
el('app-version').textContent = 'v' + APP_VERSION;

// Assigns each team member to learn one other member's name (a derangement:
// nobody learns their own name, everybody learns from exactly one person and
// is learned-from by exactly one person). Prefers pairings where the learner
// doesn't already know the source's relevant name part, retrying random
// arrangements and keeping the one with the fewest such repeats.
function computeShareAssignment(teamIds, knownNames, shareType) {
  function alreadyKnows(learner, source) {
    const k = (knownNames[learner] && knownNames[learner][source]) || {};
    if (shareType === 'first') return !!k.first;
    if (shareType === 'last') return !!k.last;
    return !!(k.first && k.last);
  }
  let best = null, bestViolations = Infinity;
  const attempts = teamIds.length <= 2 ? 1 : 300;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const order = shuffle(teamIds);
    let violations = 0;
    const assignment = {};
    for (let i = 0; i < order.length; i++) {
      const learner = order[i];
      const source = order[(i + 1) % order.length];
      assignment[learner] = source;
      if (alreadyKnows(learner, source)) violations++;
    }
    if (violations < bestViolations) {
      best = assignment;
      bestViolations = violations;
      if (violations === 0) break;
    }
  }
  return best;
}
function obj(x) { return x || {}; }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderChatLog(chat, players) {
  const messages = Object.values(chat).sort((a, b) => a.ts - b.ts);
  if (messages.length === 0) return '<p class="hint">No messages yet.</p>';
  return messages.map(m => {
    const sender = players[m.senderId];
    const label = sender ? sender.label : '?';
    return `<p class="chat-msg"><strong>${label}:</strong> ${esc(m.text)}</p>`;
  }).join('');
}
function generateRoomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/* ---------------- LOCAL SESSION STATE ---------------- */

let myUid = null;
let myRoomCode = null;
let myPlayerId = null;
let currentRoomData = null;
let roomUnsub = null;

function saveSession(code) {
  localStorage.setItem('dn_session', JSON.stringify({ code }));
}
function clearSession() {
  localStorage.removeItem('dn_session');
}

/* ---------------- AUTH BOOTSTRAP ---------------- */

let resolveAuthReady;
const authReadyPromise = new Promise((resolve) => { resolveAuthReady = resolve; });

onAuthStateChanged(auth, (user) => {
  if (user) {
    myUid = user.uid;
    el('btn-create-game').disabled = false;
    el('btn-join-game').disabled = false;
    el('landing-connecting').classList.add('hidden');
    resolveAuthReady();
    tryResumeSession();
  }
});
signInAnonymously(auth).catch((err) => {
  console.error(err);
  el('landing-connecting').textContent = 'Could not connect.';
  showLandingError('Could not connect. Check your internet connection and reload.');
});

function tryResumeSession() {
  const saved = localStorage.getItem('dn_session');
  if (!saved) { showScreen('screen-landing'); return; }
  try {
    const { code } = JSON.parse(saved);
    if (code) { myRoomCode = code; attachRoomListener(code); return; }
  } catch (e) { /* ignore */ }
  showScreen('screen-landing');
}

/* ---------------- SCREEN HELPERS ---------------- */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  el(id).classList.remove('hidden');
}
function screenForStatus(status) {
  return { lobby: 'screen-lobby', reveal: 'screen-reveal', playing: 'screen-round', gameover: 'screen-gameover' }[status];
}
let toastTimer = null;
function showToast(html, duration = 5000) {
  const t = el('toast');
  t.innerHTML = html;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), duration);
}

function showLandingError(msg) {
  const box = el('landing-error');
  box.textContent = msg;
  box.classList.remove('hidden');
}
function clearLandingError() {
  el('landing-error').classList.add('hidden');
}

/* ---------------- LANDING: CREATE / JOIN ---------------- */

el('btn-create-game').addEventListener('click', async () => {
  clearLandingError();
  const name = el('landing-name').value.trim();
  const customCode = el('landing-custom-code').value.trim();
  if (!name) return showLandingError('Enter your name first.');
  el('btn-create-game').disabled = true;
  try {
    await createRoom(name, customCode);
  } catch (e) {
    showLandingError('Could not create game: ' + e.message);
  } finally {
    el('btn-create-game').disabled = false;
  }
});

function sanitizeCustomCode(raw) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

el('btn-join-game').addEventListener('click', async () => {
  clearLandingError();
  const name = el('landing-name').value.trim();
  const code = el('landing-code').value.trim().toUpperCase();
  if (!name) return showLandingError('Enter your name first.');
  if (!code) return showLandingError('Enter the room code.');
  el('btn-join-game').disabled = true;
  try {
    await joinRoom(code, name);
  } catch (e) {
    showLandingError('Could not join: ' + e.message);
  } finally {
    el('btn-join-game').disabled = false;
  }
});

async function createRoom(name, customCode) {
  await authReadyPromise;
  const newRoomData = {
    createdAt: Date.now(), hostUid: myUid, status: 'lobby',
    round: 0, phase: null,
    lScore: 0, kiraScore: 0,
    lastInfoPhaseSwapped: false,
    settings: { watari: 'off', xKira: 'off', mello: 'off', n: 'off', npa: 'off', misa: 'off' },
    mission: { step: null },
    voting: { resolved: false },
    info: { lDone: false, kiraDone: false, swappedThisPhase: false },
    endgame: { active: false, resolved: false },
    players: { A: { uid: myUid, label: 'A', name } }
  };

  let code;
  if (customCode) {
    code = sanitizeCustomCode(customCode);
    if (code.length < 3 || code.length > 12) {
      throw new Error('Custom room code must be 3-12 letters/numbers.');
    }
    // Transaction guards against two hosts claiming the same custom code at once.
    const result = await runTransaction(ref(db, `rooms/${code}`), (existing) => {
      if (existing) return existing;
      return { code, ...newRoomData };
    });
    const finalRoom = result.snapshot.val();
    if (!finalRoom || finalRoom.hostUid !== myUid) {
      throw new Error(`Room code "${code}" is already in use. Try a different one.`);
    }
  } else {
    code = generateRoomCode();
    await set(ref(db, `rooms/${code}`), { code, ...newRoomData });
  }
  myRoomCode = code;
  saveSession(code);
  attachRoomListener(code);
}

async function joinRoom(code, name) {
  await authReadyPromise;
  const roomRef = ref(db, `rooms/${code}`);
  const snap = await get(roomRef);
  if (!snap.exists()) throw new Error('Room not found.');
  const room = snap.val();
  if (room.status !== 'lobby') throw new Error('This game has already started.');

  const playersRef = ref(db, `rooms/${code}/players`);
  const result = await runTransaction(playersRef, (players) => {
    players = players || {};
    const used = Object.keys(players);
    if (used.some(id => players[id].uid === myUid)) return players;
    if (used.length >= 10) return players;
    const nextLabel = LABELS.find(l => !used.includes(l));
    players[nextLabel] = { uid: myUid, label: nextLabel, name };
    return players;
  });
  const finalPlayers = obj(result.snapshot.val());
  const joined = Object.values(finalPlayers).some(p => p.uid === myUid);
  if (!joined) throw new Error('Room is full.');

  myRoomCode = code;
  saveSession(code);
  attachRoomListener(code);
}

/* ---------------- ROOM LISTENER ---------------- */

function attachRoomListener(code) {
  detachRoomListener();
  notesPanelInitialized = false;
  expansionPanelOpen = false;
  const roomRef = ref(db, `rooms/${code}`);
  roomUnsub = onValue(roomRef, (snap) => {
    if (!snap.exists()) {
      clearSession();
      currentRoomData = null;
      showScreen('screen-landing');
      showLandingError('That game no longer exists.');
      return;
    }
    currentRoomData = snap.val();
    render();
  }, (err) => {
    console.error(err);
    showLandingError('Connection error: ' + err.message);
  });
}
function detachRoomListener() {
  if (roomUnsub) { roomUnsub(); roomUnsub = null; }
}

/* ---------------- MAIN RENDER DISPATCH ---------------- */

function render() {
  const room = currentRoomData;
  if (!room) return;
  if (!resolveMyPlayerId(room)) return;
  showScreen(screenForStatus(room.status));
  if (room.status === 'lobby') return renderLobby(room);
  if (room.status === 'reveal') return renderReveal(room);
  if (room.status === 'playing') return renderRound(room);
  if (room.status === 'gameover') return renderGameOver(room);
}

function resolveMyPlayerId(room) {
  if (myPlayerId && room.players && room.players[myPlayerId] && room.players[myPlayerId].uid === myUid) return true;
  const players = obj(room.players);
  const found = Object.keys(players).find(id => players[id].uid === myUid);
  if (found) { myPlayerId = found; return true; }
  clearSession();
  detachRoomListener();
  currentRoomData = null;
  myRoomCode = null;
  myPlayerId = null;
  showScreen('screen-landing');
  showLandingError("You're not part of that game (anymore).");
  return false;
}

/* ---------------- LOBBY ---------------- */

let expansionPanelOpen = false;

function renderLobby(room) {
  const players = obj(room.players);
  const ids = Object.keys(players).sort();
  const isHost = myUid === room.hostUid;
  const count = ids.length;
  const canStart = isHost && count >= 7 && count <= 10;
  const watariSetting = (room.settings && room.settings.watari) || 'off';
  const xKiraSetting = (room.settings && room.settings.xKira) || 'off';
  const melloSetting = (room.settings && room.settings.mello) || 'off';
  const nSetting = (room.settings && room.settings.n) || 'off';
  const npaSetting = (room.settings && room.settings.npa) || 'off';
  const misaSetting = (room.settings && room.settings.misa) || 'off';
  const configuredCount = (watariSetting !== 'off' ? 1 : 0) + (xKiraSetting !== 'off' ? 1 : 0) + (melloSetting !== 'off' ? 1 : 0) + (nSetting !== 'off' ? 1 : 0) + (npaSetting !== 'off' ? 1 : 0) + (misaSetting !== 'off' ? 1 : 0);

  let html = `<h1 class="title">DEATH NOTE<br><span class="subtitle">Kira's Game</span></h1>
    <div class="card">
      <p class="hint">Share this room code with everyone playing:</p>
      <div class="room-code">${room.code}</div>
      <p class="hint">${count} / 10 joined (need at least 7 to start)</p>
      <div class="player-list">`;
  ids.forEach(id => {
    html += `<div class="player-row"><span>${players[id].label} — ${esc(players[id].name)}${players[id].uid === myUid ? ' (you)' : ''}</span></div>`;
  });
  html += `</div>`;

  const roleSettingRow = (role, setting, title, desc) => `
    <div class="role-setting">
      <div class="role-setting-label">${title}<small>${desc}</small></div>
      <div class="toggle-row" data-role="${role}">
        <button class="choice ${setting === 'on' ? 'selected' : ''}" data-role="${role}" data-value="on">On</button>
        <button class="choice ${setting === 'off' ? 'selected' : ''}" data-role="${role}" data-value="off">Off</button>
        <button class="choice ${setting === 'random' ? 'selected' : ''}" data-role="${role}" data-value="random">Random</button>
      </div>
    </div>`;

  if (isHost) {
    html += `<button id="btn-toggle-expansions" class="secondary" type="button">🎭 Expansions &amp; Roles${configuredCount ? ` — ${configuredCount} configured` : ''}</button>`;
    html += `<div id="expansion-body" class="${expansionPanelOpen ? '' : 'hidden'}">
      <p class="hint">On = guaranteed in the game. Off = guaranteed out. Random = 50/50, decided when roles are dealt — and never announced either way.</p>
      <p class="hint" style="margin-top:10px;">Task Force expansion</p>`;
    html += roleSettingRow('watari', watariSetting, 'Watari', "A normal Investigator who knows L's identity from the start (and L knows Watari too). Watari is never one of L's 4 suspects.");
    html += roleSettingRow('npa', npaSetting, 'NPA Chief', "On L/N's team. Can never vote to skip — always names someone. If a vote fails to reach majority, the Chief may force an arrest anyway, choosing from whoever led the vote (or let it go).");
    html += roleSettingRow('misa', misaSetting, 'Misa', "Replaces the Kira Follower. Knows Kira's identity like any Follower, but has a one-time Shinigami Eyes power: instantly learn half of any player's real name, no mission needed — using it costs her the rest of that Information Phase. Requires a Follower to exist, so it has no effect in a game where X-Kira ends up active.");
    html += `<p class="hint" style="margin-top:10px;">Special Provisions for Kira</p>`;
    html += roleSettingRow('xKira', xKiraSetting, 'X-Kira', 'Replaces Kira. Starts with no Follower — once L\'s team reaches 3 points, X-Kira gets one chance to recruit one during a Voting Phase.');
    html += roleSettingRow('mello', melloSetting, 'Mello', "A neutral third team of one. Can attempt to steal the Death Note from Kira during the Information Phase — succeed, and Mello becomes the new Kira while the old Kira becomes the new Mello. Two failed attempts (by whoever currently holds the role), or an arrest, means elimination.");
    html += roleSettingRow('n', nSetting, 'N', "Replaces L. Instead of 4 suspects, N accuses one player per Information Phase — an innocent gets cleared for good, Mello gets identified, but Kira or the Follower gives nothing away. Limited Definitive Clears for the whole game (2 with 7-8 players, 3 with 9-10).");
    html += `</div>`;
  } else if (watariSetting === 'on' || xKiraSetting === 'on' || melloSetting === 'on' || nSetting === 'on' || npaSetting === 'on' || misaSetting === 'on') {
    const active = [watariSetting === 'on' && 'Watari (Task Force)', npaSetting === 'on' && 'NPA Chief (Task Force)', misaSetting === 'on' && 'Misa (Task Force)', xKiraSetting === 'on' && 'X-Kira (Special Provisions for Kira)', melloSetting === 'on' && 'Mello (Special Provisions for Kira)', nSetting === 'on' && 'N (Special Provisions for Kira)'].filter(Boolean);
    html += `<p class="hint">Expansion${active.length > 1 ? 's' : ''} active: ${active.join(', ')}</p>`;
  }

  if (isHost) {
    html += canStart
      ? `<button id="btn-start-game" class="primary">Deal Roles &amp; Start</button>`
      : `<p class="hint">Waiting for at least 7 players to join...</p>`;
  } else {
    html += `<p class="hint">Waiting for the host to start the game...</p>`;
  }
  html += `<button id="btn-leave-lobby" class="secondary">Leave Lobby</button>`;
  html += `</div>`;
  el('lobby-content').innerHTML = html;

  if (canStart) {
    el('btn-start-game').addEventListener('click', () => startGame(myRoomCode));
  }
  el('btn-leave-lobby').addEventListener('click', () => leaveLobby(myRoomCode));

  if (isHost) {
    el('btn-toggle-expansions').addEventListener('click', () => {
      expansionPanelOpen = !expansionPanelOpen;
      renderLobby(room);
    });
    document.querySelectorAll('.toggle-row .choice').forEach(btn => {
      btn.addEventListener('click', () => setExpansionRoleSetting(myRoomCode, btn.dataset.role, btn.dataset.value));
    });
  }
}

async function setExpansionRoleSetting(code, role, value) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.status !== 'lobby' || room.hostUid !== myUid) return room;
    room.settings = room.settings || {};
    room.settings[role] = value;
    return room;
  });
}

async function leaveLobby(code) {
  const leavingPlayerId = myPlayerId;
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.status !== 'lobby') return room;
    const players = obj(room.players);
    delete players[leavingPlayerId];
    const remainingIds = Object.keys(players);
    if (remainingIds.length === 0) return null;
    room.players = players;
    if (room.hostUid === myUid) {
      const nextHostId = remainingIds.sort()[0];
      room.hostUid = players[nextHostId].uid;
    }
    return room;
  });
  clearSession();
  detachRoomListener();
  currentRoomData = null;
  myRoomCode = null;
  myPlayerId = null;
  notesPanelInitialized = false;
  showScreen('screen-landing');
}

async function startGame(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.status !== 'lobby') return room;
    const playerIds = Object.keys(obj(room.players));
    const count = playerIds.length;
    if (count < 7 || count > 10) return room;
    const resolveRoleSetting = (setting) => setting === 'on' ? true : setting === 'random' ? Math.random() < 0.5 : false;
    const watariEnabled = resolveRoleSetting(room.settings && room.settings.watari);
    const xKiraEnabled = resolveRoleSetting(room.settings && room.settings.xKira);
    const melloEnabled = resolveRoleSetting(room.settings && room.settings.mello);
    const nEnabled = resolveRoleSetting(room.settings && room.settings.n);
    const npaEnabled = resolveRoleSetting(room.settings && room.settings.npa);
    const misaEnabled = resolveRoleSetting(room.settings && room.settings.misa);
    const fixedRoles = ['L', 'Kira']
      .concat(xKiraEnabled ? [] : ['KiraFollower'])
      .concat(watariEnabled ? ['Watari'] : [])
      .concat(melloEnabled ? ['Mello'] : [])
      .concat(npaEnabled ? ['NPAChief'] : []);
    const roles = shuffle(fixedRoles.concat(Array(count - fixedRoles.length).fill('Investigator')));
    const firstNames = shuffle(FIRST_NAMES).slice(0, count);
    const lastNames = shuffle(LAST_NAMES).slice(0, count);
    const secrets = {};
    playerIds.forEach((id, i) => {
      secrets[id] = {
        role: roles[i], firstName: firstNames[i], lastName: lastNames[i],
        alive: true, skipNextMission: false, skipNextInfo: false,
        wrongGuessCount: 0, immune: false, ready: false, wrongStealCount: 0
      };
    });
    room.secrets = secrets;
    room.lPlayerId = playerIds.find(id => secrets[id].role === 'L');
    room.kiraPlayerId = playerIds.find(id => secrets[id].role === 'Kira');
    // The resolved (post-coin-flip) outcome, distinct from room.settings.xKira
    // which stays 'on'/'off'/'random' as configured — every in-game check
    // needs the actual dealt result, not the pre-deal setting.
    room.xKiraActive = xKiraEnabled;
    // N reuses the 'L' role slot entirely (same trick as X-Kira reusing 'Kira') so
    // Watari's mutual reveal, X-Kira's recruit-immunity, arrest handling, and the
    // endgame guess all keep working unchanged — only display text branches on this.
    room.nActive = nEnabled;
    room.nClearCap = count <= 8 ? 2 : 3;
    // Misa reuses the 'KiraFollower' role slot the same way N/X-Kira reuse 'L'/'Kira',
    // so partner reveal, chat, swap, N's silent-accusation check, and X-Kira's
    // recruit-follower-exists check all keep working unchanged. She requires an
    // actual Follower to be dealt, so she's never active in the same game as X-Kira
    // (which starts with no Follower at all).
    room.misaActive = !xKiraEnabled && misaEnabled;
    // X-Kira starts without a Follower — one is only assigned if/when recruited mid-game.
    if (!xKiraEnabled) room.followerPlayerId = playerIds.find(id => secrets[id].role === 'KiraFollower');
    if (watariEnabled) room.watariPlayerId = playerIds.find(id => secrets[id].role === 'Watari');
    if (melloEnabled) room.melloPlayerId = playerIds.find(id => secrets[id].role === 'Mello');
    if (npaEnabled) room.npaPlayerId = playerIds.find(id => secrets[id].role === 'NPAChief');
    const missionDeck = buildMissionDeck(count);
    room.missionDeck = {};
    missionDeck.forEach((c, i) => { room.missionDeck[i] = c; });
    room.missionDeckIndex = 0;

    const supplyDeck = buildSupplyDeck();
    room.supplyDeck = {};
    supplyDeck.forEach((c, i) => { room.supplyDeck[i] = c; });
    room.supplyDeckIndex = 0;
    room.supplyDiscard = {};
    room.supplyHands = {};
    playerIds.forEach((id) => {
      const dealt = drawSupplyCards(room, 3);
      room.supplyHands[id] = {};
      dealt.forEach((c) => { room.supplyHands[id][c.id] = c.color; });
    });

    room.status = 'reveal';
    return room;
  });
}

/* ---------------- REVEAL ---------------- */

function renderReveal(room) {
  const mySecret = obj(room.secrets)[myPlayerId];
  if (!mySecret) return;
  let roleName, roleDesc;
  const isXKira = mySecret.role === 'Kira' && !!room.xKiraActive;
  if (isXKira) {
    roleName = 'You are X-KIRA';
    roleDesc = `You lead the evil team alone — no Follower to start. Kill investigators by correctly guessing their secret names. Once ${room.nActive ? 'N' : "L"}'s team reaches 3 points, you can try to recruit a Follower during the Voting Phase. Avoid being arrested.`;
  } else if (mySecret.role === 'Kira') {
    roleName = 'You are KIRA';
    roleDesc = "You lead the evil team. Coordinate with your Follower during the Information Phase. Kill investigators by correctly guessing their secret names. Avoid being arrested.";
  } else if (mySecret.role === 'KiraFollower' && room.misaActive) {
    roleName = 'You are MISA';
    roleDesc = "You know who Kira is, and you're utterly devoted to them. You traded half your remaining lifespan for Shinigami Eyes — once for the whole game, you can look at any other player and instantly learn either their first or last name, no mission needed. Using it costs you the rest of that Information Phase.";
  } else if (mySecret.role === 'KiraFollower') {
    roleName = "You are KIRA'S FOLLOWER";
    roleDesc = "You know who Kira is. Help them strategize over a private chat you two can use any time, all game long — not just during the Information Phase. Only Kira can write in the Death Note or swap it with you — if they choose to swap, you become Kira yourself.";
  } else if (mySecret.role === 'L' && room.nActive) {
    roleName = 'You are N';
    const cap = room.nClearCap || 2;
    roleDesc = `Where L works from instinct, you work from proof. Each Information Phase you may accuse one player: an innocent gets cleared for good, Mello (if he's in this game) gets identified to you, but Kira or the Follower gives you nothing — silence is a clue too. You have ${cap} Definitive Clears for the whole game; accusing Kira, the Follower, or Mello never spends one.`;
  } else if (mySecret.role === 'L') {
    roleName = 'You are L';
    roleDesc = "Each Information Phase you'll be shown 4 suspects — one is truly Kira. Use missions and votes to find and arrest Kira before it's too late.";
  } else if (mySecret.role === 'Watari') {
    roleName = 'You are WATARI';
    roleDesc = "You're a normal Investigator in every way that matters — vote, join missions, help find Kira. The one difference: you know L's identity from the start, and L knows you. You're never one of L's 4 suspects.";
  } else if (mySecret.role === 'Mello') {
    roleName = 'You are MELLO';
    roleDesc = "A team of one — not with L, not with Kira. Your goal: steal the Death Note and become the new Kira yourself. During the Information Phase you can guess who's holding it. You get 2 attempts total, for as long as you hold this role — fail both, or get arrested, and you're eliminated.";
  } else if (mySecret.role === 'NPAChief') {
    roleName = 'You are NPA CHIEF';
    roleDesc = `A normal Investigator on ${room.nActive ? "N" : 'L'}'s side, bound to your post: you can never vote to skip — always name someone. If a vote ever fails to reach a majority, you alone may force an arrest anyway, choosing from whoever led the vote — or let it go, if you don't like the odds.`;
  } else {
    roleName = 'You are an INVESTIGATOR';
    roleDesc = "You're on L's side. Vote wisely and help complete missions to expose Kira.";
  }

  let partnerHtml = '';
  const players = obj(room.players);
  if (mySecret.role === 'Kira' && room.followerPlayerId && players[room.followerPlayerId]) {
    const f = players[room.followerPlayerId];
    partnerHtml = `<div class="role-desc">Your Follower is <strong>Investigator ${f.label} — ${esc(f.name)}</strong>.</div>`;
  } else if (mySecret.role === 'KiraFollower' && room.kiraPlayerId && players[room.kiraPlayerId]) {
    const k = players[room.kiraPlayerId];
    partnerHtml = `<div class="role-desc">Kira is <strong>Investigator ${k.label} — ${esc(k.name)}</strong>.</div>`;
  } else if (mySecret.role === 'Watari' && room.lPlayerId && players[room.lPlayerId]) {
    const l = players[room.lPlayerId];
    partnerHtml = `<div class="role-desc">${room.nActive ? 'N' : 'L'} is <strong>Investigator ${l.label} — ${esc(l.name)}</strong>.</div>`;
  } else if (mySecret.role === 'L' && room.watariPlayerId && players[room.watariPlayerId]) {
    const w = players[room.watariPlayerId];
    partnerHtml = `<div class="role-desc">Watari is <strong>Investigator ${w.label} — ${esc(w.name)}</strong>.</div>`;
  }

  const ready = !!mySecret.ready;
  let html = `<h2>Your Secret Role</h2>
    <div class="card">
      <div class="role-box">
        <div class="role-name">${roleName}</div>
        <div class="role-names">Your secret name: <strong>${mySecret.firstName} ${mySecret.lastName}</strong></div>
        <div class="role-desc">${roleDesc}</div>
        ${partnerHtml}
      </div>`;
  if (!ready) {
    html += `<button id="btn-ready" class="primary">I've Memorized My Role — Ready</button>`;
  } else {
    const secrets = obj(room.secrets);
    const readyCount = Object.values(secrets).filter(s => s.ready).length;
    html += `<p class="hint">Waiting for everyone else... (${readyCount}/${Object.keys(players).length} ready)</p>`;
  }
  html += `</div>`;
  el('reveal-content2').innerHTML = html;

  if (!ready) {
    el('btn-ready').addEventListener('click', () => markReady(myRoomCode, myPlayerId));
  }
  maybeStartRound(room, myRoomCode);
}

async function markReady(code, playerId) {
  await update(ref(db, `rooms/${code}/secrets/${playerId}`), { ready: true });
}

async function maybeStartRound(room, code) {
  if (room.status !== 'reveal') return;
  const secrets = obj(room.secrets);
  const players = obj(room.players);
  const ids = Object.keys(players);
  if (ids.length === 0 || !ids.every(id => secrets[id] && secrets[id].ready)) return;
  await runTransaction(ref(db, `rooms/${code}`), (r) => {
    if (!r || r.status !== 'reveal') return r;
    const s = obj(r.secrets), p = obj(r.players);
    if (!Object.keys(p).every(id => s[id] && s[id].ready)) return r;
    r.status = 'playing';
    r.round = 1;
    r.phase = 'deaths';
    return r;
  });
}

/* ---------------- ROUND DISPATCH ---------------- */

function updateHeader(room) {
  el('round-label').textContent = `Round ${room.round || 1}`;
  el('score-label').textContent = `${room.nActive ? 'N' : 'L'}: ${room.lScore || 0}  |  Kira: ${room.kiraScore || 0}`;
}

function renderRound(room) {
  updateHeader(room);
  initNotesPanel(room);
  updateNotesLockState(room);
  initKiraChatPanel();
  updateKiraChatPanel(room);
  if (room.endgame && room.endgame.active && !room.endgame.resolved) return renderEndgame(room);
  if (room.phase === 'deaths') return renderDeathsPhase(room);
  if (room.phase === 'mission') return renderMissionPhase(room);
  if (room.phase === 'voting') return renderVotingPhase(room);
  if (room.phase === 'information') return renderInformationPhase(room);
}

/* ---------------- PRIVATE NOTES (per-player scratchpad, persists all game) ---------------- */

let notesPanelInitialized = false;
let notesSaveTimer = null;

function initNotesPanel(room) {
  if (notesPanelInitialized) return;
  notesPanelInitialized = true;

  const textarea = el('notes-textarea');
  textarea.value = (obj(room.notes)[myPlayerId]) || '';

  el('btn-notes-toggle').addEventListener('click', () => {
    el('notes-body').classList.toggle('hidden');
  });

  textarea.addEventListener('input', () => {
    el('notes-saved-indicator').textContent = 'Typing...';
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => saveNotes(myRoomCode, myPlayerId, textarea.value), 600);
  });

  // The 600ms debounce above is only for the live "Typing..." indicator while
  // actively typing. If the player switches away before it fires -- taps back
  // into the game, their phone locks, the tab gets backgrounded -- a pending
  // save must not be lost, so flush it immediately on both signals.
  const flushPendingSave = () => {
    if (notesSaveTimer) {
      clearTimeout(notesSaveTimer);
      notesSaveTimer = null;
      saveNotes(myRoomCode, myPlayerId, textarea.value);
    }
  };
  textarea.addEventListener('blur', flushPendingSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });
}

function updateNotesLockState(room) {
  const info = obj(room.info);
  const locked = room.phase === 'information' && !!obj(info.sittingOutIds)[myPlayerId];
  const textarea = el('notes-textarea');
  const hint = el('notes-locked-hint');
  if (textarea) textarea.disabled = locked;
  if (hint) hint.classList.toggle('hidden', !locked);
}

async function saveNotes(code, playerId, text) {
  await set(ref(db, `rooms/${code}/notes/${playerId}`), text || null);
  const indicator = el('notes-saved-indicator');
  if (indicator) indicator.textContent = 'Saved';
}

/* ---------------- KIRA TEAM CHAT (persistent panel, available every phase) ---------------- */

let kiraChatPanelInitialized = false;

function initKiraChatPanel() {
  if (kiraChatPanelInitialized) return;
  kiraChatPanelInitialized = true;

  el('btn-kira-chat-toggle').addEventListener('click', () => {
    el('kira-chat-body').classList.toggle('hidden');
  });

  const chatInput = el('kira-chat-input');
  const sendChat = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    sendChatMessage(myRoomCode, text);
  };
  el('btn-kira-chat-send').addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
}

function updateKiraChatPanel(room) {
  const panel = el('kira-chat-panel');
  if (!panel) return;
  const amKiraTeam = myPlayerId === room.kiraPlayerId || myPlayerId === room.followerPlayerId;
  const visible = amKiraTeam && !!room.followerPlayerId;
  panel.classList.toggle('hidden', !visible);
  if (!visible) return;

  el('kira-chat-toggle-label').textContent = `Chat with your ${myPlayerId === room.kiraPlayerId ? 'Follower' : 'Kira'}`;

  // The Information-Phase-specific restrictions (Misa's Shinigami Eyes cost,
  // the arrest sit-out) still block chat, but only during that one phase --
  // this panel is otherwise available across every other phase of the game.
  let restricted = false, restrictedReason = '';
  if (room.phase === 'information') {
    const info = obj(room.info);
    if (obj(info.sittingOutIds)[myPlayerId]) {
      restricted = true;
      restrictedReason = "You're sitting out this Information Phase.";
    } else if (room.misaActive && myPlayerId === room.followerPlayerId && info.misaUsedThisPhase) {
      restricted = true;
      restrictedReason = 'Your Shinigami Eyes cost you this Information Phase.';
    }
  }

  const chatLog = el('kira-chat-log');
  const chatInput = el('kira-chat-input');
  const sendBtn = el('btn-kira-chat-send');
  const restrictedHint = el('kira-chat-restricted-hint');

  if (restrictedHint) restrictedHint.classList.toggle('hidden', !restricted);
  if (restrictedHint) restrictedHint.textContent = restrictedReason;
  if (chatInput) chatInput.disabled = restricted;
  if (sendBtn) sendBtn.disabled = restricted;
  if (chatLog) {
    chatLog.innerHTML = renderChatLog(obj(room.kiraChat), obj(room.players));
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

/* ---------------- KIRA TURN TIMER ---------------- */

// Runs silently in the background on every device's own local clock -- no
// live-updating countdown shown on screen (that used to re-render every
// second and was disruptive during real playtesting). Players just get a
// single 30-second warning toast, then the auto-finish safety net still
// fires exactly as before once time actually runs out.
let kiraTurnAutoFinishTriggered = false;
let kiraTurnWarningShown = false;
const KIRA_TURN_WARNING_MS = 30 * 1000;

setInterval(() => {
  if (!currentRoomData || currentRoomData.phase !== 'information') {
    kiraTurnAutoFinishTriggered = false;
    kiraTurnWarningShown = false;
    return;
  }
  const info = obj(currentRoomData.info);
  if (info.kiraDone || !info.kiraDeadline) return;
  const remainingMs = info.kiraDeadline - Date.now();
  if (remainingMs <= 0) {
    if (!kiraTurnAutoFinishTriggered) {
      kiraTurnAutoFinishTriggered = true;
      finishKiraTeamTurn(myRoomCode);
    }
    return;
  }
  if (remainingMs <= KIRA_TURN_WARNING_MS && !kiraTurnWarningShown) {
    kiraTurnWarningShown = true;
    showToast("<p><strong>30 seconds left for Kira's team to finish this phase...</strong></p>");
  }
}, 1000);

function applyWinCheck(room) {
  if (room.status === 'gameover') return;
  if ((room.kiraScore || 0) >= 10) {
    room.status = 'gameover';
    room.gameOverInfo = { winner: 'Kira', reason: "Kira's team reached 10 points." };
    return;
  }
  const detectiveLabel = room.nActive ? 'N' : 'L';
  if ((room.lScore || 0) >= 10) {
    room.status = 'gameover';
    room.gameOverInfo = { winner: 'L', reason: `${detectiveLabel}'s team reached 10 points.` };
    return;
  }
  const l = room.secrets && room.secrets[room.lPlayerId];
  if (l && !l.alive) {
    room.status = 'gameover';
    room.gameOverInfo = { winner: 'Kira', reason: `${detectiveLabel} has been killed.` };
  }
}

/* ---------------- DEATHS PHASE ---------------- */

function renderDeathsPhase(room) {
  const players = obj(room.players);
  const deaths = Object.keys(obj(room.pendingDeaths));
  let html = `<h2>Deaths Phase</h2><div class="card">`;
  if (deaths.length === 0) html += `<p>No one has died... yet.</p>`;
  else deaths.forEach(id => { html += `<p>Investigator ${players[id].label} has died.</p>`; });
  if (deaths.includes(room.watariPlayerId)) {
    html += `<p class="watari-alert">Watari has died... All data deletion.</p>`;
  }
  html += `<button id="btn-deaths-continue" class="primary">Continue</button></div>`;
  el('round-content').innerHTML = html;
  el('btn-deaths-continue').addEventListener('click', () => continueFromDeaths(myRoomCode));
}

async function continueFromDeaths(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'deaths') return room;
    room.pendingDeaths = null;
    const players = obj(room.players), secrets = obj(room.secrets);
    const eligible = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && !secrets[id].skipNextMission);
    const leaderId = eligible[Math.floor(Math.random() * eligible.length)];
    // Two cards are drawn and offered to the leader -- the unpicked one is
    // discarded (never returned to the deck). Once chosen, the card is fixed
    // for the round -- rejected team proposals (the approval-vote retry) pick
    // a new leader/team but never a new card.
    const cardChoices = { 0: drawMissionCard(room), 1: drawMissionCard(room) };
    room.mission = { leaderId, teamIds: { [leaderId]: true }, result: null, step: 'choose_card', rejectionCount: 0, cardChoices };
    room.phase = 'mission';
    return room;
  });
}

/* ---------------- MISSION PHASE ---------------- */

function renderMissionPhase(room) {
  const m = obj(room.mission);
  const players = obj(room.players);
  const secrets = obj(room.secrets);
  const leader = players[m.leaderId];
  const isLeader = m.leaderId === myPlayerId;

  let html = `<h2>Mission Phase</h2><div class="card">`;
  html += `<p><strong>Leading Investigator: ${leader ? leader.label + ' — ' + esc(leader.name) : '...'}</strong></p>`;

  if (m.step === 'choose_card') {
    if (isLeader) {
      html += `<p class="hint">Choose one of these two Mission Cards. The card you don't pick is discarded.</p>`;
      html += `<div id="card-choice-list" class="card-face-row">`;
      Object.entries(obj(m.cardChoices)).forEach(([key, c]) => {
        html += missionCardFaceHtml(c, { tag: 'button', extraClass: 'card-choice-btn', extraAttrs: `type="button" data-key="${key}"` });
      });
      html += `</div>`;
    } else {
      html += `<p class="waiting">Waiting for ${leader ? leader.label : '...'} to choose a Mission Card...</p>`;
    }
    html += `</div>`;
    el('round-content').innerHTML = html;
    if (isLeader) {
      document.querySelectorAll('#card-choice-list .card-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => chooseMissionCard(myRoomCode, btn.dataset.key));
      });
    }
    return;
  }

  const card = m.card || {};
  const cardNameShareLabel = { first: 'First Names', last: 'Last Names', both: 'Both Names' }[card.nameShare] || '';
  html += missionCardFaceHtml(card, { extraClass: 'small readonly' });
  html += `<p class="hint">This round's Mission Card — Share: ${cardNameShareLabel}</p>`;

  if (m.step === 'team') {
    const teamIds = obj(m.teamIds);
    const teamCount = Object.keys(teamIds).length;
    if (isLeader) {
      html += `<p class="hint">Choose ${card.teamSize} players total to join this meeting (you're included automatically). (${teamCount}/${card.teamSize} selected)</p>`;
      const eligible = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && !secrets[id].skipNextMission);
      const atCap = teamCount >= card.teamSize;
      html += `<div id="mission-team-list">`;
      eligible.forEach(id => {
        const selected = !!teamIds[id];
        const locked = id === m.leaderId;
        const disabled = locked || (atCap && !selected);
        html += `<button class="choice ${selected ? 'selected' : ''}" data-id="${id}" ${disabled ? 'disabled' : ''}>${selected ? '✓ ' : ''}${players[id].label} — ${esc(players[id].name)}${locked ? ' (leader)' : ''}</button>`;
      });
      html += `</div><button id="btn-mission-confirm" class="primary" ${teamCount === card.teamSize ? '' : 'disabled'}>Confirm Team</button>`;
    } else {
      html += `<p class="waiting">Waiting for ${leader ? leader.label : '...'} to choose the mission team...</p>`;
    }
  } else if (m.step === 'approve') {
    const teamIds = Object.keys(obj(m.teamIds));
    const votes = obj(m.approvalVotes);
    const aliveIds = Object.keys(players).filter(id => secrets[id] && secrets[id].alive);
    html += `<p class="hint">Team: ${teamIds.map(id => players[id].label).join(', ')}</p>
      <p class="hint">Everyone votes Yes or No on this team. Majority rules — a tie counts as No.</p>`;
    if (!m.approvalResolved) {
      if ((m.rejectionCount || 0) >= 1) {
        html += `<p class="hint"><strong>This mission was already rejected once — reject this team too and the mission automatically fails.</strong></p>`;
      }
      if (votes[myPlayerId] !== undefined) {
        html += `<p class="waiting">Vote cast. Waiting for others... (${Object.keys(votes).length}/${aliveIds.length} voted)</p>`;
      } else {
        html += `<div id="approve-choices">
          <button class="choice" data-vote="yes">Yes</button>
          <button class="choice" data-vote="no">No</button>
        </div>`;
      }
    } else {
      html += `<h3>Votes</h3>`;
      aliveIds.forEach(id => {
        const v = votes[id];
        html += `<div class="player-row"><span>${players[id].label} — ${esc(players[id].name)}</span><span>${v === 'yes' ? 'Yes' : 'No'}</span></div>`;
      });
      if (m.approved) {
        html += `<p><strong>Team APPROVED — the mission proceeds.</strong></p>`;
      } else if (m.autoFailed) {
        html += `<p><strong>Team REJECTED a second time — this mission automatically fails. Kira's team gains a point.</strong></p>`;
      } else {
        html += `<p><strong>Team REJECTED — a new Leading Investigator will be chosen for the same mission.</strong></p>`;
      }
      html += `<button id="btn-approve-continue" class="primary">Continue</button>`;
    }
  } else if (m.step === 'play_cards') {
    const teamIds = Object.keys(obj(m.teamIds));
    const submitted = obj(m.playedSubmitted);
    const onTeam = teamIds.includes(myPlayerId);
    html += `<p class="hint">Team: ${teamIds.map(id => players[id].label).join(', ')}</p>
      <p class="hint">Everyone on the mission plays Supply Cards face-down — at least 1 each. ${card.color === 'white' ? 'White' : 'Black'} or Gray cards help the total; the opposite color hurts it.</p>`;
    if (onTeam) {
      if (submitted[myPlayerId]) {
        html += `<p class="waiting">Cards played. Waiting for others... (${Object.keys(submitted).length}/${teamIds.length} played)</p>`;
      } else {
        const hand = obj(obj(room.supplyHands)[myPlayerId]);
        const handIds = Object.keys(hand);
        const pending = obj(obj(m.pendingPlaySelections)[myPlayerId]);
        const selectedCount = Object.keys(pending).length;
        const minRequired = Math.min(1, handIds.length);
        if (handIds.length === 0) {
          html += `<p class="hint">You have no Supply Cards left to play.</p>`;
        } else {
          html += `<div id="hand-list" class="card-face-row">`;
          handIds.forEach((id) => {
            const selected = !!pending[id];
            html += supplyCardFaceHtml(hand[id], { tag: 'button', extraClass: `small ${selected ? 'selected' : ''}`, extraAttrs: `type="button" data-id="${id}"` });
          });
          html += `</div>`;
        }
        html += `<button id="btn-play-cards" class="primary" ${selectedCount >= minRequired ? '' : 'disabled'}>Play ${selectedCount} Card${selectedCount === 1 ? '' : 's'}</button>`;
      }
    } else {
      html += `<p class="waiting">The mission team is playing their Supply Cards...</p>`;
    }
  } else if (m.step === 'result') {
    const teamIds = Object.keys(obj(m.teamIds));
    const breakdown = obj(m.cardBreakdown);
    const parts = [];
    if (breakdown.black) parts.push(`${breakdown.black} Black`);
    if (breakdown.white) parts.push(`${breakdown.white} White`);
    if (breakdown.gray) parts.push(`${breakdown.gray} Gray`);
    html += `<p class="hint">Team: ${teamIds.map(id => players[id].label).join(', ')}</p>`;
    html += `<p class="hint">Cards played: ${parts.join(', ') || 'none'} — total value <strong>${m.cardTotal}</strong> vs. threshold <strong>${card.points}</strong>. (Who played what stays hidden.)</p>`;
    html += m.result === 'success'
      ? `<p><strong>Mission SUCCEEDED! ${room.nActive ? 'N' : 'L'} +1</strong></p>`
      : `<p><strong>Mission FAILED! Kira +1</strong></p>`;
    html += `<button id="btn-result-continue" class="primary">Continue</button>`;
  } else if (m.step === 'redistribute') {
    const teamIds = Object.keys(obj(m.teamIds));
    const pool = obj(m.redistributePool);
    const poolIds = Object.keys(pool);
    html += `<p class="hint">Team: ${teamIds.map(id => players[id].label).join(', ')}</p>`;
    if (isLeader) {
      html += `<p class="hint">Hand out these ${poolIds.length} drawn Supply Card${poolIds.length === 1 ? '' : 's'} to the team (max 3 per person). Anything left over when you finish is discarded.</p>`;
      if (poolIds.length > 0) {
        html += `<div id="redistribute-pool">`;
        poolIds.forEach((id) => {
          html += `<div class="player-row">`;
          html += supplyCardFaceHtml(pool[id], { extraClass: 'small readonly' });
          html += `<span>`;
          teamIds.forEach((tid) => {
            const handSize = Object.keys(obj(obj(room.supplyHands)[tid])).length;
            const atCap = handSize >= 3;
            html += `<button class="choice give-btn" data-card="${id}" data-target="${tid}" ${atCap ? 'disabled' : ''}>Give to ${players[tid].label}</button>`;
          });
          html += `</span></div>`;
        });
        html += `</div>`;
      }
      html += `<h3>Team Hands</h3>`;
      teamIds.forEach((tid) => {
        const handSize = Object.keys(obj(obj(room.supplyHands)[tid])).length;
        html += `<div class="player-row"><span>${players[tid].label} — ${esc(players[tid].name)}</span><span>${handSize}/3</span></div>`;
      });
      html += `<button id="btn-redistribute-finish" class="primary">Finish Redistribution</button>`;
    } else {
      html += `<p class="waiting">Waiting for ${leader ? leader.label : '...'} to hand out the Supply Cards drawn for the team...</p>`;
    }
  } else if (m.step === 'share') {
    const teamIds = Object.keys(obj(m.teamIds));
    const onMission = teamIds.includes(myPlayerId);
    html += `<p><strong>Mission ${m.result === 'success' ? `succeeded! ${room.nActive ? 'N' : 'L'} +1` : 'failed! Kira +1'}</strong></p>`;

    const shareTypeLabel = { first: 'first name', last: 'last name', both: 'name' }[m.shareType] || 'name';

    if (teamIds.length < 2) {
      html += `<p class="hint">Only one player was on this mission — no names to share.</p>
        <button id="btn-mission-done" class="primary">Continue</button>`;
    } else if (onMission) {
      const assignment = obj(m.shareAssignment);
      const sourceId = assignment[myPlayerId];
      const source = players[sourceId];
      const secretSource = secrets[sourceId] || {};
      const sharedValue = m.shareType === 'first' ? secretSource.firstName
        : m.shareType === 'last' ? secretSource.lastName
        : `${secretSource.firstName} ${secretSource.lastName}`;
      const learnerOfMineId = Object.keys(assignment).find(l => assignment[l] === myPlayerId);
      const learnerOfMine = players[learnerOfMineId];
      html += `<p><strong>You learned ${source ? source.label : '?'}'s ${shareTypeLabel}: ${esc(sharedValue)}</strong></p>`;
      if (learnerOfMine) {
        html += `<p class="hint">${learnerOfMine.label} learned your ${shareTypeLabel}.</p>`;
      }
      html += `<button id="btn-mission-done" class="primary">Continue</button>`;
    } else {
      html += `<p class="hint">Players on the mission shared ${shareTypeLabel}s with each other.</p>
        <button id="btn-mission-done" class="primary">Continue</button>`;
    }
  }
  html += `</div>`;
  el('round-content').innerHTML = html;

  if (m.step === 'team' && isLeader) {
    document.querySelectorAll('#mission-team-list .choice').forEach(btn => {
      btn.addEventListener('click', () => toggleMissionTeam(myRoomCode, btn.dataset.id));
    });
    el('btn-mission-confirm').addEventListener('click', () => confirmMissionTeam(myRoomCode));
  }
  if (m.step === 'approve') {
    if (!m.approvalResolved) {
      document.querySelectorAll('#approve-choices .choice').forEach(btn => {
        btn.addEventListener('click', () => castTeamApprovalVote(myRoomCode, btn.dataset.vote));
      });
    } else {
      const continueBtn = el('btn-approve-continue');
      if (continueBtn) continueBtn.addEventListener('click', () => continueFromTeamApproval(myRoomCode));
    }
    maybeResolveTeamApproval(room, myRoomCode);
  }
  if (m.step === 'play_cards') {
    const teamIds = Object.keys(obj(m.teamIds));
    if (teamIds.includes(myPlayerId) && !obj(m.playedSubmitted)[myPlayerId]) {
      document.querySelectorAll('#hand-list .card-face').forEach(btn => {
        btn.addEventListener('click', () => togglePlayCardSelection(myRoomCode, btn.dataset.id));
      });
      const playBtn = el('btn-play-cards');
      if (playBtn) playBtn.addEventListener('click', () => submitPlayedCards(myRoomCode));
    }
    maybeResolvePlayedCards(room, myRoomCode);
  }
  if (m.step === 'result') {
    const continueBtn = el('btn-result-continue');
    if (continueBtn) continueBtn.addEventListener('click', () => continueFromMissionResult(myRoomCode));
  }
  if (m.step === 'redistribute' && isLeader) {
    document.querySelectorAll('#redistribute-pool .give-btn').forEach(btn => {
      btn.addEventListener('click', () => giveRedistributeCard(myRoomCode, btn.dataset.card, btn.dataset.target));
    });
    const finishBtn = el('btn-redistribute-finish');
    if (finishBtn) finishBtn.addEventListener('click', () => finishRedistribution(myRoomCode));
  }
  if (m.step === 'share') {
    const doneBtn = el('btn-mission-done');
    if (doneBtn) doneBtn.addEventListener('click', () => continueFromMissionShare(myRoomCode));
  }
}

async function chooseMissionCard(code, choiceKey) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'choose_card') return room;
    if (myPlayerId !== room.mission.leaderId) return room;
    const choices = obj(room.mission.cardChoices);
    const chosen = choices[choiceKey];
    if (!chosen) return room;
    room.mission.card = chosen;
    room.mission.cardChoices = null;
    room.mission.step = 'team';
    return room;
  });
}
async function toggleMissionTeam(code, playerId) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'team') return room;
    if (playerId === room.mission.leaderId) return room;
    room.mission.teamIds = obj(room.mission.teamIds);
    if (room.mission.teamIds[playerId]) {
      delete room.mission.teamIds[playerId];
    } else {
      // Team size is fixed by the drawn Mission Card -- can't select more than it calls for.
      if (Object.keys(room.mission.teamIds).length >= room.mission.card.teamSize) return room;
      room.mission.teamIds[playerId] = true;
    }
    return room;
  });
}
async function confirmMissionTeam(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'team') return room;
    if (Object.keys(obj(room.mission.teamIds)).length !== room.mission.card.teamSize) return room;
    room.mission.step = 'approve';
    room.mission.approvalVotes = {};
    room.mission.approvalResolved = false;
    return room;
  });
}

async function castTeamApprovalVote(code, choice) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'approve' || room.mission.approvalResolved) return room;
    if (!room.secrets[myPlayerId] || !room.secrets[myPlayerId].alive) return room;
    if (choice !== 'yes' && choice !== 'no') return room;
    room.mission.approvalVotes = obj(room.mission.approvalVotes);
    room.mission.approvalVotes[myPlayerId] = choice;
    return room;
  });
}

async function maybeResolveTeamApproval(room, code) {
  const m = obj(room.mission);
  if (room.phase !== 'mission' || m.step !== 'approve' || m.approvalResolved) return;
  const players = obj(room.players), secrets = obj(room.secrets);
  const aliveIds = Object.keys(players).filter(id => secrets[id] && secrets[id].alive);
  const votes = obj(m.approvalVotes);
  if (!aliveIds.every(id => votes[id] !== undefined)) return;

  await runTransaction(ref(db, `rooms/${code}`), (r) => {
    if (!r || r.phase !== 'mission' || r.mission.step !== 'approve' || r.mission.approvalResolved) return r;
    const p = obj(r.players), s = obj(r.secrets), v = obj(r.mission.approvalVotes);
    const alive2 = Object.keys(p).filter(id => s[id] && s[id].alive);
    if (!alive2.every(id => v[id] !== undefined)) return r;

    let yes = 0, no = 0;
    alive2.forEach(id => { if (v[id] === 'yes') yes++; else no++; });
    // Tie counts as No.
    const approved = yes > no;
    r.mission.approvalResolved = true;
    r.mission.approved = approved;

    if (!approved) {
      r.mission.rejectionCount = (r.mission.rejectionCount || 0) + 1;
      if (r.mission.rejectionCount >= 2) {
        r.mission.autoFailed = true;
        r.kiraScore = (r.kiraScore || 0) + 1;
        applyWinCheck(r);
      }
    }
    return r;
  });
}

async function continueFromTeamApproval(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'approve' || !room.mission.approvalResolved) return room;
    if (room.mission.approved) {
      room.mission.step = 'play_cards';
      room.mission.cardsPlayed = {};
      room.mission.pendingPlaySelections = {};
      return room;
    }
    if (room.mission.autoFailed) {
      room.phase = 'voting';
      room.voting = { resolved: false };
      return room;
    }
    // Rejected once -- same mission card, a new Leading Investigator picks a fresh team.
    const players = obj(room.players), secrets = obj(room.secrets);
    const prevLeaderId = room.mission.leaderId;
    let eligible = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && !secrets[id].skipNextMission && id !== prevLeaderId);
    if (eligible.length === 0) {
      eligible = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && !secrets[id].skipNextMission);
    }
    const newLeaderId = eligible[Math.floor(Math.random() * eligible.length)];
    room.mission.leaderId = newLeaderId;
    room.mission.teamIds = { [newLeaderId]: true };
    room.mission.step = 'team';
    room.mission.approvalVotes = {};
    room.mission.approvalResolved = false;
    room.mission.approved = false;
    return room;
  });
}

async function togglePlayCardSelection(code, cardId) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'play_cards') return room;
    const teamIds = obj(room.mission.teamIds);
    if (!teamIds[myPlayerId]) return room;
    if (obj(room.mission.playedSubmitted)[myPlayerId]) return room;
    const hand = obj(obj(room.supplyHands)[myPlayerId]);
    if (hand[cardId] === undefined) return room;
    room.mission.pendingPlaySelections = obj(room.mission.pendingPlaySelections);
    room.mission.pendingPlaySelections[myPlayerId] = obj(room.mission.pendingPlaySelections[myPlayerId]);
    const mine = room.mission.pendingPlaySelections[myPlayerId];
    if (mine[cardId]) delete mine[cardId]; else mine[cardId] = true;
    return room;
  });
}

// Every player must play at least 1 Supply Card into the mission (0 is only
// allowed if their hand is genuinely empty). Cards are played face-down --
// this moves them from hand to discard and records the colors played, but
// nothing here reveals who played what.
async function submitPlayedCards(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'play_cards') return room;
    const teamIds = obj(room.mission.teamIds);
    if (!teamIds[myPlayerId]) return room;
    room.mission.cardsPlayed = obj(room.mission.cardsPlayed);
    room.mission.playedSubmitted = obj(room.mission.playedSubmitted);
    if (room.mission.playedSubmitted[myPlayerId]) return room;
    const hand = obj(obj(room.supplyHands)[myPlayerId]);
    const handIds = Object.keys(hand);
    const selection = Object.keys(obj(obj(room.mission.pendingPlaySelections)[myPlayerId]));
    const minRequired = Math.min(1, handIds.length);
    if (selection.length < minRequired) return room;
    if (!selection.every(id => hand[id] !== undefined)) return room;

    const played = {};
    room.supplyHands[myPlayerId] = obj(room.supplyHands[myPlayerId]);
    room.supplyDiscard = obj(room.supplyDiscard);
    selection.forEach((id) => {
      const color = room.supplyHands[myPlayerId][id];
      played[id] = color;
      delete room.supplyHands[myPlayerId][id];
      room.supplyDiscard[id] = color;
    });
    room.mission.cardsPlayed[myPlayerId] = played;
    // A player who plays 0 cards (empty hand) would leave cardsPlayed[id] as
    // an empty object, which Firebase silently prunes away -- so submission
    // is tracked separately via this always-truthy marker instead.
    room.mission.playedSubmitted[myPlayerId] = true;
    if (room.mission.pendingPlaySelections) delete room.mission.pendingPlaySelections[myPlayerId];
    return room;
  });
}

async function maybeResolvePlayedCards(room, code) {
  const m = obj(room.mission);
  if (room.phase !== 'mission' || m.step !== 'play_cards') return;
  const teamIds = Object.keys(obj(m.teamIds));
  const submitted = obj(m.playedSubmitted);
  if (!teamIds.every(id => submitted[id])) return;

  await runTransaction(ref(db, `rooms/${code}`), (r) => {
    if (!r || r.phase !== 'mission' || r.mission.step !== 'play_cards') return r;
    const tIds = Object.keys(obj(r.mission.teamIds));
    const sub = obj(r.mission.playedSubmitted);
    if (!tIds.every(id => sub[id])) return r;
    const pl = obj(r.mission.cardsPlayed);

    const missionColor = r.mission.card.color;
    let total = 0;
    const breakdown = { black: 0, white: 0, gray: 0 };
    tIds.forEach((id) => {
      Object.values(obj(pl[id])).forEach((color) => {
        breakdown[color] = (breakdown[color] || 0) + 1;
        total += supplyCardValue(color, missionColor);
      });
    });
    const success = total >= r.mission.card.points;
    r.mission.cardTotal = total;
    r.mission.cardBreakdown = breakdown;
    r.mission.result = success ? 'success' : 'fail';
    if (success) r.lScore = (r.lScore || 0) + 1; else r.kiraScore = (r.kiraScore || 0) + 1;
    r.mission.step = 'result';
    applyWinCheck(r);

    // Name-share type is dictated by the drawn Mission Card, not chosen by the
    // leader -- compute the pairing immediately once the result is in.
    if (tIds.length >= 2) {
      const shareType = r.mission.card.nameShare;
      const knownNames = obj(r.knownNames);
      const assignment = computeShareAssignment(tIds, knownNames, shareType);
      r.mission.shareType = shareType;
      r.mission.shareAssignment = assignment;

      r.knownNames = knownNames;
      Object.entries(assignment).forEach(([learner, source]) => {
        r.knownNames[learner] = obj(r.knownNames[learner]);
        r.knownNames[learner][source] = obj(r.knownNames[learner][source]);
        if (shareType === 'first' || shareType === 'both') r.knownNames[learner][source].first = true;
        if (shareType === 'last' || shareType === 'both') r.knownNames[learner][source].last = true;
      });
    }
    return r;
  });
}

// Draws (team size + 1) Supply Cards for the leader to hand back out.
async function continueFromMissionResult(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'result') return room;
    const teamIds = Object.keys(obj(room.mission.teamIds));
    const drawn = drawSupplyCards(room, teamIds.length + 1);
    room.mission.redistributePool = {};
    drawn.forEach((c) => { room.mission.redistributePool[c.id] = c.color; });
    room.mission.step = 'redistribute';
    return room;
  });
}

async function giveRedistributeCard(code, cardId, targetId) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'redistribute') return room;
    if (myPlayerId !== room.mission.leaderId) return room;
    const teamIds = obj(room.mission.teamIds);
    if (!teamIds[targetId]) return room;
    const pool = obj(room.mission.redistributePool);
    const color = pool[cardId];
    if (color === undefined) return room;
    room.supplyHands = obj(room.supplyHands);
    room.supplyHands[targetId] = obj(room.supplyHands[targetId]);
    if (Object.keys(room.supplyHands[targetId]).length >= 3) return room;
    delete room.mission.redistributePool[cardId];
    room.supplyHands[targetId][cardId] = color;
    return room;
  });
}

// Any Supply Cards the leader didn't hand out are discarded, not lost --
// they go back into the shared discard pile like any other played card.
async function finishRedistribution(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'redistribute') return room;
    if (myPlayerId !== room.mission.leaderId) return room;
    const pool = obj(room.mission.redistributePool);
    room.supplyDiscard = obj(room.supplyDiscard);
    Object.entries(pool).forEach(([id, color]) => { room.supplyDiscard[id] = color; });
    room.mission.redistributePool = null;
    room.mission.step = 'share';
    return room;
  });
}

async function continueFromMissionShare(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'share') return room;
    const secrets = obj(room.secrets);
    Object.keys(secrets).forEach(id => { if (secrets[id].skipNextMission) secrets[id].skipNextMission = false; });
    room.phase = 'voting';
    room.voting = { resolved: false };
    return room;
  });
}

/* ---------------- VOTING PHASE ---------------- */

function renderVotingPhase(room) {
  const players = obj(room.players);
  const secrets = obj(room.secrets);
  const voting = obj(room.voting);
  const votes = obj(voting.votes);
  const aliveIds = Object.keys(players).filter(id => secrets[id] && secrets[id].alive);

  let html = `<h2>Voting Phase</h2><div class="card">`;

  if (!voting.resolved) {
    const amAlive = secrets[myPlayerId] && secrets[myPlayerId].alive;
    if (!amAlive) {
      html += `<p class="waiting">You're out — watching the vote unfold. (${Object.keys(votes).length}/${aliveIds.length} voted)</p>`;
    } else if (votes[myPlayerId] !== undefined) {
      html += `<p class="waiting">Vote cast. Waiting for others... (${Object.keys(votes).length}/${aliveIds.length} voted)</p>`;
    } else {
      const amNpaChief = myPlayerId === room.npaPlayerId;
      html += `<p class="hint">${amNpaChief ? "As NPA Chief, you're bound to your post — you must name someone, no skipping." : 'Vote to arrest a player, or skip.'}</p><div id="vote-choices">`;
      aliveIds.filter(id => id !== myPlayerId).forEach(id => {
        html += `<button class="choice" data-target="${id}">${players[id].label} — ${esc(players[id].name)}</button>`;
      });
      if (!amNpaChief) html += `<button class="choice" data-target="skip">Skip</button>`;
      html += `</div>`;
    }
  } else {
    const tally = {};
    aliveIds.forEach(id => { const v = votes[id]; tally[v] = (tally[v] || 0) + 1; });
    html += `<h3>Vote Tally</h3>`;
    Object.entries(tally).forEach(([k, c]) => {
      const label = k === 'skip' ? 'Skip' : (players[k] ? `${players[k].label} — ${esc(players[k].name)}` : k);
      html += `<div class="player-row"><span>${label}</span><span>${c} vote(s)</span></div>`;
    });

    const tieBreakPending = !!(voting.tieBreakPending && !voting.tieBreakDone);
    const amNpaChief = myPlayerId === room.npaPlayerId;

    if (tieBreakPending) {
      if (amNpaChief) {
        html += `<p class="hint">No majority — as NPA Chief, you may force an arrest anyway, choosing from whoever led the vote. Or let it go.</p>
          <div id="tiebreak-choices">`;
        Object.keys(obj(voting.tieBreakCandidates)).forEach(id => {
          html += `<button class="choice" data-target="${id}">${players[id].label} — ${esc(players[id].name)}</button>`;
        });
        html += `<button class="choice" data-target="none">Let It Go — No Arrest</button></div>`;
      } else {
        html += `<p class="waiting">No majority — waiting for the NPA Chief's decision...</p>`;
      }
    } else if (!voting.arrestedId) {
      html += `<p><strong>No majority reached — no one is arrested.</strong></p>`;
    } else {
      const arrested = players[voting.arrestedId];
      const arrestedSecret = secrets[voting.arrestedId];
      html += `<p><strong>Investigator ${arrested.label} has been arrested.</strong></p>
        <p>They must reveal their secret identity: <strong>${arrestedSecret.firstName} ${arrestedSecret.lastName}</strong></p>`;
      html += arrestedSecret.alive === false
        ? `<p class="hint">${arrested.label} is eliminated from the game entirely.</p>`
        : `<p class="hint">${arrested.label} will sit out the next mission and next Information Phase.</p>`;
    }
    if (!tieBreakPending) {
      html += `<button id="btn-voting-continue" class="primary">Continue</button>`;
    }
  }
  html += `</div>`;

  // X-Kira's private recruitment attempt — additive to normal voting, visible
  // only to X-Kira (while picking/pending) and to whoever just got recruited.
  // This is a one-time power: room.xKiraRecruitOffered is set permanently
  // (never resets between rounds, unlike room.voting) the moment the panel
  // has been offered once, whether or not X-Kira actually used it.
  const xKiraActive = !!room.xKiraActive;
  const amXKira = xKiraActive && myPlayerId === room.kiraPlayerId;
  const recruitEligible = amXKira && !room.followerPlayerId && (room.lScore || 0) >= 3 && !room.xKiraRecruitOffered;
  const picks = Object.keys(obj(voting.recruitPicks));

  if (recruitEligible) {
    html += `<div class="card">
      <h3>Recruit a Follower</h3>
      <p class="hint">${room.nActive ? 'N' : "L"}'s team has reached 3 points. Choose 2 players to attempt to recruit — the app will pick one of them at random. This is a one-time offer. (${picks.length}/2 selected)</p>
      <div id="recruit-list">`;
    aliveIds.filter(id => id !== myPlayerId).forEach(id => {
      const selected = picks.includes(id);
      html += `<button class="choice ${selected ? 'selected' : ''}" data-id="${id}">${selected ? '✓ ' : ''}${players[id].label} — ${esc(players[id].name)}</button>`;
    });
    html += `</div><button id="btn-recruit-confirm" class="danger" ${picks.length === 2 ? '' : 'disabled'}>Confirm Recruitment Targets</button>
    </div>`;
  } else if (amXKira && voting.recruitDone && voting.recruitBothProtected) {
    const [pickA, pickB] = Object.keys(obj(voting.recruitPicks));
    const pA = players[pickA], pB = players[pickB];
    const base = `The two people you chose to recruit — ${pA.label} — ${esc(pA.name)} and ${pB.label} — ${esc(pB.name)} — were L and Watari.`;
    if (voting.recruitedId) {
      const recruited = players[voting.recruitedId];
      html += `<div class="card"><p><strong>${recruited.label} — ${esc(recruited.name)} has joined you as your Follower.</strong></p><p class="hint">${base} A third person was recruited instead.</p></div>`;
    } else {
      html += `<div class="card"><p class="hint">${base} No one else was available to recruit instead.</p></div>`;
    }
  } else if (amXKira && voting.recruitDone && voting.recruitedId) {
    const recruited = players[voting.recruitedId];
    html += `<div class="card"><p><strong>${recruited.label} — ${esc(recruited.name)} has joined you as your Follower.</strong></p></div>`;
  } else if (xKiraActive && voting.recruitDone && voting.recruitedId === myPlayerId) {
    const kira = players[room.kiraPlayerId];
    html += `<div class="card"><p><strong>You have been recruited into a Kira Follower.</strong></p><p>X-Kira is <strong>${kira.label} — ${esc(kira.name)}</strong>.</p></div>`;
  }

  el('round-content').innerHTML = html;

  if (!voting.resolved) {
    document.querySelectorAll('#vote-choices .choice').forEach(btn => {
      btn.addEventListener('click', () => castVote(myRoomCode, btn.dataset.target));
    });
  } else {
    const continueBtn = el('btn-voting-continue');
    if (continueBtn) continueBtn.addEventListener('click', () => continueFromVotingResult(myRoomCode));
    document.querySelectorAll('#tiebreak-choices .choice').forEach(btn => {
      btn.addEventListener('click', () => submitTieBreak(myRoomCode, btn.dataset.target === 'none' ? null : btn.dataset.target));
    });
  }

  if (recruitEligible) {
    document.querySelectorAll('#recruit-list .choice').forEach(btn => {
      btn.addEventListener('click', () => toggleRecruitPick(myRoomCode, btn.dataset.id));
    });
    const confirmBtn = el('btn-recruit-confirm');
    if (confirmBtn && picks.length === 2) confirmBtn.addEventListener('click', () => confirmRecruit(myRoomCode));
  }

  maybeResolveVoting(room, myRoomCode);
}

async function toggleRecruitPick(code, playerId) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'voting' || room.xKiraRecruitOffered) return room;
    if (myPlayerId !== room.kiraPlayerId || playerId === room.kiraPlayerId) return room;
    if (!room.xKiraActive || room.followerPlayerId) return room;
    room.voting.recruitPicks = obj(room.voting.recruitPicks);
    const picks = room.voting.recruitPicks;
    if (picks[playerId]) {
      delete picks[playerId];
    } else if (Object.keys(picks).length < 2) {
      picks[playerId] = true;
    }
    return room;
  });
}

async function confirmRecruit(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'voting' || room.xKiraRecruitOffered) return room;
    if (myPlayerId !== room.kiraPlayerId) return room;
    if (!room.xKiraActive || room.followerPlayerId) return room;
    if ((room.lScore || 0) < 3) return room;
    const picks = Object.keys(obj(room.voting.recruitPicks));
    if (picks.length !== 2) return room;
    const [a, b] = picks;
    const secrets = obj(room.secrets);
    if (!secrets[a] || !secrets[a].alive || !secrets[b] || !secrets[b].alive) return room;

    const isProtected = (id) => id === room.lPlayerId || id === room.watariPlayerId;
    const aProtected = isProtected(a), bProtected = isProtected(b);
    let recruitedId = null;
    let bothProtected = false;
    if (aProtected && bProtected) {
      const pool = Object.keys(secrets).filter(id => secrets[id].alive && id !== room.kiraPlayerId && id !== a && id !== b);
      recruitedId = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      bothProtected = true;
    } else if (aProtected) {
      recruitedId = b;
    } else if (bProtected) {
      recruitedId = a;
    } else {
      recruitedId = Math.random() < 0.5 ? a : b;
    }

    // This is a one-time power — mark it spent permanently (not scoped to
    // room.voting, which resets every round) regardless of the outcome.
    room.xKiraRecruitOffered = true;
    room.voting.recruitDone = true;
    if (recruitedId) {
      room.secrets[recruitedId].role = 'KiraFollower';
      room.followerPlayerId = recruitedId;
      room.voting.recruitedId = recruitedId;
    }
    if (bothProtected) {
      room.voting.recruitBothProtected = true;
    }
    return room;
  });
}

async function castVote(code, targetOrSkip) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'voting' || room.voting.resolved) return room;
    if (!room.secrets[myPlayerId] || !room.secrets[myPlayerId].alive) return room;
    // NPA Chief is bound to their post — always names someone, never skips.
    if (targetOrSkip === 'skip' && myPlayerId === room.npaPlayerId) return room;
    room.voting.votes = obj(room.voting.votes);
    room.voting.votes[myPlayerId] = targetOrSkip;
    return room;
  });
}

// Shared by a normal majority arrest and an NPA Chief tie-break arrest, so
// both paths end up with identical consequences (sit-out, Kira endgame
// trigger, Mello elimination).
function applyArrestConsequences(room, secrets, arrestedId) {
  secrets[arrestedId].skipNextMission = true;
  secrets[arrestedId].skipNextInfo = true;
  if (secrets[arrestedId].role === 'Kira') {
    room.endgame = { active: true, resolved: false };
  } else if (secrets[arrestedId].role === 'Mello') {
    // Neutral role — arrest eliminates Mello outright, same as failing
    // both steal attempts, rather than just sitting out a round.
    secrets[arrestedId].alive = false;
    room.pendingDeaths = obj(room.pendingDeaths);
    room.pendingDeaths[arrestedId] = true;
  }
}

async function maybeResolveVoting(room, code) {
  const voting = obj(room.voting);
  if (room.phase !== 'voting' || voting.resolved) return;
  const players = obj(room.players), secrets = obj(room.secrets);
  const aliveIds = Object.keys(players).filter(id => secrets[id] && secrets[id].alive);
  const votes = obj(voting.votes);
  if (!aliveIds.every(id => votes[id] !== undefined)) return;

  await runTransaction(ref(db, `rooms/${code}`), (r) => {
    if (!r || r.phase !== 'voting' || r.voting.resolved) return r;
    const p = obj(r.players), s = obj(r.secrets), v = obj(r.voting.votes);
    const alive2 = Object.keys(p).filter(id => s[id] && s[id].alive);
    if (!alive2.every(id => v[id] !== undefined)) return r;

    const tally = {};
    alive2.forEach(id => { const vote = v[id]; tally[vote] = (tally[vote] || 0) + 1; });
    let topId = null, topCount = 0;
    Object.entries(tally).forEach(([k, c]) => { if (k !== 'skip' && c > topCount) { topCount = c; topId = k; } });
    const arrested = (topId && topCount > alive2.length / 2) ? topId : null;

    r.voting.resolved = true;
    r.voting.arrestedId = arrested;
    if (arrested) {
      applyArrestConsequences(r, s, arrested);
    } else {
      // No majority — NPA Chief (if alive and in this game) gets a chance to
      // break the deadlock, choosing only from whoever actually led the vote.
      const npaId = r.npaPlayerId;
      if (npaId && s[npaId] && s[npaId].alive) {
        const nonSkipCounts = Object.entries(tally).filter(([k]) => k !== 'skip').map(([, c]) => c);
        const maxCount = Math.max(0, ...nonSkipCounts);
        if (maxCount > 0) {
          r.voting.tieBreakPending = true;
          // Object map, not an array — Firebase Realtime Database doesn't
          // preserve arrays as arrays (they come back as {0: ..., 1: ...}
          // objects), which is why every other list in this app is a map too.
          r.voting.tieBreakCandidates = {};
          Object.entries(tally)
            .filter(([k, c]) => k !== 'skip' && c === maxCount)
            .forEach(([k]) => { r.voting.tieBreakCandidates[k] = true; });
        }
      }
    }
    return r;
  });
}

async function submitTieBreak(code, chosenId) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'voting' || !room.voting.resolved) return room;
    if (!room.voting.tieBreakPending || room.voting.tieBreakDone) return room;
    if (myPlayerId !== room.npaPlayerId) return room;
    room.voting.tieBreakDone = true;
    if (chosenId && obj(room.voting.tieBreakCandidates)[chosenId]) {
      const secrets = obj(room.secrets);
      room.voting.arrestedId = chosenId;
      applyArrestConsequences(room, secrets, chosenId);
    }
    return room;
  });
}

async function continueFromVotingResult(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'voting' || !room.voting.resolved) return room;
    if (room.voting.tieBreakPending && !room.voting.tieBreakDone) return room;
    if (room.endgame && room.endgame.active) return room;
    // If X-Kira's one-time recruitment offer was available this round but never
    // used, the window closes here rather than reappearing next round.
    if (room.xKiraActive && !room.followerPlayerId && !room.xKiraRecruitOffered && (room.lScore || 0) >= 3) {
      room.xKiraRecruitOffered = true;
    }
    room.phase = 'information';
    // Anyone arrested last round sits out this entire Information Phase --
    // no acting, no notes -- across every role, not just L. Consumed here
    // (cleared right away) so the sit-out only ever covers one phase.
    const secrets = obj(room.secrets);
    const sittingOutIds = {};
    Object.keys(secrets).forEach(id => {
      if (secrets[id].skipNextInfo) {
        sittingOutIds[id] = true;
        secrets[id].skipNextInfo = false;
      }
    });
    const l = room.secrets[room.lPlayerId];
    const lNeedsToAct = !!(l && l.alive && !sittingOutIds[room.lPlayerId]);
    const mello = room.melloPlayerId ? room.secrets[room.melloPlayerId] : null;
    const melloNeedsToAct = !!(mello && mello.alive && !sittingOutIds[room.melloPlayerId]);
    room.info = { lDone: !lNeedsToAct, kiraDone: false, melloDone: !melloNeedsToAct, swappedThisPhase: false, kiraDeadline: Date.now() + KIRA_TURN_MS, sittingOutIds };
    return room;
  });
}

/* ---------------- ENDGAME: KIRA ARRESTED ---------------- */

function renderEndgame(room) {
  const players = obj(room.players);
  const secrets = obj(room.secrets);
  const arrested = players[room.voting.arrestedId];

  let html = `<h2>Kira Has Been Arrested</h2><div class="card pass-card">
    <p><strong>Investigator ${arrested.label} was Kira!</strong></p>`;

  const amGuesser = myPlayerId === room.kiraPlayerId || myPlayerId === room.followerPlayerId;
  const detectiveLabel = room.nActive ? 'N' : 'L';
  if (amGuesser) {
    const candidates = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && id !== room.kiraPlayerId && id !== room.followerPlayerId);
    html += `<p class="hint">You get one shared guess: who is ${detectiveLabel}, and what's their secret name?</p>
      <label>Who is ${detectiveLabel}?</label>
      <select id="guess-who">${candidates.map(id => `<option value="${id}">${players[id].label} — ${esc(players[id].name)}</option>`).join('')}</select>
      <label>Guess their first name</label>
      <select id="guess-first">${FIRST_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
      <label>Guess their last name</label>
      <select id="guess-last">${LAST_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
      <button id="btn-endgame-submit" class="primary">Submit Final Guess</button>`;
  } else {
    html += `<p class="waiting">Kira and the Follower are making their final guess...</p>`;
  }
  html += `</div>`;
  el('round-content').innerHTML = html;

  if (amGuesser) {
    el('btn-endgame-submit').addEventListener('click', () => {
      const whoId = el('guess-who').value;
      const first = el('guess-first').value;
      const last = el('guess-last').value;
      submitEndgameGuess(myRoomCode, whoId, first, last);
    });
  }
}

async function submitEndgameGuess(code, whoId, first, last) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || !room.endgame || !room.endgame.active || room.endgame.resolved) return room;
    const l = room.secrets[room.lPlayerId];
    const detectiveLabel = room.nActive ? 'N' : 'L';
    room.endgame.resolved = true;
    room.status = 'gameover';
    if (whoId === room.lPlayerId && first === l.firstName && last === l.lastName) {
      room.gameOverInfo = { winner: 'Kira', reason: `Kira's team correctly identified ${detectiveLabel}: Investigator ${room.players[room.lPlayerId].label}, ${l.firstName} ${l.lastName}.` };
    } else {
      room.gameOverInfo = { winner: 'L', reason: `Kira's team guessed wrong. ${detectiveLabel} was actually Investigator ${room.players[room.lPlayerId].label} — ${l.firstName} ${l.lastName}.` };
    }
    return room;
  });
}

/* ---------------- INFORMATION PHASE ---------------- */

function renderInformationPhase(room) {
  const players = obj(room.players);
  const secrets = obj(room.secrets);
  const info = obj(room.info);
  const amL = myPlayerId === room.lPlayerId;
  const amKiraTeam = myPlayerId === room.kiraPlayerId || myPlayerId === room.followerPlayerId;
  const amMello = myPlayerId === room.melloPlayerId && secrets[room.melloPlayerId] && secrets[room.melloPlayerId].alive;
  const amMisa = !!room.misaActive && myPlayerId === room.followerPlayerId;
  const misaLockedThisRound = amMisa && !!info.misaUsedThisPhase;
  const amSittingOut = !!obj(info.sittingOutIds)[myPlayerId];

  // Preserve any in-progress kill-guess form selections and chat input across
  // re-renders, since this panel is viewed by two separate devices (Kira +
  // Follower) at once, and one device's action shouldn't wipe out the other
  // device's half-filled guess or in-progress message.
  const prevKillTarget = el('kill-target') ? el('kill-target').value : null;
  const prevKillFirst = el('kill-first') ? el('kill-first').value : null;
  const prevKillLast = el('kill-last') ? el('kill-last').value : null;
  const prevStealTarget = el('steal-target') ? el('steal-target').value : null;
  const prevAccuseTarget = el('accuse-target') ? el('accuse-target').value : null;
  const prevEyesTarget = el('eyes-target') ? el('eyes-target').value : null;
  const prevEyesPart = el('eyes-part') ? el('eyes-part').value : null;

  let html = `<h2>Information Phase</h2><div class="card pass-card">`;

  if (amL && room.nActive) {
    const cap = room.nClearCap || 2;
    const clearedIds = Object.keys(obj(room.nClearedIds));
    const clearsUsed = room.nClearsUsed || 0;
    const melloRevealed = !!(room.nMelloRevealed && room.melloPlayerId);
    html += `<p class="hint">Definitive Clears: ${clearsUsed} / ${cap} used</p>`;
    if (clearedIds.length > 0) {
      html += `<p class="hint">Cleared: ${clearedIds.map(id => players[id] ? players[id].label : '?').join(', ')}</p>`;
    }
    if (melloRevealed) {
      html += `<p class="hint">Identified as Mello: ${players[room.melloPlayerId].label} — ${esc(players[room.melloPlayerId].name)}</p>`;
    }
    const result = info.nAccuseResult;
    if (result && players[result.targetId]) {
      const t = players[result.targetId];
      if (result.outcome === 'cleared') html += `<p><strong>${t.label} — ${esc(t.name)} is cleared. Not Kira.</strong></p>`;
      else if (result.outcome === 'mello') html += `<p><strong>${t.label} — ${esc(t.name)} is Mello.</strong></p>`;
      else if (result.outcome === 'capped') html += `<p class="hint">Out of Definitive Clears — no new information on ${t.label}.</p>`;
      else html += `<p class="hint">No new information on ${t.label}.</p>`;
    }
    if (info.lDone) {
      html += `<p class="hint">Done. Waiting for Kira's team to finish...</p>`;
    } else {
      const excludeIds = new Set([myPlayerId, room.watariPlayerId, ...clearedIds]);
      if (melloRevealed) excludeIds.add(room.melloPlayerId);
      const targets = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && !excludeIds.has(id));
      if (targets.length === 0) {
        html += `<p class="hint">No one left to accuse.</p><button id="btn-n-finish" class="primary">Continue</button>`;
      } else {
        html += `<label>Accuse</label>
          <select id="accuse-target">${targets.map(id => `<option value="${id}">${players[id].label} — ${esc(players[id].name)}</option>`).join('')}</select>
          <button id="btn-accuse-submit" class="danger">Accuse</button>
          <hr><button id="btn-n-finish" class="secondary">Don't Accuse — Continue</button>`;
      }
    }
  } else if (amL) {
    const suspectIds = Object.keys(obj(info.lSuspects));
    if (info.lDone) {
      if (suspectIds.length > 0) {
        html += `<p><strong>4 Suspects — one of them is Kira:</strong></p>`;
        suspectIds.forEach(id => { html += `<div class="player-row"><span>${players[id].label} — ${esc(players[id].name)}</span></div>`; });
        html += `<p class="hint">Done. Waiting for Kira's team to finish...</p>`;
      } else {
        html += `<p class="hint">You're sitting out this Information Phase.</p>`;
      }
    } else if (suspectIds.length === 0) {
      html += `<button id="btn-l-reveal" class="primary">Reveal My 4 Suspects</button>`;
    } else {
      html += `<p><strong>4 Suspects — one of them is Kira:</strong></p>`;
      suspectIds.forEach(id => { html += `<div class="player-row"><span>${players[id].label} — ${esc(players[id].name)}</span></div>`; });
      html += `<p class="hint">Kira's Follower has an equal chance of appearing here as any other Investigator.</p>
        <button id="btn-l-done" class="primary">Done</button>`;
    }
  } else if (amKiraTeam) {
    const kira = players[room.kiraPlayerId];
    const follower = room.followerPlayerId ? players[room.followerPlayerId] : null;
    const amActingKira = myPlayerId === room.kiraPlayerId;
    const stealResult = info.stealResult;
    if (stealResult && stealResult.success && stealResult.thief === myPlayerId) {
      html += `<p class="hint"><strong>You successfully stole the Death Note. You are now Kira.</strong></p>`;
    }
    html += `<p><strong>Kira:</strong> ${kira.label} — ${esc(kira.name)}${follower ? ` &nbsp; <strong>Follower:</strong> ${follower.label} — ${esc(follower.name)}` : ' &nbsp; <em>(no Follower yet)</em>'}</p>
      <p class="hint">${follower ? 'Share what you learned during the Mission Phase and strategize.' : "You're operating alone this round."}</p><hr>`;

    if (amSittingOut) {
      html += `<p class="hint"><strong>You're sitting out this Information Phase.</strong></p>
        <p class="hint">You were arrested last round — waiting for the round to finish...</p>`;
    } else if (misaLockedThisRound) {
      const eyesResult = info.misaEyesResult;
      html += `<p class="hint"><strong>You used your Shinigami Eyes this round.</strong></p>`;
      if (eyesResult && players[eyesResult.targetId]) {
        const t = players[eyesResult.targetId];
        const partLabel = eyesResult.part === 'first' ? 'first name' : 'last name';
        html += `<p><strong>${t.label} — ${esc(t.name)}'s ${partLabel}: ${esc(eyesResult.value)}</strong></p>`;
      }
      html += `<p class="hint">Using it cost you the rest of this Information Phase — waiting for Kira to finish...</p>`;
    } else if (info.kiraDone) {
      html += `<p class="hint">Done. Waiting for ${room.nActive ? 'N' : 'L'} to finish...</p>`;
    } else if (amActingKira) {
      const canSwap = !!follower && !room.lastInfoPhaseSwapped && !info.swappedThisPhase;
      if (!follower) { /* nothing to swap with yet */ }
      else if (info.swappedThisPhase) html += `<p class="hint">The Death Note was swapped this phase.</p>`;
      else if (canSwap) html += `<button id="btn-swap-note" class="secondary">Swap the Death Note (Kira ⇄ Follower)</button>`;
      else html += `<p class="hint">The Death Note was swapped last time — cannot swap again this round.</p>`;

      html += `<hr><p><strong>Write a name in the Death Note?</strong></p>`;
      const killsUsed = info.killsThisPhase || 0;
      if (killsUsed >= 2) {
        html += `<p class="hint">You've used both kills for this Information Phase.</p>`;
      } else {
        const targets = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && !secrets[id].immune && id !== room.kiraPlayerId && id !== room.followerPlayerId);
        if (targets.length === 0) {
          html += `<p class="hint">No valid targets remain.</p>`;
        } else {
          html += `<label>Target</label>
            <select id="kill-target">${targets.map(id => `<option value="${id}">${players[id].label} — ${esc(players[id].name)}</option>`).join('')}</select>
            <label>Guess first name</label>
            <select id="kill-first">${FIRST_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
            <label>Guess last name</label>
            <select id="kill-last">${LAST_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
            <button id="btn-kill-submit" class="danger">Submit Guess</button>
            <p class="hint">${killsUsed === 1 ? '1 kill used — 1 remaining this phase.' : 'Up to 2 successful kills allowed this phase.'}</p>`;
        }
      }
      html += `<hr><button id="btn-info-finish" class="primary">Finished — Continue</button>`;
    } else {
      html += `<p class="hint">Only Kira can write a name in the Death Note, swap it, or end this phase — chat with them below.</p>`;

      if (amMisa && !room.misaEyesUsed) {
        const eyesTargets = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && id !== myPlayerId && id !== room.kiraPlayerId);
        html += `<hr><div class="card">
          <h3>👁 Shinigami Eyes (one-time)</h3>
          <p class="hint">Trade the rest of this turn to instantly learn part of someone's real name — no mission needed.</p>`;
        if (eyesTargets.length === 0) {
          html += `<p class="hint">No valid targets remain.</p>`;
        } else {
          html += `<label>Look at</label>
            <select id="eyes-target">${eyesTargets.map(id => `<option value="${id}">${players[id].label} — ${esc(players[id].name)}</option>`).join('')}</select>
            <label>Which part of their name?</label>
            <select id="eyes-part"><option value="first">First name</option><option value="last">Last name</option></select>
            <button id="btn-eyes-submit" class="danger">Use Shinigami Eyes</button>`;
        }
        html += `</div>`;
      }
    }
  } else if (amMello) {
    const stealResult = info.stealResult;
    if (stealResult && stealResult.success && stealResult.victim === myPlayerId) {
      html += `<p class="hint"><strong>Your Death Note has been stolen. You are now Mello.</strong></p>`;
    }
    if (info.melloDone) {
      html += `<p class="hint">Done. Waiting for the others to finish...</p>`;
    } else {
      const attemptsUsed = (secrets[room.melloPlayerId] && secrets[room.melloPlayerId].wrongStealCount) || 0;
      const targets = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && id !== room.melloPlayerId);
      html += `<p><strong>Attempt to steal the Death Note?</strong></p>
        <p class="hint">${2 - attemptsUsed} attempt(s) remaining, for as long as you hold this role. Fail both, and you're eliminated.</p>`;
      if (targets.length === 0) {
        html += `<p class="hint">No valid targets remain.</p><button id="btn-mello-finish" class="primary">Continue</button>`;
      } else {
        html += `<label>Who has the Death Note?</label>
          <select id="steal-target">${targets.map(id => `<option value="${id}">${players[id].label} — ${esc(players[id].name)}</option>`).join('')}</select>
          <button id="btn-steal-submit" class="danger">Attempt Steal</button>
          <hr><button id="btn-mello-finish" class="secondary">Don't Steal — Continue</button>`;
      }
    }
  } else {
    const melloWaiting = melloStillNeedsToAct(room) ? `<br>Mello is ${info.melloDone ? 'done' : 'deciding'}...` : '';
    const detectiveLabel = room.nActive ? 'N' : 'L';
    const detectiveVerb = room.nActive ? 'building a case' : 'reviewing suspects';
    html += `<p class="waiting">Everyone, close your eyes.<br>
      ${detectiveLabel} is ${info.lDone ? 'done' : detectiveVerb}...<br>
      Kira and the Follower are ${info.kiraDone ? 'done' : 'strategizing'}...${melloWaiting}</p>
      <p class="hint">Please use this time to take notes, write down suspicions, and write down a plan for next round.</p>`;
  }
  html += `</div>`;
  el('round-content').innerHTML = html;

  if (amL && room.nActive && !info.lDone) {
    const accuseSel = el('accuse-target');
    if (accuseSel && prevAccuseTarget && [...accuseSel.options].some(o => o.value === prevAccuseTarget)) accuseSel.value = prevAccuseTarget;
    const accuseBtn = el('btn-accuse-submit');
    if (accuseBtn) accuseBtn.addEventListener('click', () => submitAccusation(myRoomCode, el('accuse-target').value));
    const nFinishBtn = el('btn-n-finish');
    if (nFinishBtn) nFinishBtn.addEventListener('click', () => lDoneViewing(myRoomCode));
  } else if (amL && !info.lDone) {
    const suspectIds = Object.keys(obj(info.lSuspects));
    if (suspectIds.length === 0) el('btn-l-reveal').addEventListener('click', () => lRevealSuspects(myRoomCode));
    else el('btn-l-done').addEventListener('click', () => lDoneViewing(myRoomCode));
  }
  if (amKiraTeam) {
    const targetSel = el('kill-target'), firstSel = el('kill-first'), lastSel = el('kill-last');
    if (targetSel && prevKillTarget && [...targetSel.options].some(o => o.value === prevKillTarget)) targetSel.value = prevKillTarget;
    if (firstSel && prevKillFirst) firstSel.value = prevKillFirst;
    if (lastSel && prevKillLast) lastSel.value = prevKillLast;

    if (!info.kiraDone) {
      const swapBtn = el('btn-swap-note');
      if (swapBtn) swapBtn.addEventListener('click', () => swapDeathNote(myRoomCode));
      const killBtn = el('btn-kill-submit');
      if (killBtn) killBtn.addEventListener('click', async () => {
        const targetId = el('kill-target').value;
        const first = el('kill-first').value;
        const last = el('kill-last').value;
        const msg = await submitKillGuess(myRoomCode, targetId, first, last);
        showToast(msg);
      });
      const finishBtn = el('btn-info-finish');
      if (finishBtn) finishBtn.addEventListener('click', () => finishKiraTeamTurn(myRoomCode));

      const eyesTargetSel = el('eyes-target'), eyesPartSel = el('eyes-part');
      if (eyesTargetSel && prevEyesTarget && [...eyesTargetSel.options].some(o => o.value === prevEyesTarget)) eyesTargetSel.value = prevEyesTarget;
      if (eyesPartSel && prevEyesPart) eyesPartSel.value = prevEyesPart;
      const eyesBtn = el('btn-eyes-submit');
      if (eyesBtn) eyesBtn.addEventListener('click', () => {
        submitMisaEyes(myRoomCode, el('eyes-target').value, el('eyes-part').value);
      });
    }
  }
  if (amMello && !info.melloDone) {
    const stealSel = el('steal-target');
    if (stealSel && prevStealTarget && [...stealSel.options].some(o => o.value === prevStealTarget)) stealSel.value = prevStealTarget;
    const stealBtn = el('btn-steal-submit');
    if (stealBtn) stealBtn.addEventListener('click', () => submitStealAttempt(myRoomCode, el('steal-target').value));
    const melloFinishBtn = el('btn-mello-finish');
    if (melloFinishBtn) melloFinishBtn.addEventListener('click', () => finishMelloTurn(myRoomCode));
  }

  maybeAdvanceFromInfo(room, myRoomCode);
}

function melloStillNeedsToAct(room) {
  if (!room.melloPlayerId) return false;
  const mello = obj(room.secrets)[room.melloPlayerId];
  return !!(mello && mello.alive);
}

async function maybeAdvanceFromInfo(room, code) {
  if (room.phase !== 'information') return;
  const info = obj(room.info);
  if (!info.lDone || !info.kiraDone || (melloStillNeedsToAct(room) && !info.melloDone)) return;
  await runTransaction(ref(db, `rooms/${code}`), (r) => {
    if (!r || r.phase !== 'information') return r;
    const i = obj(r.info);
    if (!i.lDone || !i.kiraDone || (melloStillNeedsToAct(r) && !i.melloDone)) return r;
    r.round = (r.round || 1) + 1;
    r.phase = 'deaths';
    r.mission = { step: null };
    r.voting = { resolved: false };
    r.info = { lDone: false, kiraDone: false, melloDone: false, swappedThisPhase: false };
    return r;
  });
}

async function lRevealSuspects(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.lDone) return room;
    if (Object.keys(obj(room.info.lSuspects)).length > 0) return room;
    const players = obj(room.players), secrets = obj(room.secrets);
    const kiraId = room.kiraPlayerId;
    const pool = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && id !== room.lPlayerId && id !== kiraId && id !== room.watariPlayerId);
    const others = shuffle(pool).slice(0, 3);
    const four = shuffle([kiraId, ...others]);
    room.info.lSuspects = {};
    four.forEach(id => { room.info.lSuspects[id] = true; });
    return room;
  });
}
async function lDoneViewing(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.lDone) return room;
    room.info.lDone = true;
    return room;
  });
}

// N's accusation — one per Information Phase. Outcome depends on the
// target's CURRENT role, so it stays correct even after a Mello<->Kira
// swap changes who's playing what mid-game.
async function submitAccusation(code, targetId) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.lDone) return room;
    if (!room.nActive || myPlayerId !== room.lPlayerId) return room;
    const target = room.secrets[targetId];
    if (!target || !target.alive || targetId === room.lPlayerId || targetId === room.watariPlayerId) return room;
    if (room.nClearedIds && room.nClearedIds[targetId]) return room;
    if (room.nMelloRevealed && targetId === room.melloPlayerId) return room;

    room.info.lDone = true;

    if (targetId === room.kiraPlayerId || targetId === room.followerPlayerId) {
      room.info.nAccuseResult = { targetId, outcome: 'silent' };
    } else if (targetId === room.melloPlayerId) {
      room.nMelloRevealed = true;
      room.info.nAccuseResult = { targetId, outcome: 'mello' };
    } else {
      const cap = room.nClearCap || 2;
      const used = room.nClearsUsed || 0;
      if (used < cap) {
        room.nClearedIds = obj(room.nClearedIds);
        room.nClearedIds[targetId] = true;
        room.nClearsUsed = used + 1;
        room.info.nAccuseResult = { targetId, outcome: 'cleared' };
      } else {
        room.info.nAccuseResult = { targetId, outcome: 'capped' };
      }
    }
    return room;
  });
}

async function swapDeathNote(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.kiraDone) return room;
    // Only Kira (the Note's current holder) can initiate a swap — not the Follower.
    if (myPlayerId !== room.kiraPlayerId) return room;
    if (room.lastInfoPhaseSwapped || room.info.swappedThisPhase) return room;
    if (!room.followerPlayerId) return room;
    const kId = room.kiraPlayerId, fId = room.followerPlayerId;
    room.secrets[kId].role = 'KiraFollower';
    room.secrets[fId].role = 'Kira';
    room.kiraPlayerId = fId;
    room.followerPlayerId = kId;
    room.info.swappedThisPhase = true;
    return room;
  });
}

// Misa's Shinigami Eyes — one-time for the whole game (room.misaEyesUsed is
// permanent, like xKiraRecruitOffered), but info.misaUsedThisPhase is scoped
// to room.info so it resets automatically each round like every other
// per-phase flag, unlocking her normal panel again next Information Phase
// (the power itself stays spent).
async function submitMisaEyes(code, targetId, part) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.kiraDone) return room;
    if (!room.misaActive || myPlayerId !== room.followerPlayerId) return room;
    if (room.misaEyesUsed || room.info.misaUsedThisPhase) return room;
    if (part !== 'first' && part !== 'last') return room;
    const target = room.secrets[targetId];
    if (!target || !target.alive || targetId === myPlayerId || targetId === room.kiraPlayerId) return room;

    room.misaEyesUsed = true;
    room.info.misaUsedThisPhase = true;
    room.info.misaEyesResult = { targetId, part, value: part === 'first' ? target.firstName : target.lastName };
    return room;
  });
}

async function sendChatMessage(code, text) {
  const key = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await update(ref(db, `rooms/${code}/kiraChat`), { [key]: { senderId: myPlayerId, text, ts: Date.now() } });
}

async function submitKillGuess(code, targetId, first, last) {
  const beforeKillsUsed = (currentRoomData.info && currentRoomData.info.killsThisPhase) || 0;
  if (beforeKillsUsed >= 2) {
    return '<p class="hint">You have already killed the maximum of 2 investigators this Information Phase.</p>';
  }
  const before = currentRoomData.secrets && currentRoomData.secrets[targetId];
  if (!before || !before.alive || before.immune) {
    return '<p class="hint">That target is no longer available — pick another.</p>';
  }
  const result = await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.kiraDone) return room;
    // Only Kira (the Note's current holder) can write a name in it — not the Follower.
    if (myPlayerId !== room.kiraPlayerId) return room;
    if ((room.info.killsThisPhase || 0) >= 2) return room;
    const target = room.secrets[targetId];
    if (!target || !target.alive || target.immune) return room;
    if (first === target.firstName && last === target.lastName) {
      target.alive = false;
      room.pendingDeaths = obj(room.pendingDeaths);
      room.pendingDeaths[targetId] = true;
      room.kiraScore = (room.kiraScore || 0) + 2;
      room.info.killsThisPhase = (room.info.killsThisPhase || 0) + 1;
      if (targetId === room.watariPlayerId) {
        room.lScore = Math.max(0, (room.lScore || 0) - 3);
      }
      applyWinCheck(room);
    } else {
      target.wrongGuessCount = (target.wrongGuessCount || 0) + 1;
      if (target.wrongGuessCount >= 2) target.immune = true;
    }
    return room;
  });
  if (!result.committed || !result.snapshot.exists()) {
    return '<p>Something went wrong, try again.</p>';
  }
  const newRoom = result.snapshot.val();
  const target = newRoom.secrets[targetId];
  const targetLabel = newRoom.players[targetId].label;
  if (before.alive && !target.alive) {
    return `<p><strong>Correct! ${targetLabel} has been killed.</strong></p>`;
  }
  if (before.wrongGuessCount !== target.wrongGuessCount) {
    let msg = `<p>Wrong. ${targetLabel} survives.</p>`;
    if (target.immune && !before.immune) msg += `<p class="hint">${targetLabel} has been guessed wrong twice and is now immune for the rest of the game.</p>`;
    return msg;
  }
  return '<p class="hint">That guess didn\'t go through (maybe someone else acted first) — try again.</p>';
}

async function finishKiraTeamTurn(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.kiraDone) return room;
    room.lastInfoPhaseSwapped = !!room.info.swappedThisPhase;
    room.info.kiraDone = true;
    return room;
  });
}

/* ---------------- MELLO: STEAL THE DEATH NOTE ---------------- */

async function submitStealAttempt(code, targetId) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.melloDone) return room;
    const melloId = room.melloPlayerId;
    if (!melloId || myPlayerId !== melloId) return room;
    const mello = room.secrets[melloId];
    if (!mello || !mello.alive) return room;
    const target = room.secrets[targetId];
    if (!target || !target.alive || targetId === melloId) return room;

    // One attempt per Information Phase — success or failure both end Mello's
    // turn for this round, same as Kira's team finishing theirs.
    room.info.melloDone = true;

    if (targetId === room.kiraPlayerId) {
      const kiraId = room.kiraPlayerId;
      room.secrets[melloId].role = 'Kira';
      room.secrets[kiraId].role = 'Mello';
      room.secrets[kiraId].wrongStealCount = 0;
      room.kiraPlayerId = melloId;
      room.melloPlayerId = kiraId;
      room.info.stealResult = { success: true, thief: melloId, victim: kiraId };
    } else {
      mello.wrongStealCount = (mello.wrongStealCount || 0) + 1;
      if (mello.wrongStealCount >= 2) {
        mello.alive = false;
        room.pendingDeaths = obj(room.pendingDeaths);
        room.pendingDeaths[melloId] = true;
      }
      room.info.stealResult = { success: false };
    }
    return room;
  });
}

async function finishMelloTurn(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.melloDone) return room;
    if (myPlayerId !== room.melloPlayerId) return room;
    room.info.melloDone = true;
    return room;
  });
}

/* ---------------- GAME OVER ---------------- */

function renderGameOver(room) {
  const players = obj(room.players);
  const secrets = obj(room.secrets);
  const info = obj(room.gameOverInfo);
  const detectiveLabel = room.nActive ? 'N' : 'L';
  const winTitle = info.winner === 'Kira' ? 'KIRA WINS' : `${detectiveLabel}'S TEAM WINS`;
  let html = `<h1 class="title" style="color:${info.winner === 'Kira' ? 'var(--red-bright)' : 'var(--gold)'}">${winTitle}</h1>
    <div class="card">
      <p>${info.reason || ''}</p>
      <h3>Full Reveal</h3>`;
  Object.keys(players).sort().forEach(id => {
    const s = secrets[id] || {};
    const status = s.alive === false ? '<span class="tag dead">dead</span>' : '';
    let roleLabel = s.role || '';
    if (roleLabel === 'Kira' && room.xKiraActive) roleLabel = 'X-Kira';
    else if (roleLabel === 'L' && room.nActive) roleLabel = 'N';
    else if (roleLabel === 'KiraFollower' && room.misaActive) roleLabel = 'Misa';
    else if (roleLabel === 'NPAChief') roleLabel = 'NPA Chief';
    html += `<div class="player-row"><span>${players[id].label} — ${esc(players[id].name)}${status}</span><span>${roleLabel} · ${s.firstName || ''} ${s.lastName || ''}</span></div>`;
  });
  html += `<button id="btn-new-game" class="primary">New Game</button></div>`;
  el('gameover-content').innerHTML = html;
  el('btn-new-game').addEventListener('click', () => {
    clearSession();
    location.reload();
  });
}
