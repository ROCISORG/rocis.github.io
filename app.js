const $ = (q)=>document.querySelector(q);
const $$ = (q)=>Array.from(document.querySelectorAll(q));

async function loadJSON(path){ const r = await fetch(path); if(!r.ok) throw new Error(path); return r.json(); }
function normalizeTime(t){
  if (t==null) return null;
  t = String(t).trim();
  if (!t) return null;
  if (t.includes(" ") && !t.includes("T")) t = t.replace(" ", "T"); // make ISO-like
  const d = new Date(t);
  return isNaN(d.getTime()) ? t : d;
}
function loadCSV(path){
  return new Promise((resolve, reject) => {
    Papa.parse(path, { header:true, dynamicTyping:false, download:true, skipEmptyLines:true,
      complete: res => resolve(res.data),
      error: err => reject(err)
    });
  });
}
function movingAverage(arr, window){
  if (!window || window<=1) return arr;
  const out = new Array(arr.length).fill(null);
  let sum=0, count=0, q=[];
  for(let i=0;i<arr.length;i++){
    const v = arr[i];
    if (v==null || isNaN(v)){ out[i]=null; continue; }
    q.push(v); sum+=v; count++;
    if (q.length>window){ sum-=q.shift(); count--; }
    out[i]= sum / count;
  }
  return out;
}
function decimate(x, y, step){
  if (!step || step<=1) return {x,y};
  const X=[], Y=[];
  for(let i=0;i<x.length;i+=step){ X.push(x[i]); Y.push(y[i]); }
  return {x:X,y:Y};
}
function fillSelect(sel, items, getLabel, getValue){
  sel.innerHTML = ""; 
  items.forEach(it=>{ const o=document.createElement('option'); o.value=getValue(it); o.textContent=getLabel(it); sel.appendChild(o); });
}

// high-contrast palette
const COLORWAY = [
  "#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd",
  "#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"
];

// ----- Cohort grids -----
async function renderCards(kind){
  const manPath = kind==="small" ? "Data/manifest_small.json" : "Data/manifest_large.json";
  const list = $("#cohortGrid");
  list.innerHTML = "";
  const man = await loadJSON(manPath);
  if (!man.datasets?.length){ list.innerHTML = `<p class="empty">No datasets in ${manPath}.</p>`; return; }
  man.datasets.forEach(d => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="card__title">
        <div><strong>${d.title}</strong><div class="card__meta">Cohort ${d.cohort ?? "?"}</div></div>
        <span class="badge">CSV</span>
      </div>
      <div class="card__actions">
        <a class="button" href="${d.path}" download>Download CSV</a>
        <a class="button primary" href="${kind}_viz.html?csv=${encodeURIComponent(d.path)}&title=${encodeURIComponent(d.title)}">Visualize</a>
      </div>
    `;
    list.appendChild(el);
  });
}

// ----- Visualizer -----
async function initVisualizer(kind){
  const params = new URLSearchParams(location.search);
  const csvPath = params.get("csv");
  const title = params.get("title") || (kind==="small"?"Small Dylos Data":"Large Dylos Data");
  $("#vizTitle").textContent = title;
  const csvSel = $("#csvSelect");
  const manPath = kind==="small" ? "Data/manifest_small.json" : "Data/manifest_large.json";
  const man = await loadJSON(manPath);
  fillSelect(csvSel, man.datasets, d => d.title, d => d.path);
  if (csvPath) csvSel.value = csvPath;

  const previewTable = $("#previewTable tbody");
  const dlBtn = $("#downloadBtn");
  const colSel = $("#colSelect");
  const scaleSel = $("#scale");
  const maSel = $("#ma");
  const decSel = $("#decimate");
  const startEl = $("#start");
  const endEl = $("#end");

  function toNum(v){
    if (v==null) return null;
    v = String(v).trim().replace(/,/g,"");
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  async function loadAndRender(){
    const rows = await loadCSV(csvSel.value);
    if (!rows.length) return;
    const columns = Object.keys(rows[0]);
    const timeKey = columns[0];
    const seriesKeys = columns.slice(1);
    colSel.innerHTML = "";
    seriesKeys.forEach(k => {
      const o=document.createElement("option");
      o.value=k; o.textContent=k;
      colSel.appendChild(o);
    });
    for (let i=0; i<Math.min(3, seriesKeys.length); i++){ colSel.options[i].selected = true; }

    // preview: first 8 rows
    previewTable.innerHTML = "";
    rows.slice(0,8).forEach(r => {
      const tr=document.createElement("tr");
      columns.forEach(c=>{
        const td=document.createElement("td");
        td.textContent = r[c];
        tr.appendChild(td);
      });
      previewTable.appendChild(tr);
    });
    dlBtn.href = csvSel.value;

    draw(rows, timeKey);
  }

  function draw(rows, timeKey){
    const selected = Array.from(colSel.selectedOptions).map(o=>o.value);
    if (!selected.length) return;

    const t = rows.map(r => normalizeTime(r[timeKey]));
    // date filter
    let mask = t.map(_=>true);
    if (startEl.value){ const s=new Date(startEl.value).getTime(); mask = mask.map((_,i)=> (t[i] instanceof Date ? t[i].getTime()>=s : true)); }
    if (endEl.value){ const e=new Date(endEl.value).getTime(); mask = mask.map((ok,i)=> ok && (t[i] instanceof Date ? t[i].getTime()<=e : true)); }

    const traces = selected.map((k, idx) => {
      const y = rows.map(r => toNum(r[k]));
      const xMasked=[], yMasked=[];
      for(let i=0;i<t.length;i++){ if (mask[i]){ xMasked.push(t[i]); yMasked.push(y[i]); } }
      const window = Number(maSel.value || "1");
      const yMA = movingAverage(yMasked, window);
      const step = Number(decSel.value || "1");
      const {x, y: yDec} = decimate(xMasked, yMA, step);
      return {
        type:"scatter", mode:"lines",
        name:k, x, y: yDec, connectgaps:false,
        line:{width:2.4},
        hovertemplate:`<b>${k}</b><br>%{x}<br>%{y}<extra></extra>`
      };
    });

    const layout = {
      title: $("#vizTitle").textContent,
      colorway: COLORWAY,
      hovermode: "x unified",
      legend: { orientation:"h", y:-0.2, bgcolor:"rgba(0,0,0,0)" },
      xaxis: {
        title: timeKey,
        showspikes: true, spikemode: "across",
        gridcolor: "rgba(255,255,255,0.06)",
        zerolinecolor: "rgba(255,255,255,0.12)"
      },
      yaxis: {
        title: "Counts",
        type: (document.getElementById("scale").value || "linear"),
        gridcolor: "rgba(255,255,255,0.06)",
        zerolinecolor: "rgba(255,255,255,0.12)"
      },
      margin: { t: 64, r: 24, b: 96, l: 72 },
      plot_bgcolor: "rgba(12,18,24,1)",
      paper_bgcolor: "rgba(12,18,24,0)"
    };

    Plotly.newPlot("chart", traces, layout, {
      responsive:true,
      displaylogo:false,
      modeBarButtonsToRemove:["toggleSpikelines","lasso2d","select2d"],
      scrollZoom:true
    });
  }

  $("#qfull").onclick = ()=>{ startEl.value=""; endEl.value=""; loadAndRender(); };
  $("#q7d").onclick = ()=>{ setQuick(-7); };
  $("#q3d").onclick = ()=>{ setQuick(-3); };
  $("#q1d").onclick = ()=>{ setQuick(-1); };
  function setQuick(days){
    const end = new Date();
    const start = new Date(end.getTime() + days*24*60*60*1000);
    startEl.value = start.toISOString().slice(0,16);
    endEl.value = end.toISOString().slice(0,16);
    loadAndRender();
  }

  ["change","input"].forEach(evt => {
    [csvSel, colSel, scaleSel, maSel, decSel, startEl, endEl].forEach(id => id.addEventListener(evt, ()=>loadAndRender()));
  });

  loadAndRender();
}

window.ROGIS = { renderCards, initVisualizer };
