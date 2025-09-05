// --- Simple helpers ---
function decimate(array, step) {
  if (!step || step <= 1) return array;
  const out = [];
  for (let i = 0; i < array.length; i += step) out.push(array[i]);
  return out;
}

function parseCsv(text) {
  return new Promise((resolve) => {
    Papa.parse(text, { header: true, dynamicTyping: false, complete: resolve });
  });
}

// --- Public: build a chart from a hosted CSV path ---
async function initCsvChart(opts) {
  const {
    csvPath, chartEl, title,
    xLabel = "Time", yLabel = "Particle Count (per 0.01 ft³)",
    scaleEl, decimateEl, smoothEl,
    seriesSearchEl, seriesPanelEl,
    dateStartEl, dateEndEl, quickFullEl, quick7dEl, quick3dEl, quick1dEl
  } = opts;

  const rawText = await fetch(csvPath).then(r => {
    if (!r.ok) throw new Error(`Failed to load CSV: ${csvPath}`);
    return r.text();
  });
  await buildFromText(rawText, {
    chartEl, title, xLabel, yLabel,
    scaleEl, decimateEl, smoothEl,
    seriesSearchEl, seriesPanelEl,
    dateStartEl, dateEndEl, quickFullEl, quick7dEl, quick3dEl, quick1dEl
  });
}

// --- Internal: render from CSV text (used by initCsvChart) ---
async function buildFromText(text, controls) {
  const {
    chartEl, title, xLabel, yLabel,
    scaleEl, decimateEl, smoothEl,
    seriesSearchEl, seriesPanelEl,
    dateStartEl, dateEndEl, quickFullEl, quick7dEl, quick3dEl, quick1dEl
  } = controls;

  const result = await parseCsv(text);
  const rows = result.data.filter(r => Object.values(r).some(v => v !== null && v !== ""));
  if (!rows.length) throw new Error("CSV appears empty.");

  const columns = Object.keys(rows[0]);
  const timeCol = columns[0];
  const seriesCols = columns.slice(1);

  // Parse X
  const x = rows.map(r => {
    const t = r[timeCol];
    const dt = new Date(t);
    return isNaN(dt.getTime()) ? t : dt;
  });

  // Build series checkbox panel
  const panel = document.getElementById(seriesPanelEl);
  panel.innerHTML = "";
  seriesCols.forEach((col, idx) => {
    const wrapper = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.value = col;
    cb.dataset.series = col;
    cb.id = `s_${idx}`;
    const span = document.createElement("span");
    span.textContent = col;
    wrapper.appendChild(cb);
    wrapper.appendChild(span);
    panel.appendChild(wrapper);
  });

  const chartNode = document.getElementById(chartEl);

  function getActiveSeries() {
    return [...panel.querySelectorAll("input[type=checkbox]")].filter(cb => cb.checked).map(cb => cb.value);
  }

  function filterByDate(xVals) {
    const startVal = document.getElementById(dateStartEl)?.value;
    const endVal = document.getElementById(dateEndEl)?.value;
    const hasStart = !!startVal, hasEnd = !!endVal;
    if (!hasStart && !hasEnd) return { x: xVals, mask: null };

    const s = hasStart ? new Date(startVal).getTime() : -Infinity;
    const e = hasEnd ? new Date(endVal).getTime() : +Infinity;

    const mask = xVals.map(v => {
      const t = (v instanceof Date) ? v.getTime() : new Date(v).getTime();
      return (t >= s && t <= e);
    });
    const xFiltered = xVals.filter((_, i) => mask[i]);
    return { x: xFiltered, mask };
  }

  function seriesData(activeCols, mask, step, smooth) {
    const traces = [];
    activeCols.forEach(col => {
      const y = rows.map(r => {
        const v = Number(String(r[col]).trim().replace(/,/g,""));
        return isNaN(v) ? null : v;
      });

      let xUse = x, yUse = y;
      if (mask) {
        xUse = x.filter((_, i) => mask[i]);
        yUse = y.filter((_, i) => mask[i]);
      }

      // Decimate
      xUse = decimate(xUse, step);
      yUse = decimate(yUse, step);

      // Smoothing (moving average)
      if (smooth && smooth > 1) {
        const smY = [];
        for (let i = 0; i < yUse.length; i++) {
          const a = Math.max(0, i - smooth + 1);
          let sum = 0, count = 0;
          for (let j = a; j <= i; j++) {
            const val = yUse[j];
            if (val != null) { sum += val; count++; }
          }
          smY.push(count ? sum / count : null);
        }
        yUse = smY;
      }

      traces.push({
        type: "scatter",
        mode: "lines",
        name: col,
        x: xUse,
        y: yUse,
        hovertemplate: `<b>${col}</b><br>%{x}<br>%{y}<extra></extra>`
      });
    });
    return traces;
  }

  function render() {
    const scale = document.getElementById(scaleEl)?.value || "linear";
    const step = Number(document.getElementById(decimateEl)?.value || "1");
    const smooth = Number(document.getElementById(smoothEl)?.value || "1");
    const { mask } = filterByDate(x);
    const active = getActiveSeries();
    const traces = seriesData(active, mask, step, smooth);

    const layout = {
      title: { text: title },
      xaxis: { title: xLabel, showspikes: true, spikemode: "across" },
      yaxis: { title: yLabel, type: scale },
      margin: { l: 64, r: 16, t: 52, b: 84 },
      legend: { orientation: "h", y: -0.25 }, // put legend below the chart
      height: 680
    };
    const config = { responsive: true, displaylogo: false, modeBarButtonsToAdd: ["toImage","select2d","lasso2d"] };

    Plotly.react(chartNode, traces, layout, config);
  }

  // Search keys
  const search = document.getElementById(seriesSearchEl);
  if (search) {
    search.addEventListener("input", () => {
      const q = search.value.toLowerCase();
      panel.querySelectorAll("label").forEach(lab => {
        const txt = lab.textContent.toLowerCase();
        lab.style.display = txt.includes(q) ? "" : "none";
      });
    });
  }

  // Quick range buttons
  function setRange(days) {
    const last = x[x.length - 1];
    const end = last instanceof Date ? last.getTime() : new Date(last).getTime();
    const start = days === "full"
      ? (x[0] instanceof Date ? x[0].getTime() : new Date(x[0]).getTime())
      : end - days*24*60*60*1000;

    const sEl = document.getElementById(dateStartEl);
    const eEl = document.getElementById(dateEndEl);
    if (sEl) sEl.value = new Date(start).toISOString().slice(0,16);
    if (eEl) eEl.value = new Date(end).toISOString().slice(0,16);
    render();
  }
  if (quickFullEl) document.getElementById(quickFullEl).onclick = () => setRange("full");
  if (quick7dEl) document.getElementById(quick7dEl).onclick = () => setRange(7);
  if (quick3dEl) document.getElementById(quick3dEl).onclick = () => setRange(3);
  if (quick1dEl) document.getElementById(quick1dEl).onclick = () => setRange(1);

  // Listen to inputs
  ["change","input"].forEach(evt => {
    [scaleEl, decimateEl, smoothEl, dateStartEl, dateEndEl].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, render);
    });
  });
  panel.addEventListener("change", render);

  // First draw
  render();
}
