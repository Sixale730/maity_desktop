#!/usr/bin/env node
// Genera el reporte B (manager) a partir de un JSON de datos y del esqueleto.
//   node build-report-b.mjs docs/piloto/<empresa>-<fecha>.data.json <salida.html>
// Sin dependencias. Todo el texto narrativo vive en el JSON; aquí solo hay forma.
//
// v5 (2026-09-07, feedback del cofundador sobre el deck "Dashboard Maity.pptx"):
// 5 secciones (resumen · competencias · personas · juntas · acciones), sin método
// en el cuerpo, porcentajes en vez de conteos, ejemplos con nombre, radar por
// persona (mismo estilo que el dashboard de inicio) y nada de tiles ni tablas.
// Campos nuevos del JSON son opcionales: un JSON v4 sigue compilando (ver fallbacks).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [,, dataPath, outPath] = process.argv;
if (!dataPath || !outPath) { console.error('uso: node build-report-b.mjs <datos.json> <salida.html>'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const D = JSON.parse(readFileSync(dataPath, 'utf8'));
const skeleton = readFileSync(join(here, 'report-b-skeleton.html'), 'utf8');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (s) => esc(s).replace(/\n/g, '&#10;');
const nf = (n) => Number(n).toLocaleString('es-MX');
const pct = (n, tot) => tot ? Math.round(100 * n / tot) : 0;
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-');
const DIMS = ['claridad', 'proposito', 'estructura', 'persuasion', 'empatia', 'adaptacion'];
const LABEL = { claridad: 'Claridad', proposito: 'Propósito', estructura: 'Estructura', persuasion: 'Persuasión', empatia: 'Empatía', adaptacion: 'Adaptación', 'persuasión': 'Persuasión' };
const lab = (k) => LABEL[k] || k;

// Ejemplos: `ejemplos: [{cita, alternativa, quien}]` o, en JSON v4, `cita/alternativa/quien` sueltos.
const ejemplosDe = (o) => Array.isArray(o.ejemplos) && o.ejemplos.length ? o.ejemplos : (o.cita ? [{ cita: o.cita, alternativa: o.alternativa, quien: o.quien }] : []);
const exList = (items, withWho) => `<div class="ex-list">${items.map(e => `
  <blockquote class="ex"><div class="q">«${esc(e.cita)}»</div>${e.alternativa ? `<div class="a">${esc(e.alternativa)}</div>` : ''}${withWho && e.quien ? `<div class="w">${esc(e.quien)}</div>` : ''}</blockquote>`).join('')}</div>`;

// ---------- masthead / toc / footer ----------
const masthead = `
  <header class="masthead">
    <div>
      <div class="eyebrow"><span class="dot"></span>Maity · piloto ${esc(D.empresa)}</div>
      <h1>${esc(D.titulo)}</h1>
      <p class="period">Métricas del ${esc(D.periodo)}</p>
      ${D.subtitulo ? `<p class="lede">${esc(D.subtitulo)}</p>` : ''}
    </div>
    <div class="meta">
      ${D.equipo_n ? `<b>${D.equipo_n} personas</b> del equipo<br>` : ''}
      fuente: conversaciones y minutas de Maity
    </div>
  </header>`;

const toc = `
  <nav class="toc" aria-label="Secciones"><ul>
    <li><a href="#resumen">Resumen</a></li>
    <li><a href="#competencias">Seis competencias</a></li>
    <li><a href="#personas">Persona por persona</a></li>
    <li><a href="#juntas">Resumen de juntas</a></li>
    <li><a href="#acciones">Acciones</a></li>
  </ul></nav>`;

const metodo = [
  ...(D.corte ? [`Datos al ${D.corte}.`] : []),
  ...(D.jornada ? [`La cobertura de jornada supone un horario de ${D.jornada} para todos${D.dias_habiles ? ` (${D.dias_habiles} días hábiles)` : ''}.`] : []),
  ...(D.como_leer || []),
];
const footer = `
  <footer>
    <p>Preparado por Maity para la dirección de ${esc(D.empresa)}. Los puntajes describen conversaciones, no personas: cambian con cada grabación nueva. Este reporte no incluye transcripciones.</p>
    ${metodo.length ? `<details class="tbl"><summary>Cómo se midió</summary><ul class="plain">${metodo.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
    ${D.datos_uso ? `<details class="tbl"><summary>Datos de uso (referencia)</summary>
      <p class="note">${esc(D.datos_uso.nota)}</p>
      <p class="note">${nf(D.datos_uso.conv)} conversaciones guardadas · ${nf(D.datos_uso.horas)} horas · ${esc(D.datos_uso.personas)} personas grabaron · ${nf(D.datos_uso.analisis)} conversaciones analizadas · ${nf(D.datos_uso.minutas)} minutas.</p>
    </details>` : ''}
  </footer>`;

// ---------- 1. resumen ----------
// Cobertura de jornada, compacta: una barra por persona, sin gráfica de picos (esa vive en el artifact interno).
function coverageRows() {
  const ps = D.personas.filter(p => p.cobertura != null).slice().sort((a, b) => b.cobertura - a.cobertura);
  return ps.map(p => `
    <div class="cov">
      <div>${esc(p.nombre)}</div>
      <div class="bar" data-tip="${attr(`${p.nombre}: Maity encendida el ${p.cobertura} % de la jornada${p.dias_con_maity != null && D.dias_habiles ? ` (${p.dias_con_maity} de ${D.dias_habiles} días)` : ''}`)}"><i style="width:${p.cobertura}%"></i></div>
      <div class="t">${p.cobertura} %</div>
    </div>`).join('');
}
const s1 = `
  <section id="resumen">
    <div class="eyebrow">Resumen del equipo</div>
    <h2>${esc(D.resumen_titulo || `Cómo se comunica el equipo de ${D.empresa}`)}</h2>
    <ul class="headlines">${D.resumen.map(p => `<li>${p}</li>`).join('')}</ul>
    ${D.personas.some(p => p.cobertura != null) ? `
    <div class="card cov-card">
      <div class="cap"><h3>Parte de la jornada con Maity encendida</h3><span class="u">${esc(D.jornada || '')}</span></div>
      ${coverageRows()}
    </div>` : ''}
  </section>`;

// ---------- 2. competencias ----------
function dimRow(c) {
  const bar = Math.max(0, Math.min(100, c.media));
  const tot = c.critico + c.desarrollo + c.competente || 1;
  const seg = (n, cls, name) => n ? `<div class="${cls}" style="flex:${n}" data-tip="${attr(`${name}: ${n} de ${tot} conversaciones`)}"><span>${pct(n, tot)} %</span></div>` : '';
  const partial = c.n_eval < c.n_total;
  return `
    <div class="dim-row">
      <div class="head">
        <div class="name">${esc(c.label)}</div>
        <div class="score">${c.media}<small>/ 100</small></div>
        <div class="n">medida en <b>${c.n_eval}${partial ? ` de ${c.n_total}` : ''}</b> conversaciones</div>
      </div>
      <div>
        <div class="bar" data-tip="${attr(`${c.label}: ${c.media} de 100, promedio de ${c.n_eval} conversaciones`)}"><i style="width:${bar}%"></i></div>
        <div class="levels" aria-label="${attr(`crítico ${pct(c.critico, tot)} %, en desarrollo ${pct(c.desarrollo, tot)} %, competente o sólido ${pct(c.competente, tot)} %`)}">
          ${seg(c.critico, 'l1', 'crítico')}${seg(c.desarrollo, 'l2', 'en desarrollo')}${seg(c.competente, 'l3', 'competente o sólido')}
        </div>
        <div class="dim-body">
          <div>
            <h4>Qué pasa</h4><p>${esc(c.que_pasa)}</p>
            <h4>Qué mejorar</h4><p>${esc(c.mejorar)}</p>
          </div>
          <div>
            <h4>Ejemplos</h4>
            ${exList(ejemplosDe(c), true)}
          </div>
        </div>
      </div>
    </div>`;
}
const s2 = `
  <section id="competencias">
    <div class="eyebrow">Las seis competencias</div>
    <h2>${esc(D.competencias_titulo || 'Dónde está el equipo en cada competencia')}</h2>
    <p class="sub">Promedio de las conversaciones analizadas y parte de ellas en cada nivel.</p>
    <div class="legend"><span style="--sw: var(--lvl-crit)">crítico · menos de 40</span><span style="--sw: var(--lvl-dev)">en desarrollo · 40 a 59</span><span style="--sw: var(--lvl-ok)">competente · 60 o más</span></div>
    <div style="margin-top:16px">${D.competencias.map(dimRow).join('')}</div>
  </section>`;

// ---------- 3. personas ----------
// Radar portado de frontend/src/features/gamification/components/RadarChartV2.tsx (dashboard de inicio):
// rejilla hexagonal a 25/50/75/100, radios, polígonos con relleno tenue + glow, puntos con borde de superficie,
// etiquetas fuera del radio. Dos series: cómo se ve (cuestionario) y cómo lo mide Maity.
// Un `medido == null` NO se pinta como 0: la serie de Maity se cierra por los ejes con valor y el eje dice "sin medir".
function radar(p) {
  // viewBox más ancho que alto: las etiquetas de los ejes laterales ("Estructura", "Adaptación") salen del radio.
  const W = 380, H = 300, cx = W / 2, cy = H / 2, r = 100, n = DIMS.length, step = (Math.PI * 2) / n;
  const pt = (v, i, scale = 1) => { const a = i * step - Math.PI / 2; const rr = (v / 100) * r * scale; return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) }; };
  const id = `radarGlow-${slug(p.nombre)}`;
  const fx = (v) => v.toFixed(1);
  let g = `<defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  [0.25, 0.5, 0.75, 1].forEach(l => { g += `<polygon class="grid" points="${DIMS.map((_, i) => { const q = pt(100, i, l); return `${fx(q.x)},${fx(q.y)}`; }).join(' ')}"/>`; });
  DIMS.forEach((_, i) => { const q = pt(100, i); g += `<line class="grid" x1="${cx}" y1="${cy}" x2="${fx(q.x)}" y2="${fx(q.y)}"/>`; });
  const series = [
    { key: 'auto', cls: 'auto', vals: DIMS.map(k => p.dims[k]?.auto ?? null) },
    { key: 'medido', cls: 'med', vals: DIMS.map(k => p.dims[k]?.medido ?? null) },
  ];
  series.forEach(s => {
    const pts = s.vals.map((v, i) => v == null ? null : pt(v, i)).filter(Boolean);
    if (pts.length >= 3) g += `<polygon class="${s.cls}" points="${pts.map(q => `${fx(q.x)},${fx(q.y)}`).join(' ')}" filter="url(#${id})"/>`;
  });
  series.forEach(s => s.vals.forEach((v, i) => {
    if (v == null) return; const q = pt(v, i);
    const tip = s.key === 'auto' ? `cómo se ve: ${v}` : `Maity: ${v}${p.dims[DIMS[i]]?.n ? ` (en ${p.dims[DIMS[i]].n})` : ''}`;
    g += `<circle class="${s.cls}" cx="${fx(q.x)}" cy="${fx(q.y)}" r="3.5"><title>${esc(tip)}</title></circle>`;
  }));
  DIMS.forEach((k, i) => {
    const a = i * step - Math.PI / 2; const lr = r + 22;
    const x = cx + lr * Math.cos(a), y = cy + lr * Math.sin(a);
    const cos = Math.cos(a); const anchor = Math.abs(cos) < 0.1 ? 'middle' : cos > 0 ? 'start' : 'end';
    const none = p.dims[k]?.medido == null;
    g += `<text class="lbl${none ? ' none' : ''}" x="${fx(x)}" y="${fx(y)}" text-anchor="${anchor}" dominant-baseline="middle">${lab(k)}${none ? `<tspan class="none" x="${fx(x)}" dy="13">sin medir</tspan>` : ''}</text>`;
  });
  return `<svg class="radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(`${p.nombre}: cómo se ve contra cómo lo mide Maity, por competencia`)}">${g}</svg>`;
}
function personCard(p) {
  const head = `<div class="top"><div><div class="name">${esc(p.nombre)}</div><div class="role">${esc(p.puesto)}</div></div></div>`;
  const recs = Array.isArray(p.recomendaciones) && p.recomendaciones.length ? p.recomendaciones : (p.accion ? [p.accion] : []);
  const act = recs.length ? `<div class="act"><h4>Qué hacer</h4><ul class="plain">${recs.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
  if (p.sin_analisis) {
    return `<article class="person">${head}
      <div class="n">sin conversaciones analizadas</div>
      ${p.bloqueo ? `<div class="block">${esc(p.bloqueo)}.</div>` : ''}
      ${act}
    </article>`;
  }
  const patron = p.patron_llano || p.patron;
  return `<article class="person">${head}
    <div class="n"><b>${p.n}</b> ${p.n === 1 ? 'conversación analizada' : 'conversaciones analizadas'}${p.n < 5 ? ' · lectura preliminar' : ''}</div>
    <dl class="kv">
      <dt>Fortaleza</dt><dd>${esc(lab(p.fortaleza))}</dd>
      <dt>Área</dt><dd>${esc(lab(p.area))}${exList(ejemplosDe(p), false)}</dd>
      ${patron ? `<dt>Patrón</dt><dd>${esc(patron)}</dd>` : ''}
    </dl>
    ${p.n >= 2 ? radar(p) : `<p class="note">Con una sola conversación no se muestran promedios ni comparación con la autoevaluación.</p>`}
    ${act}
  </article>`;
}
const s3 = `
  <section id="personas">
    <div class="eyebrow">Persona por persona</div>
    <h2>Fortalezas y áreas de oportunidad</h2>
    <p class="sub">Cada tarjeta dice cuántas conversaciones la respaldan.</p>
    <div class="legend radar-legend"><span style="--sw: var(--radar-auto)">cómo se ve (cuestionario de registro)</span><span style="--sw: var(--radar-maity)">cómo lo mide Maity</span></div>
    <div class="people">${D.personas.map(personCard).join('')}</div>
  </section>`;

// ---------- 4. resumen de juntas ----------
const M = D.conversaciones;
const GROUP = (r) => /cliente/i.test(r.interlocutor) ? 'clientes' : /equipo interno|uno a uno/i.test(r.interlocutor) ? 'internas' : 'otras';
const groups = { internas: { label: 'Internas y uno a uno', n: 0, h: 0, ef: 0, inf: 0, cls: 'g-int' }, clientes: { label: 'Clientes', n: 0, h: 0, ef: 0, inf: 0, cls: 'g-cli' }, otras: { label: 'Otras', n: 0, h: 0, ef: 0, inf: 0, cls: 'g-otr' } };
M.matriz.forEach(r => { const g = groups[GROUP(r)]; g.n += r.n; g.h += r.horas || 0; g.ef += (r.efectividad || 0) * r.n; g.inf += r.informales || 0; });
const totalN = Object.values(groups).reduce((s, g) => s + g.n, 0);
Object.values(groups).forEach(g => { g.pct = pct(g.n, totalN); g.efw = g.n ? Math.round(g.ef / g.n) : null; });
const PJ = M.pct_jornada || {};
const EF_TIP = 'Efectividad: promedio de cuatro señales de la minuta de cada reunión: agenda, decisiones, acciones con dueño y fecha, y participación equilibrada.';
const stack = `
  <div class="stack" role="img" aria-label="${attr(Object.values(groups).filter(g => g.n).map(g => `${g.label}: ${g.pct} %`).join(', '))}">
    ${Object.entries(groups).filter(([, g]) => g.n).map(([k, g]) => `<div class="${g.cls}" style="flex:${g.n}" data-tip="${attr(`${g.label}: ${g.n} de ${totalN} conversaciones · ${nf(Math.round(g.h * 10) / 10)} h${PJ[k] != null ? ` · ${PJ[k]} % de la jornada` : ''}`)}"><b>${g.pct} %</b><span>${g.label}${PJ[k] != null ? ` · ${PJ[k]} % de la jornada` : ''}</span></div>`).join('')}
  </div>`;
const efRows = ['clientes', 'internas'].filter(k => groups[k].n).map(k => `
  <div class="ef-row ${groups[k].cls}"><div>${groups[k].label}</div><div class="bar" data-tip="${attr(`${groups[k].label}: ${groups[k].efw} de 100 en ${groups[k].n} conversaciones`)}"><i style="width:${groups[k].efw}%"></i></div><div class="t">${groups[k].efw}</div></div>`).join('');
const delta = groups.clientes.n && groups.internas.n ? groups.clientes.efw - groups.internas.efw : null;
const fugaPct = groups.internas.n ? pct(groups.internas.inf, groups.internas.n) : null;
const A = M.acciones, Dc = M.decisiones;
const incompletas = A ? A.total - A.completas : null;

// Temas: `[{t, n}]` o strings v4 "pólizas (38)".
const parseTema = (t) => { if (typeof t !== 'string') return t; const m = t.match(/^(.+?)\s*\((\d+)\)\s*$/); return m ? { t: m[1], n: +m[2] } : { t, n: 0 }; };
const temas = (M.temas || []).map(parseTema).filter(t => t.n > 0).sort((a, b) => b.n - a.n);
function temasChart() {
  const rows = temas.slice(0, 12); const tot = temas.reduce((s, t) => s + t.n, 0);
  const W = 640, L = 170, R = 56, rowH = 24, T = 6; const H = T + rows.length * rowH + 6; const pw = W - L - R;
  const maxP = Math.max(...rows.map(t => pct(t.n, tot)), 1);
  let g = '';
  rows.forEach((t, i) => {
    const y = T + i * rowH; const p = pct(t.n, tot); const w = Math.max(2, (p / maxP) * pw);
    g += `<text class="lbl" x="${L - 10}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="middle">${esc(t.t)}</text>`;
    g += `<rect class="track" x="${L}" y="${y + 6}" width="${pw}" height="${rowH - 12}" rx="4"/>`;
    g += `<rect class="${i < 2 ? 'top' : 'bar'}" x="${L}" y="${y + 6}" width="${w.toFixed(1)}" height="${rowH - 12}" rx="4"><title>${esc(`${t.t}: ${t.n} menciones (${p} %)`)}</title></rect>`;
    g += `<text class="val${i < 2 ? ' top' : ''}" x="${L + pw + 8}" y="${y + rowH / 2}" dominant-baseline="middle">${p} %</text>`;
  });
  const top2 = rows.slice(0, 2); const top2p = pct(top2.reduce((s, t) => s + t.n, 0), tot);
  return { svg: `<svg class="hbar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Temas por porcentaje de menciones">${g}</svg>`, tot, top2, top2p };
}
const TC = temas.length ? temasChart() : null;
const s4 = `
  <section id="juntas">
    <div class="eyebrow">Resumen de juntas</div>
    <h2>${esc(M.titulo || 'Qué conversaciones tienen y cómo salen')}</h2>
    <p class="sub">Tipo de conversación según la minuta de cada una · ${nf(totalN)} conversaciones.</p>
    ${stack}
    <div class="split">
      <div class="card">
        <div class="cap"><h3>Efectividad</h3><span class="u" data-tip="${attr(EF_TIP)}">cómo se mide</span></div>
        ${efRows}
        ${delta != null ? `<div class="delta ${delta >= 0 ? 'g-cli' : 'g-int'}">${delta >= 0 ? 'Clientes' : 'Internas'}: ${delta >= 0 ? '+' : ''}${Math.abs(delta)} punto${Math.abs(delta) === 1 ? '' : 's'}</div>` : ''}
      </div>
      ${fugaPct != null ? `<div class="card">
        <div class="cap"><h3>Tramos sin agenda</h3></div>
        <div class="big g-otr">${fugaPct} %</div>
        <p>de las conversaciones internas incluyó tramos "informales" o sin agenda</p>
        <p class="note">${groups.internas.inf} de ${groups.internas.n} conversaciones internas</p>
      </div>` : ''}
    </div>
    ${M.prioridad ? `<div class="priority"><span class="tag">Prioridad</span>${esc(M.prioridad)}</div>` : ''}
    ${A ? `<div class="stat-line" data-tip="${attr(`${incompletas} de ${A.total} acciones detectadas en las minutas no tienen dueño, fecha o ninguna de las dos`)}"><b>${pct(incompletas, A.total)} %</b><span>de las acciones acordadas en juntas quedan sin dueño o sin fecha <small>(${incompletas} de ${A.total})</small></span></div>` : ''}
    ${Dc ? `<div class="stat-line minor"><b>${pct(Dc.confirmadas, Dc.total)} %</b><span>de las decisiones quedaron confirmadas <small>(${Dc.confirmadas} de ${Dc.total})</small></span></div>` : ''}
    ${TC ? `<div class="card">
      <div class="cap"><h3>De qué hablan</h3><span class="u">${nf(TC.tot)} menciones</span></div>
      <div class="chart">${TC.svg}</div>
      ${TC.top2.length === 2 ? `<div class="callout"><p><b>${TC.top2.map(t => t.t.charAt(0).toUpperCase() + t.t.slice(1)).join(' y ')}</b> concentran el ${TC.top2p} % de lo que se habla.</p></div>` : ''}
    </div>` : ''}
  </section>`;

// ---------- 5. acciones ----------
const s5 = `
  <section id="acciones">
    <div class="eyebrow">Acciones para las próximas dos semanas</div>
    <h2>Qué hacer el lunes</h2>
    <div class="card">
      <div class="cap"><h3>Por persona</h3></div>
      <div class="tblwrap"><table class="checklist"><tbody>${D.acciones.personas.map(a => `<tr><td>${esc(a.nombre)}</td><td>${esc(a.accion)}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card">
      <div class="cap"><h3>Para el equipo</h3></div>
      <ul class="plain">${D.acciones.equipo.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
    ${D.acciones.maity?.length ? `<div class="card">
      <div class="cap"><h3>Lo que Maity necesita de ${esc(D.empresa)}</h3></div>
      <ul class="plain">${D.acciones.maity.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>` : ''}
  </section>`;

const html = skeleton
  .replace('{{TITLE}}', esc(D.titulo))
  .replace('{{MASTHEAD}}', masthead)
  .replace('{{TOC}}', toc)
  .replace('{{SECTIONS}}', [s1, s2, s3, s4, s5].join('\n'))
  .replace('{{FOOTER}}', footer);
writeFileSync(outPath, html, 'utf8');
console.log(`ok ${outPath} ${html.length} bytes · ${D.personas.length} personas · ${D.competencias.length} competencias · ${totalN} conversaciones en juntas`);
