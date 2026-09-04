const LEAGUE_ID = "12368"; 
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev"; 

const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;
const FULL_URL = `${WORKER_URL}?url=${encodeURIComponent(FPL_DRAFT_API)}`;

async function fetchFPLDraftData() {
  const statusElement = document.getElementById("status");
  const refreshBtn = document.getElementById("refresh");

  try {
    if (statusElement) statusElement.textContent = "Fetching live FPL Draft data...";
    if (refreshBtn) refreshBtn.style.opacity = "0.5";

    const response = await fetch(FULL_URL);
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const draftData = await response.json();
    console.log("Full FPL Draft API Response:", draftData);

    if (statusElement && draftData.league) {
      statusElement.textContent = `Connected! Loaded league: ${draftData.league.name}`;
      statusElement.style.color = "#00ff87";
    }

    updateMetricCards(draftData);
    renderLeagueTable(draftData);
    renderAccolades(draftData);

  } catch (error) {
    console.error("Error fetching FPL Draft data:", error);
    if (statusElement) {
      statusElement.textContent = "Failed to load live data (Check console for details).";
      statusElement.style.color = "#ff2882";
    }
  } finally {
    if (refreshBtn) refreshBtn.style.opacity = "1";
  }
}

function updateMetricCards(draftData) {
  const entriesList = draftData.league_entries || [];
  const standingsList = draftData.standings || [];

  const managerCountEl = document.getElementById("managerCount");
  if (managerCountEl) managerCountEl.textContent = entriesList.length || 0;

  if (standingsList.length > 0) {
    const topScore = Math.max(...standingsList.map(s => s.total ?? s.total_points ?? 0));
    const topScoreEl = document.getElementById("topScore");
    if (topScoreEl) topScoreEl.textContent = topScore;

    const totalSum = standingsList.reduce((acc, s) => acc + (s.total ?? s.total_points ?? 0), 0);
    const avgScore = Math.round(totalSum / standingsList.length);
    const averageEl = document.getElementById("average");
    if (averageEl) averageEl.textContent = avgScore;
  }

  const updatedEl = document.getElementById("updated");
  if (updatedEl) {
    const now = new Date();
    updatedEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function getTeamMap(entriesList) {
  const teamsMap = {};
  entriesList.forEach(item => {
    const managerDetails = {
      teamName: item.entry_name || "Unnamed Team",
      managerName: `${item.player_first_name || ''} ${item.player_last_name || ''}`.trim() || "Unknown Manager",
      shortName: item.short_name || ""
    };

    if (item.id) teamsMap[item.id] = managerDetails;
    if (item.entry_id) teamsMap[item.entry_id] = managerDetails;
  });
  return teamsMap;
}

function renderLeagueTable(draftData) {
  const tableBody = document.getElementById("league-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = ""; 

  const standingsList = draftData.standings || [];
  const entriesList = draftData.league_entries || [];
  const teamsMap = getTeamMap(entriesList);

  const rowsToRender = standingsList.length > 0 ? standingsList : entriesList;

  rowsToRender.forEach((row, index) => {
    const keyId = row.league_entry || row.entry || row.entry_id || row.id;
    const teamInfo = teamsMap[keyId] || { 
      teamName: row.entry_name || "Unknown Team", 
      managerName: `${row.player_first_name || ''} ${row.player_last_name || ''}`.trim() || "Unknown Manager" 
    };
    
    const rank = row.rank || (index + 1);
    const lastRank = row.last_rank || rank;
    
    let moveHtml = `-`;
    if (lastRank > rank) {
      moveHtml = `<span style="color:#00ff87; font-weight:600;">▲ ${lastRank - rank}</span>`;
    } else if (lastRank < rank) {
      moveHtml = `<span style="color:#ff2882; font-weight:600;">▼ ${rank - lastRank}</span>`;
    }

    const gameweekPoints = row.event_total ?? row.points_for ?? row.event_points ?? 0;
    const overallPoints = row.total ?? row.total_points ?? row.points ?? 0;

    const rowElement = document.createElement("tr");
    rowElement.innerHTML = `
      <td>${rank}</td>
      <td><strong>${teamInfo.teamName}</strong><br><small style="opacity: 0.7;">${teamInfo.managerName}</small></td>
      <td>${gameweekPoints}</td>
      <td>${overallPoints}</td>
      <td>${moveHtml}</td>
    `;
    tableBody.appendChild(rowElement);
  });
}

function renderAccolades(draftData) {
  const standingsList = draftData.standings || [];
  const entriesList = draftData.league_entries || [];
  if (standingsList.length === 0) return;

  const teamsMap = getTeamMap(entriesList);

  // 1. Gameweek High Scorer
  const gwHigh = standingsList.reduce((max, item) => 
    ((item.event_total ?? item.points_for ?? 0) > (max.event_total ?? max.points_for ?? -1)) ? item : max, standingsList[0]);
  
  const gwHighTeam = teamsMap[gwHigh.league_entry || gwHigh.entry_id];
  const gwHighNameEl = document.getElementById("gw-high-name");
  const gwHighStatEl = document.getElementById("gw-high-stat");

  if (gwHighNameEl && gwHighTeam) gwHighNameEl.textContent = gwHighTeam.teamName;
  if (gwHighStatEl) gwHighStatEl.textContent = `${gwHigh.event_total ?? gwHigh.points_for ?? 0} pts (GW)`;

  // 2. Gameweek Flop (Lowest GW Score)
  const gwLow = standingsList.reduce((min, item) => 
    ((item.event_total ?? item.points_for ?? 999) < (min.event_total ?? min.points_for ?? 999)) ? item : min, standingsList[0]);

  const gwLowTeam = teamsMap[gwLow.league_entry || gwLow.entry_id];
  const gwLowNameEl = document.getElementById("gw-low-name");
  const gwLowStatEl = document.getElementById("gw-low-stat");

  if (gwLowNameEl && gwLowTeam) gwLowNameEl.textContent = gwLowTeam.teamName;
  if (gwLowStatEl) gwLowStatEl.textContent = `${gwLow.event_total ?? gwLow.points_for ?? 0} pts (GW)`;

  // 3. Wooden Spoon (Lowest Overall Rank / Score)
  const woodenSpoon = standingsList.reduce((min, item) => 
    ((item.total ?? item.total_points ?? 9999) < (min.total ?? min.total_points ?? 9999)) ? item : min, standingsList[0]);

  const woodenSpoonTeam = teamsMap[woodenSpoon.league_entry || woodenSpoon.entry_id];
  const woodenSpoonNameEl = document.getElementById("wooden-spoon-name");
  const woodenSpoonStatEl = document.getElementById("wooden-spoon-stat");

  if (woodenSpoonNameEl && woodenSpoonTeam) woodenSpoonNameEl.textContent = woodenSpoonTeam.teamName;
  if (woodenSpoonStatEl) woodenSpoonStatEl.textContent = `${woodenSpoon.total ?? woodenSpoon.total_points ?? 0} pts Total`;
}

document.addEventListener("DOMContentLoaded", () => {
  fetchFPLDraftData();

  const refreshBtn = document.getElementById("refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", fetchFPLDraftData);
  }
});
