import"./style-DvyL25kn.js";const s=!1;async function l(){try{const o=await fetch("http://localhost:3000/leaderboard");if(!o.ok)throw new Error(`HTTP error! status: ${o.status}`);const a=await o.json(),e=document.querySelector("#leaderboard-table tbody");if(!e)return;a.forEach(t=>{const d=document.createElement("tr"),r=t.gpu||"Unknown GPU",n=(t.cpuCores!=null?t.cpuCores:"?")+" Cores",c=typeof t.score=="number"?t.score:0;d.innerHTML=`
                <td>${t.rank}</td>
                <td>${t.name}</td>
                <td>${c}</td>
                <td>${r} / ${n}</td>
                <td>${t.date}</td>
            `,e.appendChild(d)})}catch(o){console.error("Could not load leaderboard data:",o);const a=document.querySelector("#leaderboard-table tbody");if(a){const e=document.createElement("tr");e.innerHTML='<td colspan="5">Could not load leaderboard data. Please try again later.</td>',a.appendChild(e)}}}document.addEventListener("DOMContentLoaded",l);
