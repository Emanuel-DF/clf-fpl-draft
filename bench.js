const LEAGUE_ID = "12368";
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev";

const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;
const FULL_URL = `${WORKER_URL}?url=${encodeURIComponent(FPL_DRAFT_API)}`;

// ============================================================
// MAIN DATA FETCHING
// ============================================================

async function fetchBenchLeagueData() {
  const statusElement = document.getElementById("status");
  const refreshBtn = document.getElementById("refresh");

  try {
    if (statusElement) statusElement.textContent = "Fetching live FPL Draft data...";
    if (refreshBtn) refreshBtn.style.opacity = "0.5";

    // 1. Fetch main league details
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
      statusElement.textContent = `Fetching live scores for GW1 to GW${currentGW}…`;
    }

    // 2. Load all live player scores across all active GWs
    const liveStatsByGW = {};
    for (let gw = 1; gw <= currentGW; gw++) {
      const liveUrl = `https://draft.premierleague.com/api/event/${gw}/live`;
      const proxyLiveUrl = `${WORKER_URL}?url=${encodeURIComponent(liveUrl)}`;
      
      const liveRes = await fetch(proxyLiveUrl);
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        // Store map of element_id -> total_points
        liveStatsByGW[gw] = liveData.elements || {};
      }
    }

    // 3. Process managers & bench points
    const benchStandings = await calculateAllBenchPoints(entries, currentGW, liveStatsByGW);

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

async function calculateAllBenchPoints(entries, maxGW, liveStatsByGW) {
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

    // Bench players occupy positions 12, 13, 14, 15
    const benchPicks = data.picks.filter(pick => pick.position > 11);
    const gwLiveElements = liveStatsByGW[gw] || {};

    // Sum points for benched players using element stats
    const gwBenchPoints = benchPicks.reduce((sum, pick) => {
      const playerLive = gwLiveElements[pick.element];
      const pts = playerLive?.stats?.total_points || 0;
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