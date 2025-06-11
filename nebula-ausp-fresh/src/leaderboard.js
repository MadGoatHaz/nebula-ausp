async function populateLeaderboard() {
    try {
        const response = await fetch('leaderboard-data.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const tableBody = document.querySelector('#leaderboard-table tbody');
        
        if (!tableBody) return;

        data.forEach(entry => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${entry.rank}</td>
                <td>${entry.user}</td>
                <td>${entry.score}</td>
                <td>${entry.system.gpu} / ${entry.system.cpuCores} Cores</td>
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