const LEAGUE_ID = "12368"; 
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev"; 

const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;
const FULL_URL = `${WORKER_URL}?url=${encodeURIComponent(FPL_DRAFT_API)}`;

async function fetchFPLDraftData() {
  const statusElement = document.getElementById("status");

  try {
    if (statusElement) statusElement.textContent = "Fetching live FPL Draft data...";

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

    renderLeagueTable(draftData);
    updateMetricCards(draftData);

  } catch (error) {
    console.error("Error fetching FPL Draft data:", error);
    if (statusElement) {
      statusElement.textContent = "Failed to load live data (Check console for details).";
      statusElement.style.color = "#ff2882";
    }
  }
}

function updateMetricCards(draftData) {
  const entriesList = draftData.league_entries || [];
  const standingsList = draftData.standings || [];

  // Update Managers Count
  const managersCard = document.querySelector('[data-card="managers"]');
  if (managersCard) managersCard.textContent = entriesList.length || 0;

  if (standingsList.length > 0) {
    // Find highest total score
    const topScore = Math.max(...standingsList.map(s => s.total ?? s.total_points ?? 0));
    const topScoreCard = document.querySelector('[data-card="top-score"]');
    if (topScoreCard) topScoreCard.textContent = topScore;

    // Calculate League Average Total Score
    const totalSum = standingsList.reduce((acc, s) => acc + (s.total ?? s.total_points ?? 0), 0);
    const avgScore = Math.round(totalSum / standingsList.length);
    const avgCard = document.querySelector('[data-card="average"]');
    if (avgCard) avgCard.textContent = avgScore;
  }

  // Update Last Refreshed Time
  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const updatedCard = document.querySelector('[data-card="updated"]');
  if (updatedCard) updatedCard.textContent = timeString;
}

function renderLeagueTable(draftData) {
  const tableBody = document.getElementById("league-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = ""; 

  const standingsList = draftData.standings || [];
  const entriesList = draftData.league_entries || [];

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
      moveHtml = `<span style="color:#00ff87;">▲ ${lastRank - rank}</span>`;
    } else if (lastRank < rank) {
      moveHtml = `<span style="color:#ff2882;">▼ ${rank - lastRank}</span>`;
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

document.addEventListener("DOMContentLoaded", fetchFPLDraftData);
