import {
  auth, db, signInAnonymously, onAuthStateChanged,
  ref, get, set, update, onValue, runTransaction
} from "./firebase-init.js";

const FIRST_NAMES = ["Harry", "Ron", "Katniss", "Peeta", "Percy", "Sherlock", "Peter", "Tony", "Bruce", "Clark"];
const LAST_NAMES = ["Potter", "Weasley", "Everdeen", "Mellark", "Jackson", "Holmes", "Parker", "Stark", "Wayne", "Kent"];
const LABELS = "ABCDEFGHIJ".split("");
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function el(id) { return document.getElementById(id); }
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
  if (!name) return showLandingError('Enter your name first.');
  el('btn-create-game').disabled = true;
  try {
    await createRoom(name);
  } catch (e) {
    showLandingError('Could not create game: ' + e.message);
  } finally {
    el('btn-create-game').disabled = false;
  }
});

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

async function createRoom(name) {
  await authReadyPromise;
  const code = generateRoomCode();
  await set(ref(db, `rooms/${code}`), {
    code, createdAt: Date.now(), hostUid: myUid, status: 'lobby',
    round: 0, phase: null,
    lScore: 0, kiraScore: 0,
    lastInfoPhaseSwapped: false,
    mission: { step: null },
    voting: { resolved: false },
    info: { step: null, swappedThisPhase: false },
    endgame: { active: false, resolved: false },
    players: { A: { uid: myUid, label: 'A', name } }
  });
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

function renderLobby(room) {
  const players = obj(room.players);
  const ids = Object.keys(players).sort();
  const isHost = myUid === room.hostUid;
  const count = ids.length;
  const canStart = isHost && count >= 7 && count <= 10;

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
  if (isHost) {
    html += canStart
      ? `<button id="btn-start-game" class="primary">Deal Roles &amp; Start</button>`
      : `<p class="hint">Waiting for at least 7 players to join...</p>`;
  } else {
    html += `<p class="hint">Waiting for the host to start the game...</p>`;
  }
  html += `</div>`;
  el('lobby-content').innerHTML = html;

  if (canStart) {
    el('btn-start-game').addEventListener('click', () => startGame(myRoomCode));
  }
}

async function startGame(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.status !== 'lobby') return room;
    const playerIds = Object.keys(obj(room.players));
    const count = playerIds.length;
    if (count < 7 || count > 10) return room;
    const roles = shuffle(['L', 'Kira', 'KiraFollower'].concat(Array(count - 3).fill('Investigator')));
    const firstNames = shuffle(FIRST_NAMES).slice(0, count);
    const lastNames = shuffle(LAST_NAMES).slice(0, count);
    const secrets = {};
    playerIds.forEach((id, i) => {
      secrets[id] = {
        role: roles[i], firstName: firstNames[i], lastName: lastNames[i],
        alive: true, skipNextMission: false, skipNextInfo: false,
        wrongGuessCount: 0, immune: false, ready: false
      };
    });
    room.secrets = secrets;
    room.lPlayerId = playerIds.find(id => secrets[id].role === 'L');
    room.kiraPlayerId = playerIds.find(id => secrets[id].role === 'Kira');
    room.followerPlayerId = playerIds.find(id => secrets[id].role === 'KiraFollower');
    room.status = 'reveal';
    return room;
  });
}

/* ---------------- REVEAL ---------------- */

function renderReveal(room) {
  const mySecret = obj(room.secrets)[myPlayerId];
  if (!mySecret) return;
  let roleName, roleDesc;
  if (mySecret.role === 'Kira') {
    roleName = 'You are KIRA';
    roleDesc = "You lead the evil team. Coordinate with your Follower during the Information Phase. Kill investigators by correctly guessing their secret names. Avoid being arrested.";
  } else if (mySecret.role === 'KiraFollower') {
    roleName = "You are KIRA'S FOLLOWER";
    roleDesc = "You know who Kira is. Help them strategize. If needed, you can swap the Death Note with Kira to become Kira yourself.";
  } else if (mySecret.role === 'L') {
    roleName = 'You are L';
    roleDesc = "Each Information Phase you'll be shown 4 suspects — one is truly Kira. Use missions and votes to find and arrest Kira before it's too late.";
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
  el('score-label').textContent = `L: ${room.lScore || 0}  |  Kira: ${room.kiraScore || 0}`;
}

function renderRound(room) {
  updateHeader(room);
  initNotesPanel(room);
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
}

async function saveNotes(code, playerId, text) {
  await set(ref(db, `rooms/${code}/notes/${playerId}`), text || null);
  const indicator = el('notes-saved-indicator');
  if (indicator) indicator.textContent = 'Saved';
}

function applyWinCheck(room) {
  if (room.status === 'gameover') return;
  if ((room.kiraScore || 0) >= 10) {
    room.status = 'gameover';
    room.gameOverInfo = { winner: 'Kira', reason: "Kira's team reached 10 points." };
    return;
  }
  if ((room.lScore || 0) >= 10) {
    room.status = 'gameover';
    room.gameOverInfo = { winner: 'L', reason: "L's team reached 10 points." };
    return;
  }
  const l = room.secrets && room.secrets[room.lPlayerId];
  if (l && !l.alive) {
    room.status = 'gameover';
    room.gameOverInfo = { winner: 'Kira', reason: 'L has been killed.' };
  }
}

/* ---------------- DEATHS PHASE ---------------- */

function renderDeathsPhase(room) {
  const players = obj(room.players);
  const deaths = Object.keys(obj(room.pendingDeaths));
  let html = `<h2>Deaths Phase</h2><div class="card">`;
  if (deaths.length === 0) html += `<p>No one has died... yet.</p>`;
  else deaths.forEach(id => { html += `<p>Investigator ${players[id].label} has died.</p>`; });
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
    room.mission = { leaderId, teamIds: { [leaderId]: true }, result: null, step: 'team' };
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

  if (m.step === 'team') {
    if (isLeader) {
      html += `<p class="hint">Choose the players joining this meeting (you're included automatically). Your physical mission card tells you how many are required.</p>`;
      const eligible = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && !secrets[id].skipNextMission);
      const teamIds = obj(m.teamIds);
      html += `<div id="mission-team-list">`;
      eligible.forEach(id => {
        const selected = !!teamIds[id];
        const locked = id === m.leaderId;
        html += `<button class="choice ${selected ? 'selected' : ''}" data-id="${id}" ${locked ? 'disabled' : ''}>${selected ? '✓ ' : ''}${players[id].label} — ${esc(players[id].name)}${locked ? ' (leader)' : ''}</button>`;
      });
      html += `</div><button id="btn-mission-confirm" class="primary">Confirm Team</button>`;
    } else {
      html += `<p class="waiting">Waiting for ${leader ? leader.label : '...'} to choose the mission team...</p>`;
    }
  } else if (m.step === 'result') {
    const teamIds = Object.keys(obj(m.teamIds));
    html += `<p class="hint">Team: ${teamIds.map(id => players[id].label).join(', ')}</p>`;
    if (isLeader) {
      html += `<p>Play mission cards face-down now. Enter the outcome once compared to the requirement:</p>
        <button id="btn-mission-success" class="primary">Mission Succeeds (L +1)</button>
        <button id="btn-mission-fail" class="danger">Mission Fails (Kira +1)</button>`;
    } else {
      html += `<p class="waiting">Waiting for ${leader.label} to report the mission result...</p>`;
    }
  } else if (m.step === 'share') {
    const teamIds = Object.keys(obj(m.teamIds));
    const onMission = teamIds.includes(myPlayerId);
    html += `<p><strong>Mission ${m.result === 'success' ? 'succeeded! L +1' : 'failed! Kira +1'}</strong></p>`;
    html += onMission
      ? `<p class="hint">You were on this mission — share one of your secret names (first or last) with another player who was also on it.</p>`
      : `<p class="hint">Players on the mission are sharing a secret name with each other.</p>`;
    html += `<button id="btn-mission-done" class="primary">Continue</button>`;
  }
  html += `</div>`;
  el('round-content').innerHTML = html;

  if (m.step === 'team' && isLeader) {
    document.querySelectorAll('#mission-team-list .choice').forEach(btn => {
      btn.addEventListener('click', () => toggleMissionTeam(myRoomCode, btn.dataset.id));
    });
    el('btn-mission-confirm').addEventListener('click', () => confirmMissionTeam(myRoomCode));
  }
  if (m.step === 'result' && isLeader) {
    el('btn-mission-success').addEventListener('click', () => submitMissionResult(myRoomCode, true));
    el('btn-mission-fail').addEventListener('click', () => submitMissionResult(myRoomCode, false));
  }
  if (m.step === 'share') {
    el('btn-mission-done').addEventListener('click', () => continueFromMissionShare(myRoomCode));
  }
}

async function toggleMissionTeam(code, playerId) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'team') return room;
    if (playerId === room.mission.leaderId) return room;
    room.mission.teamIds = obj(room.mission.teamIds);
    if (room.mission.teamIds[playerId]) delete room.mission.teamIds[playerId];
    else room.mission.teamIds[playerId] = true;
    return room;
  });
}
async function confirmMissionTeam(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'team') return room;
    room.mission.step = 'result';
    return room;
  });
}
async function submitMissionResult(code, success) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'mission' || room.mission.step !== 'result') return room;
    room.mission.result = success ? 'success' : 'fail';
    if (success) room.lScore = (room.lScore || 0) + 1; else room.kiraScore = (room.kiraScore || 0) + 1;
    room.mission.step = 'share';
    applyWinCheck(room);
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
      html += `<p class="hint">Vote to arrest a player, or skip.</p><div id="vote-choices">`;
      aliveIds.filter(id => id !== myPlayerId).forEach(id => {
        html += `<button class="choice" data-target="${id}">${players[id].label} — ${esc(players[id].name)}</button>`;
      });
      html += `<button class="choice" data-target="skip">Skip</button></div>`;
    }
  } else {
    const tally = {};
    aliveIds.forEach(id => { const v = votes[id]; tally[v] = (tally[v] || 0) + 1; });
    html += `<h3>Vote Tally</h3>`;
    Object.entries(tally).forEach(([k, c]) => {
      const label = k === 'skip' ? 'Skip' : (players[k] ? `${players[k].label} — ${esc(players[k].name)}` : k);
      html += `<div class="player-row"><span>${label}</span><span>${c} vote(s)</span></div>`;
    });
    if (!voting.arrestedId) {
      html += `<p><strong>No majority reached — no one is arrested.</strong></p>`;
    } else {
      const arrested = players[voting.arrestedId];
      const arrestedSecret = secrets[voting.arrestedId];
      html += `<p><strong>Investigator ${arrested.label} has been arrested.</strong></p>
        <p>They must reveal their secret identity: <strong>${arrestedSecret.firstName} ${arrestedSecret.lastName}</strong></p>
        <p class="hint">${arrested.label} will sit out the next mission and next Information Phase.</p>`;
    }
    html += `<button id="btn-voting-continue" class="primary">Continue</button>`;
  }
  html += `</div>`;
  el('round-content').innerHTML = html;

  if (!voting.resolved) {
    document.querySelectorAll('#vote-choices .choice').forEach(btn => {
      btn.addEventListener('click', () => castVote(myRoomCode, btn.dataset.target));
    });
  } else {
    el('btn-voting-continue').addEventListener('click', () => continueFromVotingResult(myRoomCode));
  }

  maybeResolveVoting(room, myRoomCode);
}

async function castVote(code, targetOrSkip) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'voting' || room.voting.resolved) return room;
    if (!room.secrets[myPlayerId] || !room.secrets[myPlayerId].alive) return room;
    room.voting.votes = obj(room.voting.votes);
    room.voting.votes[myPlayerId] = targetOrSkip;
    return room;
  });
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
      s[arrested].skipNextMission = true;
      s[arrested].skipNextInfo = true;
      if (s[arrested].role === 'Kira') {
        r.endgame = { active: true, resolved: false };
      }
    }
    return r;
  });
}

async function continueFromVotingResult(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'voting' || !room.voting.resolved) return room;
    if (room.endgame && room.endgame.active) return room;
    room.phase = 'information';
    const l = room.secrets[room.lPlayerId];
    const lNeedsToAct = !!(l && l.alive && !l.skipNextInfo);
    if (l && l.skipNextInfo) l.skipNextInfo = false;
    room.info = { lDone: !lNeedsToAct, kiraDone: false, swappedThisPhase: false };
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
  if (amGuesser) {
    const candidates = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && id !== room.kiraPlayerId && id !== room.followerPlayerId);
    html += `<p class="hint">You get one shared guess: who is L, and what's their secret name?</p>
      <label>Who is L?</label>
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
    room.endgame.resolved = true;
    room.status = 'gameover';
    if (whoId === room.lPlayerId && first === l.firstName && last === l.lastName) {
      room.gameOverInfo = { winner: 'Kira', reason: `Kira's team correctly identified L: Investigator ${room.players[room.lPlayerId].label}, ${l.firstName} ${l.lastName}.` };
    } else {
      room.gameOverInfo = { winner: 'L', reason: `Kira's team guessed wrong. L was actually Investigator ${room.players[room.lPlayerId].label} — ${l.firstName} ${l.lastName}.` };
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

  // Preserve any in-progress kill-guess form selections and chat input across
  // re-renders, since this panel is viewed by two separate devices (Kira +
  // Follower) at once, and one device's action shouldn't wipe out the other
  // device's half-filled guess or in-progress message.
  const prevKillTarget = el('kill-target') ? el('kill-target').value : null;
  const prevKillFirst = el('kill-first') ? el('kill-first').value : null;
  const prevKillLast = el('kill-last') ? el('kill-last').value : null;
  const prevChatInput = el('kira-chat-input') ? el('kira-chat-input').value : null;
  const prevChatFocused = document.activeElement && document.activeElement.id === 'kira-chat-input';

  let html = `<h2>Information Phase</h2><div class="card pass-card">`;

  if (amL) {
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
    const kira = players[room.kiraPlayerId], follower = players[room.followerPlayerId];
    html += `<p><strong>Kira:</strong> ${kira.label} — ${esc(kira.name)} &nbsp; <strong>Follower:</strong> ${follower.label} — ${esc(follower.name)}</p>
      <p class="hint">Share what you learned during the Mission Phase and strategize.</p><hr>`;

    if (info.kiraDone) {
      html += `<p class="hint">Done. Waiting for L to finish...</p>`;
    } else {
      const canSwap = !room.lastInfoPhaseSwapped && !info.swappedThisPhase;
      if (info.swappedThisPhase) html += `<p class="hint">The Death Note was swapped this phase.</p>`;
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
    }

    html += `<hr><p><strong>Chat with your ${myPlayerId === room.kiraPlayerId ? 'Follower' : 'Kira'}</strong></p>
      <div class="chat-log" id="kira-chat-log">${renderChatLog(obj(room.kiraChat), players)}</div>
      <div class="chat-input-row">
        <input type="text" id="kira-chat-input" placeholder="Message..." maxlength="200">
        <button id="btn-kira-chat-send" class="secondary">Send</button>
      </div>`;
  } else {
    html += `<p class="waiting">Everyone, close your eyes.<br>
      L is ${info.lDone ? 'done' : 'reviewing suspects'}...<br>
      Kira and the Follower are ${info.kiraDone ? 'done' : 'strategizing'}...</p>
      <p class="hint">Please use this time to take notes, write down suspicions, and write down a plan for next round.</p>`;
  }
  html += `</div>`;
  el('round-content').innerHTML = html;

  if (amL && !info.lDone) {
    const suspectIds = Object.keys(obj(info.lSuspects));
    if (suspectIds.length === 0) el('btn-l-reveal').addEventListener('click', () => lRevealSuspects(myRoomCode));
    else el('btn-l-done').addEventListener('click', () => lDoneViewing(myRoomCode));
  }
  if (amKiraTeam) {
    const targetSel = el('kill-target'), firstSel = el('kill-first'), lastSel = el('kill-last');
    if (targetSel && prevKillTarget && [...targetSel.options].some(o => o.value === prevKillTarget)) targetSel.value = prevKillTarget;
    if (firstSel && prevKillFirst) firstSel.value = prevKillFirst;
    if (lastSel && prevKillLast) lastSel.value = prevKillLast;

    const chatLog = el('kira-chat-log');
    if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
    const chatInput = el('kira-chat-input');
    if (chatInput) {
      if (prevChatInput) chatInput.value = prevChatInput;
      if (prevChatFocused) {
        chatInput.focus();
        chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
      }
    }
    const chatSendBtn = el('btn-kira-chat-send');
    if (chatSendBtn) {
      const sendChat = () => {
        const text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        sendChatMessage(myRoomCode, text);
      };
      chatSendBtn.addEventListener('click', sendChat);
      chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
    }

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
      el('btn-info-finish').addEventListener('click', () => finishKiraTeamTurn(myRoomCode));
    }
  }

  maybeAdvanceFromInfo(room, myRoomCode);
}

async function maybeAdvanceFromInfo(room, code) {
  if (room.phase !== 'information') return;
  const info = obj(room.info);
  if (!info.lDone || !info.kiraDone) return;
  await runTransaction(ref(db, `rooms/${code}`), (r) => {
    if (!r || r.phase !== 'information') return r;
    const i = obj(r.info);
    if (!i.lDone || !i.kiraDone) return r;
    r.round = (r.round || 1) + 1;
    r.phase = 'deaths';
    r.mission = { step: null };
    r.voting = { resolved: false };
    r.info = { lDone: false, kiraDone: false, swappedThisPhase: false };
    return r;
  });
}

async function lRevealSuspects(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.lDone) return room;
    if (Object.keys(obj(room.info.lSuspects)).length > 0) return room;
    const players = obj(room.players), secrets = obj(room.secrets);
    const kiraId = room.kiraPlayerId;
    const pool = Object.keys(players).filter(id => secrets[id] && secrets[id].alive && id !== room.lPlayerId && id !== kiraId);
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

async function swapDeathNote(code) {
  await runTransaction(ref(db, `rooms/${code}`), (room) => {
    if (!room || room.phase !== 'information' || room.info.kiraDone) return room;
    if (room.lastInfoPhaseSwapped || room.info.swappedThisPhase) return room;
    const kId = room.kiraPlayerId, fId = room.followerPlayerId;
    room.secrets[kId].role = 'KiraFollower';
    room.secrets[fId].role = 'Kira';
    room.kiraPlayerId = fId;
    room.followerPlayerId = kId;
    room.info.swappedThisPhase = true;
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
    if ((room.info.killsThisPhase || 0) >= 2) return room;
    const target = room.secrets[targetId];
    if (!target || !target.alive || target.immune) return room;
    if (first === target.firstName && last === target.lastName) {
      target.alive = false;
      room.pendingDeaths = obj(room.pendingDeaths);
      room.pendingDeaths[targetId] = true;
      room.kiraScore = (room.kiraScore || 0) + 2;
      room.info.killsThisPhase = (room.info.killsThisPhase || 0) + 1;
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

/* ---------------- GAME OVER ---------------- */

function renderGameOver(room) {
  const players = obj(room.players);
  const secrets = obj(room.secrets);
  const info = obj(room.gameOverInfo);
  let html = `<h1 class="title" style="color:${info.winner === 'Kira' ? 'var(--red-bright)' : 'var(--gold)'}">${info.winner === 'Kira' ? 'KIRA WINS' : "L'S TEAM WINS"}</h1>
    <div class="card">
      <p>${info.reason || ''}</p>
      <h3>Full Reveal</h3>`;
  Object.keys(players).sort().forEach(id => {
    const s = secrets[id] || {};
    const status = s.alive === false ? '<span class="tag dead">dead</span>' : '';
    html += `<div class="player-row"><span>${players[id].label} — ${esc(players[id].name)}${status}</span><span>${s.role || ''} · ${s.firstName || ''} ${s.lastName || ''}</span></div>`;
  });
  html += `<button id="btn-new-game" class="primary">New Game</button></div>`;
  el('gameover-content').innerHTML = html;
  el('btn-new-game').addEventListener('click', () => {
    clearSession();
    location.reload();
  });
}
