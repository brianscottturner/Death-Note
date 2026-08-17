'use strict';

const FIRST_NAMES = ["Harry", "Ron", "Katniss", "Peeta", "Percy", "Sherlock", "Peter", "Tony", "Bruce", "Clark"];
const LAST_NAMES = ["Potter", "Weasley", "Everdeen", "Mellark", "Jackson", "Holmes", "Parker", "Stark", "Wayne", "Kent"];
const LABELS = "ABCDEFGHIJ".split("");

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function el(id) { return document.getElementById(id); }
function alivePlayers() { return state.players.filter(p => p.alive); }
function findPlayer(id) { return state.players.find(p => p.id === id); }

const state = {
  players: [],
  round: 1,
  lScore: 0,
  kiraScore: 0,
  lPlayerId: null,
  kiraPlayerId: null,
  followerPlayerId: null,
  lastInfoPhaseSwapped: false,
  pendingDeaths: [],
  revealIndex: 0,
  missionLeaderId: null,
  missionTeamIds: [],
  missionResult: null,
  votingOrder: null,
  votingIndex: 0,
  votes: {},
  infoStep: null,
  lSuspects: null,
  didSwapThisInfoPhase: false,
  gameOver: null
};

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  el(id).classList.remove('hidden');
}

/* ---------------- SETUP ---------------- */

el('btn-gen-names').addEventListener('click', () => {
  const count = clampCount();
  const box = el('player-name-inputs');
  box.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const label = LABELS[i];
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label>Investigator ${label} — name (optional)</label>
      <input type="text" class="name-input" placeholder="Investigator ${label}">`;
    box.appendChild(wrap);
  }
});

function clampCount() {
  const input = el('player-count');
  let count = parseInt(input.value, 10) || 7;
  count = Math.max(7, Math.min(10, count));
  input.value = count;
  return count;
}

el('btn-start-setup').addEventListener('click', () => {
  const count = clampCount();
  const nameInputs = Array.from(document.querySelectorAll('.name-input'));
  const names = [];
  for (let i = 0; i < count; i++) {
    const v = nameInputs[i] ? nameInputs[i].value.trim() : '';
    names.push(v || `Investigator ${LABELS[i]}`);
  }
  dealRoles(count, names);
});

function dealRoles(count, names) {
  const roles = ['L', 'Kira', 'KiraFollower'].concat(Array(count - 3).fill('Investigator'));
  const rolesShuffled = shuffle(roles);
  const firstNames = shuffle(FIRST_NAMES).slice(0, count);
  const lastNames = shuffle(LAST_NAMES).slice(0, count);

  state.players = [];
  for (let i = 0; i < count; i++) {
    state.players.push({
      id: i,
      label: LABELS[i],
      name: names[i],
      role: rolesShuffled[i],
      firstName: firstNames[i],
      lastName: lastNames[i],
      alive: true,
      skipNextMission: false,
      skipNextInfo: false,
      wrongGuessCount: 0,
      immune: false
    });
  }
  state.lPlayerId = state.players.find(p => p.role === 'L').id;
  state.kiraPlayerId = state.players.find(p => p.role === 'Kira').id;
  state.followerPlayerId = state.players.find(p => p.role === 'KiraFollower').id;

  state.revealIndex = 0;
  showScreen('screen-reveal');
  renderReveal();
}

/* ---------------- ROLE / NAME REVEAL ---------------- */

function renderReveal() {
  if (state.revealIndex >= state.players.length) {
    startRound();
    return;
  }
  const p = state.players[state.revealIndex];
  el('reveal-pass-text').textContent = `Pass the device to Investigator ${p.label} (${p.name})`;
  el('reveal-content').classList.add('hidden');
  el('btn-reveal-show').classList.remove('hidden');
}

el('btn-reveal-show').addEventListener('click', () => {
  const p = state.players[state.revealIndex];
  let roleName, roleDesc;
  if (p.role === 'Kira') {
    roleName = 'You are KIRA';
    roleDesc = "You lead the evil team. Coordinate with your Follower during the Information Phase. Kill investigators by correctly guessing their secret names. Avoid being arrested.";
  } else if (p.role === 'KiraFollower') {
    roleName = "You are KIRA'S FOLLOWER";
    roleDesc = "You know who Kira is. Help them strategize. If needed, you can swap the Death Note with Kira to become Kira yourself.";
  } else if (p.role === 'L') {
    roleName = 'You are L';
    roleDesc = "Each Information Phase you'll be shown 4 suspects — one is truly Kira. Use missions and votes to find and arrest Kira before it's too late.";
  } else {
    roleName = 'You are an INVESTIGATOR';
    roleDesc = "You're on L's side. Vote wisely and help complete missions to expose Kira.";
  }
  el('reveal-role-box').innerHTML = `
    <div class="role-name">${roleName}</div>
    <div class="role-names">Your secret name: <strong>${p.firstName} ${p.lastName}</strong></div>
    <div class="role-desc">${roleDesc}</div>`;
  el('reveal-content').classList.remove('hidden');
  el('btn-reveal-show').classList.add('hidden');
});

el('btn-reveal-next').addEventListener('click', () => {
  state.revealIndex++;
  renderReveal();
});

/* ---------------- ROUND FLOW ---------------- */

function startRound() {
  state.round = 1;
  state.lScore = 0;
  state.kiraScore = 0;
  state.pendingDeaths = [];
  state.lastInfoPhaseSwapped = false;
  showScreen('screen-round');
  resetRoundTransientState();
  goPhase('deaths');
}

function resetRoundTransientState() {
  state.missionLeaderId = null;
  state.missionTeamIds = [];
  state.missionResult = null;
  state.votingOrder = null;
  state.votingIndex = 0;
  state.votes = {};
  state.infoStep = null;
  state.lSuspects = null;
}

function nextRound() {
  state.round++;
  resetRoundTransientState();
  goPhase('deaths');
}

function updateHeader() {
  el('round-label').textContent = `Round ${state.round}`;
  el('score-label').textContent = `L: ${state.lScore}  |  Kira: ${state.kiraScore}`;
}

function goPhase(name) {
  document.querySelectorAll('.phase-panel').forEach(p => p.classList.add('hidden'));
  el('phase-' + name).classList.remove('hidden');
  updateHeader();
  if (name === 'deaths') renderDeaths();
  if (name === 'mission') renderMission();
  if (name === 'voting') renderVoting();
  if (name === 'information') renderInfo();
}

/* ---------------- DEATHS PHASE ---------------- */

function renderDeaths() {
  const box = el('deaths-content');
  if (state.pendingDeaths.length === 0) {
    box.innerHTML = `<p>No one has died... yet.</p>`;
  } else {
    box.innerHTML = state.pendingDeaths.map(id => {
      const p = findPlayer(id);
      return `<p>Investigator ${p.label} has died.</p>`;
    }).join('');
  }
}

el('btn-deaths-continue').addEventListener('click', () => {
  state.pendingDeaths = [];
  goPhase('mission');
});

/* ---------------- MISSION PHASE ---------------- */

function eligibleForMission() {
  return state.players.filter(p => p.alive && !p.skipNextMission);
}

function renderMission() {
  if (state.missionLeaderId === null) {
    const pool = eligibleForMission();
    const leader = pool[Math.floor(Math.random() * pool.length)];
    state.missionLeaderId = leader.id;
    state.missionTeamIds = [leader.id];
  }
  const leader = findPlayer(state.missionLeaderId);
  el('mission-leader-box').innerHTML = `<p><strong>Leading Investigator: ${leader.label} (${leader.name})</strong></p>
    <p class="hint">Choose the players joining this meeting. Your physical mission card tells you how many are required (3-8, leader included).</p>`;

  const pool = eligibleForMission();
  el('mission-team-select').innerHTML = pool.map(p => {
    const selected = state.missionTeamIds.includes(p.id);
    const locked = p.id === leader.id;
    return `<button class="choice ${selected ? 'selected' : ''}" data-id="${p.id}" ${locked ? 'disabled' : ''}>
      ${selected ? '✓ ' : ''}${p.label} — ${p.name}${locked ? ' (leader)' : ''}
    </button>`;
  }).join('');

  document.querySelectorAll('#mission-team-select .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const idx = state.missionTeamIds.indexOf(id);
      if (idx === -1) state.missionTeamIds.push(id); else state.missionTeamIds.splice(idx, 1);
      renderMission();
    });
  });

  el('btn-mission-confirm-team').classList.toggle('hidden', state.missionTeamIds.length < 1);
  el('mission-result-box').classList.add('hidden');
  el('mission-shared-name-box').classList.add('hidden');
}

el('btn-mission-confirm-team').addEventListener('click', () => {
  el('mission-team-select').classList.add('hidden');
  el('btn-mission-confirm-team').classList.add('hidden');
  el('mission-result-box').classList.remove('hidden');
});

function resolveMission(success) {
  state.missionResult = success ? 'success' : 'fail';
  if (success) state.lScore += 1; else state.kiraScore += 1;
  updateHeader();
  if (checkWin()) return;
  el('mission-result-box').classList.add('hidden');
  el('mission-shared-name-box').classList.remove('hidden');
}

el('btn-mission-success').addEventListener('click', () => resolveMission(true));
el('btn-mission-fail').addEventListener('click', () => resolveMission(false));

el('btn-mission-done').addEventListener('click', () => {
  state.players.forEach(p => { if (p.skipNextMission) p.skipNextMission = false; });
  goPhase('voting');
});

/* ---------------- VOTING PHASE ---------------- */

function renderVoting() {
  if (state.votingOrder === null) {
    state.votingOrder = alivePlayers().map(p => p.id);
    state.votingIndex = 0;
    state.votes = {};
  }
  el('voting-result-box').classList.add('hidden');
  const box = el('voting-ballot-box');

  if (state.votingIndex < state.votingOrder.length) {
    box.classList.remove('hidden');
    const voter = findPlayer(state.votingOrder[state.votingIndex]);
    box.innerHTML = `<p class="pass-text">Pass to Investigator ${voter.label}. Everyone else, look away.</p>
      <button id="btn-show-ballot" class="primary">I'm ${voter.label} — Show My Ballot</button>
      <div id="ballot-choices" class="hidden"></div>`;

    el('btn-show-ballot').addEventListener('click', () => {
      el('btn-show-ballot').classList.add('hidden');
      const choicesBox = el('ballot-choices');
      choicesBox.classList.remove('hidden');
      const others = alivePlayers().filter(p => p.id !== voter.id);
      choicesBox.innerHTML = others.map(p =>
        `<button class="choice" data-target="${p.id}">Vote: ${p.label} — ${p.name}</button>`
      ).join('') + `<button class="choice" data-target="skip">Skip</button>`;

      choicesBox.querySelectorAll('.choice').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = btn.dataset.target;
          state.votes[voter.id] = t === 'skip' ? 'skip' : parseInt(t, 10);
          state.votingIndex++;
          renderVoting();
        });
      });
    });
  } else {
    box.classList.add('hidden');
    resolveVoting();
  }
}

function resolveVoting() {
  const tally = {};
  Object.values(state.votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
  const totalVoters = state.votingOrder.length;

  let topTarget = null, topCount = 0;
  Object.entries(tally).forEach(([k, c]) => {
    if (k !== 'skip' && c > topCount) { topCount = c; topTarget = parseInt(k, 10); }
  });

  const tallyLines = Object.entries(tally).map(([k, c]) => {
    const name = k === 'skip' ? 'Skip' : (() => { const p = findPlayer(parseInt(k, 10)); return `${p.label} — ${p.name}`; })();
    return `<div class="player-row"><span>${name}</span><span>${c} vote(s)</span></div>`;
  }).join('');

  const resultBox = el('voting-result-box');
  resultBox.classList.remove('hidden');

  const arrested = (topTarget !== null && topCount > totalVoters / 2) ? findPlayer(topTarget) : null;

  let outcomeHtml = `<h3>Vote Tally</h3>${tallyLines}`;

  if (!arrested) {
    outcomeHtml += `<p><strong>No majority reached — no one is arrested.</strong></p>
      <button id="btn-voting-continue" class="primary">Continue</button>`;
    resultBox.innerHTML = outcomeHtml;
    el('btn-voting-continue').addEventListener('click', () => goPhase('information'));
    return;
  }

  arrested.skipNextMission = true;
  arrested.skipNextInfo = true;

  if (arrested.role === 'Kira') {
    outcomeHtml += `<p><strong>Investigator ${arrested.label} has been arrested... and it was KIRA!</strong></p>
      <button id="btn-voting-continue" class="primary">Continue to Final Guess</button>`;
    resultBox.innerHTML = outcomeHtml;
    el('btn-voting-continue').addEventListener('click', showEndgameGuess);
    return;
  }

  outcomeHtml += `<p><strong>Investigator ${arrested.label} has been arrested.</strong></p>
    <p>They must reveal their secret identity: <strong>${arrested.firstName} ${arrested.lastName}</strong></p>
    <p class="hint">${arrested.label} will sit out the next mission and the next Information Phase.</p>
    <button id="btn-voting-continue" class="primary">Continue</button>`;
  resultBox.innerHTML = outcomeHtml;
  el('btn-voting-continue').addEventListener('click', () => goPhase('information'));
}

/* ---------------- ENDGAME: KIRA ARRESTED ---------------- */

function showEndgameGuess() {
  showScreen('screen-endgame-guess');
  const form = el('endgame-guess-form');
  const candidates = alivePlayers().filter(p => p.id !== state.kiraPlayerId && p.id !== state.followerPlayerId);
  form.innerHTML = `
    <label>Who is L?</label>
    <select id="guess-who">${candidates.map(p => `<option value="${p.id}">${p.label} — ${p.name}</option>`).join('')}</select>
    <label>Guess their first name</label>
    <select id="guess-first">${FIRST_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
    <label>Guess their last name</label>
    <select id="guess-last">${LAST_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
    <button id="btn-endgame-submit" class="primary">Submit Final Guess</button>`;

  el('btn-endgame-submit').addEventListener('click', () => {
    const whoId = parseInt(el('guess-who').value, 10);
    const first = el('guess-first').value;
    const last = el('guess-last').value;
    const lPlayer = findPlayer(state.lPlayerId);
    if (whoId === lPlayer.id && first === lPlayer.firstName && last === lPlayer.lastName) {
      endGame('Kira', `Kira's team correctly identified L: Investigator ${lPlayer.label}, ${lPlayer.firstName} ${lPlayer.lastName}.`);
    } else {
      endGame('L', `Kira's team guessed wrong. L was actually Investigator ${lPlayer.label} — ${lPlayer.firstName} ${lPlayer.lastName}.`);
    }
  });
}

/* ---------------- INFORMATION PHASE ---------------- */

function renderInfo() {
  if (state.infoStep === null) {
    const lPlayer = findPlayer(state.lPlayerId);
    if (lPlayer.alive && !lPlayer.skipNextInfo) {
      state.infoStep = 'l-pass';
    } else {
      if (lPlayer.skipNextInfo) lPlayer.skipNextInfo = false;
      state.infoStep = 'kira-pass';
    }
    state.didSwapThisInfoPhase = false;
  }

  const box = el('info-content');

  if (state.infoStep === 'l-pass') {
    box.innerHTML = `<p class="pass-text">Pass the device to L. Everyone else, close your eyes.</p>
      <button id="btn-l-reveal" class="primary">L: Reveal Suspects</button>`;
    el('btn-l-reveal').addEventListener('click', () => {
      const kira = findPlayer(state.kiraPlayerId);
      const pool = alivePlayers().filter(p => p.id !== state.lPlayerId && p.id !== kira.id);
      const others = shuffle(pool).slice(0, 3);
      state.lSuspects = shuffle([kira, ...others]).map(p => p.id);
      state.infoStep = 'l-view';
      renderInfo();
    });
    return;
  }

  if (state.infoStep === 'l-view') {
    const suspects = state.lSuspects.map(id => findPlayer(id));
    box.innerHTML = `<p><strong>4 Suspects — one of them is Kira:</strong></p>
      ${suspects.map(p => `<div class="player-row"><span>${p.label} — ${p.name}</span></div>`).join('')}
      <p class="hint">Write these down if you'd like. Kira's Follower has an equal chance of appearing here as any other Investigator.</p>
      <button id="btn-l-done" class="primary">Done — Hide &amp; Pass</button>`;
    el('btn-l-done').addEventListener('click', () => {
      state.infoStep = 'kira-pass';
      renderInfo();
    });
    return;
  }

  if (state.infoStep === 'kira-pass') {
    const follower = findPlayer(state.followerPlayerId);
    const note = follower.skipNextInfo ? `<p class="hint">Kira's Follower is arrested and sits out this phase.</p>` : '';
    box.innerHTML = `<p class="pass-text">Pass the device to Kira${follower.skipNextInfo ? '' : ' and the Follower'}. Everyone else, close your eyes.</p>
      ${note}
      <button id="btn-kira-reveal" class="primary">Reveal</button>`;
    el('btn-kira-reveal').addEventListener('click', () => {
      if (follower.skipNextInfo) follower.skipNextInfo = false;
      state.infoStep = 'kira-view';
      renderInfo();
    });
    return;
  }

  if (state.infoStep === 'kira-view') {
    renderKiraView(box);
    return;
  }
}

function renderKiraView(box) {
  const kira = findPlayer(state.kiraPlayerId);
  const follower = findPlayer(state.followerPlayerId);
  const canSwap = !state.lastInfoPhaseSwapped && !state.didSwapThisInfoPhase;

  const targets = alivePlayers().filter(p => p.id !== kira.id && p.id !== follower.id && !p.immune);

  let html = `<p><strong>Kira:</strong> ${kira.label} — ${kira.name} &nbsp; <strong>Follower:</strong> ${follower.label} — ${follower.name}</p>
    <p class="hint">Share what you learned during the Mission Phase and strategize.</p>
    <hr>`;

  if (state.didSwapThisInfoPhase) {
    html += `<p class="hint">The Death Note was swapped this phase.</p>`;
  } else if (canSwap) {
    html += `<button id="btn-swap-note" class="secondary">Swap the Death Note (Kira ⇄ Follower)</button>`;
  } else {
    html += `<p class="hint">The Death Note was swapped last time — cannot swap again this round.</p>`;
  }

  html += `<hr><p><strong>Write a name in the Death Note?</strong></p>`;
  if (targets.length === 0) {
    html += `<p class="hint">No valid targets remain.</p>`;
  } else {
    html += `
      <label>Target</label>
      <select id="kill-target">${targets.map(p => `<option value="${p.id}">${p.label} — ${p.name}</option>`).join('')}</select>
      <label>Guess first name</label>
      <select id="kill-first">${FIRST_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
      <label>Guess last name</label>
      <select id="kill-last">${LAST_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
      <button id="btn-kill-submit" class="danger">Submit Guess</button>
      <div id="kill-result"></div>`;
  }

  html += `<hr><button id="btn-info-finish" class="primary">Finished — Continue</button>`;
  box.innerHTML = html;

  const swapBtn = el('btn-swap-note');
  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      kira.role = 'KiraFollower';
      follower.role = 'Kira';
      state.kiraPlayerId = follower.id;
      state.followerPlayerId = kira.id;
      state.didSwapThisInfoPhase = true;
      renderKiraView(box);
    });
  }

  const killBtn = el('btn-kill-submit');
  if (killBtn) {
    killBtn.addEventListener('click', () => {
      const targetId = parseInt(el('kill-target').value, 10);
      const target = findPlayer(targetId);
      const first = el('kill-first').value;
      const last = el('kill-last').value;
      let resultMsg;
      let killed = false;
      if (first === target.firstName && last === target.lastName) {
        target.alive = false;
        state.pendingDeaths.push(target.id);
        state.kiraScore += 2;
        updateHeader();
        resultMsg = `<p><strong>Correct! ${target.label} has been killed.</strong></p>`;
        killed = true;
      } else {
        target.wrongGuessCount++;
        resultMsg = `<p>Wrong. ${target.label} survives.</p>`;
        if (target.wrongGuessCount >= 2) {
          target.immune = true;
          resultMsg += `<p class="hint">${target.label} has been guessed wrong twice and is now immune for the rest of the game.</p>`;
        }
      }
      if (killed && checkWin()) return;
      renderKiraView(box);
      el('kill-result').innerHTML = resultMsg;
    });
  }

  el('btn-info-finish').addEventListener('click', () => {
    state.lastInfoPhaseSwapped = state.didSwapThisInfoPhase;
    nextRound();
  });
}

/* ---------------- WIN CHECK ---------------- */

function checkWin() {
  if (state.kiraScore >= 10) { endGame('Kira', "Kira's team reached 10 points."); return true; }
  if (state.lScore >= 10) { endGame('L', "L's team reached 10 points."); return true; }
  const lPlayer = findPlayer(state.lPlayerId);
  if (!lPlayer.alive) { endGame('Kira', 'L has been killed.'); return true; }
  return false;
}

function endGame(winner, reason) {
  state.gameOver = { winner, reason };
  showScreen('screen-gameover');
  el('gameover-heading').textContent = winner === 'Kira' ? 'KIRA WINS' : "L'S TEAM WINS";
  el('gameover-heading').style.color = winner === 'Kira' ? 'var(--red-bright)' : 'var(--gold)';
  el('gameover-reason').textContent = reason;
  el('gameover-reveal').innerHTML = `<h3>Full Reveal</h3>` + state.players.map(p => {
    const status = !p.alive ? '<span class="tag dead">dead</span>' : '';
    return `<div class="player-row"><span>${p.label} — ${p.name}${status}</span><span>${p.role} · ${p.firstName} ${p.lastName}</span></div>`;
  }).join('');
}

el('btn-restart').addEventListener('click', () => {
  location.reload();
});
