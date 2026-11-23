import { net } from './net.js';
import { ROLES, TEAMS, ROLE_GROUPS, roleName, teamName } from './roles.js';
import * as E from './engine.js';

const APP_VERSION = 1;
const EDITION = 'werewolves';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 30;
const ALTRUIST_WINDOW_MS = 20000;
const { arr, obj } = E;

const $app = document.getElementById('app');
let myUid = null;
let code = null;
let room = null;
let unsub = null;
let landingError = '';
let showRole = false;
let draft = { key: null, values: {} };
let voteDraft = { t: null, power: false };

/* ---------------- small helpers ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const roomPath = () => `rooms/${code}`;
function myPid(r = room) {
  if (!r) return null;
  return Object.keys(obj(r.players)).find(p => r.players[p].uid === myUid) || null;
}
const isHost = (r = room) => !!r && r.hostUid === myUid;
const isSpeaker = (r = room) => !!r && r.speakerUid === myUid;
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function teamBadge(team) {
  const t = TEAMS[team] || { name: team, color: '#888' };
  return `<span class="badge" style="background:${t.color}">${esc(t.name)}</span>`;
}

// Run a change against the whole room atomically. `fn` mutates the room.
async function tx(fn) {
  const res = await net.transaction(roomPath(), (cur) => {
    if (!cur) return cur;
    fn(cur);
    return cur;
  });
  if (res.committed && res.value) { room = res.value; }
  return res;
}

/* ---------------- session ---------------- */

// In local test mode every tab is a different player, so the session is per tab.
const sessionStore = net.local ? sessionStorage : localStorage;
function saveSession() { sessionStore.setItem('ww_session', JSON.stringify({ code })); }
function clearSession() { sessionStore.removeItem('ww_session'); }

function attach(c) {
  if (unsub) unsub();
  code = c;
  saveSession();
  unsub = net.listen(roomPath(), (val) => {
    if (!val) {
      detach();
      landingError = 'That game no longer exists.';
      render();
      return;
    }
    const prev = room;
    room = val;
    if (!myPid() && !isSpeaker()) {
      detach();
      landingError = "You're not part of that game anymore.";
      render();
      return;
    }
    onRoomChanged(prev, val);
    render();
  });
}
function detach() {
  if (unsub) unsub();
  unsub = null; room = null; code = null;
  clearSession();
}

/* ---------------- landing ---------------- */

function renderLanding() {
  const savedName = localStorage.getItem('ww_name') || '';
  $app.innerHTML = `
    <h1 class="title">🐺 WEREWOLVES<br><span class="subtitle">Moderator</span></h1>
    <div class="card">
      ${landingError ? `<div class="error">${esc(landingError)}</div>` : ''}
      ${net.local ? '<p class="hint warn">Local test mode: games only exist in this browser.</p>' : ''}
      <label for="in-name">Your name</label>
      <input id="in-name" type="text" maxlength="20" placeholder="Your name" value="${esc(savedName)}">
      <button class="primary" data-act="create">Create New Game</button>
      <hr>
      <label for="in-code">Room code</label>
      <input id="in-code" type="text" maxlength="8" placeholder="e.g. WOLF7" style="text-transform:uppercase">
      <button class="secondary" data-act="join">Join Game</button>
      <button class="ghost" data-act="joinSpeaker">🔊 Join as the speaker phone only (not playing)</button>
      <p class="hint center dim">v${APP_VERSION}</p>
    </div>`;
}

async function createGame() {
  const name = document.getElementById('in-name').value.trim();
  if (!name) return landingFail('Enter your name first.');
  localStorage.setItem('ww_name', name);
  for (let attempt = 0; attempt < 5; attempt++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const res = await net.transaction(`rooms/${c}`, (cur) => {
      if (cur) return undefined;
      return {
        code: c, edition: EDITION, createdAt: Date.now(), hostUid: myUid, speakerUid: null,
        status: 'lobby',
        settings: { roles: { werewolf: 2, seer: 1, villager: 2 }, trueLovers: false, revealRoles: true, discussSec: 180 },
        players: { p1: { uid: myUid, name } },
      };
    });
    if (res.committed) { landingError = ''; attach(c); return; }
  }
  landingFail('Could not create a game. Try again.');
}

async function joinGame(asSpeaker) {
  const name = document.getElementById('in-name').value.trim();
  const c = document.getElementById('in-code').value.trim().toUpperCase();
  if (!asSpeaker && !name) return landingFail('Enter your name first.');
  if (!c) return landingFail('Enter the room code.');
  if (name) localStorage.setItem('ww_name', name);
  const r = await net.get(`rooms/${c}`);
  if (!r) return landingFail('Room not found.');
  if (r.edition !== EDITION) return landingFail("That code isn't a Werewolves game.");
  const already = Object.values(obj(r.players)).some(p => p.uid === myUid) || r.speakerUid === myUid;
  if (!already && r.status !== 'lobby') return landingFail('That game has already started.');
  if (asSpeaker) {
    await net.update(`rooms/${c}`, { speakerUid: myUid, speakerDevice: true });
  } else if (!already) {
    const res = await net.transaction(`rooms/${c}/players`, (players) => {
      players = players || {};
      if (Object.values(players).some(p => p.uid === myUid)) return players;
      const ids = Object.keys(players);
      if (ids.length >= MAX_PLAYERS) return undefined;
      const n = Math.max(0, ...ids.map(id => Number(id.slice(1)))) + 1;
      players['p' + n] = { uid: myUid, name };
      return players;
    });
    if (!res.committed) return landingFail('That game is full.');
  }
  landingError = '';
  attach(c);
}
function landingFail(msg) { landingError = msg; renderLanding(); }

/* ---------------- lobby ---------------- */

function renderLobby() {
  const r = room;
  const host = isHost();
  const ids = E.playerIds(r);
  const s = obj(r.settings);
  const counts = obj(s.roles);
  const deck = E.deckFromSettings(s);
  const need = E.deckSizeNeeded(r);
  const problem = E.validateSetup(r) || (!r.speakerUid ? 'Choose a speaker phone.' : null);
  const speakerName = !r.speakerUid ? null
    : r.speakerDevice && !Object.values(obj(r.players)).some(p => p.uid === r.speakerUid) ? 'a dedicated speaker device'
    : (Object.values(obj(r.players)).find(p => p.uid === r.speakerUid) || {}).name;

  let html = `<h1 class="title small">🐺 WEREWOLVES</h1>
    <div class="card">
      <p class="hint center">Room code</p>
      <div class="room-code">${esc(r.code)}</div>
      <p class="hint center">${ids.length} player${ids.length === 1 ? '' : 's'} joined</p>
      <div class="player-list">`;
  ids.forEach(p => {
    const pl = r.players[p];
    const tags = [pl.uid === r.hostUid ? 'host' : '', pl.uid === r.speakerUid ? '🔊 speaker' : '', pl.uid === myUid ? 'you' : ''].filter(Boolean).join(', ');
    html += `<div class="player-row"><span>${esc(pl.name)} ${tags ? `<span class="dim">(${tags})</span>` : ''}</span>
      ${host && pl.uid !== r.speakerUid ? `<button class="mini" data-act="makeSpeaker" data-uid="${pl.uid}">🔊 Make speaker</button>` : ''}
      ${host && pl.uid !== myUid ? `<button class="mini danger" data-act="kick" data-pid="${p}">✕</button>` : ''}
    </div>`;
  });
  html += `</div>
      <p class="hint">🔊 Speaker: <b>${speakerName ? esc(speakerName) : 'not chosen yet'}</b>. The speaker phone reads everything out loud. Put it in the middle of the table, turned up.</p>
      ${!myPid() && isSpeaker() ? '<p class="hint">This device is the speaker. Leave it on this screen.</p>' : ''}
      ${myPid() ? `<button class="ghost" data-act="leave">Leave game</button>` : ''}
    </div>`;

  // Role setup
  html += `<div class="card"><h2>Roles <span class="count ${deck.length === need ? 'ok' : 'bad'}">${deck.length} / ${need}</span></h2>
    ${deck.includes('thief') ? '<p class="hint">With a Thief, you need 2 extra roles: the two unused cards the Thief chooses from.</p>' : ''}`;
  ROLE_GROUPS.forEach(gr => {
    html += `<h3>${gr.label}</h3>`;
    gr.roles.forEach(id => {
      const ro = ROLES[id];
      const n = counts[id] || 0;
      const disabled = id === 'cupid' && s.trueLovers;
      if (!host && !n) return;
      html += `<div class="role-row ${n ? 'on' : ''} ${disabled ? 'disabled' : ''}">
        <div class="role-text"><b>${ro.name}</b><div class="hint">${esc(ro.desc)}</div></div>
        ${host ? `<div class="stepper">
          <button class="mini" data-act="roleDec" data-role="${id}" ${n ? '' : 'disabled'}>−</button>
          <span>${n}</span>
          <button class="mini" data-act="roleInc" data-role="${id}" ${disabled || (!ro.multi && n >= 1) ? 'disabled' : ''}>+</button>
        </div>` : `<span class="stepper"><span>×${n}</span></span>`}
      </div>`;
    });
  });
  html += `</div>`;

  // Options
  const mort = deck.includes('mortician');
  const opt = (key, label, hint, disabled = false) => `
    <label class="toggle ${disabled ? 'disabled' : ''}">
      <input type="checkbox" data-act="toggleSetting" data-key="${key}" ${s[key] && !disabled ? 'checked' : ''} ${host && !disabled ? '' : 'disabled'}>
      <span><b>${label}</b><br><span class="hint">${hint}</span></span>
    </label>`;
  html += `<div class="card"><h2>Options</h2>
    ${opt('trueLovers', 'True Lovers mode', "Two random players start as Lovers. Can't be used with Cupid.")}
    ${opt('revealRoles', 'Reveal roles when players die', mort ? 'Turned off automatically because the Mortician is in the game.' : 'Everyone hears the role of each player who dies.', mort)}
    <div class="row-between"><span><b>Discussion time</b></span>
      <span class="stepper">${host ? `<button class="mini" data-act="discuss" data-d="-30">−</button>` : ''}
      <span>${fmtTime((s.discussSec || 180) * 1000)}</span>
      ${host ? `<button class="mini" data-act="discuss" data-d="30">+</button>` : ''}</span>
    </div>
  </div>`;

  if (host) {
    html += `<div class="card">
      ${problem ? `<p class="error">${esc(problem)}</p>` : '<p class="hint">Everything is ready!</p>'}
      <button class="primary" data-act="start" ${problem ? 'disabled' : ''}>Start: everyone enters their card</button>
      <p class="hint">Shuffle and deal your physical cards first: only the cards checked above${deck.includes('thief') ? ', with the 2 leftover cards face down in the middle for the Thief' : ''}.</p>
    </div>`;
  } else {
    html += `<p class="hint center">Waiting for the host to start the game…</p>`;
  }
  $app.innerHTML = html;
}

/* ---------------- entering physical cards ---------------- */

let pickError = '';

function renderChoosing() {
  const r = room;
  const me = myPid();
  const ids = E.playerIds(r);
  const picks = obj(r.picks);
  const done = ids.filter(p => picks[p]).length;
  const deckRoles = [...new Set(E.deckFromSettings(r.settings))];
  let html = `<h1 class="title small">🐺 WEREWOLVES</h1>`;
  if (me) {
    const mine = picks[me];
    html += `<div class="card awake"><h2>Which card did you get?</h2>
      <p class="hint">Keep your screen hidden from the others while you choose.</p>
      ${pickError ? `<p class="error">${esc(pickError)}</p>` : ''}
      ${mine ? `<p>✅ You entered <b>${esc(roleName(mine))}</b>. Tap it again to change.</p>` : ''}
      <div class="choices">${deckRoles.map(ro => `<button class="choice ${mine === ro ? 'selected' : ''}" data-act="pickCard" data-role="${ro}">${esc(roleName(ro))}</button>`).join('')}</div>
    </div>`;
  } else {
    html += `<div class="card"><h2>🔊 Speaker</h2><p>Waiting for everyone to enter their card…</p></div>`;
  }
  html += `<div class="card"><p><b>${done} of ${ids.length}</b> players have entered their card.</p>
    <div class="player-list">${ids.map(p => `<div class="player-row"><span>${esc(pname(p))}</span><span>${picks[p] ? '✅' : '…'}</span></div>`).join('')}</div></div>`;
  if (isHost()) {
    html += `<div class="card">
      <button class="primary" data-act="beginGame" ${done === ids.length ? '' : 'disabled'}>Begin the game</button>
      <button class="ghost" data-act="backToSetup">Back to role setup</button>
    </div>`;
  } else {
    html += `<p class="hint center">The host starts the game once everyone has entered their card.</p>`;
  }
  $app.innerHTML = html;
}

/* ---------------- game (every phone) ---------------- */

function renderGame() {
  const r = room, g = r.g;
  const me = myPid();
  let html = '';
  const phaseLabel = r.status === 'over' ? 'Game over'
    : g.phase === 'night' ? `🌙 Night ${g.night}` : `☀️ Day ${g.night}`;
  html += `<header class="topbar"><span>${phaseLabel}</span><span class="dim">${esc(r.code)}${me ? ' · ' + esc(pname(me)) : ''}</span></header>`;

  if (isSpeaker()) html += renderSpeakerPanel();
  if (r.status === 'over') html += renderGameOver();
  else if (me) html += renderPlayerPanel(me);
  if (isHost() && !isSpeaker() && r.status !== 'over') {
    html += `<details class="card host-controls" data-keep="host"><summary>Host controls</summary>
      <p class="hint">Use this if someone is stuck. It moves the speaker on to the next part.</p>
      <button class="secondary" data-act="hostSkip">⏭ Skip / continue</button>
    </details>`;
  }
  $app.innerHTML = html;
  document.body.classList.toggle('night', g.phase === 'night' && r.status !== 'over' && !isSpeaker());
}
const pname = (p) => E.pname(room, p);

function renderPlayerPanel(me) {
  const r = room, g = r.g;
  let html = '';
  const alive = E.isAlive(r, me);
  const notes = arr(obj(g.notes)[me]);

  // Role card (hidden until tapped so neighbours can't glance at it)
  html += `<div class="card role-card">
    <button class="secondary" data-act="toggleRole">${showRole ? 'Hide my role' : '👁 Show my role'}${!showRole && notes.length ? ` <span class="badge" style="background:#b03a2e">${notes.length} message${notes.length > 1 ? 's' : ''}</span>` : ''}</button>
    ${showRole ? renderRoleDetails(me) : ''}
  </div>`;

  if (!alive) {
    html += `<div class="card dead-card"><h2>💀 You are dead</h2><p>Please stay quiet and don't give anything away.</p></div>`;
  }

  switch (g.phase) {
    case 'night': html += renderNight(me); break;
    case 'morning': html += renderMorning(me); break;
    case 'hunter': html += renderHunter(me); break;
    case 'discussion': html += renderDiscussion(); break;
    case 'vote': html += renderVote(me); break;
  }
  if (g.phase !== 'night') html += renderPublicList();
  return html;
}

function renderRoleDetails(me) {
  const r = room, g = r.g;
  const role = E.roleOf(r, me);
  const team = E.teamOf(r, me);
  let html = `<div class="role-name">${esc(roleName(role))}</div>
    <div class="center">${teamBadge(team)}</div>
    <p>${esc(ROLES[role].desc)}</p>`;
  const facts = [];
  const lover = E.loverOf(r, me);
  if (lover) facts.push(`💘 You are in love with <b>${esc(pname(lover))}</b>.`);
  const exT = obj(g.execTarget)[me];
  if (role === 'executioner' && exT) facts.push(`🎯 Your target: <b>${esc(pname(exT))}</b>`);
  if (role === 'medic' && g.shield && g.shield.by === me) facts.push(`🛡 Shielding: <b>${esc(pname(g.shield.t))}</b>`);
  if (role === 'oracle' && g.oracle && g.oracle.by === me) facts.push(`🔮 Your target: <b>${esc(pname(g.oracle.t))}</b>`);
  if (role === 'witch') {
    const u = obj(obj(g.used)[me]);
    facts.push(`🧪 Save potion: ${u.save ? 'used' : 'available'} · Kill potion: ${u.kill ? 'used' : 'available'}`);
  }
  if (role === 'vigilante') facts.push(`🔫 Shot: ${obj(obj(g.used)[me]).vig ? 'used' : 'available'}`);
  if (role === 'arsonist') {
    const d = arr(obj(g.doused)[me]).filter(p => E.isAlive(r, p));
    facts.push(`🔥 Doused: ${d.length ? d.map(p => esc(pname(p))).join(', ') : 'nobody'}`);
  }
  if (role === 'juggernaut') facts.push(`⚔️ Kills: ${obj(g.jugKills)[me] || 0} (you can kill ${E.juggernautKillsPerNight(r, me)} per night)`);
  if (role === 'mayor') facts.push('🗳 Your vote secretly counts as 3.');
  if (team === 'wolves' || E.wakesWithWolves(r, me)) {
    const pack = E.playerIds(r).filter(p => p !== me && E.wakesWithWolves(r, p));
    if (pack.length) facts.push(`🐺 Awake with you at night: ${pack.map(p => `${esc(pname(p))} (${roleName(E.roleOf(r, p))})${E.isAlive(r, p) ? '' : ' 💀'}`).join(', ')}`);
  }
  if (team === 'jackal') {
    const pals = E.playerIds(r).filter(p => p !== me && E.teamOf(r, p) === 'jackal');
    if (pals.length) facts.push(`🦊 Your partner: ${pals.map(p => `${esc(pname(p))} (${roleName(E.roleOf(r, p))})${E.isAlive(r, p) ? '' : ' 💀'}`).join(', ')}`);
  }
  if (role === 'mortician') {
    const dead = E.playerIds(r).filter(p => !E.isAlive(r, p));
    if (dead.length) facts.push(`⚰️ The dead: ${dead.map(p => `${esc(pname(p))} (${roleName(E.roleOf(r, p))})`).join(', ')}`);
  }
  if (facts.length) html += `<div class="facts">${facts.map(f => `<div>${f}</div>`).join('')}</div>`;
  const notes = arr(obj(g.notes)[me]);
  if (notes.length) {
    html += `<h3>Private messages</h3><div class="notes">${notes.slice().reverse().map(n => `<div><span class="dim">Night ${n.night}:</span> ${esc(n.text)}</div>`).join('')}</div>`;
  }
  return html;
}

function currentStep() {
  const g = room.g;
  if (g.phase !== 'night' || g.stepIdx < 0) return null;
  return arr(g.steps)[g.stepIdx] || null;
}

function renderNight(me) {
  const r = room, g = r.g;
  if (!E.isAlive(r, me)) return '';
  if (g.hacked === me) {
    return `<div class="card sleep"><div class="moon">👾</div><h2>You've been hacked</h2><p>The Glitch hacked you. You can't wake up tonight. Keep your eyes closed.</p></div>`;
  }
  const id = currentStep();
  if (!id || !g.stepOpen || !E.stepActors(r, id).includes(me)) {
    return `<div class="card sleep"><div class="moon">🌙</div><p>Keep your eyes closed.</p><p class="hint">Your phone will show something when it's your turn.</p></div>`;
  }
  const key = E.actionKey(r, id) + ':' + me;
  const existing = E.actionsFor(r, id)[me] || {};
  if (draft.key !== key) draft = { key, values: { ...existing } };
  delete draft.values.done;

  if (existing.done) {
    const result = E.stepResult(r, id, me);
    return `<div class="card awake">
      <h2>${stepTitle(id)}</h2>
      ${result ? `<div class="result">${result}</div>` : '<p>✅ Done.</p>'}
      <p class="hint">Close your eyes when the speaker tells you to.</p>
    </div>`;
  }

  const form = E.stepForm(r, id, me);
  let html = `<div class="card awake"><h2>${stepTitle(id)}</h2>`;
  form.info.forEach(i => { html += `<p>${i}</p>`; });
  html += renderFields(form.fields, draft.values);

  // The pack sees each other's votes live.
  if (id === 'werewolves' || id === 'jackal') {
    const acts = E.actionsFor(r, id);
    const voters = E.stepActors(r, id).filter(p => p !== me && acts[p] && acts[p].t);
    if (voters.length) html += `<p class="hint">Votes so far: ${voters.map(p => `${esc(pname(p))} → <b>${esc(pname(acts[p].t))}</b>${acts[p].done ? ' ✔' : ''}`).join(', ')}</p>`;
  }
  const ok = formValid(form.fields, draft.values);
  html += `<button class="primary" data-act="submitStep" ${ok ? '' : 'disabled'}>${form.fields.length ? 'Confirm' : 'OK'}</button></div>`;
  return html;
}

function stepTitle(id) {
  if (id === 'werewolves') return '🐺 Werewolves';
  if (id === 'lovers') return '💘 Lovers';
  if (id === 'jackal') return '🦊 Jackal';
  return roleName(id);
}

function visibleFields(fields, values) { return fields.filter(f => !f.showIf || f.showIf(values)); }

function renderFields(fields, values) {
  let html = '';
  visibleFields(fields, values).forEach(f => {
    html += `<div class="field"><label>${esc(f.label)}</label><div class="choices">`;
    if (f.type === 'players') {
      const sel = f.count > 1 ? arr(values[f.key]) : (values[f.key] ? [values[f.key]] : []);
      f.candidates.forEach(p => {
        html += `<button class="choice ${sel.includes(p) ? 'selected' : ''}" data-act="field" data-key="${f.key}" data-val="${p}">${esc(pname(p))}</button>`;
      });
      if (!f.candidates.length) html += `<p class="hint">Nobody to choose.</p>`;
    } else {
      f.options.forEach(o => {
        html += `<button class="choice ${values[f.key] === o.value ? 'selected' : ''}" data-act="field" data-key="${f.key}" data-val="${esc(o.value)}">${esc(o.label)}</button>`;
      });
    }
    html += `</div></div>`;
  });
  return html;
}

function formValid(fields, values) {
  return visibleFields(fields, values).every(f => {
    if (f.type !== 'players') return f.min === 0 || values[f.key] != null;
    const n = f.count > 1 ? arr(values[f.key]).length : (values[f.key] ? 1 : 0);
    if (n < f.min) return false;
    // Swapper-style fields: pick none, or the full set.
    if (f.count === 2 && f.min === 0 && n === 1) return false;
    return true;
  });
}

async function onFieldTap(key, val) {
  const id = currentStep(); const me = myPid();
  if (!id) return;
  const form = E.stepForm(room, id, me);
  const f = form.fields.find(x => x.key === key);
  if (!f) return;
  const v = draft.values;
  if (f.type === 'players' && f.count > 1) {
    let sel = arr(v[key]);
    if (sel.includes(val)) sel = sel.filter(x => x !== val);
    else if (sel.length < f.count) sel.push(val);
    else sel = [...sel.slice(1), val];
    v[key] = sel;
  } else {
    v[key] = v[key] === val ? null : val;
  }
  // Drop values for fields that are now hidden.
  form.fields.forEach(x => { if (x.showIf && !x.showIf(v)) delete v[x.key]; });
  if (f.live) await net.set(`${roomPath()}/g/actions/${E.actionKey(room, id)}/${me}/${key}`, v[key] || null);
  render();
}

async function submitStep() {
  const id = currentStep(); const me = myPid();
  if (!id) return;
  const form = E.stepForm(room, id, me);
  const vals = {};
  visibleFields(form.fields, draft.values).forEach(f => { if (draft.values[f.key] != null) vals[f.key] = draft.values[f.key]; });
  if (!formValid(form.fields, vals)) return;
  await net.set(`${roomPath()}/g/actions/${E.actionKey(room, id)}/${me}`, { ...vals, done: true });
}

function renderAnnouncements() {
  const lines = arr(room.g.announce);
  if (!lines.length) return '';
  return `<div class="card announce">${lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
}

function renderMorning(me) {
  const r = room, g = r.g;
  let html = renderAnnouncements();
  const m = g.morning || {};
  if (m.sub === 'altruist' && E.isAlive(r, me) && E.roleOf(r, me) === 'altruist') {
    const dead = arr(m.dead).filter(p => p !== me);
    const choice = g.altruistChoice && g.altruistChoice.by === me ? g.altruistChoice.t : null;
    html += `<div class="card awake"><h2>Altruist</h2>
      <p>You may sacrifice yourself to bring one of them back. Time left: <b data-until="${m.altruistEnds}"></b></p>
      <div class="choices">${dead.map(p => `<button class="choice ${choice === p ? 'selected' : ''}" data-act="altruist" data-val="${p}">Revive ${esc(pname(p))}</button>`).join('')}
      <button class="choice ${!choice ? 'selected' : ''}" data-act="altruist" data-val="">Don't sacrifice</button></div>
    </div>`;
  }
  return html;
}

function renderHunter(me) {
  const r = room, g = r.g;
  const hunter = arr(g.hunterQueue)[0];
  let html = renderAnnouncements();
  if (hunter === me) {
    const shot = g.hunterShot && g.hunterShot.by === me ? g.hunterShot.t : null;
    html += `<div class="card awake"><h2>🏹 Hunter</h2>
      ${shot !== null ? `<p>You chose: <b>${shot ? esc(pname(shot)) : 'nobody'}</b></p>` : `<p>You're dying. Choose someone to take with you.</p>
      <div class="choices">${E.alivePlayers(r).map(p => `<button class="choice" data-act="hunter" data-val="${p}">${esc(pname(p))}</button>`).join('')}
      <button class="choice" data-act="hunter" data-val="">Nobody</button></div>`}
    </div>`;
  } else {
    html += `<div class="card"><p>Waiting for the Hunter to choose…</p></div>`;
  }
  return html;
}

function renderDiscussion() {
  const g = room.g;
  return renderAnnouncements() + `<div class="card center"><h2>Discuss!</h2>
    ${g.discussEnds ? `<div class="timer" data-until="${g.discussEnds}"></div>` : ''}
    <p class="hint">Voting on your phone opens when the timer ends.</p></div>`;
}

function renderVote(me) {
  const r = room, g = r.g;
  let html = renderAnnouncements();
  const alive = E.alivePlayers(r);
  const votes = obj(g.votes);
  const nVoted = alive.filter(p => votes[p]).length;
  if (!E.isAlive(r, me)) return html + `<div class="card"><p>The living are voting… (${nVoted}/${alive.length})</p></div>`;
  const mine = votes[me];
  if (mine) {
    return html + `<div class="card"><h2>🗳 Vote</h2><p>You voted for <b>${mine.t === 'skip' ? 'nobody (skip)' : esc(pname(mine.t))}</b>${mine.power ? ' using your Dictator power' : ''}.</p>
      <p class="hint">${nVoted} of ${alive.length} have voted.</p></div>`;
  }
  const isDict = E.roleOf(r, me) === 'dictator';
  html += `<div class="card awake"><h2>🗳 Vote</h2><p>Who should be voted out?</p><div class="choices">`;
  alive.filter(p => p !== me).forEach(p => {
    html += `<button class="choice ${voteDraft.t === p ? 'selected' : ''}" data-act="votePick" data-val="${p}">${esc(pname(p))}</button>`;
  });
  html += `<button class="choice ${voteDraft.t === 'skip' ? 'selected' : ''}" data-act="votePick" data-val="skip">Skip (nobody)</button></div>`;
  if (isDict) {
    html += `<label class="toggle"><input type="checkbox" data-act="dictPower" ${voteDraft.power ? 'checked' : ''}>
      <span><b>Use my Dictator power</b><br><span class="hint">Announce it out loud! Your pick is lynched immediately, and you die too. Without this, your vote doesn't count.</span></span></label>`;
  }
  html += `<button class="primary" data-act="voteSubmit" ${voteDraft.t && !(voteDraft.power && voteDraft.t === 'skip') ? '' : 'disabled'}>Lock in vote</button>
    <p class="hint">${nVoted} of ${alive.length} have voted.</p></div>`;
  return html;
}

function renderPublicList() {
  const r = room, g = r.g;
  const pr = obj(g.publicRoles);
  return `<div class="card"><h3>Players</h3><div class="player-list">${E.playerIds(r).map(p => `
    <div class="player-row ${E.isAlive(r, p) ? '' : 'dead'}"><span>${E.isAlive(r, p) ? '' : '💀 '}${esc(pname(p))}</span>
    <span class="dim">${pr[p] ? esc(roleName(pr[p])) : ''}</span></div>`).join('')}</div></div>`;
}

function renderGameOver() {
  const r = room, g = r.g;
  const w = g.winner || { text: 'Game over', players: [] };
  const winners = arr(w.players);
  let html = `<div class="card center"><h2>🏆 ${esc(w.text)}</h2></div>
    <div class="card"><h3>Everyone's roles</h3><div class="player-list">`;
  E.playerIds(r).forEach(p => {
    const role = E.roleOf(r, p), orig = obj(g.origRoles)[p];
    html += `<div class="player-row ${winners.includes(p) ? 'winner' : ''}">
      <span>${winners.includes(p) ? '🏆 ' : ''}${E.isAlive(r, p) ? '' : '💀 '}${esc(pname(p))}</span>
      <span>${esc(roleName(role))}${orig && orig !== role ? ` <span class="dim">(was ${esc(roleName(orig))})</span>` : ''} ${teamBadge(E.teamOf(r, p))}</span></div>`;
  });
  html += `</div></div>`;
  if (isHost()) html += `<button class="primary" data-act="playAgain">Play again with the same players</button>`;
  html += `<button class="ghost" data-act="exit">Exit</button>`;
  return html;
}

/* ---------------- speaker phone ---------------- */

let loopRunning = false;
let paused = false;
let currentLine = '';
let speechFinish = null;
let lastSkipToken = null;
let spokenWinner = null;
let wakeLock = null;
const waiters = new Set();

function renderSpeakerPanel() {
  const r = room, g = r.g;
  const voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  const savedVoice = localStorage.getItem('ww_voice') || '';
  const rate = localStorage.getItem('ww_rate') || '0.9';
  let status = '';
  if (r.status === 'over') status = 'Game over';
  else if (g.phase === 'night') status = `Night ${g.night}`;
  else if (g.phase === 'discussion') status = `Discussion${g.discussEnds ? ` · <span data-until="${g.discussEnds}"></span>` : ''}`;
  else if (g.phase === 'vote') { const al = E.alivePlayers(r); status = `Voting · ${al.filter(p => obj(g.votes)[p]).length}/${al.length} voted`; }
  else if (g.phase === 'morning') status = 'Morning';
  else if (g.phase === 'hunter') status = 'Waiting for the Hunter';

  let html = `<div class="card speaker">
    <h2>🔊 Speaker</h2>`;
  if (!loopRunning && r.status !== 'over') {
    html += `<p>Put this phone in the middle of the table with the volume up. Keep this screen open.</p>
      <button class="primary big" data-act="startNarration">▶ Start narration</button>`;
  } else {
    html += `<div class="status">${status}</div>
      <div class="line">${esc(currentLine || '…')}</div>
      ${r.status === 'over' ? '' : `<div class="btn-row">
        <button class="secondary" data-act="pause">${paused ? '▶ Resume' : '⏸ Pause'}</button>
        <button class="secondary" data-act="repeat">🔁 Repeat</button>
        <button class="secondary" data-act="skip">⏭ Skip</button>
      </div>
      <p class="hint">Skip moves on if someone is stuck, or ends the discussion or vote early.</p>`}`;
  }
  html += `<details data-keep="voice"><summary>Voice settings</summary>
      <label>Voice</label>
      <select data-act="voice"><option value="">Default</option>${voices.map(v => `<option value="${esc(v.name)}" ${v.name === savedVoice ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select>
      <label>Speed: ${rate}</label>
      <input type="range" min="0.6" max="1.3" step="0.05" value="${rate}" data-act="rate">
      <button class="ghost" data-act="testVoice">Test voice</button>
    </details>`;
  if (r.status !== 'over' && g.phase !== 'night') {
    const lines = arr(g.announce);
    if (lines.length) html += `<div class="announce">${lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
  }
  html += `</div>`;
  if (!myPid() && r.status !== 'over' && g.phase !== 'night') html += renderPublicList();
  return html;
}

function onRoomChanged(prev, cur) {
  if (cur.status === 'lobby') { showRole = false; }
  const g = obj(cur.g);
  // A new vote resets the local vote draft.
  if (!prev || !prev.g || prev.g.phase !== g.phase) voteDraft = { t: null, power: false };
  if (isSpeaker(cur)) {
    if (lastSkipToken === null) lastSkipToken = g.skipToken || 0;
    else if ((g.skipToken || 0) !== lastSkipToken) { lastSkipToken = g.skipToken || 0; skipAll(); }
    checkWaiters();
  }
}

function waitFor(cond, ms) {
  return new Promise(res => {
    const w = { cond, done: false };
    w.finish = (why) => { if (w.done) return; w.done = true; waiters.delete(w); clearTimeout(w.timer); res(why); };
    if (ms != null) w.timer = setTimeout(() => w.finish('timeout'), ms);
    waiters.add(w);
    checkWaiters();
  });
}
function checkWaiters() {
  waiters.forEach(w => { try { if (w.cond && room && w.cond(room)) w.finish('ok'); } catch (e) { console.error(e); } });
}
function skipAll() {
  waiters.forEach(w => { if (w.cond !== isUnpaused) w.finish('skip'); });
  if (speechFinish) speechFinish();
}
const isUnpaused = () => !paused;
async function gate() { while (paused) await waitFor(isUnpaused); }

function speak(text) {
  return new Promise(res => {
    if (!('speechSynthesis' in window)) { setTimeout(res, 1500 + text.length * 60); return; }
    const u = new SpeechSynthesisUtterance(text);
    const vName = localStorage.getItem('ww_voice');
    const v = speechSynthesis.getVoices().find(x => x.name === vName);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Number(localStorage.getItem('ww_rate') || 0.9);
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(t); speechFinish = null; res(); };
    // Some browsers never fire onend, so there's a fallback timer.
    const t = setTimeout(fin, 5000 + text.length * 120);
    u.onend = fin; u.onerror = fin;
    speechFinish = () => { speechSynthesis.cancel(); fin(); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
async function say(text) {
  await gate();
  currentLine = text;
  render();
  await speak(text);
}
const pause = (ms) => waitFor(null, ms);
// How long to "wait" for a role nobody alive has, so silence doesn't give it away.
const fakeMs = () => 9000 + Math.random() * 9000;

async function startNarration() {
  // Browsers only allow speech after a tap, so this primes it.
  if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not supported */ }
  speakerLoop();
}

async function speakerLoop() {
  if (loopRunning) return;
  loopRunning = true;
  render();
  try {
    while (room && room.status !== 'lobby' && isSpeaker()) {
      if (room.status === 'over') {
        const text = (room.g.winner || {}).text;
        if (text && spokenWinner !== text) { spokenWinner = text; await say('The game is over. ' + text); }
        break;
      }
      await tick();
      await sleep(50);
    }
  } catch (e) {
    console.error(e);
  } finally {
    loopRunning = false;
    render();
  }
}

// After deaths: hunters shoot next, then the game either ends or moves on.
function afterDeaths(r, next) {
  const g = r.g;
  if (g.winner) { r.status = 'over'; g.phase = 'over'; return; }
  if (arr(g.hunterQueue).length) { g.phase = 'hunter'; g.afterHunter = next; return; }
  goTo(r, next);
}
function goTo(r, next) {
  if (next === 'night') E.startNight(r);
  else { r.g.phase = 'discussion'; r.g.discussEnds = null; }
}
function addAnnounce(r, lines) { r.g.announce = [...arr(r.g.announce), ...lines]; }

async function tick() {
  const g = room.g;
  switch (g.phase) {
    case 'night': {
      if (g.stepIdx < 0) {
        await say(`Night ${g.night}. Everyone, close your eyes.`);
        await pause(4000);
        await tx(r => { if (r.g.phase === 'night' && r.g.stepIdx < 0) { r.g.stepIdx = 0; r.g.stepOpen = true; } });
        return;
      }
      const idx = g.stepIdx;
      const steps = arr(g.steps);
      if (idx >= steps.length) {
        await tx(r => { if (r.g.phase === 'night' && r.g.stepIdx >= arr(r.g.steps).length) E.resolveNight(r); });
        return;
      }
      const id = steps[idx];
      if (!g.stepOpen) await tx(r => { if (r.g.stepIdx === idx) r.g.stepOpen = true; });
      await say(E.wakeLine(room, id));
      if (E.stepActors(room, id).length) await waitFor(r => r.g.stepIdx !== idx || E.stepDone(r, id));
      else await pause(fakeMs());
      await gate();
      await tx(r => { if (r.g.stepIdx === idx) r.g.stepOpen = false; });
      await say(E.sleepLine(room, id));
      await pause(2500);
      await tx(r => {
        if (r.g.phase === 'night' && r.g.stepIdx === idx) { E.applyStepEnd(r, id); r.g.stepIdx = idx + 1; r.g.stepOpen = true; }
      });
      return;
    }
    case 'morning': {
      const m = g.morning || {};
      if (m.sub === 'announce') {
        await say('Everyone, wake up.');
        await pause(1500);
        const line = E.morningDeathLine(room);
        await tx(r => {
          if (r.g.phase !== 'morning' || r.g.morning.sub !== 'announce') return;
          r.g.announce = [line];
          if (E.altruistAvailable(r)) { r.g.morning.sub = 'altruist'; r.g.morning.altruistEnds = Date.now() + ALTRUIST_WINDOW_MS; }
          else r.g.morning.sub = 'apply';
        });
        await say(line);
        return;
      }
      if (m.sub === 'altruist') {
        await say('Altruist, if you wish, you may now sacrifice yourself on your phone to bring one of them back.');
        await pause(Math.max(0, m.altruistEnds - Date.now()));
        await tx(r => { if (r.g.morning && r.g.morning.sub === 'altruist') r.g.morning.sub = 'apply'; });
        return;
      }
      let lines = [];
      await tx(r => {
        if (r.g.phase !== 'morning' || !r.g.morning || r.g.morning.sub !== 'apply') { lines = []; return; }
        lines = E.finishMorning(r);
        addAnnounce(r, lines);
        afterDeaths(r, 'discussion');
      });
      for (const l of lines) await say(l);
      return;
    }
    case 'hunter': {
      const h = arr(g.hunterQueue)[0];
      if (!h) { await tx(r => { if (r.g.phase === 'hunter') goTo(r, r.g.afterHunter || 'discussion'); }); return; }
      if (g.huntingAnnounced !== h) {
        const known = obj(room.g.publicRoles)[h] === 'hunter';
        await say(`${known ? '' : `${E.pname(room, h)} was the Hunter! `}Hunter, choose someone on your phone to take down with you.`);
        await tx(r => { r.g.huntingAnnounced = h; });
      }
      await waitFor(r => r.g.phase !== 'hunter' || (r.g.hunterShot && r.g.hunterShot.by === h), 120000);
      let lines = [];
      await tx(r => {
        if (r.g.phase !== 'hunter' || arr(r.g.hunterQueue)[0] !== h) { lines = []; return; }
        lines = E.resolveHunterShot(r);
        r.g.huntingAnnounced = null;
        addAnnounce(r, lines);
        if (r.g.winner) { r.status = 'over'; r.g.phase = 'over'; }
        else if (!arr(r.g.hunterQueue).length) goTo(r, r.g.afterHunter || 'discussion');
      });
      for (const l of lines) await say(l);
      return;
    }
    case 'discussion': {
      if (!g.discussEnds) {
        const sec = g.discussSec || 180;
        await tx(r => { if (r.g.phase === 'discussion' && !r.g.discussEnds) r.g.discussEnds = Date.now() + sec * 1000; });
        const mins = sec % 60 === 0 ? `${sec / 60} minute${sec === 60 ? '' : 's'}` : fmtTime(sec * 1000).replace(':', ' minutes and ') + ' seconds';
        await say(`It's day ${g.night}. You have ${mins} to discuss.`);
        return;
      }
      await waitFor(r => r.g.phase !== 'discussion', Math.max(0, g.discussEnds - Date.now()));
      await gate();
      if (room.g.phase !== 'discussion') return;
      await say("Time's up! Everyone, vote on your phones now.");
      await tx(r => { if (r.g.phase === 'discussion') { r.g.phase = 'vote'; r.g.votes = {}; } });
      return;
    }
    case 'vote': {
      await waitFor(r => r.g.phase !== 'vote' || E.alivePlayers(r).every(p => obj(r.g.votes)[p]));
      await gate();
      if (room.g.phase !== 'vote') return;
      await say('The votes are in.');
      await pause(1500);
      let lines = [];
      await tx(r => {
        if (r.g.phase !== 'vote') { lines = []; return; }
        lines = E.resolveVote(r);
        r.g.announce = lines.slice();
        afterDeaths(r, 'night');
      });
      for (const l of lines) await say(l);
      if (room.status !== 'over' && room.g.phase === 'night') await pause(3000);
      return;
    }
    default:
      await sleep(500);
  }
}

/* ---------------- event handling ---------------- */

$app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type !== 'checkbox')) return;
  const act = b.dataset.act;
  try {
    await handle(act, b);
  } catch (err) {
    console.error(err);
    alert('Something went wrong: ' + err.message);
  }
});
$app.addEventListener('change', (e) => {
  const b = e.target;
  if (b.dataset.act === 'voice') { localStorage.setItem('ww_voice', b.value); }
  if (b.dataset.act === 'rate') { localStorage.setItem('ww_rate', b.value); render(); }
});

async function handle(act, b) {
  const d = b.dataset;
  const host = isHost();
  switch (act) {
    case 'create': return createGame();
    case 'join': return joinGame(false);
    case 'joinSpeaker': return joinGame(true);
    case 'leave': {
      const me = myPid();
      await tx(r => {
        delete r.players[me];
        if (r.speakerUid === myUid) r.speakerUid = null;
        if (r.hostUid === myUid) { const next = E.playerIds(r)[0]; r.hostUid = next ? r.players[next].uid : null; }
      });
      detach(); render(); return;
    }
    case 'kick': if (host) await tx(r => { const p = r.players[d.pid]; if (p && r.speakerUid === p.uid) r.speakerUid = null; delete r.players[d.pid]; }); return;
    case 'makeSpeaker': if (host) await tx(r => { r.speakerUid = d.uid; r.speakerDevice = false; }); return;
    case 'roleInc': case 'roleDec':
      if (host) await tx(r => {
        r.settings.roles = obj(r.settings.roles);
        const n = (r.settings.roles[d.role] || 0) + (act === 'roleInc' ? 1 : -1);
        r.settings.roles[d.role] = Math.max(0, ROLES[d.role].multi ? n : Math.min(1, n));
      });
      return;
    case 'toggleSetting':
      if (host) {
        const k = d.key;
        await tx(r => { r.settings[k] = !r.settings[k]; if (k === 'trueLovers' && r.settings[k]) r.settings.roles.cupid = 0; });
      }
      return;
    case 'discuss': if (host) await tx(r => { r.settings.discussSec = Math.min(900, Math.max(30, (r.settings.discussSec || 180) + Number(d.d))); }); return;
    case 'start':
      if (host) await tx(r => { if (r.status === 'lobby' && !E.validateSetup(r) && r.speakerUid) { r.status = 'choosing'; r.picks = {}; } });
      return;
    case 'pickCard': {
      const me = myPid(), role = d.role;
      pickError = '';
      if (obj(room.picks)[me] === role) { await net.set(`${roomPath()}/picks/${me}`, null); return; }
      await tx(r => { if (r.status === 'choosing' && !E.pickProblem(r, me, role)) { r.picks = obj(r.picks); r.picks[me] = role; } });
      if (obj(room.picks)[me] !== role) pickError = E.pickProblem(room, me, role) || 'Could not save your card. Try again.';
      render();
      return;
    }
    case 'beginGame':
      if (host) await tx(r => { if (r.status === 'choosing' && E.allPicked(r) && !E.validateSetup(r)) { E.dealGame(r); r.picks = null; } });
      return;
    case 'backToSetup':
      if (host) await tx(r => { if (r.status === 'choosing') { r.status = 'lobby'; r.picks = null; } });
      return;
    case 'toggleRole': showRole = !showRole; render(); return;
    case 'field': return onFieldTap(d.key, d.val);
    case 'submitStep': return submitStep();
    case 'altruist': return net.set(`${roomPath()}/g/altruistChoice`, d.val ? { by: myPid(), t: d.val } : null);
    case 'hunter': return net.set(`${roomPath()}/g/hunterShot`, { by: myPid(), t: d.val || '' });
    case 'votePick': voteDraft.t = voteDraft.t === d.val ? null : d.val; render(); return;
    case 'dictPower': voteDraft.power = b.checked; render(); return;
    case 'voteSubmit':
      if (!voteDraft.t) return;
      return net.set(`${roomPath()}/g/votes/${myPid()}`, { t: voteDraft.t, power: !!voteDraft.power });
    case 'hostSkip': return net.set(`${roomPath()}/g/skipToken`, Date.now());
    case 'startNarration': return startNarration();
    case 'pause': paused = !paused; if (paused && 'speechSynthesis' in window) speechSynthesis.pause(); else if ('speechSynthesis' in window) speechSynthesis.resume(); checkWaiters(); render(); return;
    case 'repeat': if (currentLine) speak(currentLine); return;
    case 'skip': lastSkipToken = Date.now(); skipAll(); return;
    case 'testVoice': speak('Werewolves, wake up.'); return;
    case 'playAgain':
      if (host) await tx(r => { r.status = 'lobby'; r.g = null; });
      spokenWinner = null;
      return;
    case 'exit': detach(); render(); return;
  }
}

/* ---------------- render dispatch ---------------- */

// Re-rendering replaces the HTML, so remember which <details> panels were open.
const openPanels = new Set();
document.addEventListener('toggle', (e) => {
  const k = e.target.dataset && e.target.dataset.keep;
  if (!k) return;
  if (e.target.open) openPanels.add(k); else openPanels.delete(k);
}, true);
function restorePanels() {
  document.querySelectorAll('details[data-keep]').forEach(d => { if (openPanels.has(d.dataset.keep)) d.open = true; });
}

function render() {
  renderInner();
  restorePanels();
}
function renderInner() {
  if (!room) { document.body.classList.remove('night'); return renderLanding(); }
  if (room.status === 'lobby') { document.body.classList.remove('night'); return renderLobby(); }
  if (room.status === 'choosing') { document.body.classList.remove('night'); return renderChoosing(); }
  renderGame();
  updateCountdowns();
  // The speaker phone resumes narrating by itself after a reload only once tapped (browser rule).
}

function updateCountdowns() {
  document.querySelectorAll('[data-until]').forEach(el => { el.textContent = fmtTime(Number(el.dataset.until) - Date.now()); });
}
setInterval(updateCountdowns, 500);
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (isSpeaker()) render(); };

/* ---------------- boot ---------------- */

(async function boot() {
  $app.innerHTML = '<p class="hint center">Connecting…</p>';
  try {
    myUid = await net.signIn();
  } catch (e) {
    $app.innerHTML = `<div class="card error">Couldn't connect: ${esc(e.message)}</div>`;
    return;
  }
  const saved = JSON.parse(sessionStore.getItem('ww_session') || 'null');
  if (saved && saved.code) attach(saved.code);
  render();
})();
