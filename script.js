// Replace LEAGUE_ID with your actual FPL Draft League ID
const LEAGUE_ID = "12368"; 

// Using CORS Proxy to bypass browser cross-origin restrictions
const CORS_PROXY = "https://corsproxy.io/?";
const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;

const FULL_URL = `${CORS_PROXY}${encodeURIComponent(FPL_DRAFT_API)}`;

async function fetchFPLDraftData() {
  const statusElement = document.getElementById("status");
  const tableBody = document.getElementById("league-table-body");

  try {
    if (statusElement) statusElement.textContent = "Fetching live FPL Draft data...";

    const response = await fetch(FULL_URL);
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    
    // Log the JSON response to inspect the structure in Developer Tools
    console.log("FPL Draft API Response:", data);

    if (statusElement) {
      statusElement.textContent = `Connected! Loaded league: ${data.league.name}`;
      statusElement.style.color = "#00ff87";
    }

    // Render league standings
    renderStandings(data);

  } catch (error) {
    console.error("Error fetching FPL Draft data:", error);
    if (statusElement) {
      statusElement.textContent = "Failed to load live data (Check console for details).";
      statusElement.style.color = "#ff2882";
    }
  }
}

function renderStandings(data) {
  const tableBody = document.getElementById("league-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = ""; // Clear placeholder / loading rows

  // Extract standings from the API response
  const standings = data.standings || [];
  const entries = data.league_entries || [];

  // Map entry ID to entry details (manager name, team name)
  const entryMap = {};
  entries.forEach(entry => {
    entryMap[entry.id] = {
      teamName: entry.entry_name,
      managerName: `${entry.player_first_name} ${entry.player_last_name}`
    };
  });

  standings.forEach((row, index) => {
    const managerInfo = entryMap[row.league_entry] || { teamName: "Unknown", managerName: "Unknown" };
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><strong>${managerInfo.teamName}</strong><br><small>${managerInfo.managerName}</small></td>
      <td>${row.event_total || 0}</td>
      <td>${row.total || 0}</td>
    `;
    tableBody.appendChild(tr);
  });
}

// Execute on DOM load
document.addEventListener("DOMContentLoaded", fetchFPLDraftData);
