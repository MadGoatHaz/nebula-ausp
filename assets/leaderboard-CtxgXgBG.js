import"./style-DCXveqyH.js";async function r(){try{const e=await fetch("http://localhost:3000/leaderboard");if(!e.ok)throw new Error(`HTTP error! status: ${e.status}`);const a=await e.json(),o=document.querySelector("#leaderboard-table tbody");if(!o)return;a.forEach(t=>{const d=document.createElement("tr");d.innerHTML=`
                <td>${t.rank}</td>
                <td>${t.name}</td>
                <td>${t.score}</td>
                <td>${t.system.gpu} / ${t.system.cpuCores} Cores</td>
                <td>${t.date}</td>
            `,o.appendChild(d)})}catch(e){console.error("Could not load leaderboard data:",e);const a=document.querySelector("#leaderboard-table tbody");if(a){const o=document.createElement("tr");o.innerHTML='<td colspan="5">Could not load leaderboard data. Please try again later.</td>',a.appendChild(o)}}}document.addEventListener("DOMContentLoaded",r);
