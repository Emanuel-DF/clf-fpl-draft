// Your FPL Draft League ID
const LEAGUE_ID = "12368"; 

// Using AllOrigins CORS Proxy (handles Cloudflare protections reliably)
const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;
const PROXY_URL = `https://api.allorigins.win/get?url=${encodeURIComponent(FPL_DRAFT_API)}`;

async function fetchFPLDraftData() {
  const statusElement = document.getElementById("status");

  try {
    if (statusElement) statusElement.textContent = "Fetching live FPL Draft data...";

    const response = await fetch(PROXY_URL);
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const wrapperData = await response.json();
    
    // AllOrigins wraps the API response inside the 'contents' string property
    const data = JSON.parse(wrapperData.contents);
    
    console.log("FPL Draft API Response:", data);

    if (statusElement) {
      statusElement.textContent = `Connected! Loaded league: ${data.league.name}`;
      statusElement.style.color = "#00ff87";
    }

    renderStandings(data);

  } catch (error) {
    console.error("Error fetching FPL Draft data:", error);
    if (statusElement) {
      statusElement.textContent = "Failed to load live data. See browser console for details.";
      statusElement.style.color = "#ff2882";
    }
  }
}

function renderStandings(data) {
  const tableBody = document.getElementById("league-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = ""; 

  const standings = data.standings || [];
  const entries = data.league_entries || [];

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

document.addEventListener("DOMContentLoaded", fetchFPLDraftData);
