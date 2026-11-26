import{l as f,n as g,R as b,T as w,a as k,e as i,t as p,f as v,S,b as y}from"./index-Be1NVXtp.js";const e={wc:"All",role:"brawl",faction:"All",q:"",stable:!1};let s,r;async function L(o){if(s=o,r=await f(),!r.ctx||!r.builds){o.innerHTML=g();return}d()}function d(){const{db:o,builds:n}=r,a=e.role+(e.stable?S:""),m=o.mechs.filter(t=>!n.mechs[t.id]?.sameAs&&n.mechs[t.id]?.roles[a]?.[0]).filter(t=>(e.wc==="All"||t.weightClass===e.wc)&&(e.faction==="All"||t.faction===e.faction)).filter(t=>!e.q||`${t.label} ${t.variant}`.toLowerCase().includes(e.q.toLowerCase())).map(t=>({m:t,b:n.mechs[t.id],top:n.mechs[t.id].roles[a][0],t:n.mechs[t.id].tiers[a]})).sort((t,l)=>e.wc==="All"?(l.t?.rel??0)-(t.t?.rel??0):l.top.score-t.top.score).slice(0,150),h=(t,l,$={})=>`<span class="seg">${l.map(c=>`<button data-k="${t}" data-v="${c}" class="${e[t]===c?"on":""}">${$[c]??c}</button>`).join("")}</span>`;s.innerHTML=`<div class="page">
    <h1>Current meta</h1>
    <p class="sub">Every mech's best generated build, ranked against the rest of its weight class for the chosen engagement range.
      <span class="tier S">S</span> = top 6% (meta), <span class="tier A">A</span> = next 14%, <span class="tier B">B</span> = next 30%.
      Scores come from the game files on your disk, so they follow every balance patch after a rescan. Reskins with identical stats are folded into one row.</p>
    <div class="bar">
      ${h("role",y,b)}
      <button id="stable" class="${e.stable?"on":""}" title="Prefer builds whose cooling keeps up with their heat, so they can fire without pausing">Heat stable</button>
      ${h("wc",["All","Light","Medium","Heavy","Assault"])}
      ${h("faction",["All","InnerSphere","Clan"],{InnerSphere:"Inner Sphere"})}
      <input type="text" id="q" placeholder="Filter mechs…" value="${i(e.q)}" />
      
    </div>
    <p class="dim small"><b>${b[e.role]}</b> (${w.roleRange[e.role]} m): ${k[e.role]} Mechs that cannot fill the role are left out.${e.stable?" <b>Heat stable:</b> ranked by builds that can fire non-stop without building heat.":""}</p>
    <table><thead><tr><th>#</th><th>Tier</th><th>Mech</th><th>Class</th><th class="num">Tons</th><th>Best build</th><th class="num">Score</th><th class="num">vs class best</th><th class="num">vs stock</th></tr></thead>
    <tbody>${m.map((t,l)=>`<tr class="click" data-id="${t.m.id}">
      <td class="dim">${e.wc==="All"?l+1:t.t?.rank??""}</td>
      <td><span class="tier ${t.t?.tier??"C"}">${t.t?.tier??"–"}</span></td>
      <td><b>${i(p(t.m.chassisLabel))}</b> <span class="dim">${i(t.m.variant)}</span></td>
      <td class="dim">${t.m.weightClass} · ${t.m.faction==="Clan"?"Clan":"IS"}</td>
      <td class="num">${t.m.tons}</td>
      <td>${i(p(t.top.title))}</td>
      <td class="num"><b>${v(t.top.score,1)}</b></td>
      <td class="num">${t.t?Math.round(t.t.rel*100)+"%":""}</td>
      <td class="num ${t.b.stock?"good":"dim"}">${t.b.stock?.[a]?"+"+Math.round((t.top.score/t.b.stock[a]-1)*100)+"%":"–"}</td>
    </tr>`).join("")}</tbody></table></div>`,s.querySelector("#stable").addEventListener("click",()=>{e.stable=!e.stable,d()}),s.querySelectorAll("button[data-k]").forEach(t=>t.addEventListener("click",()=>{e[t.dataset.k]=t.dataset.v,d()}));const u=s.querySelector("#q");u.addEventListener("input",()=>{e.q=u.value,d();const t=s.querySelector("#q");t.focus(),t.setSelectionRange(t.value.length,t.value.length)}),s.querySelectorAll("tr.click").forEach(t=>t.addEventListener("click",()=>{location.hash=`#/mechs/${t.dataset.id}/${a}`}))}export{L as mount};
