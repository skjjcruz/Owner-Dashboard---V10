import React, { useState } from ‘react’;

// Mock data
const mockLeagues = [
{ id: 1, name: ‘The Psycho League: Year VI’, type: ‘dynasty’ },
{ id: 2, name: ‘Dynasty Warriors 2026’, type: ‘dynasty’ },
{ id: 3, name: ‘Redraft Champions’, type: ‘redraft’ },
];

const mockPlayers = [
{ id: 1, name: ‘Cameron Ward’, pos: ‘QB’, school: ‘Miami’, size: ‘6'2”’, weight: 223, speed: 4.58, tier: 1 },
{ id: 2, name: ‘Shedeur Sanders’, pos: ‘QB’, school: ‘Colorado’, size: ‘6'2”’, weight: 215, speed: 4.6, tier: 1 },
{ id: 3, name: ‘Quinn Ewers’, pos: ‘QB’, school: ‘Texas’, size: ‘6'2”’, weight: 195, speed: 4.7, tier: 1 },
{ id: 4, name: ‘Riley Leonard’, pos: ‘QB’, school: ‘Notre Dame’, size: ‘6'4”’, weight: 212, speed: 4.5, tier: 2 },
{ id: 5, name: ‘Ashton Jeanty’, pos: ‘RB’, school: ‘Boise State’, size: ‘5'9”’, weight: 215, speed: 4.42, tier: 1 },
{ id: 6, name: ‘Omarion Hampton’, pos: ‘RB’, school: ‘UNC’, size: ‘6'0”’, weight: 220, speed: 4.5, tier: 1 },
{ id: 7, name: ‘Travis Hunter’, pos: ‘WR’, school: ‘Colorado’, size: ‘6'1”’, weight: 185, speed: 4.3, tier: 1 },
{ id: 8, name: ‘Tetairoa McMillan’, pos: ‘WR’, school: ‘Arizona’, size: ‘6'5”’, weight: 210, speed: 4.5, tier: 1 },
{ id: 9, name: ‘Emeka Egbuka’, pos: ‘WR’, school: ‘Ohio State’, size: ‘6'1”’, weight: 206, speed: 4.3, tier: 1 },
{ id: 10, name: ‘Abdul Carter’, pos: ‘EDGE’, school: ‘Penn State’, size: ‘6'3”’, weight: 252, speed: 4.4, tier: 1 },
];

const positions = [‘QB’, ‘RB’, ‘WR’, ‘TE’, ‘EDGE’, ‘DL’, ‘LB’, ‘DB’, ‘K’];

export default function DraftBoard() {
const [numTeams] = useState(16);
const [numRounds] = useState(7);
const [draftType] = useState(‘snake’);
const [selectedPos, setSelectedPos] = useState(‘ALL’);
const [searchTerm, setSearchTerm] = useState(’’);
const [players] = useState(mockPlayers);
const [draftPicks, setDraftPicks] = useState({});
const [selectedPickSlot, setSelectedPickSlot] = useState(null);

// Sleeper API State
const [sleeperUsername, setSleeperUsername] = useState(‘skjjcruz’);
const [sleeperUserId, setSleeperUserId] = useState(null);
const [userLeagues, setUserLeagues] = useState(mockLeagues);
const [selectedLeague, setSelectedLeague] = useState(mockLeagues[0]);
const [leagueSeason, setLeagueSeason] = useState(2026);
const [statsSeason, setStatsSeason] = useState(2025);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);

// Fetch Sleeper user data
const fetchSleeperUser = async (username) => {
if (!username) return;

```
setLoading(true);
setError(null);

try {
  const response = await fetch(`https://api.sleeper.app/v1/user/${username}`);
  if (!response.ok) throw new Error('User not found');
  
  const userData = await response.json();
  setSleeperUserId(userData.user_id);
  
  const leaguesResponse = await fetch(`https://api.sleeper.app/v1/user/${userData.user_id}/leagues/nfl/${leagueSeason}`);
  if (!leaguesResponse.ok) throw new Error('Could not fetch leagues');
  
  const leaguesData = await leaguesResponse.json();
  
  const mappedLeagues = leaguesData.map(league => ({
    id: league.league_id,
    name: league.name,
    type: league.settings.type || 'redraft',
    totalRosters: league.total_rosters,
    season: league.season,
    status: league.status,
    draftId: league.draft_id
  }));
  
  setUserLeagues(mappedLeagues);
  if (mappedLeagues.length > 0) {
    setSelectedLeague(mappedLeagues[0]);
  }
  
} catch (err) {
  setError(err.message);
  console.error('Sleeper API Error:', err);
} finally {
  setLoading(false);
}
```

};

const generateDraftOrder = () => {
const order = [];
for (let round = 1; round <= numRounds; round++) {
for (let team = 1; team <= numTeams; team++) {
const pickNum = draftType === ‘snake’ && round % 2 === 0
? numTeams - team + 1
: team;
order.push({
round,
pick: pickNum,
overall: (round - 1) * numTeams + team,
team: pickNum,
key: `${round}.${String(pickNum).padStart(2, '0')}`
});
}
}
return order;
};

const draftOrder = generateDraftOrder();

const filteredPlayers = players.filter(p => {
const matchesPos = selectedPos === ‘ALL’ || p.pos === selectedPos;
const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
p.school.toLowerCase().includes(searchTerm.toLowerCase());
const notDrafted = !Object.values(draftPicks).includes(p.id);
return matchesPos && matchesSearch && notDrafted;
});

const positionCounts = positions.reduce((acc, pos) => {
acc[pos] = players.filter(p => p.pos === pos && !Object.values(draftPicks).includes(p.id)).length;
return acc;
}, {});
const totalAvailable = players.filter(p => !Object.values(draftPicks).includes(p.id)).length;

const handlePlayerClick = (player) => {
if (!selectedPickSlot) {
const nextPick = draftOrder.find(pick => !draftPicks[pick.key]);
if (nextPick) {
setDraftPicks(prev => ({ …prev, [nextPick.key]: player.id }));
}
} else {
setDraftPicks(prev => ({ …prev, [selectedPickSlot]: player.id }));
setSelectedPickSlot(null);
}
};

const handlePickSlotClick = (pickKey) => {
if (draftPicks[pickKey]) {
const newPicks = { …draftPicks };
delete newPicks[pickKey];
setDraftPicks(newPicks);
} else {
setSelectedPickSlot(pickKey);
}
};

const picksByRound = draftOrder.reduce((acc, pick) => {
if (!acc[pick.round]) acc[pick.round] = [];
acc[pick.round].push(pick);
return acc;
}, {});

return (
<div className="min-h-screen bg-slate-950 text-slate-100">
{/* League Selection Bar */}
<div className="bg-slate-900 border-b border-slate-700 px-4 py-3">
<div className="flex flex-wrap gap-4 items-center">
<input
type=“text”
placeholder=“Sleeper username”
value={sleeperUsername}
onChange={(e) => setSleeperUsername(e.target.value)}
onKeyPress={(e) => e.key === ‘Enter’ && fetchSleeperUser(sleeperUsername)}
className=“bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 w-32”
/>

```
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-400">League Season:</label>
        <select 
          value={leagueSeason}
          onChange={(e) => setLeagueSeason(Number(e.target.value))}
          className="bg-slate-800 border border-slate-600

// Add info icon to player cards
function addInfoIconToPlayerCards() {
    const playerCards = document.querySelectorAll('.player-card');
    
    playerCards.forEach(card => {
        if (card.querySelector('.player-info-icon')) return;
        
        const infoIcon = document.createElement('div');
        infoIcon.className = 'player-info-icon';
        infoIcon.innerHTML = 'ⓘ';
        infoIcon.title = 'View player details';
        
        const playerNameEl = card.querySelector('.player-name');
        if (!playerNameEl) return;
        
        const playerName = playerNameEl.textContent.trim();
        
        infoIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            window.location.href = `player-detail.html?player=${encodeURIComponent(playerName)}`;
        });
        
        card.appendChild(infoIcon);
    });
}

// Auto-add info icons
const observer = new MutationObserver(() => {
    addInfoIconToPlayerCards();
});

const playerContainer = document.querySelector('.players-grid') || document.body;
observer.observe(playerContainer, { childList: true, subtree: true });

// Add to existing cards on load
setTimeout(() => {
    addInfoIconToPlayerCards();
}, 500);

```
