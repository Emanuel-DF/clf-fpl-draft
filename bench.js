// ============================================================
// CONFIGURATION & CONSTANTS
// ============================================================

const LEAGUE_ID = "12368";
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev";

const FPL_DRAFT_BASE = "https://draft.premierleague.com/api";

// Helper function to build proxied requests safely
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

    // STEP 1: Fetch League Details
    const leagueDetailsUrl = getProxyUrl(`${FPL_DRAFT_BASE}/league/${LEAGUE_ID}/details`);
    const leagueDetailsResponse = await fetch(leagueDetailsUrl);

    if (!leagueDetailsResponse.ok) {
      throw new Error(`Failed to fetch league details. Status: ${leagueDetailsResponse.status}`);
    }

    const leagueData = await parseJsonResponse(leagueDetailsResponse);

    // Identify current active Gameweek
    const currentGameweek = leagueData.league?.current_event || leagueData.current_event || 1;

    const gwDisplayElement = document.getElementById("gw");
    if (gwDisplayElement) {
      gwDisplayElement.textContent = currentGameweek;
    }

    // Identify League Entries (Managers)
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
        statusElement.textContent = `Loading live player performance data for GW${gw}…`;
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
      statusElement.textContent = `Calculating bench lineups for ${leagueEntries.length} managers…`;
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
      statusElement.textContent = `Connected! Calculated live bench points for ${leagueName}`;
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
  // Initialize data structures for each manager entry
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

  // Prepare asynchronous requests for every manager and every GW
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

  // Await all concurrent lineup requests
  const lineupResults = await Promise.all(lineupFetchRequests);

  // Accumulate bench points per manager
  lineupResults.forEach(function (result) {
    if (!result || !result.lineupData) {
      return;
    }

    const managerIndex = result.managerIndex;
    const gw = result.gameweek;
    const picks = result.lineupData.picks || [];

    // Filter picks: Positions 12, 13, 14, 15 are bench positions
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

    // Add to manager running total
    managerTotalsMap[managerIndex].totalBenchPoints += currentGameweekBenchPointsTotal;

    // Record the score if this is the latest Gameweek
    if (gw === maxGameweek) {
      managerTotalsMap[managerIndex].latestGwBenchPoints = currentGameweekBenchPointsTotal;
    }
  });

  // Sort managers in descending order by total bench points scored
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

  // If proxy wraps the response inside a stringified "contents" property
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

  // Handle case where elementsData is an Object indexed by player IDs
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
  // Handle case where elementsData is an Array of player objects
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

  // 1. Bench King (Rank 1 Manager)
  const benchKingElement = document.getElementById("benchKing");
  if (benchKingElement) {
    const topManager = standingsList[0];
    benchKingElement.textContent = `${topManager.teamName} (${topManager.totalBenchPoints} pts)`;
  }

  // 2. League Total Benched Points Sum
  const totalBenchedPointsSum = standingsList.reduce(function (runningSum, manager) {
    return runningSum + manager.totalBenchPoints;
  }, 0);

  const totalBenchedElement = document.getElementById("totalBenched");
  if (totalBenchedElement) {
    totalBenchedElement.textContent = `${totalBenchedPointsSum} pts`;
  }

  // 3. Last Updated Time
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