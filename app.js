// ========== helpers ==========
const COLORWAY = [
  "#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd",
  "#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"
];
const $ = (q)=>document.querySelector(q);

async function loadJSON(path){
  const r = await fetch(path);
  if(!r.ok) throw new Error(`Failed to load ${path}`);
  return r.json();
}
function loadCSV(path){
  return new Promise((resolve, reject) => {
    Papa.parse(path, {
      header:true, download:true, dynamicTyping:false, skipEmptyLines:true,
      complete: res => resolve(res.data),
      error: err => reject(err)
    });
  });
}
function normalizeTime(v){
  if (v==null) return null;
  let t = String(v).trim();
  if (!t) return null;
  if (t.includes(" ") && !t.includes("T")) t = t.replace(" ", "T");
  const d = new Date(t);
  return isNaN(d.getTime()) ? t : d;
}
function toNum(v){
  if (v==null) return null;
  const n = Number(String(v).replace(/,/g,"").trim());
  return isNaN(n) ? null : n;
}

// ========== cohort grids ==========
async function renderCards(kind){
  const manPath = kind === "small" ? "Data/manifest_small.json" : "Data/manifest_large.json";
  const grid = document.getElementById("cohortGrid");
  grid.innerHTML = "";
  const man = await loadJSON(manPath);
  if (!man.datasets?.length){
    grid.innerHTML = `<p style="color:#666">No datasets in ${manPath}</p>`;
    return;
  }
  man.datasets.forEach(d => {
    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `
      <h3 class="card__title">${d.title} <span class="badge">CSV</span></h3>
      <p>
        <a class="button" href="${d.path}" download>Download CSV</a>
        <a class="button primary" href="${kind}_viz.html?csv=${encodeURIComponent(d.path)}&title=${encodeURIComponent(d.title)}">Visualize</a>
      </p>
    `;
    grid.appendChild(el);
  });
}

// ========== visualizer ==========
async function initVisualizer(kind){
  const params = new URLSearchParams(location.search);
  const csvParam = params.get("csv");
  const titleParam = params.get("title");
  const titleEl = document.getElementById("vizTitle");
  const csvSel = document.getElementById("csvSelect");
  const scaleSel = document.getElementById("scale");
  const dlBtn = document.getElementById("downloadBtn");

  const manPath = kind === "small" ? "Data/manifest_small.json" : "Data/manifest_large.json";
  const man = await loadJSON(manPath);

  // fill select
  csvSel.innerHTML = "";
  man.datasets.forEach(d => {
    const o = document.createElement("option");
    o.value = d.path;
    o.textContent = d.title;
    csvSel.appendChild(o);
  });

  // choose dataset: URL param or first
  if (csvParam) csvSel.value = csvParam;
  if (!csvSel.value && man.datasets.length) csvSel.value = man.datasets[0].path;

  // set title
  titleEl.textContent = titleParam || (man.datasets.find(x => x.path === csvSel.value)?.title || "ROCIS Low Cost Monitoring Project");

  // update download link
  dlBtn.href = csvSel.value;

  async function draw(){
    if (!csvSel.value) return;
    dlBtn.href = csvSel.value;

    const rows = await loadCSV(csvSel.value);
    if (!rows.length) return;

    const cols = Object.keys(rows[0]);
    const timeKey = cols[0];
    const seriesKeys = cols.slice(1);

    const t = rows.map(r => normalizeTime(r[timeKey]));
    const traces = seriesKeys.map((k) => ({
      type: "scatter",
      mode: "lines",
      name: k,
      x: t,
      y: rows.map(r => toNum(r[k])),
      connectgaps: false,
      line: { width: 2 }
    }));

    const layout = {
      title: titleEl.textContent,
      colorway: COLORWAY,
      hovermode: "x unified",
      legend: { orientation: "v", x: 1.02, y: 1, bgcolor: "#fff" },
      xaxis: { title: "Time" },
      yaxis: { title: "Particle Count", type: scaleSel.value || "linear" },
      margin: { t: 60, r: 220, b: 60, l: 70 },
      paper_bgcolor: "#fff",
      plot_bgcolor: "#fff",
      height: 600
    };

    Plotly.newPlot("chart", traces, layout, {
      responsive: true,
      displaylogo: false,
      scrollZoom: true
    });
  }

  // events
  csvSel.addEventListener("change", async () => {
    titleEl.textContent = man.datasets.find(x => x.path === csvSel.value)?.title || titleEl.textContent;
    await draw();
  });
  scaleSel.addEventListener("change", draw);

  // initial draw
  await draw();
}

// expose
window.ROGIS = { renderCards, initVisualizer };
