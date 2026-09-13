const LEAGUE_ID = "12368"; 
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev"; 

const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;
const FULL_URL = `${WORKER_URL}?url=${encodeURIComponent(FPL_DRAFT_API)}`;

async function fetchBenchLeagueData() {
  const statusElement = document.getElementById("status");
  const refreshBtn = document.getElementById("refresh");

  try {
    if (statusElement) statusElement.textContent = "Fetching live FPL Draft data...";
    if (refreshBtn) refreshBtn.style.opacity = "0.5";

    const response = await fetch(FULL_URL);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

    const draftData = await response.json();
    
    // Determine current GW
    let currentGW = draftData.league?.current_event || 
                    draftData.matches?.[0]?.event || 
                    draftData.standings?.[0]?.event || 1;

    const gwElement = document.getElementById("gw");
    if (gwElement) gwElement.textContent = currentGW;

    const entries = draftData.league_entries || [];
    const managerCountEl = document.getElementById("managerCount");
    if (managerCountEl) managerCountEl.textContent = entries.length;

    if (statusElement) {
      statusElement.textContent = `Calculating bench totals (GW1 to GW${currentGW})…`;
    }

    // Process benched points for all gameweeks
    const benchStandings = await calculateAllBenchPoints(entries, currentGW);

    renderBenchTable(benchStandings, currentGW);
    updateBenchMetrics(benchStandings);

    if (statusElement) {
      statusElement.textContent = `Connected! Loaded league: ${draftData.league?.name || 'CLF Draft'}`;
      statusElement.style.color = "#313131";
    }

  } catch (error) {
    console.error("Error fetching bench data:", error);
    if (statusElement) {
      statusElement.textContent = "Failed to load live bench data.";
      statusElement.style.color = "#ff2882";
    }
  } finally {
    if (refreshBtn) refreshBtn.style.opacity = "1";
  }
}

async function calculateAllBenchPoints(entries, maxGW) {
  // Array to store results for each manager
  const managerTotals = entries.map(e => ({
    entryId: e.entry_id || e.id,
    teamName: e.entry_name || "Unnamed Team",
    managerName: `${e.player_first_name || ''} ${e.player_last_name || ''}`.trim() || "Unknown Manager",
    totalBenchPoints: 0,
    latestGwBenchPoints: 0
  }));

  // First, fetch the live player stats for every GW up to maxGW
  const liveStatsByGW = {};
  const livePromises = [];

  for (let gw = 1; gw <= maxGW; gw++) {
    const liveUrl = `${WORKER_URL}?url=${encodeURIComponent(`https://draft.premierleague.com/api/event/${gw}/live`)}`;
    livePromises.push(
      fetch(liveUrl)
        .then(res => res.ok ? res.json() : null)
        .then(data => { liveStatsByGW[gw] = data?.elements || {}; })
        .catch(() => { liveStatsByGW[gw] = {}; })
    );
  }

  await Promise.all(livePromises);

  // Next, fetch each manager's pick selections for every GW
  const pickPromises = [];

  for (let gw = 1; gw <= maxGW; gw++) {
    entries.forEach((entry, idx) => {
      const entryId = entry.entry_id || entry.id;
      const url = `${WORKER_URL}?url=${encodeURIComponent(`https://draft.premierleague.com/api/entry/${entryId}/event/${gw}`)}`;
      
      pickPromises.push(
        fetch(url)
          .then(res => res.ok ? res.json() : null)
          .then(data => ({ managerIndex: idx, gw, data }))
          .catch(() => ({ managerIndex: idx, gw, data: null }))
      );
    });
  }

  const pickResults = await Promise.all(pickPromises);

  // Calculate points for benched players (positions 12 to 15)
  pickResults.forEach(({ managerIndex, gw, data }) => {
    if (!data || !data.picks) return;

    const gwLiveElements = liveStatsByGW[gw] || {};

    // Filter sub bench players (positions 12, 13, 14, 15)
    const benchPicks = data.picks.filter(p => p.position > 11);
    
    let benchScore = 0;
    benchPicks.forEach(p => {
      const playerId = p.element;
      // Get score from live event stats or direct fallback
      const playerPts = gwLiveElements[playerId]?.stats?.total_points ?? p.points ?? 0;
      benchScore += playerPts;
    });

    managerTotals[managerIndex].totalBenchPoints += benchScore;

    if (gw === maxGW) {
      managerTotals[managerIndex].latestGwBenchPoints = benchScore;
    }
  });

  // Sort by highest total bench points
  return managerTotals.sort((a, b) => b.totalBenchPoints - a.totalBenchPoints);
}

function renderBenchTable(standings) {
  const tableBody = document.getElementById("bench-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  standings.forEach((row, index) => {
    const rank = index + 1;
    const rowElement = document.createElement("tr");

    rowElement.innerHTML = `
      <td>${rank}</td>
      <td><strong>${row.teamName}</strong><br><small style="opacity: 0.7;">${row.managerName}</small></td>
      <td>${row.latestGwBenchPoints} pts</td>
      <td><strong style="font-size: 16px; color: #008a48;">${row.totalBenchPoints} pts</strong></td>
    `;
    tableBody.appendChild(rowElement);
  });
}

function updateBenchMetrics(standings) {
  if (standings.length === 0) return;

  const benchKingEl = document.getElementById("benchKing");
  if (benchKingEl) {
    benchKingEl.textContent = `${standings[0].teamName} (${standings[0].totalBenchPoints} pts)`;
  }

  const totalSum = standings.reduce((acc, s) => acc + s.totalBenchPoints, 0);
  const totalBenchedEl = document.getElementById("totalBenched");
  if (totalBenchedEl) {
    totalBenchedEl.textContent = `${totalSum} pts`;
  }

  const updatedEl = document.getElementById("updated");
  if (updatedEl) {
    const now = new Date();
    updatedEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  fetchBenchLeagueData();

  const refreshBtn = document.getElementById("refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", fetchBenchLeagueData);
  }
});