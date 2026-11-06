
const LEAGUE_ID = "12368";
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev";
const DRAFT_API = "https://draft.premierleague.com/api";

function proxyUrl(url) {
  return `${WORKER_URL}?url=${encodeURIComponent(url)}`;
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  let data = await response.json();

  // Handle a worker response wrapped inside a contents property.
  if (data && typeof data.contents === "string") {
    data = JSON.parse(data.contents);
  }

  return data;
}

function getTeamId(entry) {
  return entry.entry_id || entry.id;
}

function getOfficialTotal(row) {
  return Number(row.total ?? row.total_points ?? row.points ?? 0) || 0;
}

function getOfficialGameweekPoints(row) {
  return Number(
    row.event_total ?? row.points_for ?? row.event_points ?? 0
  ) || 0;
}

function getPlayerPoints(liveData) {
  const points = {};
  const elements = liveData?.elements;

  if (!elements) return points;

  if (Array.isArray(elements)) {
    elements.forEach(player => {
      if (player?.id != null) {
        points[player.id] = Number(player.stats?.total_points) || 0;
      }
    });
  } else {
    Object.entries(elements).forEach(([id, player]) => {
      points[id] = Number(player?.stats?.total_points) || 0;
    });
  }

  return points;
}

async function getCurrentGameweek(leagueData) {
  try {
    const game = await fetchJson(proxyUrl(`${DRAFT_API}/game`));

    if (Number(game.current_event) > 0) {
      return Number(game.current_event);
    }
  } catch (error) {
    console.warn("Could not retrieve current gameweek from /game.", error);
  }

  const leagueGW = Number(leagueData.league?.current_event);

  if (leagueGW > 0) return leagueGW;

  const matchGWs = (leagueData.matches || [])
    .map(match => Number(match.event) || 0)
    .filter(Boolean);

  return matchGWs.length ? Math.max(...matchGWs) : 1;
}

// Calculate unused bench points for every manager.
async function calculateBenchPoints(entries, maxGW) {
  const livePointsByGW = {};

  // Fetch player scores for each gameweek.
  await Promise.all(
    Array.from({ length: maxGW }, (_, index) => {
      const gw = index + 1;

      return fetchJson(
        proxyUrl(`${DRAFT_API}/event/${gw}/live`)
      )
        .then(data => {
          livePointsByGW[gw] = getPlayerPoints(data);
        })
        .catch(error => {
          console.warn(`Could not load live scores for GW${gw}`, error);
          livePointsByGW[gw] = {};
        });
    })
  );

  const managerBenchTotals = entries.map(() => ({
    total: 0,
    latest: 0,
    loadedGameweeks: 0
  }));

  const requests = [];

  // Fetch each manager's picks for every gameweek.
  entries.forEach((entry, managerIndex) => {
    const teamId = getTeamId(entry);

    for (let gw = 1; gw <= maxGW; gw++) {
      requests.push(
        fetchJson(
          proxyUrl(`${DRAFT_API}/entry/${teamId}/event/${gw}`)
        )
          .then(data => ({
            managerIndex,
            gw,
            data
          }))
          .catch(error => {
            console.warn(
              `Could not load picks for team ${teamId}, GW${gw}`,
              error
            );

            return {
              managerIndex,
              gw,
              data: null
            };
          })
      );
    }
  });

  const results = await Promise.all(requests);

  results.forEach(({ managerIndex, gw, data }) => {
    if (!data || !Array.isArray(data.picks)) return;

    const picks = data.picks;
    const livePoints = livePointsByGW[gw] || {};

    // Players automatically substituted into the starting XI
    // must not be counted again as unused bench players.
    const autoSubbedIn = new Set(
      (data.subs || []).map(sub => Number(sub.element_in))
    );

    // Draft positions 12–15 are the bench positions.
    const unusedBench = picks.filter(pick =>
      Number(pick.position) > 11 &&
      !autoSubbedIn.has(Number(pick.element))
    );

    const gwBenchPoints = unusedBench.reduce((total, pick) => {
      return total + (Number(livePoints[pick.element]) || 0);
    }, 0);

    managerBenchTotals[managerIndex].total += gwBenchPoints;
    managerBenchTotals[managerIndex].loadedGameweeks++;

    if (gw === maxGW) {
      managerBenchTotals[managerIndex].latest = gwBenchPoints;
    }
  });

  return managerBenchTotals;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderSquadTable(rows) {
  const tableBody = document.getElementById("squad-table-body");

  if (!tableBody) {
    console.error("Could not find #squad-table-body in squad.html");
    return;
  }

  tableBody.innerHTML = "";

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>
        <strong>${escapeHtml(row.teamName)}</strong><br>
        <small style="opacity:0.7;">
          ${escapeHtml(row.managerName)}
        </small>
      </td>
      <td>${row.squadGameweekPoints} pts</td>
      <td>
        <strong style="font-size:16px;color:#008a48;">
          ${row.squadTotalPoints} pts
        </strong>
      </td>
    `;

    tableBody.appendChild(tr);
  });
}

function updateSummary(rows, managerCount) {
  const managerCountEl = document.getElementById("managerCount");
  const leaderEl = document.getElementById("squadLeader");
  const totalEl = document.getElementById("leagueSquadTotal");
  const updatedEl = document.getElementById("updated");

  if (managerCountEl) {
    managerCountEl.textContent = managerCount;
  }

  if (leaderEl) {
    leaderEl.textContent = rows.length
      ? `${rows[0].teamName} (${rows[0].squadTotalPoints} pts)`
      : "—";
  }

  const leagueTotal = rows.reduce(
    (sum, row) => sum + row.squadTotalPoints,
    0
  );

  if (totalEl) {
    totalEl.textContent = `${leagueTotal} pts`;
  }

  if (updatedEl) {
    updatedEl.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
}

async function fetchSquadLeague() {
  const status = document.getElementById("status");
  const refresh = document.getElementById("refresh");

  try {
    if (status) {
      status.textContent = "Fetching official league and bench points…";
      status.style.color = "";
    }

    if (refresh) {
      refresh.disabled = true;
      refresh.style.opacity = "0.5";
    }

    // 1. Get official Draft league standings.
    const leagueData = await fetchJson(
      proxyUrl(`${DRAFT_API}/league/${LEAGUE_ID}/details`)
    );

    const entries = leagueData.league_entries || [];
    const standings = leagueData.standings || [];

    if (!entries.length || !standings.length) {
      throw new Error("League entries or official standings are missing.");
    }

    const currentGW = await getCurrentGameweek(leagueData);

    const gwElement = document.getElementById("gw");
    if (gwElement) gwElement.textContent = currentGW;

    if (status) {
      status.textContent =
        `Calculating all 15-player scores through GW${currentGW}…`;
    }

    // 2. Calculate the unused bench points.
    const benchTotals = await calculateBenchPoints(entries, currentGW);

    // 3. Index official standings by league-entry ID.
    // IMPORTANT:
    // entry.id is the league-entry ID.
    // entry.entry_id is the manager's team ID used for fetching picks.
    const officialByLeagueEntryId = new Map();

    standings.forEach(row => {
      officialByLeagueEntryId.set(
        String(row.league_entry),
        row
      );
    });

    // 4. Add official starting XI points to unused bench points.
    const combinedRows = entries.map((entry, index) => {
      const leagueEntryId = entry.id;
      const official = officialByLeagueEntryId.get(
        String(leagueEntryId)
      );

      if (!official) {
        console.warn(
          "No official standings match for:",
          entry.entry_name,
          "League entry ID:",
          leagueEntryId
        );
      }

      const startingTotal = official
        ? getOfficialTotal(official)
        : 0;

      const startingGW = official
        ? getOfficialGameweekPoints(official)
        : 0;

      const bench = benchTotals[index];

      return {
        teamName: entry.entry_name || "Unnamed Team",

        managerName:
          `${entry.player_first_name || ""} ${entry.player_last_name || ""}`.trim() ||
          "Unknown Manager",

        startingTotal,
        startingGW,

        benchTotal: bench.total,
        benchGW: bench.latest,

        // THE IMPORTANT CALCULATION:
        // Official league points + unused bench points.
        squadTotalPoints: startingTotal + bench.total,
        squadGameweekPoints: startingGW + bench.latest,

        loadedGameweeks: bench.loadedGameweeks
      };
    });

    // 5. Rank managers by their total 15-player squad points.
    combinedRows.sort((a, b) =>
      b.squadTotalPoints - a.squadTotalPoints ||
      b.squadGameweekPoints - a.squadGameweekPoints
    );

    renderSquadTable(combinedRows);
    updateSummary(combinedRows, entries.length);

    // Diagnostic breakdown for checking the calculations.
    console.table(combinedRows.map(row => ({
      manager: row.teamName,
      startingXI: row.startingTotal,
      bench: row.benchTotal,
      combinedSquad: row.squadTotalPoints
    })));

    const incomplete = benchTotals.some(
      item => item.loadedGameweeks < currentGW
    );

    if (status) {
      status.textContent = incomplete
        ? `Squad table loaded, but some bench data is missing. Check the browser console.`
        : `Squad League loaded · Starting XI + unused bench · GW1–GW${currentGW}`;

      status.style.color = incomplete ? "#ff2882" : "#008a48";
    }

  } catch (error) {
    console.error("Squad League error:", error);

    if (status) {
      status.textContent = `Could not load Squad League: ${error.message}`;
      status.style.color = "#ff2882";
    }

  } finally {
    if (refresh) {
      refresh.disabled = false;
      refresh.style.opacity = "1";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  fetchSquadLeague();

  const refresh = document.getElementById("refresh");

  if (refresh) {
    refresh.addEventListener("click", fetchSquadLeague);
  }
});