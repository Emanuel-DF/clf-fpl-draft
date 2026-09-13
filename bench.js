const LEAGUE_ID = "12368";
const WORKER_URL = "https://fpl-proxy.emanmedia02.workers.dev";

const FPL_DRAFT_API =
  `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;

const FULL_URL =
  `${WORKER_URL}?url=${encodeURIComponent(FPL_DRAFT_API)}`;


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


    // --------------------------------------------------------
    // Get league details
    // --------------------------------------------------------

    const detailsRes = await fetch(FULL_URL);

    if (!detailsRes.ok) {
      throw new Error(
        `League details HTTP error! Status: ${detailsRes.status}`
      );
    }

    const draftData = await detailsRes.json();


    // --------------------------------------------------------
    // Current gameweek
    // --------------------------------------------------------

    const currentGW =
      draftData.league?.current_event ||
      draftData.current_event ||
      1;


    const gwElement = document.getElementById("gw");

    if (gwElement) {
      gwElement.textContent = currentGW;
    }


    // --------------------------------------------------------
    // Managers
    // --------------------------------------------------------

    const entries = draftData.league_entries || [];

    const managerCountEl =
      document.getElementById("managerCount");

    if (managerCountEl) {
      managerCountEl.textContent = entries.length;
    }


    if (statusElement) {
      statusElement.textContent =
        `Calculating bench totals (GW1 to GW${currentGW})…`;
    }


    // --------------------------------------------------------
    // Calculate bench points
    // --------------------------------------------------------

    const benchStandings =
      await calculateAllBenchPoints(entries, currentGW);


    // --------------------------------------------------------
    // Render
    // --------------------------------------------------------

    renderBenchTable(benchStandings);

    updateBenchMetrics(benchStandings);


    if (statusElement) {

      statusElement.textContent =
        `Connected! Loaded league: ${
          draftData.league?.name || "CLF Draft"
        }`;

      statusElement.style.color = "#008a48";
    }


  } catch (error) {

    console.error("Error fetching bench data:", error);

    if (statusElement) {

      statusElement.textContent =
        "Failed to load live bench data (check console).";

      statusElement.style.color = "#ff2882";
    }

  } finally {

    if (refreshBtn) {
      refreshBtn.style.opacity = "1";
    }
  }
}



// ============================================================
// CALCULATE BENCH POINTS
// ============================================================

async function calculateAllBenchPoints(entries, maxGW) {

  const managerTotals = entries.map(entry => ({

    entryId:
      entry.entry_id ||
      entry.id,

    teamName:
      entry.entry_name ||
      "Unnamed Team",

    managerName:
      `${entry.player_first_name || ""} ${
        entry.player_last_name || ""
      }`.trim() || "Unknown Manager",

    totalBenchPoints: 0,

    latestGwBenchPoints: 0

  }));


  // ----------------------------------------------------------
  // Create requests for every manager / gameweek
  // ----------------------------------------------------------

  const requests = [];

  for (let gw = 1; gw <= maxGW; gw++) {

    entries.forEach((entry, managerIndex) => {

      const entryId =
        entry.entry_id ||
        entry.id;


      const apiUrl =
        `https://draft.premierleague.com/api/entry/` +
        `${entryId}/event/${gw}`;


      const url =
        `${WORKER_URL}?url=${encodeURIComponent(apiUrl)}`;


      requests.push(

        fetch(url)
          .then(async response => {

            if (!response.ok) {
              return null;
            }

            return await response.json();

          })

          .then(data => ({

            managerIndex,
            gw,
            data

          }))

          .catch(error => {

            console.warn(
              `Could not load GW${gw} for manager ${entryId}`,
              error
            );

            return {

              managerIndex,
              gw,
              data: null

            };

          })

      );

    });

  }


  // ----------------------------------------------------------
  // Wait for all requests
  // ----------------------------------------------------------

  const results = await Promise.all(requests);


  // ----------------------------------------------------------
  // Process each gameweek
  // ----------------------------------------------------------

  results.forEach(({ managerIndex, gw, data }) => {

    if (!data) {
      return;
    }


    // --------------------------------------------------------
    // THIS IS THE IMPORTANT PART
    //
    // FPL already gives us the points scored by players
    // left on the bench for this gameweek.
    // --------------------------------------------------------

    const benchPoints =
      Number(
        data.entry_history?.points_on_bench
      ) || 0;


    managerTotals[managerIndex].totalBenchPoints +=
      benchPoints;


    if (gw === maxGW) {

      managerTotals[managerIndex].latestGwBenchPoints =
        benchPoints;

    }

  });


  // ----------------------------------------------------------
  // Highest bench points first
  // ----------------------------------------------------------

  return managerTotals.sort(
    (a, b) =>
      b.totalBenchPoints -
      a.totalBenchPoints
  );

}



// ============================================================
// RENDER TABLE
// ============================================================

function renderBenchTable(standings) {

  const tableBody =
    document.getElementById("bench-table-body");

  if (!tableBody) {
    return;
  }


  tableBody.innerHTML = "";


  standings.forEach((row, index) => {

    const rank = index + 1;

    const rowElement =
      document.createElement("tr");


    rowElement.innerHTML = `

      <td>${rank}</td>

      <td>
        <strong>${row.teamName}</strong>
        <br>
        <small style="opacity: 0.7;">
          ${row.managerName}
        </small>
      </td>

      <td>
        ${row.latestGwBenchPoints} pts
      </td>

      <td>
        <strong
          style="
            font-size: 16px;
            color: #008a48;
          "
        >
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

  if (!standings.length) {
    return;
  }


  // ----------------------------------------------------------
  // Bench King
  // ----------------------------------------------------------

  const benchKingEl =
    document.getElementById("benchKing");


  if (benchKingEl) {

    benchKingEl.textContent =
      `${standings[0].teamName} ` +
      `(${standings[0].totalBenchPoints} pts)`;

  }


  // ----------------------------------------------------------
  // League total
  // ----------------------------------------------------------

  const totalSum =
    standings.reduce(
      (total, manager) =>
        total + manager.totalBenchPoints,
      0
    );


  const totalBenchedEl =
    document.getElementById("totalBenched");


  if (totalBenchedEl) {

    totalBenchedEl.textContent =
      `${totalSum} pts`;

  }


  // ----------------------------------------------------------
  // Updated time
  // ----------------------------------------------------------

  const updatedEl =
    document.getElementById("updated");


  if (updatedEl) {

    const now = new Date();

    updatedEl.textContent =
      now.toLocaleTimeString(
        [],
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      );

  }

}



// ============================================================
// START
// ============================================================

document.addEventListener(
  "DOMContentLoaded",
  () => {

    fetchBenchLeagueData();


    const refreshBtn =
      document.getElementById("refresh");


    if (refreshBtn) {

      refreshBtn.addEventListener(
        "click",
        fetchBenchLeagueData
      );

    }

  }
);