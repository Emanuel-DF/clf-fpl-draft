const LEAGUE_ID = "12368";
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev";

const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;
const DRAFT_ELEMENTS_API = `https://draft.premierleague.com/api/bootstrap-static`;

const FULL_URL = `${WORKER_URL}?url=${encodeURIComponent(FPL_DRAFT_API)}`;
const BOOTSTRAP_URL = `${WORKER_URL}?url=${encodeURIComponent(DRAFT_ELEMENTS_API)}`;

// Cache player stats to avoid refetching endlessly
let playerPointsCache = {};

// ============================================================
// LOAD LEAGUE DATA
// ============================================================

async function fetchBenchLeagueData() {
  const statusElement = document.getElementById("status");
  const refreshBtn = document.getElementById("refresh");

  try {
    if (statusElement) {
      statusElement.textContent = "Fetching live FPL Draft data...";
    }
    if (refreshBtn) {
      refreshBtn.style.opacity = "0.5";
    }

    // 1. Fetch bootstrap static to map player IDs to stats
    const bootstrapRes = await fetch(BOOTSTRAP_URL);
    const bootstrapData = await bootstrapRes.json();
    
    // Create quick lookup map: playerId -> points in GW
    const elements = bootstrapData.elements || [];

    // 2. Fetch league details
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
      statusElement.textContent = `Calculating bench totals (GW1 to GW${currentGW})…`;
    }

    // 3. Calculate bench points with player data lookup
    const benchStandings = await calculateAllBenchPoints(entries, currentGW, elements);

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

async function calculateAllBenchPoints(entries, maxGW, elements) {
  const managerTotals = entries.map(entry => ({
    entryId: entry.entry_id || entry.id,
    teamName: entry.entry_name || "Unnamed Team",
    managerName: `${entry.player_first_name || ""} ${entry.player_last_name || ""}`.trim() || "Unknown Manager",
    totalBenchPoints: 0,
    latestGwBenchPoints: 0
  }));

  // Map element IDs to event points lookup
  const elementMap = new Map();
  elements.forEach(el => {
    elementMap.set(el.id, el.event_points || 0);
  });

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
          .catch(error => ({ managerIndex, gw, data: null }))
      );
    });
  }

  const results = await Promise.all(requests);

  results.forEach(({ managerIndex, gw, data }) => {
    if (!data || !data.picks) return;

    // Filter picks where position is > 11 (Bench positions: 12, 13, 14, 15)
    const benchPicks = data.picks.filter(pick => pick.position > 11);

    // Sum points for benched players in this GW
    const gwBenchPoints = benchPicks.reduce((sum, pick) => {
      // Get score directly from elements dataset
      const playerPts = elementMap.get(pick.element) || 0;
      return sum + playerPts;
    }, 0);

    managerTotals[managerIndex].totalBenchPoints += gwBenchPoints;

    if (gw === maxGW) {
      managerTotals[managerIndex].latestGwBenchPoints = gwBenchPoints;
    }
  });

  return managerTotals.sort((a, b) => b.totalBenchPoints - a.totalBenchPoints);
}

// ============================================================
// RENDER TABLE
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

// ============================================================
// SUMMARY METRICS
// ============================================================

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