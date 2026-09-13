const LEAGUE_ID = "12368";
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev";

const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;
const FULL_URL = `${WORKER_URL}?url=${encodeURIComponent(FPL_DRAFT_API)}`;

// Store points per element (player ID) per Gameweek
const gwPointsMap = {};

// ============================================================
// LOAD LEAGUE DATA
// ============================================================

async function fetchBenchLeagueData() {
  const statusElement = document.getElementById("status");
  const refreshBtn = document.getElementById("refresh");

  try {
    if (statusElement) statusElement.textContent = "Fetching live FPL Draft data...";
    if (refreshBtn) refreshBtn.style.opacity = "0.5";

    // 1. Fetch league details
    const detailsRes = await fetch(FULL_URL);
    if (!detailsRes.ok) throw new Error(`HTTP error! Status: ${detailsRes.status}`);
    const draftData = await detailsRes.json();

    const currentGW = draftData.league?.current_event || draftData.current_event || 1;

    const gwElement = document.getElementById("gw");
    if (gwElement) gwElement.textContent = currentGW;

    const entries = draftData.league_entries || [];
    const managerCountEl = document.getElementById("managerCount");
    if (managerCountEl) managerCountEl.textContent = entries.length;

    if (statusElement) {
      statusElement.textContent = `Loading live scores (GW1 to GW${currentGW})…`;
    }

    // 2. Fetch live data for each GW
    for (let gw = 1; gw <= currentGW; gw++) {
      if (!gwPointsMap[gw]) {
        gwPointsMap[gw] = {};
        const liveUrl = `https://draft.premierleague.com/api/event/${gw}/live`;
        const proxyLiveUrl = `${WORKER_URL}?url=${encodeURIComponent(liveUrl)}`;
        
        try {
          const liveRes = await fetch(proxyLiveUrl);
          if (liveRes.ok) {
            const liveData = await liveRes.json();
            const elements = liveData.elements || {};
            
            // Map player ID -> total_points for this GW
            Object.keys(elements).forEach(id => {
              gwPointsMap[gw][id] = elements[id]?.stats?.total_points || 0;
            });
          }
        } catch (e) {
          console.warn(`Could not load live stats for GW${gw}`, e);
        }
      }
    }

    // 3. Calculate bench points for all managers
    const benchStandings = await calculateAllBenchPoints(entries, currentGW);

    // 4. Render output
    renderBenchTable(benchStandings);
    updateBenchMetrics(benchStandings);

    if (statusElement) {
      statusElement.textContent = `Connected! Loaded league: ${draftData.league?.name || "CLF Draft"}`;
      statusElement.style.color = "#008a48";
    }

  } catch (error) {
    console.error("Error fetching bench data:", error);
    if (statusElement) {
      statusElement.textContent = "Failed to load live bench data (check console).";
      statusElement.style.color = "#ff2882";
    }
  } finally {
    if (refreshBtn) refreshBtn.style.opacity = "1";
  }
}

// ============================================================
// CALCULATE BENCH POINTS
// ============================================================

async function calculateAllBenchPoints(entries, maxGW) {
  const managerTotals = entries.map(entry => ({
    entryId: entry.entry_id || entry.id,
    teamName: entry.entry_name || "Unnamed Team",
    managerName: `${entry.player_first_name || ""} ${entry.player_last_name || ""}`.trim() || "Unknown Manager",
    totalBenchPoints: 0,
    latestGwBenchPoints: 0
  }));

  const requests = [];

  for (let gw = 1; gw <= maxGW; gw++) {
    entries.forEach((entry, managerIndex) => {
      const entryId = entry.entry_id || entry.id;
      const apiUrl = `https://draft.premierleague.com/api/entry/${entryId}/event/${gw}`;
      const url = `${WORKER_URL}?url=${encodeURIComponent(apiUrl)}`;

      requests.push(
        fetch(url)
          .then(res => res.ok ? res.json() : null)
          .then(data => ({ managerIndex, gw, data }))
          .catch(() => ({ managerIndex, gw, data: null }))
      );
    });
  }

  const results = await Promise.all(requests);

  results.forEach(({ managerIndex, gw, data }) => {
    if (!data || !data.picks) return;

    // Bench players are position 12, 13, 14, and 15
    const benchPicks = data.picks.filter(pick => pick.position > 11);

    const gwScores = gwPointsMap[gw] || {};

    // Calculate sum of benched player points for this GW
    const gwBenchPoints = benchPicks.reduce((sum, pick) => {
      const pts = gwScores[pick.element] || 0;
      return sum + pts;
    }, 0);

    managerTotals[managerIndex].totalBenchPoints += gwBenchPoints;

    if (gw === maxGW) {
      managerTotals[managerIndex].latestGwBenchPoints = gwBenchPoints;
    }
  });

  return managerTotals.sort((a, b) => b.totalBenchPoints - a.totalBenchPoints);
}

// ============================================================
// RENDER TABLE & METRICS
// ============================================================

function renderBenchTable(standings) {
  const tableBody = document.getElementById("bench-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  standings.forEach((row, index) => {
    const rank = index + 1;
    const rowElement = document.createElement("tr");

    rowElement.innerHTML = `
      <td>${rank}</td>
      <td>
        <strong>${row.teamName}</strong>
        <br>
        <small style="opacity: 0.7;">${row.managerName}</small>
      </td>
      <td>${row.latestGwBenchPoints} pts</td>
      <td>
        <strong style="font-size: 16px; color: #008a48;">
          ${row.totalBenchPoints} pts
        </strong>
      </td>
    `;
    tableBody.appendChild(rowElement);
  });
}

function updateBenchMetrics(standings) {
  if (!standings.length) return;

  const benchKingEl = document.getElementById("benchKing");
  if (benchKingEl) {
    benchKingEl.textContent = `${standings[0].teamName} (${standings[0].totalBenchPoints} pts)`;
  }

  const totalSum = standings.reduce((total, manager) => total + manager.totalBenchPoints, 0);
  const totalBenchedEl = document.getElementById("totalBenched");
  if (totalBenchedEl) {
    totalBenchedEl.textContent = `${totalSum} pts`;
  }

  const updatedEl = document.getElementById("updated");
  if (updatedEl) {
    const now = new Date();
    updatedEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

// ============================================================
// START
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  fetchBenchLeagueData();
  const refreshBtn = document.getElementById("refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", fetchBenchLeagueData);
  }
});