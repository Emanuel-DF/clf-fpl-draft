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

  // Map BOTH entry_id and id to handle all possible foreign key links
  const entryMap = {};
  entries.forEach(entry => {
    const info = {
      teamName: entry.entry_name || "Unnamed Team",
      managerName: `${entry.player_first_name || ''} ${entry.player_last_name || ''}`.trim() || "Unknown Manager",
      shortName: entry.short_name || ""
    };

    if (entry.id) entryMap[entry.id] = info;
    if (entry.entry_id) entryMap[entry.entry_id] = info;
  });

  // If standings array is empty before the season starts, fall back to entries list
  if (standings.length === 0) {
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

  // Render live standings table
  standings.forEach((row, index) => {
    const targetId = row.league_entry || row.entry || row.entry_id || row.id;
    const managerInfo = entryMap[targetId] || { 
      teamName: row.entry_name || "Unknown Team", 
      managerName: `${row.player_first_name || ''} ${row.player_last_name || ''}`.trim() || "Unknown Manager" 
    };
    
    // Extract points with safety fallbacks
    const gwPoints = row.event_total ?? row.points_for ?? row.event_points ?? 0;
    const totalPoints = row.total ?? row.total_points ?? row.points ?? 0;

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
