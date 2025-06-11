import"./style-yw6EFRbW.js";async function r(){try{const e=await fetch("leaderboard-data.json");if(!e.ok)throw new Error(`HTTP error! status: ${e.status}`);const d=await e.json(),o=document.querySelector("#leaderboard-table tbody");if(!o)return;d.forEach(t=>{const a=document.createElement("tr");a.innerHTML=`
                <td>${t.rank}</td>
                <td>${t.user}</td>
                <td>${t.score}</td>
                <td>${t.system.gpu} / ${t.system.cpuCores} Cores</td>
                <td>${t.date}</td>
            `,o.appendChild(a)})}catch(e){console.error("Could not load leaderboard data:",e);const d=document.querySelector("#leaderboard-table tbody");if(d){const o=document.createElement("tr");o.innerHTML='<td colspan="5">Could not load leaderboard data. Please try again later.</td>',d.appendChild(o)}}}document.addEventListener("DOMContentLoaded",r);
