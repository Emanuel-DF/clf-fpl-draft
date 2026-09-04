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

    const data = await response.json();
    
    // Inspect the exact object structure in DevTools
    console.log("Full FPL Draft API Response:", data);

    if (statusElement && data.league) {
      statusElement.textContent = `Connected! Loaded league: ${data.league.name}`;
      statusElement.style.color = "#00ff87";
    }

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

  tableBody.innerHTML = ""; 

  const standings = data.standings || [];
  const entries = data.league_entries || [];

  // Map entry ID -> Manager & Team info
  const entryMap = {};
  entries.forEach(entry => {
    entryMap[entry.id] = {
      teamName: entry.entry_name || "Unnamed Team",
      managerName: `${entry.player_first_name || ''} ${entry.player_last_name || ''}`.trim() || "Unknown Manager"
    };
  });

  if (standings.length === 0) {
    // Fallback if standings array is empty before season/draft starts
    entries.forEach((entry, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td><strong>${entry.entry_name}</strong><br><small>${entry.player_first_name} ${entry.player_last_name}</small></td>
        <td>0</td>
        <td>0</td>
      `;
      tableBody.appendChild(tr);
    });
    return;
  }

  standings.forEach((row, index) => {
    // Match row to league_entry ID
    const entryId = row.league_entry || row.entry;
    const managerInfo = entryMap[entryId] || { teamName: "Unknown Team", managerName: "Unknown Manager" };
    
    const gwPoints = row.event_total !== undefined ? row.event_total : (row.points_for || 0);
    const totalPoints = row.total !== undefined ? row.total : (row.total_points || 0);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.rank || index + 1}</td>
      <td><strong>${managerInfo.teamName}</strong><br><small>${managerInfo.managerName}</small></td>
      <td>${gwPoints}</td>
      <td>${totalPoints}</td>
    `;
    tableBody.appendChild(tr);
  });
}

document.addEventListener("DOMContentLoaded", fetchFPLDraftData);
