const LEAGUE_ID = 12368;
const API = `https://draft.premierleague.com/api/league/${LEAGUE_ID}/details`;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function move(last, rank){
  const n = Number(last) - Number(rank);
  if(n > 0) return `<span class="move up">↑ ${n}</span>`;
  if(n < 0) return `<span class="move down">↓ ${Math.abs(n)}</span>`;
  return `<span class="move same">—</span>`;
}

async function load(){
  $('status').textContent = 'Refreshing…';
  try{
    const r = await fetch(API, {cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    const entries = Object.fromEntries(data.league_entries.map(e => [e.id, e]));
    const standings = [...data.standings].sort((a,b) =>
      a.rank_sort - b.rank_sort || a.rank - b.rank
    );

    const scores = standings.map(x => Number(x.event_total));
    const avg = scores.reduce((a,b)=>a+b,0) / scores.length;

    $('managerCount').textContent = standings.length;
    $('topScore').textContent = Math.max(...scores);
    $('average').textContent = avg.toFixed(1);
    $('updated').textContent = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    $('gw').textContent = data.league.start_event ?? 1;

    $('tableBody').innerHTML = standings.map(s => {
      const e = entries[s.league_entry];
      const initials = esc(e?.short_name || '');
      const name = esc(e?.entry_name || 'Unknown');
      const isMe = (e?.player_first_name || '').toLowerCase() === 'emanuel';
      return `<tr class="${isMe ? 'me' : ''}">
        <td>${s.rank}</td>
        <td><div class="manager"><span class="badge">${initials}</span><span>${name}</span></div></td>
        <td>${s.event_total}</td>
        <td class="pts">${s.total}</td>
        <td>${move(s.last_rank,s.rank)}</td>
      </tr>`;
    }).join('');

    $('status').textContent = `Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${data.league.name}`;
  }catch(err){
    console.error(err);
    $('status').textContent = 'Could not load live data.';
    $('tableBody').innerHTML = `<tr><td colspan="5" class="error">The FPL Draft API could not be reached directly from this browser.<br><small>${esc(err.message)}</small></td></tr>`;
  }
}

$('refresh').addEventListener('click', load);
load();
setInterval(load, 120000);
