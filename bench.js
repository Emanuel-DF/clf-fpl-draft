// ============================================================
// CONFIGURATION & CONSTANTS
// ============================================================

const LEAGUE_ID = "12368";
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev";
const FPL_DRAFT_BASE = "https://draft.premierleague.com/api";

function getProxyUrl(targetUrl) {
  return `${WORKER_URL}?url=${encodeURIComponent(targetUrl)}`;
}


// ============================================================
// MAIN DATA CONTROLLER
// ============================================================

async function fetchBenchLeagueData() {
  const statusElement = document.getElementById("status");
  const refreshBtn = document.getElementById("refresh");

  try {
    if (statusElement) {
      statusElement.textContent = "Connecting to FPL Draft servers...";
      statusElement.style.color = "#ffffff";
    }

    if (refreshBtn) {
      refreshBtn.style.opacity = "0.5";
      refreshBtn.disabled = true;
    }

    // STEP 1: Fetch League Details and FPL Draft Game Data
    const leagueDetailsUrl = getProxyUrl(`${FPL_DRAFT_BASE}/league/${LEAGUE_ID}/details`);
    const gameStatusUrl = getProxyUrl(`${FPL_DRAFT_BASE}/game`);

    const [leagueDetailsResponse, gameStatusResponse] = await Promise.all([
      fetch(leagueDetailsUrl),
      fetch(gameStatusUrl)
    ]);

    if (!leagueDetailsResponse.ok) {
      throw new Error(`Failed to fetch league details. Status: ${leagueDetailsResponse.status}`);
    }

    const leagueData = await parseJsonResponse(leagueDetailsResponse);
    let gameData = {};

    if (gameStatusResponse.ok) {
      try {
        gameData = await parseJsonResponse(gameStatusResponse);
      } catch (e) {
        console.warn("Failed parsing /game endpoint data:", e);
      }
    }

    // DETERMINE ACCURATE CURRENT GAMEWEEK
    let currentGameweek = 1;

    // Strategy A: Draft Game API Endpoint
    if (gameData && gameData.current_event) {
      currentGameweek = Number(gameData.current_event);
    } 
    // Strategy B: Check League Details Matches Array for highest event played/scheduled
    else if (leagueData.matches && Array.isArray(leagueData.matches) && leagueData.matches.length > 0) {
      let maxEventInMatches = 1;
      leagueData.matches.forEach(function (match) {
        if (match.event && match.event > maxEventInMatches) {
          // If match is finished or currently in progress
          if (match.finished || match.started || match.event <= (leagueData.league?.current_event || 1)) {
            maxEventInMatches = match.event;
          }
        }
      });
      currentGameweek = maxEventInMatches;
    }
    // Strategy C: Direct fallback checks
    else if (leagueData.league && leagueData.league.current_event) {
      currentGameweek = Number(leagueData.league.current_event);
    }

    // Safeguard to ensure currentGameweek is a valid positive integer
    if (isNaN(currentGameweek) || currentGameweek < 1) {
      currentGameweek = 1;
    }

    const gwDisplayElement = document.getElementById("gw");
    if (gwDisplayElement) {
      gwDisplayElement.textContent = currentGameweek;
    }

    const leagueEntries = leagueData.league_entries || [];

    const managerCountElement = document.getElementById("managerCount");
    if (managerCountElement) {
      managerCountElement.textContent = leagueEntries.length;
    }

    if (statusElement) {
      statusElement.textContent = `Fetching live player scores across GW1 to GW${currentGameweek}…`;
    }

    // STEP 2: Pre-fetch Live Stats for Every Gameweek (GW1 through currentGameweek)
    const gameweekLiveStatsMap = {};

    for (let gw = 1; gw <= currentGameweek; gw++) {
      if (statusElement) {
        statusElement.textContent = `Loading live player performance data for GW${gw} of GW${currentGameweek}…`;
      }

      const liveEventUrl = getProxyUrl(`${FPL_DRAFT_BASE}/event/${gw}/live`);
      
      try {
        const liveEventResponse = await fetch(liveEventUrl);
        
        if (liveEventResponse.ok) {
          const liveEventData = await parseJsonResponse(liveEventResponse);
          gameweekLiveStatsMap[gw] = extractPlayerPointsFromLiveEvent(liveEventData);
        } else {
          console.warn(`Could not retrieve live event data for GW${gw}`);
          gameweekLiveStatsMap[gw] = {};
        }
      } catch (gwError) {
        console.warn(`Error fetching live stats for GW${gw}:`, gwError);
        gameweekLiveStatsMap[gw] = {};
      }
    }

    if (statusElement) {
      statusElement.textContent = `Calculating bench lineups across all ${currentGameweek} Gameweeks…`;
    }

    // STEP 3: Process Every Manager's Squad Lineup for Every Gameweek
    const calculatedStandings = await calculateLeagueBenchStandings(
      leagueEntries,
      currentGameweek,
      gameweekLiveStatsMap
    );

    // STEP 4: Render Calculated Data to HTML
    renderBenchStandingsTable(calculatedStandings);
    renderBenchMetricsSummary(calculatedStandings);

    if (statusElement) {
      const leagueName = leagueData.league?.name || "CLF Draft";
      statusElement.textContent = `Connected! Calculated live bench points (GW1-GW${currentGameweek}) for ${leagueName}`;
      statusElement.style.color = "#008a48";
    }

  } catch (globalError) {
    console.error("Fatal Error fetching bench data:", globalError);

    if (statusElement) {
      statusElement.textContent = "Failed to load live bench data. Check console for details.";
      statusElement.style.color = "#ff2882";
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.style.opacity = "1";
      refreshBtn.disabled = false;
    }
  }
}


// ============================================================
// DATA CALCULATIONS & LOGIC
// ============================================================

async function calculateLeagueBenchStandings(entriesList, maxGameweek, liveStatsByGameweek) {
  const managerTotalsMap = entriesList.map(function (entry) {
    const entryId = entry.entry_id || entry.id;
    const teamName = entry.entry_name || "Unnamed Team";
    
    let firstName = entry.player_first_name || "";
    let lastName = entry.player_last_name || "";
    let fullName = `${firstName} ${lastName}`.trim();
    if (!fullName) fullName = "Unknown Manager";

    return {
      entryId: entryId,
      teamName: teamName,
      managerName: fullName,
      totalBenchPoints: 0,
      latestGwBenchPoints: 0
    };
  });

  const lineupFetchRequests = [];

  for (let gw = 1; gw <= maxGameweek; gw++) {
    entriesList.forEach(function (entry, managerIndex) {
      const entryId = entry.entry_id || entry.id;
      const entryEventUrl = getProxyUrl(`${FPL_DRAFT_BASE}/entry/${entryId}/event/${gw}`);

      const requestPromise = fetch(entryEventUrl)
        .then(async function (response) {
          if (!response.ok) {
            return null;
          }
          return await parseJsonResponse(response);
        })
        .then(function (parsedData) {
          return {
            managerIndex: managerIndex,
            gameweek: gw,
            lineupData: parsedData
          };
        })
        .catch(function (fetchErr) {
          console.warn(`Failed fetching manager ${entryId} for GW${gw}`, fetchErr);
          return {
            managerIndex: managerIndex,
            gameweek: gw,
            lineupData: null
          };
        });

      lineupFetchRequests.push(requestPromise);
    });
  }

  const lineupResults = await Promise.all(lineupFetchRequests);

  lineupResults.forEach(function (result) {
    if (!result || !result.lineupData) {
      return;
    }

    const managerIndex = result.managerIndex;
    const gw = result.gameweek;
    const picks = result.lineupData.picks || [];

    const benchedPicks = picks.filter(function (pickItem) {
      return pickItem.position > 11;
    });

    const activeGameweekPlayerPointsMap = liveStatsByGameweek[gw] || {};

    let currentGameweekBenchPointsTotal = 0;

    benchedPicks.forEach(function (benchedPick) {
      const playerId = benchedPick.element;
      const pointsScoredByPlayer = activeGameweekPlayerPointsMap[playerId] || 0;
      currentGameweekBenchPointsTotal += pointsScoredByPlayer;
    });

    managerTotalsMap[managerIndex].totalBenchPoints += currentGameweekBenchPointsTotal;

    if (gw === maxGameweek) {
      managerTotalsMap[managerIndex].latestGwBenchPoints = currentGameweekBenchPointsTotal;
    }
  });

  managerTotalsMap.sort(function (managerA, managerB) {
    return managerB.totalBenchPoints - managerA.totalBenchPoints;
  });

  return managerTotalsMap;
}


// ============================================================
// HELPER FUNCTIONS & UTILITIES
// ============================================================

async function parseJsonResponse(response) {
  const jsonText = await response.text();
  let parsedObject = JSON.parse(jsonText);

  if (parsedObject && typeof parsedObject.contents === "string") {
    parsedObject = JSON.parse(parsedObject.contents);
  }

  return parsedObject;
}

function extractPlayerPointsFromLiveEvent(liveData) {
  const pointsLookup = {};

  if (!liveData) {
    return pointsLookup;
  }

  const elementsData = liveData.elements;

  if (!elementsData) {
    return pointsLookup;
  }

  if (typeof elementsData === "object" && !Array.isArray(elementsData)) {
    Object.keys(elementsData).forEach(function (elementId) {
      const playerObj = elementsData[elementId];
      let playerPoints = 0;

      if (playerObj && playerObj.stats && typeof playerObj.stats.total_points !== "undefined") {
        playerPoints = Number(playerObj.stats.total_points) || 0;
      }

      pointsLookup[elementId] = playerPoints;
    });
  } 
  else if (Array.isArray(elementsData)) {
    elementsData.forEach(function (playerObj) {
      if (playerObj && typeof playerObj.id !== "undefined") {
        const elementId = playerObj.id;
        let playerPoints = 0;

        if (playerObj.stats && typeof playerObj.stats.total_points !== "undefined") {
          playerPoints = Number(playerObj.stats.total_points) || 0;
        }

        pointsLookup[elementId] = playerPoints;
      }
    });
  }

  return pointsLookup;
}


// ============================================================
// UI DOM RENDERERS
// ============================================================

function renderBenchStandingsTable(standingsList) {
  const tableBody = document.getElementById("bench-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  standingsList.forEach(function (row, index) {
    const rank = index + 1;
    const tableRow = document.createElement("tr");

    tableRow.innerHTML = `
      <td>${rank}</td>
      <td>
        <strong>${escapeHtml(row.teamName)}</strong>
        <br>
        <small style="opacity: 0.7;">${escapeHtml(row.managerName)}</small>
      </td>
      <td>${row.latestGwBenchPoints} pts</td>
      <td>
        <strong style="font-size: 16px; color: #008a48;">
          ${row.totalBenchPoints} pts
        </strong>
      </td>
    `;

    tableBody.appendChild(tableRow);
  });
}

function renderBenchMetricsSummary(standingsList) {
  if (!standingsList || standingsList.length === 0) return;

  const benchKingElement = document.getElementById("benchKing");
  if (benchKingElement) {
    const topManager = standingsList[0];
    benchKingElement.textContent = `${topManager.teamName} (${topManager.totalBenchPoints} pts)`;
  }

  const totalBenchedPointsSum = standingsList.reduce(function (runningSum, manager) {
    return runningSum + manager.totalBenchPoints;
  }, 0);

  const totalBenchedElement = document.getElementById("totalBenched");
  if (totalBenchedElement) {
    totalBenchedElement.textContent = `${totalBenchedPointsSum} pts`;
  }

  const updatedElement = document.getElementById("updated");
  if (updatedElement) {
    const currentTime = new Date();
    updatedElement.textContent = currentTime.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
}

function escapeHtml(textString) {
  if (!textString) return "";
  return String(textString)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// ============================================================
// INITIALIZATION ON DOM LOAD
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
  fetchBenchLeagueData();

  const refreshButton = document.getElementById("refresh");
  if (refreshButton) {
    refreshButton.addEventListener("click", function () {
      fetchBenchLeagueData();
    });
  }
});