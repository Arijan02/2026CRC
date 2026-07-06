import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBnIM2boJXgfToWWg7vDcjAKfLarU1q6mo",
  authDomain: "crc-2d577.firebaseapp.com",
  databaseURL: "https://crc-2d577-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "crc-2d577",
  storageBucket: "crc-2d577.firebasestorage.app",
  messagingSenderId: "166833614716",
  appId: "1:166833614716:web:ace44b9ba15fc9eb007ef9"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const tournamentRef = ref(db, "tournament");

let state = null;

const setupScreen = document.getElementById("setup-screen");
const tabsNav = document.getElementById("tabs");
const groupsContainer = document.getElementById("groups-container");
const knockoutContainer = document.getElementById("knockout-container");
const knockoutControls = document.getElementById("knockout-controls");
const namesEditor = document.getElementById("names-editor");
const knockoutSettings = document.getElementById("knockout-settings");
const syncBanner = document.getElementById("sync-banner");

function showSyncError(message) {
  syncBanner.textContent = message;
  syncBanner.hidden = false;
}

function saveState() {
  set(tournamentRef, state).catch(() => {
    showSyncError("Kon de wijziging niet opslaan naar de gedeelde database. Controleer de Firebase Realtime Database-regels (lees/schrijfrechten) of je internetverbinding.");
  });
}

// Suppress remote-triggered re-renders while someone is actively typing in a
// score or name field, so another player's update can't yank focus away mid-keystroke.
let editingCount = 0;
let pendingRemoteState = null;

function isTrackedInput(el) {
  return !!el && el.tagName === "INPUT" && (el.classList.contains("score-input") || el.type === "text");
}

document.addEventListener("focusin", (e) => {
  if (isTrackedInput(e.target)) editingCount++;
});
document.addEventListener("focusout", (e) => {
  if (!isTrackedInput(e.target)) return;
  setTimeout(() => {
    editingCount = Math.max(0, editingCount - 1);
    if (editingCount === 0 && pendingRemoteState !== null) {
      const toApply = pendingRemoteState;
      pendingRemoteState = null;
      applyRemoteState(toApply);
    }
  }, 0);
});

onValue(tournamentRef, (snapshot) => {
  const val = snapshot.val();
  syncBanner.hidden = true;
  if (editingCount > 0) {
    state = val;
    pendingRemoteState = val;
    if (state && state.groups) {
      state.groups.forEach((_, gIdx) => renderStandingsFor(gIdx));
      renderThirdPlaceTable();
    }
    return;
  }
  applyRemoteState(val);
}, () => {
  showSyncError("Kon geen verbinding maken met de gedeelde database. Controleer de Firebase Realtime Database-regels (lees/schrijfrechten) of je internetverbinding.");
});

function applyRemoteState(val) {
  if (val && val.groups) {
    const wasOnSetupScreen = !setupScreen.hidden;
    state = val;
    setupScreen.hidden = true;
    tabsNav.hidden = false;
    if (wasOnSetupScreen) document.getElementById("poules-tab").hidden = false;
    renderGroups();
    const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab || "poules";
    if (activeTab === "knockout") renderKnockoutTab();
    else if (activeTab === "instellingen") { renderNamesEditor(); renderKnockoutSettings(); }
  } else {
    state = null;
    setupScreen.hidden = false;
    tabsNav.hidden = true;
  }
}

// ---------- Tournament creation ----------

function roundRobinPairs(n) {
  if (n === 4) {
    // WK-speelvolgorde: 1-3, 2-4, 1-4, 2-3, 1-2, 3-4
    return [[0, 2], [1, 3], [0, 3], [1, 2], [0, 1], [2, 3]];
  }
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  }
  return pairs;
}

function groupLetter(i) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return i < letters.length ? letters[i] : `G${i + 1}`;
}

function buildTournament(numGroups, teamsPerGroup, numAdvance, bestThirds) {
  let teamCounter = 1;
  const groups = [];
  for (let g = 0; g < numGroups; g++) {
    const teams = [];
    for (let t = 0; t < teamsPerGroup; t++) teams.push(`Land ${teamCounter++}`);
    const pairs = roundRobinPairs(teamsPerGroup);
    const matches = pairs.map(([home, away]) => ({ home, away, homeScore: null, awayScore: null }));
    groups.push({ name: `Groep ${groupLetter(g)}`, teams, matches });
  }
  return { numAdvance, bestThirds: bestThirds || 0, groups, knockout: null };
}

// ---------- Standings ----------

function computeStandings(group) {
  const stats = group.teams.map((name, idx) => ({
    idx, name, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0
  }));
  group.matches.forEach(m => {
    if (m.homeScore == null || m.awayScore == null) return;
    const h = stats[m.home], a = stats[m.away];
    h.played++; a.played++;
    h.gf += m.homeScore; h.ga += m.awayScore;
    a.gf += m.awayScore; a.ga += m.homeScore;
    if (m.homeScore > m.awayScore) { h.w++; h.pts += 3; a.l++; }
    else if (m.homeScore < m.awayScore) { a.w++; a.pts += 3; h.l++; }
    else { h.d++; a.d++; h.pts += 1; a.pts += 1; }
  });
  stats.forEach(s => s.gd = s.gf - s.ga);
  stats.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
  return stats;
}

function computeThirdPlaceRanking() {
  const rankIdx = state.numAdvance;
  const entries = state.groups.map((group, gIdx) => {
    const standings = computeStandings(group);
    const e = standings[rankIdx];
    if (!e) return null;
    return { group: gIdx, groupName: group.name, name: e.name, played: e.played, w: e.w, d: e.d, l: e.l, gf: e.gf, ga: e.ga, gd: e.gd, pts: e.pts };
  }).filter(Boolean);
  entries.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
  return entries;
}

// ---------- Rendering: Poules ----------

function renderThirdPlaceTable() {
  const card = document.getElementById("third-place-card");
  const wrap = document.getElementById("third-place-standings");
  if (!state.bestThirds) { card.hidden = true; return; }
  card.hidden = false;

  const entries = computeThirdPlaceRanking();
  const table = document.createElement("table");
  table.className = "standings";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Poule</th><th>Team</th><th>Gesp</th><th>W</th><th>V</th><th>Gel</th>
        <th>DV</th><th>DT</th><th>DS</th><th>Ptn</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  entries.forEach((s, rank) => {
    const tr = document.createElement("tr");
    if (rank < state.bestThirds) tr.className = "qualifies";
    tr.innerHTML = `
      <td>${escapeHtml(s.groupName)}</td>
      <td class="team-name">${escapeHtml(s.name)}</td>
      <td>${s.played}</td>
      <td>${s.w}</td>
      <td>${s.l}</td>
      <td>${s.d}</td>
      <td>${s.gf}</td>
      <td>${s.ga}</td>
      <td>${s.gd > 0 ? "+" + s.gd : s.gd}</td>
      <td><strong>${s.pts}</strong></td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

function renderGroups() {
  groupsContainer.innerHTML = "";
  state.groups.forEach((group, gIdx) => {
    const card = document.createElement("div");
    card.className = "group-card";

    const heading = document.createElement("h3");
    heading.textContent = group.name;
    card.appendChild(heading);

    const standingsWrap = document.createElement("div");
    standingsWrap.id = `standings-${gIdx}`;
    card.appendChild(standingsWrap);

    const fixturesWrap = document.createElement("div");
    fixturesWrap.className = "fixtures";
    group.matches.forEach((m, mIdx) => {
      const row = document.createElement("div");
      row.className = "fixture-row";

      const homeName = document.createElement("span");
      homeName.className = "home-name";
      homeName.textContent = group.teams[m.home];

      const homeInput = document.createElement("input");
      homeInput.type = "number";
      homeInput.min = "0";
      homeInput.className = "score-input";
      homeInput.value = m.homeScore ?? "";
      homeInput.addEventListener("input", () => {
        m.homeScore = homeInput.value === "" ? null : Math.max(0, parseInt(homeInput.value, 10) || 0);
        saveState();
        renderStandingsFor(gIdx);
        renderThirdPlaceTable();
      });

      const dash = document.createElement("span");
      dash.className = "dash";
      dash.textContent = "-";

      const awayInput = document.createElement("input");
      awayInput.type = "number";
      awayInput.min = "0";
      awayInput.className = "score-input";
      awayInput.value = m.awayScore ?? "";
      awayInput.addEventListener("input", () => {
        m.awayScore = awayInput.value === "" ? null : Math.max(0, parseInt(awayInput.value, 10) || 0);
        saveState();
        renderStandingsFor(gIdx);
        renderThirdPlaceTable();
      });

      const awayName = document.createElement("span");
      awayName.className = "away-name";
      awayName.textContent = group.teams[m.away];

      row.appendChild(homeName);
      row.appendChild(homeInput);
      row.appendChild(dash);
      row.appendChild(awayInput);
      row.appendChild(awayName);
      fixturesWrap.appendChild(row);
    });
    card.appendChild(fixturesWrap);
    groupsContainer.appendChild(card);
  });
  state.groups.forEach((_, gIdx) => renderStandingsFor(gIdx));
  renderThirdPlaceTable();
}

function renderStandingsFor(gIdx) {
  const wrap = document.getElementById(`standings-${gIdx}`);
  if (!wrap) return;
  const group = state.groups[gIdx];
  const stats = computeStandings(group);
  const numAdvance = state.numAdvance;

  const table = document.createElement("table");
  table.className = "standings";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Team</th><th>Gesp</th><th>W</th><th>V</th><th>Gel</th>
        <th>DV</th><th>DT</th><th>DS</th><th>Ptn</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  stats.forEach((s, rank) => {
    const tr = document.createElement("tr");
    if (rank < numAdvance) tr.className = "qualifies";
    tr.innerHTML = `
      <td class="team-name">${escapeHtml(s.name)}</td>
      <td>${s.played}</td>
      <td>${s.w}</td>
      <td>${s.l}</td>
      <td>${s.d}</td>
      <td>${s.gf}</td>
      <td>${s.ga}</td>
      <td>${s.gd > 0 ? "+" + s.gd : s.gd}</td>
      <td><strong>${s.pts}</strong></td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Knockout ----------

function bracketSize() {
  return state.groups.length * state.numAdvance + (state.bestThirds || 0);
}

function isPowerOfTwo(n) {
  return n >= 2 && (n & (n - 1)) === 0;
}

function buildQualifierOrder() {
  const numGroups = state.groups.length;
  const numAdvance = state.numAdvance;
  const list = [];
  if (numAdvance === 1) {
    for (let g = 0; g < numGroups; g++) list.push({ group: g, rank: 0 });
  } else if (numAdvance === 2 && numGroups % 2 === 0) {
    for (let k = 0; k < numGroups / 2; k++) {
      const g1 = 2 * k, g2 = 2 * k + 1;
      list.push({ group: g1, rank: 0 }, { group: g2, rank: 1 });
      list.push({ group: g2, rank: 0 }, { group: g1, rank: 1 });
    }
  } else {
    for (let r = 0; r < numAdvance; r++) {
      for (let g = 0; g < numGroups; g++) list.push({ group: g, rank: r });
    }
  }
  return list;
}

// Mimics the real WK-format: each group winner faces either a runner-up or
// one of the best third-placed teams, so groups whose third place qualifies
// "free up" their runner-up, which then gets paired against another free runner-up.
function buildRound0WithThirds() {
  const n = state.groups.length;
  const k = state.bestThirds;
  const thirdRanking = computeThirdPlaceRanking();
  const qualifyingGroups = new Set(thirdRanking.slice(0, k).map(e => e.group));

  const matches = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const opponentRank = qualifyingGroups.has(j) ? state.numAdvance : 1;
    matches.push({
      homeRef: { type: "group", group: i, rank: 0 },
      awayRef: { type: "group", group: j, rank: opponentRank },
      homeScore: null, awayScore: null, tiebreak: null
    });
  }

  const leftoverRunnerupGroups = [...qualifyingGroups].sort((a, b) => a - b);
  for (let idx = 0; idx < leftoverRunnerupGroups.length; idx += 2) {
    matches.push({
      homeRef: { type: "group", group: leftoverRunnerupGroups[idx], rank: 1 },
      awayRef: { type: "group", group: leftoverRunnerupGroups[idx + 1], rank: 1 },
      homeScore: null, awayScore: null, tiebreak: null
    });
  }

  return matches;
}

function generateKnockout() {
  const size = bracketSize();
  if (!isPowerOfTwo(size)) return;
  const rounds = [];

  let round0;
  if (state.bestThirds > 0) {
    round0 = buildRound0WithThirds();
  } else {
    const qualifiers = buildQualifierOrder();
    round0 = [];
    for (let i = 0; i < qualifiers.length; i += 2) {
      round0.push({
        homeRef: { type: "group", group: qualifiers[i].group, rank: qualifiers[i].rank },
        awayRef: { type: "group", group: qualifiers[i + 1].group, rank: qualifiers[i + 1].rank },
        homeScore: null, awayScore: null, tiebreak: null
      });
    }
  }
  rounds.push(round0);

  let prevCount = round0.length;
  let roundIdx = 0;
  while (prevCount > 1) {
    const next = [];
    for (let j = 0; j < prevCount / 2; j++) {
      next.push({
        homeRef: { type: "winner", round: roundIdx, match: 2 * j },
        awayRef: { type: "winner", round: roundIdx, match: 2 * j + 1 },
        homeScore: null, awayScore: null, tiebreak: null
      });
    }
    rounds.push(next);
    prevCount = next.length;
    roundIdx++;
  }

  state.knockout = { rounds };
  saveState();
}

function resolveParticipant(ref) {
  if (ref.type === "group") {
    const group = state.groups[ref.group];
    const standings = computeStandings(group);
    const entry = standings[ref.rank];
    return entry ? entry.name : null;
  }
  const match = state.knockout.rounds[ref.round][ref.match];
  const winner = getMatchWinner(match);
  if (winner === null) return null;
  return resolveParticipant(winner === "home" ? match.homeRef : match.awayRef);
}

function getMatchWinner(match) {
  if (match.homeScore == null || match.awayScore == null) return null;
  if (match.homeScore > match.awayScore) return "home";
  if (match.homeScore < match.awayScore) return "away";
  return match.tiebreak;
}

function roundName(matchCount) {
  if (matchCount === 1) return "Finale";
  if (matchCount === 2) return "Halve finales";
  if (matchCount === 4) return "Kwartfinales";
  if (matchCount === 8) return "Achtste finales";
  if (matchCount === 16) return "Zestiende finales";
  return `Ronde van ${matchCount * 2}`;
}

function renderKnockoutControls() {
  knockoutControls.innerHTML = "";
  const size = bracketSize();
  if (!isPowerOfTwo(size)) {
    const warn = document.createElement("div");
    warn.className = "warning";
    const formula = state.bestThirds
      ? `${state.groups.length} × ${state.numAdvance} + ${state.bestThirds} beste nummers 3 = ${size}`
      : `${state.groups.length} × ${state.numAdvance} = ${size}`;
    warn.textContent = `Het totaal aantal teams in de knock-out (${formula}) moet een macht van 2 zijn (2, 4, 8, 16, 32...) om een schema te maken. Pas dit aan bij Instellingen door het toernooi opnieuw op te zetten.`;
    knockoutControls.appendChild(warn);
    return;
  }
  if (!state.knockout) {
    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.textContent = "Genereer knock-outfase";
    btn.addEventListener("click", () => {
      generateKnockout();
      renderKnockoutTab();
    });
    knockoutControls.appendChild(btn);
  } else {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = "Het schema werkt automatisch bij: winnaars schuiven direct door naar de volgende ronde. Bij een gelijkspel kies je hieronder wie doorgaat (na verlenging/strafschoppen).";
    knockoutControls.appendChild(note);
  }
}

function renderKnockoutTab() {
  renderKnockoutControls();
  knockoutContainer.innerHTML = "";
  if (!state.knockout) return;

  state.knockout.rounds.forEach((round, rIdx) => {
    const roundDiv = document.createElement("div");
    roundDiv.className = "ko-round";
    const h4 = document.createElement("h4");
    h4.textContent = roundName(round.length);
    roundDiv.appendChild(h4);

    round.forEach((match, mIdx) => {
      roundDiv.appendChild(renderKnockoutMatch(match, rIdx, mIdx));
    });

    knockoutContainer.appendChild(roundDiv);
  });

  const finalRound = state.knockout.rounds[state.knockout.rounds.length - 1];
  const finalMatch = finalRound[0];
  const champion = resolveParticipant({ type: "winner", round: state.knockout.rounds.length - 1, match: 0 });
  if (champion && getMatchWinner(finalMatch)) {
    const banner = document.createElement("div");
    banner.className = "champion-banner";
    banner.textContent = `🏆 Kampioen: ${champion}`;
    knockoutContainer.appendChild(banner);
  }
}

function renderKnockoutMatch(match, rIdx, mIdx) {
  const homeName = resolveParticipant(match.homeRef);
  const awayName = resolveParticipant(match.awayRef);

  const box = document.createElement("div");
  box.className = "ko-match" + (!homeName || !awayName ? " unresolved" : "");

  const winner = getMatchWinner(match);

  const homeRow = document.createElement("div");
  homeRow.className = "ko-team" + (winner === "home" ? " winner" : "");
  const homeLabel = document.createElement("span");
  homeLabel.className = "ko-team-name";
  homeLabel.textContent = homeName || placeholderLabel(match.homeRef);
  const homeInput = document.createElement("input");
  homeInput.type = "number";
  homeInput.min = "0";
  homeInput.className = "score-input";
  homeInput.value = match.homeScore ?? "";
  homeInput.disabled = !homeName || !awayName;
  homeInput.addEventListener("input", () => {
    match.homeScore = homeInput.value === "" ? null : Math.max(0, parseInt(homeInput.value, 10) || 0);
    if (match.homeScore !== match.awayScore) match.tiebreak = null;
    saveState();
    renderKnockoutTab();
  });
  homeRow.appendChild(homeLabel);
  homeRow.appendChild(homeInput);

  const awayRow = document.createElement("div");
  awayRow.className = "ko-team" + (winner === "away" ? " winner" : "");
  const awayLabel = document.createElement("span");
  awayLabel.className = "ko-team-name";
  awayLabel.textContent = awayName || placeholderLabel(match.awayRef);
  const awayInput = document.createElement("input");
  awayInput.type = "number";
  awayInput.min = "0";
  awayInput.className = "score-input";
  awayInput.value = match.awayScore ?? "";
  awayInput.disabled = !homeName || !awayName;
  awayInput.addEventListener("input", () => {
    match.awayScore = awayInput.value === "" ? null : Math.max(0, parseInt(awayInput.value, 10) || 0);
    if (match.homeScore !== match.awayScore) match.tiebreak = null;
    saveState();
    renderKnockoutTab();
  });
  awayRow.appendChild(awayLabel);
  awayRow.appendChild(awayInput);

  box.appendChild(homeRow);
  box.appendChild(awayRow);

  if (homeName && awayName && match.homeScore != null && match.awayScore != null && match.homeScore === match.awayScore) {
    const tb = document.createElement("div");
    tb.className = "ko-tiebreak";
    tb.innerHTML = `Gelijkspel: wie gaat door (na verlenging/strafschoppen)?`;
    const opts = document.createElement("div");
    opts.className = "tb-options";
    const homeBtn = document.createElement("button");
    homeBtn.className = "tb-btn" + (match.tiebreak === "home" ? " selected" : "");
    homeBtn.textContent = homeName;
    homeBtn.addEventListener("click", () => { match.tiebreak = "home"; saveState(); renderKnockoutTab(); });
    const awayBtn = document.createElement("button");
    awayBtn.className = "tb-btn" + (match.tiebreak === "away" ? " selected" : "");
    awayBtn.textContent = awayName;
    awayBtn.addEventListener("click", () => { match.tiebreak = "away"; saveState(); renderKnockoutTab(); });
    opts.appendChild(homeBtn);
    opts.appendChild(awayBtn);
    tb.appendChild(opts);
    box.appendChild(tb);
  }

  return box;
}

function placeholderLabel(ref) {
  if (ref.type === "group") return "?";
  return `Winnaar duel ${ref.match + 1}`;
}

// ---------- Instellingen ----------

let nameEditDebounceTimer = null;

function renderNamesEditor() {
  namesEditor.innerHTML = "";
  state.groups.forEach((group, gIdx) => {
    const wrap = document.createElement("div");
    wrap.className = "names-group";
    const h4 = document.createElement("h4");
    h4.textContent = group.name;
    wrap.appendChild(h4);

    const inputsWrap = document.createElement("div");
    inputsWrap.className = "team-inputs";
    group.teams.forEach((teamName, tIdx) => {
      const input = document.createElement("input");
      input.type = "text";
      input.value = teamName;
      input.addEventListener("input", () => {
        group.teams[tIdx] = input.value;
        saveState();
        clearTimeout(nameEditDebounceTimer);
        nameEditDebounceTimer = setTimeout(() => {
          renderGroups();
          renderThirdPlaceTable();
          if (state.knockout) renderKnockoutTab();
        }, 500);
      });
      inputsWrap.appendChild(input);
    });
    wrap.appendChild(inputsWrap);
    namesEditor.appendChild(wrap);
  });
}

function renderKnockoutSettings() {
  knockoutSettings.innerHTML = "";
  const size = bracketSize();
  const info = document.createElement("p");
  info.className = "hint";
  info.textContent = state.bestThirds
    ? `Huidig schema: ${state.groups.length} poules × ${state.numAdvance} doorgaand + ${state.bestThirds} beste nummers 3 = ${size} teams in de knock-out.`
    : `Huidig schema: ${state.groups.length} poules × ${state.numAdvance} doorgaand = ${size} teams in de knock-out.`;
  knockoutSettings.appendChild(info);

  if (state.knockout) {
    const btn = document.createElement("button");
    btn.className = "danger-btn";
    btn.textContent = "Knock-outfase verwijderen en opnieuw beginnen";
    btn.addEventListener("click", () => {
      if (confirm("Weet je zeker dat je de knock-outfase wilt wissen?")) {
        state.knockout = null;
        saveState();
        renderKnockoutSettings();
        renderKnockoutTab();
      }
    });
    knockoutSettings.appendChild(btn);
  } else if (isPowerOfTwo(size)) {
    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.textContent = "Genereer knock-outfase";
    btn.addEventListener("click", () => {
      generateKnockout();
      renderKnockoutSettings();
      renderKnockoutTab();
    });
    knockoutSettings.appendChild(btn);
  }
}

// ---------- Tabs ----------

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab;
      document.getElementById("poules-tab").hidden = target !== "poules";
      document.getElementById("knockout-tab").hidden = target !== "knockout";
      document.getElementById("instellingen-tab").hidden = target !== "instellingen";
      if (target === "knockout") renderKnockoutTab();
      if (target === "instellingen") { renderNamesEditor(); renderKnockoutSettings(); }
    });
  });
}

// ---------- Setup form / export / import / reset ----------

document.getElementById("setup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const numGroups = parseInt(document.getElementById("numGroups").value, 10);
  const teamsPerGroup = parseInt(document.getElementById("teamsPerGroup").value, 10);
  const numAdvance = parseInt(document.getElementById("numAdvance").value, 10);
  const bestThirds = parseInt(document.getElementById("bestThirds").value, 10) || 0;
  if (numAdvance > teamsPerGroup) {
    alert("Het aantal dat doorgaat kan niet groter zijn dan het aantal teams per poule.");
    return;
  }
  if (bestThirds > 0) {
    if (numAdvance !== 2) {
      alert("Beste nummers 3 laten meetellen kan alleen als er precies 2 teams per poule automatisch doorgaan.");
      return;
    }
    if (teamsPerGroup < 3) {
      alert("Poules moeten minstens 3 teams hebben om een nummer 3 te kunnen laten meetellen.");
      return;
    }
    if (bestThirds % 2 !== 0) {
      alert("Beste nummers 3 moet een even getal zijn (of 0).");
      return;
    }
    if (bestThirds > numGroups) {
      alert("Beste nummers 3 kan niet groter zijn dan het aantal poules.");
      return;
    }
  }
  state = buildTournament(numGroups, teamsPerGroup, numAdvance, bestThirds);
  saveState();
});

document.getElementById("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wk-scores-backup.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.groups) throw new Error("invalid");
      state = parsed;
      saveState();
    } catch (err) {
      alert("Kon dit bestand niet importeren. Is het een geldige export?");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("reset-btn").addEventListener("click", () => {
  if (confirm("Weet je zeker dat je een nieuw toernooi wilt starten? Dit wist het toernooi voor iedereen die de link gebruikt. Alle huidige data gaat verloren.")) {
    set(tournamentRef, null);
  }
});

// ---------- Boot ----------

setupTabs();
