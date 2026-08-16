/* Observatorio de Salud de Castilla y León
   - Carga los ficheros JSON generados por scripts/fetch_data.py
   - Renderiza mapa Leaflet (ZBS + centros) y gráficos ECharts */

"use strict";

const DATA = "data/";
const fmt = (n) => n == null ? "–" : Number(n).toLocaleString("es-ES");
const fmt1 = (n) => (n == null ? "–" : Number(n).toLocaleString("es-ES", { maximumFractionDigits: 1 }));
const fmtE = (n) => (n == null ? "–" : "€ " + Number(n).toLocaleString("es-ES", { maximumFractionDigits: 0 }));
const fmtM = (n) => (n == null ? "–" : "€ " + (Number(n) / 1e6).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " M");

function mesLabel(iso) {
  const m = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const d = new Date(iso + "T00:00:00");
  return m[d.getMonth()] + " " + String(d.getFullYear()).slice(2);
}

const files = [
  "zbs_map", "poblacion_zbs", "poblacion_prov", "poblacion_edad",
  "mortalidad_prov", "mortalidad_centro", "mortalidad_ts",
  "urgencias_prov", "urgencias_hospital", "urgencias_triaje", "urgencias_edad",
  "urgencias_mes", "urgencias_hospital_mes", "centros_salud",
  "prevalencia", "municipios", "gasto_sanidad", "personal_sanitario",
];

function loadAll() {
  const ts = Date.now();
  return Promise.all(files.map((f) => fetch(DATA + f + ".json?v=" + ts).then((r) => r.json()).then((d) => [f, d])))
    .then((pairs) => Object.fromEntries(pairs));
}

const triajeEtiqueta = {
  "1": "Nivel 1 · Resucitación",
  "2": "Nivel 2 · Emergencia",
  "3": "Nivel 3 · Urgencia",
  "4": "Nivel 4 · Menos urgente",
  "5": "Nivel 5 · No urgente",
  "Desconocido": "Sin clasificar",
};

const prevEtiquetas = {
  hta: "Hipertensión arterial",
  diabetes: "Diabetes tipo 2",
  dislipemia: "Dislipemia",
  insuficiencia_cardiaca: "Insuficiencia cardiaca",
  epoc: "EPOC",
  cronicos: "Pacientes crónicos complejos",
};

function groupBins(list, field, bin = 5, max = 100) {
  const out = [];
  for (let i = 0; i <= max; i += bin) {
    const lo = i, hi = Math.min(i + bin - 1, max);
    const rows = list.filter((r) => r[field] >= lo && r[field] <= hi);
    const n = rows.reduce((s, r) => s + (+r.n || 0), 0);
    if (rows.length) out.push({ label: lo === hi ? String(lo) : lo + "–" + hi, n });
  }
  return out;
}

function coloresBuckets(valor, minimo) {
  const rampa = ["#eef4ee", "#cfe5d3", "#a3d1ab", "#5fae73", "#1f8a4c", "#0b5e33"];
  const idx = valor === null ? 0 : Math.min(rampa.length - 1, Math.max(0, Math.floor(((valor - minimo[0]) / (minimo[1] - minimo[0] || 1)) * (rampa.length - 1))));
  return rampa[idx];
}

function init() {
  const loading = document.getElementById("loading");
  loadAll()
    .then((D) => {
      buildKPIs(D);
      buildProvTable(D);
      initMap(D);
      initCharts(D);
      buildAnalisis(D);
      buildDataSourceList();
      loading.style.display = "none";
    })
    .catch((e) => {
      loading.innerHTML = "<div style='color:#c0392b;text-align:center;padding:30px'>Error al cargar los datos: " + e.message + "<br><br>Ejecuta antes <code>python scripts/fetch_data.py</code> o sirve la carpeta con un servidor local.</div>";
    });
}

function buildKPIs(D) {
  const poblacion = D.poblacion_prov.reduce((s, r) => s + (+r.n || 0), 0);
  const poblacionReal = (D.municipios || []).reduce((s, r) => s + (+r.poblacion || 0), 0) || poblacion;
  const urgencias = D.urgencias_mes.reduce((s, r) => s + (+r.n || 0), 0);
  const fallecidos = D.mortalidad_prov.reduce((s, r) => s + (+r.fallecidos || 0), 0);
  const centros = D.centros_salud.length;
  const tasas = D.mortalidad_prov.map((r) => +r.tasa);
  const tasaMedia = (tasas.reduce((a, b) => a + b, 0) / tasas.length) * 1000;
  const gasto = D.gasto_sanidad || [];
  const gastoAnio = gasto.length ? gasto[gasto.length - 1] : null;
  const eurHab = gastoAnio ? gastoAnio.importe / poblacionReal : null;

  const items = [
    ["Población de referencia 2026", fmt(poblacion), "tarjetas sanitarias en el fichero", "brand"],
    ["Urgencias atendidas 2024/25", fmt(urgencias), "episodios hospitalarios", "brand"],
    ["Fallecimientos 2022–2026 (reg. publicado)", fmt(fallecidos), "serie mensual enero 2022 → agosto 2026", "accent"],
    ["Gasto sanitario por habitante", eurHab != null ? fmtE(eurHab) + " €/hab" : "—", gastoAnio ? "gasto ejecutado " + gastoAnio.anio + " por habitante (padrón)" : "gasto sanitario programado", "brand"],
    ["Personal sanitario (instituciones)", D.personal_sanitario ? fmt(D.personal_sanitario.efectivos) : "—", D.personal_sanitario ? "efectivos en instituciones sanitarias " + D.personal_sanitario.fecha.slice(0, 4) : "", "accent"],
  ];
  document.getElementById("kpis").innerHTML = items.map(([l, v, s, clase]) =>
    `<div class="kpi"><div class="label">${l}</div><div class="value ${clase}">${v}</div><div class="sub">${s}</div></div>`).join("");
}

function buildProvTable(D) {
  const canonical = ["Ávila", "Burgos", "León", "Palencia", "Salamanca", "Segovia", "Soria", "Valladolid", "Zamora"];
  const normProv = (n) => canonical.find((c) => c.toUpperCase() === String(n || "").toUpperCase()) || String(n || "").toUpperCase();
  const padron = {};
  (D.municipios || []).forEach((m) => {
    const p = normProv(m.provincia);
    padron[p] = (padron[p] || 0) + (+m.poblacion || 0);
  });
  const pu = Object.fromEntries(D.urgencias_prov.map((r) => [normProv(r.provincia), +r.n || 0]));
  const pm = Object.fromEntries(D.mortalidad_prov.map((r) => [normProv(r.provincia), +r.fallecidos || 0]));
  const provs = canonical.filter((p) => padron[p]).sort((a, b) => (padron[b] || 0) - (padron[a] || 0));
  const rows = provs.map((p) =>
    `<tr data-prov="${p}">
       <td>${p}</td>
       <td class="num">${fmt(padron[p])}</td>
       <td class="num">${fmt(pu[p])}</td>
       <td class="num">${fmt(pm[p])}</td>
     </tr>`).join("");
  document.getElementById("tabla-prov").innerHTML =
    `<thead><tr><th>Provincia</th><th class="num">Población (padrón)</th><th class="num">Urgencias</th><th class="num">Fallecimientos</th></tr></thead><tbody>${rows}</tbody>`;
  document.querySelectorAll("#tabla-prov tr[data-prov]").forEach((tr) => {
    tr.addEventListener("click", () => {
      document.querySelectorAll("#tabla-prov tr[data-prov]").forEach((t) => t.classList.remove("prov-selected"));
      tr.classList.add("prov-selected");
      filtrarProvincia(tr.dataset.prov);
    });
  });
}

/* ------------------------- Mapa ------------------------- */
let map, zbsLayer, csLayer, indicadorActual = "poblacion", provActual = null;
let valorPorCodigo = {};

function initMap(D) {
  map = L.map("map", { zoomControl: false }).setView([41.63, -4.7], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 18,
  }).addTo(map);

  const provs = [...new Set(D.zbs_map.features.map((f) => f.properties.provincia || ""))].filter(Boolean).sort();
  const selProv = document.getElementById("prov-filtro");
  selProv.innerHTML = '<option value="">Todas</option>' + provs.map((p) => `<option>${p}</option>`).join("");
  selProv.addEventListener("change", () => filtrarProvincia(selProv.value));
  document.getElementById("btn-reset").addEventListener("click", () => {
    selProv.value = "";
    filtrarProvincia("");
  });

  zbsLayer = L.geoJSON(null, {
    style: () => ({ color: "#666", weight: 0.6, fillOpacity: 0.75 }),
    onEachFeature: (feat, layer) => {
      layer.on("click", () => mostrarZona(feat.properties, D));
      layer.on("mouseover", (e) => {
        e.target.setStyle({ weight: 2, color: "#111" });
        e.target.bringToFront();
      });
      layer.on("mouseout", (e) => e.target.setStyle({ weight: 0.6, color: "#666" }));
    },
  }).addTo(map);
  zbsLayer.addData(D.zbs_map);

  csLayer = L.layerGroup().addTo(map);
  D.mortalidad_centro.forEach((c) => {
    if (!c.lat || !c.lon) return;
    const r = Math.max(4, Math.min(14, Math.sqrt(+c.fallecidos || 1) * 1.4));
    L.circleMarker([c.lat, c.lon], {
      radius: r, color: "#08306b", weight: 1, fillColor: "#08519c", fillOpacity: 0.75,
    }).bindTooltip(c.centro + " · " + fmt(c.fallecidos) + " fallecimientos").addTo(csLayer);
  });

  indicadorActual = document.getElementById("ind-chooser").value;
  document.getElementById("ind-chooser").addEventListener("change", (e) => {
    indicadorActual = e.target.value;
    colorearZonas(D);
  });
  colorearZonas(D);
}

function veccompute(D) {
  const porProv = {};
  ["poblacion", "urgencias", "mortalidad"].forEach((k) => (porProv[k] = {}));

  D.poblacion_prov.forEach((r) => (porProv.poblacion[r.provincia] = +r.n || 0));
  D.urgencias_prov.forEach((r) => (porProv.urgencias[r.provincia] = +r.n || 0));
  D.mortalidad_prov.forEach((r) => (porProv.mortalidad[r.provincia] = +r.fallecidos || 0));

  const porZbs = Object.fromEntries(D.poblacion_zbs.map((r) => [String(r.zbs_code), +r.n || 0]));

  const valueBy = {};
  D.zbs_map.features.forEach((f) => {
    const p = f.properties;
    const cod = String(p.codigo_zona);
    if (indicadorActual === "poblacion") valueBy[cod] = porZbs[cod] != null ? porZbs[cod] : null;
    else valueBy[cod] = porProv[indicadorActual][p.provincia] != null ? porProv[indicadorActual][p.provincia] : null;
  });
  return valueBy;
}

function colorearZonas(D) {
  valorPorCodigo = veccompute(D);
  const vals = Object.values(valorPorCodigo).filter((v) => v != null);
  const minimo = [Math.min(...vals), Math.max(...vals)];

  zbsLayer.eachLayer((l) => {
    const f = l.feature;
    const v = valorPorCodigo[String(f.properties.codigo_zona)];
    const oculto = provActual && f.properties.provincia !== provActual;
    l.setStyle({ fillColor: oculto ? "#eef4ee" : coloresBuckets(v, minimo), fillOpacity: oculto ? 0.25 : 0.75, opacity: oculto ? 0 : 0.6 });
  });

  const names = { poblacion: "Población de referencia", urgencias: "Urgencias 2024/25", mortalidad: "Fallecimientos" };
  document.getElementById("legend").innerHTML =
    `<b>${names[indicadorActual]}</b><div class="scale">
      <span>${fmt1(minimo[0])} ─ ${fmt1(minimo[0] + (minimo[1]-minimo[0]) * 0.2)}</span>
      <i style="background:#cfe5d3"></i><i style="background:#a3d1ab"></i><i style="background:#5fae73"></i><i style="background:#1f8a4c"></i><i style="background:#0b5e33"></i>
      <span>${fmt1(minimo[0] + (minimo[1]-minimo[0]) * 0.8)} ─ ${fmt1(minimo[1])}</span></div>`;
}

function filtrarProvincia(prov) {
  provActual = prov || null;
  document.getElementById("ind-chooser").dispatchEvent(new Event("change"));
  if (prov) {
    const feats = zbsLayer.getLayers().map((l) => l.feature).filter((f) => f.properties.provincia === prov);
    const latlngs = feats.flatMap((f) => f.geometry.coordinates);
    const all = [];
    (function walk(c) { if (typeof c[0] === "number") all.push([c[1], c[0]]); else c.forEach(walk); })(latlngs);
    if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.08));
  } else {
    map.setView([41.63, -4.7], 7);
  }
}

function mostrarZona(props, D) {
  const pz = Object.fromEntries(D.poblacion_prov.map((r) => [r.provincia, +r.n || 0]));
  const pu = Object.fromEntries(D.urgencias_prov.map((r) => [r.provincia, +r.n || 0]));
  const pm = Object.fromEntries(D.mortalidad_prov.map((r) => [r.provincia, +r.fallecidos || 0]));
  const poblacion_zbs = Object.fromEntries(D.poblacion_zbs.map((r) => [String(r.zbs_code), +r.n || 0]));

  const cod = String(props.codigo_zona);
  const panel = document.getElementById("info-panel");
  panel.innerHTML = `
    <div class="title">${props.d_zbs} <span style="color:var(--muted);font-weight:400">· ${props.provincia}</span></div>
    <table>
      <tr><td>Población de referencia (zona)</td><td>${fmt(poblacion_zbs[cod])}</td></tr>
      <tr><td>Población de referencia (provincia)</td><td>${fmt(pz[props.provincia])}</td></tr>
      <tr><td>Urgencias 2024/25 (provincia)</td><td>${fmt(pu[props.provincia])}</td></tr>
      <tr><td>Fallecimientos (provincia)</td><td>${fmt(pm[props.provincia])}</td></tr>
      <tr><td>Municipios en la zona</td><td>${fmt(props.num_mun)}</td></tr>
    </table>`;
  document.getElementById("map-note").innerHTML =
    `Zona Básica de Salud con código ${cod}. Los indicadores provinciales se muestran para situar la zona en contexto.`;
}

/* ------------------------- Gráficos ------------------------- */
const charts = {};
function mk(id, opt) {
  const el = document.getElementById(id);
  const c = echarts.init(el);
  charts[id] = c;
  c.setOption(opt);
}

function initCharts(D) {
  /* Urgencias por mes */
  mk("ch-urgencias-mes", {
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v) },
    grid: { left: 44, right: 12, top: 20, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: D.urgencias_mes.map((r) => mesLabel(r.mes)), axisLabel: { rotate: 45, hideOverlap: true } },
    yAxis: { type: "value", axisLabel: { formatter: (v) => fmt(v) } },
    series: [{ type: "bar", data: D.urgencias_mes.map((r) => +r.n), itemStyle: { color: "#00843d" }, showBackground: true, label: { show: true, position: "top", formatter: (p) => fmt(p.value), fontSize: 9 } }],
  });

  /* Urgencias por hospital */
  const hosp = D.urgencias_hospital.slice().sort((a, b) => b.n - a.n).slice(0, 14);
  mk("ch-urgencias-hospital", {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => fmt(v) },
    grid: { left: 130, right: 90, top: 8, bottom: 20, containLabel: true },
    xAxis: { type: "value", axisLabel: { formatter: (v) => fmt(v) } },
    yAxis: { type: "category", data: hosp.map((h) => h.hospital).reverse(), axisLabel: { width: 125, overflow: "truncate" } },
    series: [{ type: "bar", barMaxWidth: 22, data: hosp.map((h) => +h.n).reverse(), itemStyle: { color: "#1f8a4c" }, label: { show: true, position: "right", formatter: (p) => fmt(p.value), fontSize: 9 } }],
  });

  /* Mortalidad mensual */
  mk("ch-mortalidad", {
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v) },
    grid: { left: 40, right: 12, top: 20, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: D.mortalidad_ts.map((r) => mesLabel(r.mes)), axisLabel: { rotate: 45, hideOverlap: true } },
    yAxis: { type: "value", axisLabel: { formatter: (v) => fmt(v) } },
    series: [{ type: "line", smooth: true, data: D.mortalidad_ts.map((r) => +r.fallecidos), areaStyle: { opacity: .25 }, itemStyle: { color: "#e30613" } }],
  });

  /* Edad urgencias (bins 5) */
  const binsU = groupBins(D.urgencias_edad, "edad", 5, 95);
  mk("ch-urgencias-edad", {
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v) },
    grid: { left: 40, right: 12, top: 20, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: binsU.map((b) => b.label), axisLabel: { rotate: 45, hideOverlap: true } },
    yAxis: { type: "value", axisLabel: { formatter: (v) => fmt(v) } },
    series: [{ type: "line", smooth: true, data: binsU.map((b) => b.n), itemStyle: { color: "#08519c" }, areaStyle: { opacity: .12 } }],
  });

  /* Triaje */
  const triaje = D.urgencias_triaje.filter((r) => triajeEtiqueta[r.nivel_de_triaje]);
  mk("ch-triaje", {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { orient: "vertical", left: "left", top: "middle", type: "scroll" },
    series: [{
      type: "pie", radius: ["38%", "72%"], center: ["58%", "50%"], avoidLabelOverlap: true,
      label: { formatter: "{d}%", fontSize: 11 },
      data: triaje.map((r) => ({ name: triajeEtiqueta[r.nivel_de_triaje], value: +r.n })),
    }],
  });

  /* Pirámide */
  const binsP = groupBins(D.poblacion_edad, "edad", 5, 95);
  const h = { hombres: [], mujeres: [] };
  binsP.forEach((b) => {
    const hombres = D.poblacion_edad.filter((r) => r.sexo === "Hombre" && r.edad >= parseInt(b.label) && r.edad <= (parseInt(b.label.split("–")[1]) || parseInt(b.label)));
    const mujeres = D.poblacion_edad.filter((r) => r.sexo === "Mujer" && r.edad >= parseInt(b.label) && r.edad <= (parseInt(b.label.split("–")[1]) || parseInt(b.label)));
    h.hombres.push(-hombres.reduce((s, r) => s + +r.n, 0));
    h.mujeres.push(mujeres.reduce((s, r) => s + +r.n, 0));
  });
  mk("ch-piramide", {
    tooltip: { trigger: "axis", formatter: (p) => p[0].axisValue + "<br>" + p.map((x) => x.marker + " " + x.seriesName + ": " + fmt(Math.abs(x.data))).join("<br>") },
    grid: { left: 50, right: 12, top: 20, bottom: 26, containLabel: true },
    xAxis: { type: "value", axisLabel: { formatter: (v) => fmt(Math.abs(v)) } },
    yAxis: { type: "category", data: binsP.map((b) => b.label), axisLabel: { fontSize: 10 } },
    series: [
      { name: "Hombres", type: "bar", stack: "p", data: h.hombres, itemStyle: { color: "#1f8a4c" } },
      { name: "Mujeres", type: "bar", stack: "p", data: h.mujeres, itemStyle: { color: "#e30613" } },
    ],
  });

  /* Prevalencias */
  const provs = D.poblacion_prov.map((r) => r.provincia).sort();
  const series = Object.entries(prevEtiquetas).map(([key, label]) => ({
    name: label,
    type: "bar",
    data: provs.map((p) => {
      const row = D.prevalencia[key].find((r) => r.provincia === p);
      return row && row.n != null ? +row.n : 0;
    }),
  }));
  mk("ch-prevalencia", {
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v) },
    legend: { type: "scroll", bottom: 0, fontSize: 10 },
    grid: { left: 40, right: 12, top: 30, bottom: 60, containLabel: true },
    xAxis: { type: "category", data: provs, axisLabel: { rotate: 45, interval: 0, fontSize: 10 } },
    yAxis: { type: "value", axisLabel: { formatter: (v) => fmt(v) } },
    series,
  });

  /* Gasto sanitario ejecutado por año */
  const gasto = (D.gasto_sanidad || []).filter((g) => +g.anio <= 2024);
  if (gasto.length) {
    mk("ch-gasto-sanidad", {
      tooltip: { trigger: "axis", valueFormatter: (v) => fmtM(v) },
      grid: { left: 60, right: 20, top: 16, bottom: 26, containLabel: true },
      xAxis: { type: "category", data: gasto.map((g) => g.anio) },
      yAxis: { type: "value", axisLabel: { formatter: (v) => fmtM(v) } },
      series: [{ type: "bar", data: gasto.map((g) => g.importe), itemStyle: { color: "#00843d" }, label: { show: true, position: "top", formatter: (p) => fmtM(p.value), fontSize: 9 } }],
    });
  } else {
    const el = document.getElementById("ch-gasto-sanidad");
    if (el) el.innerHTML = "<p style='color:var(--muted)'>Sin datos de gasto sanitario.</p>";
  }

  /* Personal sanitario: efectivo en instituciones (serie simple) */
  const pers = D.personal_sanitario;
  const elPers = document.getElementById("ch-personal");
  if (pers && pers.efectivos && elPers) {
    elPers.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:4px">
        <div style="font-size:2.4rem;font-weight:700;color:#00843d">${fmt(pers.efectivos)}</div>
        <div style="font-size:.85rem;color:var(--muted)">efectivos en instituciones sanitarias · ${pers.fecha.slice(0, 10)}</div>
      </div>`;
  } else if (elPers) {
    elPers.innerHTML = "<p style='color:var(--muted)'>Sin datos de personal sanitario.</p>";
  }

  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
}

function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

/* ---------- Análisis: conclusiones y decisiones ---------- */
function buildAnalisis(D) {
  // Población municipal real por provincia (padrón registrado en municipios.json)
  const popProv = {};
  D.municipios.forEach((m) => {
    const p = titleCase(m.provincia);
    popProv[p] = (popProv[p] || 0) + (+m.poblacion || 0);
  });
  const provincias = Object.keys(popProv);
  const pobTotal = provincias.reduce((s, p) => s + popProv[p], 0);

  const urgByProv = {}, mortByProv = {}, centrosByProv = {};
  D.urgencias_prov.forEach((r) => (urgByProv[r.provincia] = +r.n || 0));
  D.mortalidad_prov.forEach((r) => (mortByProv[r.provincia] = +r.fallecidos || 0));
  D.mortalidad_centro.forEach((c) => {
    const p = titleCase(c.provincia);
    centrosByProv[p] = (centrosByProv[p] || 0) + 1;
  });

  const rows = provincias
    .map((p) => {
      const pob = popProv[p];
      const urg = urgByProv[p] || 0, mort = mortByProv[p] || 0, cs = centrosByProv[p] || 0;
      return {
        prov: p, pob, urg, mort, cs,
        urgr: pob ? (urg * 1000) / pob : 0,
        mortr: pob ? (mort * 1000) / pob : 0,
        csr: pob ? (cs * 100000) / pob : 0,
      };
    })
    .sort((a, b) => b.urgr - a.urgr);

  const mediaMort = rows.reduce((s, r) => s + r.mortr, 0) / rows.length;
  const maxUrg = rows[0];
  const maxMort = rows.slice().sort((a, b) => b.mortr - a.mortr)[0];
  const minCs = rows.slice().sort((a, b) => a.csr - b.csr)[0];

  // Picos estacionales
  const maxUMes = D.urgencias_mes.reduce((a, b) => (+b.n > +a.n ? b : a), D.urgencias_mes[0]);
  const maxMMes = D.mortalidad_ts.slice().sort((a, b) => b.fallecidos - a.fallecidos)[0];
  const topZbsMort = D.mortalidad_centro.slice().sort((a, b) => b.fallecidos - a.fallecidos)[0];

  // Prevalencia: peor provincia × patología por 100.000 hab
  let peorPrev = null;
  Object.entries(D.prevalencia).forEach(([key, list]) => {
    list.forEach((r) => {
      const p = r.provincia, pob = popProv[p] || 1;
      const rate = ((+r.n || 0) * 100000) / pob;
      if (!peorPrev || rate > peorPrev.rate) peorPrev = { key, provincia: p, rate, n: +r.n || 0 };
    });
  });

  const cards = [
    {
      t: "Urgencias por habitante",
      b: `${maxUrg.prov} registra la mayor presión de urgencias: ${fmt1(maxUrg.urgr)} por 1.000 habitantes (${fmt(maxUrg.urg)} episodios).`,
      p: `Media regional: ${fmt1(rows.reduce((s, r) => s + r.urgr, 0) / rows.length)} por 1.000 hab.`,
    },
    {
      t: "Mortalidad por habitante",
      b: `${maxMort.prov} tiene la mortalidad más alta: ${fmt1(maxMort.mortr)} fallecidos por 1.000 habitantes, un ${fmt1(((maxMort.mortr / mediaMort) - 1) * 100)} % por encima de la media regional (${fmt1(mediaMort)}).`,
      p: "Fallecidos consolidados por centro de salud (2021→2026).",
    },
    {
      t: "Cobertura asistencial",
      b: `${minCs.prov} tiene la peor cobertura de centros: ${fmt1(minCs.csr)} centros por 100.000 habitantes (${fmt(minCs.cs)} centros).`,
      p: `Media regional: ${fmt1(rows.reduce((s, r) => s + r.csr, 0) / rows.length)} por 100.000 hab.`,
    },
    {
      t: "Estacionalidad",
      b: `El pico de urgencias de la campaña fue en ${mesLabel(maxUMes.mes)} (${fmt(maxUMes.n)} episodios) y el de fallecimientos en ${mesLabel(maxMMes.mes)} (${fmt(maxMMes.fallecidos)}).`,
      p: "Fuente: serie mensual del registro de urgencias hospitalarias y de fallecimientos.",
    },
    {
      t: "Zona con más fallecimientos",
      b: `${topZbsMort.centro} (${topZbsMort.provincia}) acumula ${fmt(topZbsMort.fallecidos)} fallecimientos en el periodo registrado.`,
      p: "Fuente: registro de tasas de mortalidad por centro de salud.",
    },
    {
      t: "Prevalencia crónica",
      b: `La mayor carga relativa es ${prevEtiquetas[peorPrev.key] || peorPrev.key} en ${peorPrev.provincia}: ${fmt1(peorPrev.rate)} pacientes por 100.000 hab.`,
      p: "Población municipal del Registro de Municipios; pacientes activos registrados, no tasas de prevalencia estandarizadas.",
    },
  ];
  document.getElementById("concl-salud").innerHTML = cards
    .map((c) => `<div class="concl-card"><div class="concl-t">${c.t}</div><div class="concl-b">${c.b}</div><div class="concl-p">${c.p}</div></div>`)
    .join("");

  // Tabla ordenable de presión asistencial por provincia
  const tbody = document.getElementById("t-salud-body");
  const render = (keyIndex, asc) => {
    const keys = ["prov", "pob", "urg", "urgr", "mort", "mortr", "cs", "csr"];
    const nums = ["pob", "urg", "urgr", "mort", "mortr", "cs", "csr"];
    const sorted = [...rows].sort((a, b) => {
      const va = a[keys[keyIndex]], vb = b[keys[keyIndex]];
      return nums.includes(keys[keyIndex]) ? (asc ? va - vb : vb - va) : String(va).localeCompare(String(vb), "es");
    });
    tbody.innerHTML = sorted.map((r) => `<tr>
      <td>${r.prov}</td>
      <td class="num">${fmt(r.pob)}</td>
      <td class="num">${fmt(r.urg)}</td>
      <td class="num">${fmt1(r.urgr)}</td>
      <td class="num">${fmt(r.mort)}</td>
      <td class="num">${fmt1(r.mortr)}</td>
      <td class="num">${fmt(r.cs)}</td>
      <td class="num">${fmt1(r.csr)}</td>
    </tr>`).join("");
  };
  const theads = document.querySelectorAll("#t-salud th");
  let kIdx = 3, kAsc = false;
  theads.forEach((th, i) => {
    th.addEventListener("click", () => {
      if (kIdx === i) kAsc = !kAsc; else { kIdx = i; kAsc = true; }
      theads.forEach((x) => x.classList.remove("sorted"));
      th.classList.add("sorted");
      render(kIdx, kAsc);
    });
  });
  render(kIdx, kAsc);

  document.getElementById("csv-salud").addEventListener("click", () => {
    const tsv = [["Provincia", "Población", "Urgencias", "Urgencias/1000", "Fallecidos", "Fallecidos/1000", "Centros", "Centros/100k"]]
      .concat(rows.map((r) => [r.prov, r.pob, r.urg, r.urgr, r.mort, r.mortr, r.cs, r.csr]));
    const txt = tsv.map((r) => r.join("\t")).join("\r\n");
    const blob = new Blob(["\uFEFF" + txt], { type: "text/tab-separated-values;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "salud_presion_provincias.tsv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

function buildDataSourceList() {
  const ds = [
    ["Población de referencia 2026", "1285863053792", "", "https://datosabiertos.jcyl.es/web/jcyl/set/es/salud/poblacion-referencia/1285114749493"],
    ["Prevalencia de HTA / Diabetes / Dislipemia / EPOC / IC / crónicos (2025)", "—", "", "https://datosabiertos.jcyl.es/web/jcyl/set/es/salud/prevalencia-de-hta/1285522350995"],
    ["Tasa de mortalidad por zonas básicas de salud", "—", "", "https://datosabiertos.jcyl.es/web/jcyl/set/es/salud/tasa-mortalidad-centros/1284945650353"],
    ["Urgencias hospitalarias atendidas 2024/2025", "—", "", "https://datosabiertos.jcyl.es/web/jcyl/set/es/salud/urgencias-hospitalarias-atendidas/1285114487305"],
    ["Centros de salud por municipios", "—", "", "https://datosabiertos.jcyl.es/web/jcyl/set/es/salud/centros-salud-municipios/1285017220711"],
    ["Registro de municipios de Castilla y León", "—", "", "https://datosabiertos.jcyl.es/web/jcyl/set/es/demografia/registro-municipios/1284174863621"],
    ["Mapa de Zonas Básicas de Salud de Castilla y León", "—", "", "https://datosabiertos.jcyl.es/web/jcyl/set/es/medio-ambiente/mapa-zbs/1285846110000"],
  ];
  document.getElementById("ds-list").innerHTML = ds
    .map(([t, , , u]) => `<li><a href="${u}" target="_blank">${t}</a></li>`).join("");
}

document.addEventListener("DOMContentLoaded", init);