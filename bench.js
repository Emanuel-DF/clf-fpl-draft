const LEAGUE_ID = "12368"; 
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev"; 

const FPL_DRAFT_API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;
const BOOTSTRAP_API = `https://draft.premierleague.com/api/bootstrap-static`;

const FULL_URL = `${WORKER_URL}?url=${encodeURIComponent(FPL_DRAFT_API)}`;
const BOOTSTRAP_URL = `${WORKER_URL}?url=${encodeURIComponent(BOOTSTRAP_API)}`;

async function fetchBenchLeagueData() {
  const statusElement = document.getElementById("status");
  const refreshBtn = document.getElementById("refresh");

  try {
    if (statusElement) statusElement.textContent = "Fetching live FPL Draft data...";
    if (refreshBtn) refreshBtn.style.opacity = "0.5";

    // 1. Fetch league details and bootstrap player data in parallel
    const [detailsRes, bootstrapRes] = await Promise.all([
      fetch(FULL_URL),
      fetch(BOOTSTRAP_URL)
    ]);

    if (!detailsRes.ok) throw new Error(`League details HTTP error! Status: ${detailsRes.status}`);
    if (!bootstrapRes.ok) throw new Error(`Bootstrap HTTP error! Status: ${bootstrapRes.status}`);

    const draftData = await detailsRes.json();
    const bootstrapData = await bootstrapRes.json();

    // Map player IDs to their element stats object
    const playerMap = {};
    if (Array.isArray(bootstrapData.elements)) {
      bootstrapData.elements.forEach(el => {
        playerMap[el.id] = el;
      });
    }

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

    const benchStandings = await calculateAllBenchPoints(entries, currentGW, playerMap);

    renderBenchTable(benchStandings);
    updateBenchMetrics(benchStandings);

    if (statusElement) {
      statusElement.textContent = `Connected! Loaded league: ${draftData.league?.name || 'CLF Draft'}`;
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

async function calculateAllBenchPoints(entries, maxGW, playerMap) {
  const managerTotals = entries.map(e => ({
    entryId: e.entry_id || e.id,
    teamName: e.entry_name || "Unnamed Team",
    managerName: `${e.player_first_name || ''} ${e.player_last_name || ''}`.trim() || "Unknown Manager",
    totalBenchPoints: 0,
    latestGwBenchPoints: 0
  }));

  // Fetch every manager's picks for each gameweek from GW1 to maxGW
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

  // Process bench scores for each GW
  pickResults.forEach(({ managerIndex, gw, data }) => {
    if (!data || !data.picks) return;

    const picks = data.picks || [];
    const subs = data.subs || [];

    // Identify player IDs auto-subbed IN to the starting 11
    const autoSubbedInIds = new Set(subs.map(s => s.element_in));

    // Filter sub bench players (positions 12 to 15) who were NOT subbed in
    const trueBenchPicks = picks.filter(p => p.position > 11 && !autoSubbedInIds.has(p.element));

    let gwBenchScore = 0;
    trueBenchPicks.forEach(p => {
      const pId = p.element;
      
      // Extract gameweek score or fallback to total_points/event_points
      const playerData = playerMap[pId];
      const pts = p.points ?? playerData?.event_points ?? playerData?.stats?.total_points ?? 0;
      gwBenchScore += pts;
    });

    managerTotals[managerIndex].totalBenchPoints += gwBenchScore;

    if (gw === maxGW) {
      managerTotals[managerIndex].latestGwBenchPoints = gwBenchScore;
    }
  });

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