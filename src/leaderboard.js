const DEBUG_LEADERBOARD = false;

async function populateLeaderboard() {
    try {
        const response = await fetch('http://localhost:3000/leaderboard');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const tableBody = document.querySelector('#leaderboard-table tbody');
        
        if (!tableBody) return;

        if (DEBUG_LEADERBOARD) {
            console.log('[Leaderboard][client] Loaded entries:', data);
        }

        data.forEach(entry => {
            const row = document.createElement('tr');

            // Backend returns flat columns (gpu, cpuCores, etc.), not nested system object.
            const gpu = entry.gpu || 'Unknown GPU';
            const cpu = (entry.cpuCores != null ? entry.cpuCores : '?') + ' Cores';
            const score = typeof entry.score === 'number' ? entry.score : 0;

            row.innerHTML = `
                <td>${entry.rank}</td>
                <td>${entry.name}</td>
                <td>${score}</td>
                <td>${gpu} / ${cpu}</td>
                <td>${entry.date}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Could not load leaderboard data:", error);
        const tableBody = document.querySelector('#leaderboard-table tbody');
        if(tableBody) {
            const row = document.createElement('tr');
            row.innerHTML = `<td colspan="5">Could not load leaderboard data. Please try again later.</td>`;
            tableBody.appendChild(row);
        }
    }
}

document.addEventListener('DOMContentLoaded', populateLeaderboard);