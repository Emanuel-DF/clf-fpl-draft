// ============================================================
// CLF DRAFT — SQUAD LEAGUE
// Official league points + points scored by the four bench players.
// Uses the same Draft endpoints and bench-scoring approach as bench.js.
// ============================================================

const LEAGUE_ID = "12368";
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev";
const DRAFT_API = "https://draft.premierleague.com/api";

function proxyUrl(targetUrl) {
  return `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let data = JSON.parse(text);

  // Supports workers that wrap the upstream response in { contents: "..." }.
  if (data && typeof data.contents === "string") {
    data = JSON.parse(data.contents);
  }
  return data;
}

function getEntryId(entry) {
  return entry.entry_id || entry.id;
}

function getStandingsEntryId(row) {
  return row.league_entry || row.entry || row.entry_id || row.id;
}

function getOfficialTotal(row) {
  return Number(row.total ?? row.total_points ?? row.points ?? 0) || 0;
}

function getOfficialGameweekPoints(row) {
  return Number(row.event_total ?? row.points_for ?? row.event_points ?? 0) || 0;
}

function extractPlayerPointsFromLiveEvent(liveData) {
  const points = {};
  const elements = liveData?.elements;
  if (!elements) return points;

  if (Array.isArray(elements)) {
    elements.forEach(player => {
      if (player && player.id != null) {
        points[player.id] = Number(player.stats?.total_points) || 0;
      }
    });
  } else if (typeof elements === "object") {
    Object.entries(elements).forEach(([id, player]) => {
      points[id] = Number(player?.stats?.total_points) || 0;
    });
  }

  return points;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return parseJsonResponse(response);
}

async function getCurrentGameweek(leagueData) {
  // Prefer the Draft game's current event, as the bench page does.
  try {
    const gameData = await fetchJson(proxyUrl(`${DRAFT_API}/game`));
    if (Number(gameData?.current_event) > 0) {
      return Number(gameData.current_event);
    }
  } catch (error) {
    console.warn("Could not read Draft /game current_event; using league fallback.", error);
  }

  const leagueEvent = Number(leagueData.league?.current_event);
  if (leagueEvent > 0) return leagueEvent;

  const matchEvents = (leagueData.matches || [])
    .map(match => Number(match.event) || 0)
    .filter(Boolean);

  return matchEvents.length ? Math.max(...matchEvents) : 1;
}

async function fetchBenchPoints(entries, maxGameweek, statusElement) {
  // Fetch player live scores once per gameweek.
  const liveStatsByGameweek = {};

  const liveRequests = Array.from({ length: maxGameweek }, (_, index) => {
    const gw = index + 1;
    return fetchJson(proxyUrl(`${DRAFT_API}/event/${gw}/live`))
      .then(data => {
        liveStatsByGameweek[gw] = extractPlayerPointsFromLiveEvent(data);
      })
      .catch(error => {
        console.warn(`Could not load live player scores for GW${gw}.`, error);
        liveStatsByGameweek[gw] = {};
      });
  });

  await Promise.all(liveRequests);

  // Fetch every manager's Draft picks for every gameweek.
  const lineupRequests = [];
  entries.forEach((entry, managerIndex) => {
    const entryId = getEntryId(entry);

    for (let gw = 1; gw <= maxGameweek; gw++) {
      const url = proxyUrl(`${DRAFT_API}/entry/${entryId}/event/${gw}`);

      lineupRequests.push(
        fetchJson(url)
          .then(data => ({ managerIndex, gw, data }))
          .catch(error => {
            console.warn(`Could not load picks for entry ${entryId}, GW${gw}.`, error);
            return { managerIndex, gw, data: null };
          })
      );
    }
  });

  if (statusElement) {
    statusElement.textContent = `Calculating all 15-player scores across GW1–GW${maxGameweek}…`;
  }

  const lineupResults = await Promise.all(lineupRequests);
  const benchTotals = entries.map(() => ({
    total: 0,
    latest: 0,
    loadedGameweeks: 0
  }));

  lineupResults.forEach(({ managerIndex, gw, data }) => {
    if (!data || !Array.isArray(data.picks)) return;

    const livePoints = liveStatsByGameweek[gw] || {};

    // Draft pick positions 12–15 are the four substitutes/bench slots.
    const benchPicks = data.picks.filter(pick => Number(pick.position) > 11);

    const benchPoints = benchPicks.reduce((sum, pick) => {
      return sum + (Number(livePoints[pick.element]) || 0);
    }, 0);

    benchTotals[managerIndex].total += benchPoints;
    benchTotals[managerIndex].loadedGameweeks += 1;

    if (gw === maxGameweek) {
      benchTotals[managerIndex].latest = benchPoints;
    }
  });

  return benchTotals;
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
  const body = document.getElementById("squad-table-body");
  if (!body) return;

  body.innerHTML = "";

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>
        <strong>${escapeHtml(row.teamName)}</strong><br>
        <small style="opacity:0.7;">${escapeHtml(row.managerName)}</small>
      </td>
      <td>${row.squadGameweekPoints} pts</td>
      <td><strong style="font-size:16px;color:#008a48;">${row.squadTotalPoints} pts</strong></td>
    `;
    body.appendChild(tr);
  });
}

function updateSummary(rows, managerCount) {
  const managerCountEl = document.getElementById("managerCount");
  const leaderEl = document.getElementById("squadLeader");
  const totalEl = document.getElementById("leagueSquadTotal");
  const updatedEl = document.getElementById("updated");

  if (managerCountEl) managerCountEl.textContent = managerCount;
  if (leaderEl) {
    leaderEl.textContent = rows.length
      ? `${rows[0].teamName} (${rows[0].squadTotalPoints} pts)`
      : "—";
  }

  const leagueTotal = rows.reduce((sum, row) => sum + row.squadTotalPoints, 0);
  if (totalEl) totalEl.textContent = `${leagueTotal} pts`;
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
      status.textContent = "Fetching official standings and bench scores…";
      status.style.color = "";
    }
    if (refresh) {
      refresh.disabled = true;
      refresh.style.opacity = "0.5";
    }

    const leagueData = await fetchJson(
      proxyUrl(`${DRAFT_API}/league/${LEAGUE_ID}/details`)
    );

    const entries = leagueData.league_entries || [];
    const standings = leagueData.standings || [];

    if (!entries.length) {
      throw new Error("No league managers were returned by the Draft API.");
    }

    const currentGW = await getCurrentGameweek(leagueData);
    const gwEl = document.getElementById("gw");
    if (gwEl) gwEl.textContent = currentGW;

    const benchTotals = await fetchBenchPoints(entries, currentGW, status);

    // Match official standings to managers by Draft league-entry ID.
    const officialByEntryId = new Map();
    standings.forEach(row => {
      officialByEntryId.set(String(getStandingsEntryId(row)), row);
    });

    const combinedRows = entries.map((entry, index) => {
      const entryId = getEntryId(entry);
      const official = officialByEntryId.get(String(entryId));

      const officialTotal = official ? getOfficialTotal(official) : 0;
      const officialGW = official ? getOfficialGameweekPoints(official) : 0;
      const bench = benchTotals[index];

      return {
        entryId,
        teamName: entry.entry_name || "Unnamed Team",
        managerName:
          `${entry.player_first_name || ""} ${entry.player_last_name || ""}`.trim() ||
          "Unknown Manager",
        squadTotalPoints: officialTotal + bench.total,
        squadGameweekPoints: officialGW + bench.latest,
        officialTotal,
        benchTotal: bench.total,
        benchGameweek: bench.latest,
        loadedGameweeks: bench.loadedGameweeks
      };
    });

    combinedRows.sort((a, b) =>
      b.squadTotalPoints - a.squadTotalPoints ||
      b.squadGameweekPoints - a.squadGameweekPoints
    );

    renderSquadTable(combinedRows);
    updateSummary(combinedRows, entries.length);

    const incomplete = benchTotals.some(item => item.loadedGameweeks < currentGW);
    if (status) {
      status.textContent = incomplete
        ? `Loaded squad standings through GW${currentGW}, but some manager/gameweek picks could not be retrieved. Check the browser console.`
        : `Live squad table · official points plus bench points · GW1–GW${currentGW}`;
      status.style.color = incomplete ? "#ff2882" : "#008a48";
    }

    // Useful diagnostics: compare the two components for each manager.
    console.table(combinedRows.map(row => ({
      team: row.teamName,
      official: row.officialTotal,
      bench: row.benchTotal,
      squad: row.squadTotalPoints
    })));

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
  if (refresh) refresh.addEventListener("click", fetchSquadLeague);
});