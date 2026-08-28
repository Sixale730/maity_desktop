#!/usr/bin/env node
// Genera el reporte B (manager) a partir de un JSON de datos y del esqueleto.
//   node build-report-b.mjs docs/piloto/<empresa>-<fecha>.data.json <salida.html>
// Sin dependencias. Todo el texto narrativo vive en el JSON; aquí solo hay forma.
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
const DIMS = ['claridad', 'proposito', 'estructura', 'persuasion', 'empatia', 'adaptacion'];
const LABEL = { claridad: 'Claridad', proposito: 'Propósito', estructura: 'Estructura', persuasion: 'Persuasión', empatia: 'Empatía', adaptacion: 'Adaptación', 'persuasión': 'Persuasión' };
const lab = (k) => LABEL[k] || k;
const pillFor = (lectura) => lectura === 'consistente' ? 'ok' : lectura === 'sin análisis' ? 'off' : 'low';
const lecturaTxt = { consistente: 'lectura consistente', preliminar: 'lectura preliminar', 'una sola': 'una sola conversación', 'sin análisis': 'sin conversaciones analizadas' };

// ---------- masthead / toc / footer ----------
const masthead = `
  <header class="masthead">
    <div>
      <div class="eyebrow"><span class="dot"></span>Maity · piloto ${esc(D.empresa)}</div>
      <h1>${esc(D.titulo)}</h1>
      <p class="lede">${esc(D.subtitulo)}</p>
    </div>
    <div class="meta">
      <b>${esc(D.periodo)}</b><br>
      datos al ${esc(D.corte)}<br>
      jornada de referencia ${esc(D.jornada)}<br>
      fuente: conversaciones y minutas de Maity
    </div>
  </header>`;

const toc = `
  <nav class="toc" aria-label="Secciones"><ul>
    <li><a href="#resumen">En una página</a></li>
    <li><a href="#competencias">Seis competencias</a></li>
    <li><a href="#personas">Persona por persona</a></li>
    <li><a href="#conversaciones">Qué conversaciones</a></li>
    <li><a href="#jornada">Cuándo y qué pasó</a></li>
    <li><a href="#no-graban">Quiénes no aparecen</a></li>
    <li><a href="#acciones">Acciones</a></li>
    <li><a href="#como-leer">Cómo leer esto</a></li>
  </ul></nav>`;

const footer = `
  <footer>
    <p>Preparado por Maity para la dirección de ${esc(D.empresa)}. Los puntajes describen conversaciones, no personas: cambian con cada grabación nueva. Este reporte no incluye transcripciones.</p>
    <details class="tbl"><summary>Datos de uso (referencia)</summary>
      <p class="note">${esc(D.datos_uso.nota)}</p>
      <p class="note">${nf(D.datos_uso.conv)} conversaciones guardadas · ${nf(D.datos_uso.horas)} horas · ${esc(D.datos_uso.personas)} personas grabaron · ${nf(D.datos_uso.analisis)} conversaciones analizadas · ${nf(D.datos_uso.minutas)} minutas.</p>
    </details>
  </footer>`;

// ---------- 1. en una página ----------
const s1 = `
  <section id="resumen">
    <div class="eyebrow">En una página</div>
    <h2>Cómo se comunica el equipo de ${esc(D.empresa)} y qué hacer con ello</h2>
    <div class="tldr">${D.resumen.map(p => `<p>${p}</p>`).join('')}</div>
  </section>`;

// ---------- 2. competencias ----------
function dimRow(c) {
  const pct = Math.max(0, Math.min(100, c.media));
  const tot = c.critico + c.desarrollo + c.competente || 1;
  const seg = (n, cls, name) => n ? `<div class="${cls}" style="flex:${n}" data-tip="${attr(`${name}: ${n} de ${tot} conversaciones`)}">${n >= tot * 0.12 ? `${name} ${n}` : n}</div>` : '';
  const partial = c.n_eval < c.n_total;
  return `
    <div class="dim-row">
      <div class="head">
        <div class="name">${esc(c.label)}</div>
        <div class="score">${c.media}<small>/ 100</small></div>
        <div class="n">medida en <b>${c.n_eval} de ${c.n_total}</b> conversaciones${partial ? ' · ' + c.personas + ' personas' : ''}</div>
      </div>
      <div>
        <div class="bar" data-tip="${attr(`${c.label}: ${c.media} de 100, promedio de ${c.n_eval} conversaciones`)}"><i class="${partial ? 'faint' : ''}" style="width:${pct}%"></i></div>
        <div class="levels" aria-label="${attr(`crítico ${c.critico}, en desarrollo ${c.desarrollo}, competente o sólido ${c.competente}`)}">
          ${seg(c.critico, 'l1', 'crítico')}${seg(c.desarrollo, 'l2', 'en desarrollo')}${seg(c.competente, 'l3', 'competente+')}
        </div>
        <div class="dim-body">
          <div>
            <h4>Qué pasa</h4><p>${esc(c.que_pasa)}</p>
            <h4>Qué mejorar</h4><p>${esc(c.mejorar)}</p>
          </div>
          <div>
            <h4>Ejemplo</h4>
            <blockquote class="ex"><div class="q">«${esc(c.cita)}»</div><div class="a">${esc(c.alternativa)}</div><div class="w">${esc(c.quien)}</div></blockquote>
          </div>
        </div>
      </div>
    </div>`;
}
const s2 = `
  <section id="competencias">
    <div class="eyebrow">Las seis competencias</div>
    <h2>Claras pero sin orden ni argumento: dónde está el equipo en cada competencia</h2>
    <p class="sub">Promedio de las conversaciones en las que cada competencia sí se pudo medir. La franja de colores muestra cuántas conversaciones quedaron en cada nivel.</p>
    <div class="legend"><span style="--sw: var(--lvl-crit)">crítico (menos de 40)</span><span style="--sw: var(--lvl-dev)">en desarrollo (40–59)</span><span style="--sw: var(--lvl-ok)">competente o sólido (60+)</span></div>
    <div style="margin-top:16px">${D.competencias.map(dimRow).join('')}</div>
    <div class="callout"><p>${esc(D.nota_evaluable)}</p></div>
  </section>`;

// ---------- 3. personas ----------
function dumbbell(p) {
  const W = 420, L = 92, R = 60, rowH = 22, top = 8;
  const H = top + DIMS.length * rowH + 4;
  const x = (v) => L + (v / 100) * (W - L - R);
  let g = '';
  DIMS.forEach((k, i) => {
    const d = p.dims[k] || {}; const y = top + i * rowH + rowH / 2;
    g += `<text x="${L - 8}" y="${y + 4}" text-anchor="end" class="lbl">${lab(k)}</text>`;
    if (d.medido == null) {
      g += `<circle cx="${x(d.auto)}" cy="${y}" r="5" class="auto"><title>cómo se ve: ${d.auto}</title></circle><text x="${x(100) + 8}" y="${y + 4}" class="none">sin medir</text>`;
    } else {
      const a = x(d.auto), m = x(d.medido);
      g += `<line x1="${a}" y1="${y}" x2="${m}" y2="${y}" class="link"/>`;
      g += `<circle cx="${a}" cy="${y}" r="5" class="auto"><title>cómo se ve: ${d.auto}</title></circle>`;
      g += `<circle cx="${m}" cy="${y}" r="5.5" class="med"><title>Maity: ${d.medido} (en ${d.n})</title></circle>`;
      g += `<text x="${x(100) + 8}" y="${y + 4}">${d.medido} <tspan class="none">/ ${d.auto}</tspan></text>`;
    }
  });
  const grid = [0, 50, 100].map(v => `<line x1="${x(v)}" y1="${top - 2}" x2="${x(v)}" y2="${H - 4}" class="axis"/>`).join('');
  return `<svg class="db" viewBox="0 0 ${W} ${H}" role="img" aria-label="Autoevaluación contra medición de Maity por competencia">${grid}${g}</svg>
    <div class="db-legend"><span><i class="a"></i>cómo se ve (cuestionario de registro)</span><span><i class="m"></i>cómo lo mide Maity</span></div>`;
}
function personCard(p) {
  const pill = `<span class="pill ${pillFor(p.lectura)}">${esc(lecturaTxt[p.lectura] || p.lectura)}</span>`;
  const head = `
    <div class="top"><div><div class="name">${esc(p.nombre)}</div><div class="role">${esc(p.puesto)}</div></div>${pill}</div>`;
  if (p.sin_analisis) {
    return `<article class="person">${head}
      <div class="n">${p.dias_con_maity ? `Maity encendida <b>${p.dias_con_maity}</b> de ${D.dias_habiles} días hábiles · ` : ''}reto que declaró: <b>${esc(p.reto)}</b></div>
      ${p.bloqueo ? `<div class="block">${esc(p.bloqueo)}.</div>` : ''}
      <p>${esc(p.extra)}</p>
      <div class="act">${esc(p.accion)}</div>
    </article>`;
  }
  const showDb = p.n >= 2;
  return `<article class="person">${head}
    <div class="n"><b>${p.n}</b> conversaciones analizadas · <b>${p.dos_partes}</b> con las dos partes audibles · Maity encendida el <b>${p.cobertura} %</b> de la jornada (<b>${p.cobertura_analizada} %</b> con conversación)</div>
    <dl class="kv">
      <dt>Fortaleza</dt><dd>${esc(lab(p.fortaleza))}</dd>
      <dt>Área</dt><dd>${esc(lab(p.area))}
        <blockquote class="ex"><div class="q">«${esc(p.cita)}»</div><div class="a">${esc(p.alternativa)}</div></blockquote></dd>
      <dt>Patrón</dt><dd>${esc(p.patron)} — lo que cambiaría: ${esc(p.que_cambiaria).toLowerCase()}.</dd>
      <dt>Reto</dt><dd>${esc(p.reto_vs_medido)}</dd>
    </dl>
    ${showDb ? dumbbell(p) : `<p class="note">Con una sola conversación no se muestran promedios ni comparación con la autoevaluación.</p>`}
    ${p.extra ? `<p>${esc(p.extra)}</p>` : ''}
    <div class="act">${esc(p.accion)}</div>
  </article>`;
}
const s3 = `
  <section id="personas">
    <div class="eyebrow">Persona por persona</div>
    <h2>Fortalezas y áreas de oportunidad de cada quien</h2>
    <p class="sub">Cada tarjeta dice cuántas conversaciones la respaldan. "Cómo se ve" viene del cuestionario que cada persona respondió al registrarse; "cómo lo mide Maity", de sus conversaciones. Empatía y adaptación aparecen "sin medir" cuando Maity no escuchó a la otra parte.</p>
    <div class="people">${D.personas.map(personCard).join('')}</div>
  </section>`;

// ---------- 4. conversaciones ----------
const M = D.conversaciones;
const maxN = Math.max(...M.matriz.map(r => r.n));
const matrixRows = M.matriz.map(r => `
  <tr>
    <td>${esc(r.tipo)}</td><td>${esc(r.interlocutor)}</td>
    <td class="bar-cell"><i style="width:${Math.round(100 * r.n / maxN)}%"></i><b>${r.n}</b></td>
    <td class="n">${nf(r.horas)} h</td><td class="n">${r.min} min</td>
    <td class="n"><b>${r.efectividad}</b><small style="color:var(--muted)">/100</small></td>
    <td class="n">${r.informales ? `${r.informales} de ${r.n}` : '—'}</td>
  </tr>`).join('');
const A = M.acciones, Dc = M.decisiones;
const s4 = `
  <section id="conversaciones">
    <div class="eyebrow">Qué conversaciones tienen y cómo salen</div>
    <h2>Juntas internas y uno a uno casi siempre; con clientes pocas veces, pero mejor</h2>
    <p class="sub">Tipo de conversación según la minuta que Maity generó de cada una. "Efectividad" resume si la reunión tuvo agenda, decisiones, acciones con dueño y fecha, y participación equilibrada.</p>
    <div class="card">
      <div class="cap"><h3>Tipo de conversación y cómo salió</h3><span class="u">${M.informales.total} minutas</span></div>
      <div class="tblwrap"><table>
        <thead><tr><th>Tipo</th><th>Con quién</th><th>Cuántas</th><th class="n">Horas</th><th class="n">Duración típica</th><th class="n">Efectividad</th><th class="n">"Informal / sin agenda"</th></tr></thead>
        <tbody>${matrixRows}</tbody>
      </table></div>
      <p class="note">"Informal / sin agenda" son las que Maity tituló así: no se pierde el tiempo, es que la grabación siguió entre conversaciones o en pláticas sin propósito.</p>
    </div>
    <div class="kpi-row">
      <div class="k"><div class="v">${A.completas}<small>de ${A.total}</small></div><div class="l">acciones con dueño y fecha</div></div>
      <div class="k"><div class="v">${A.sin_fecha}</div><div class="l">acciones sin fecha</div></div>
      <div class="k"><div class="v">${A.sin_dueno}</div><div class="l">acciones sin dueño</div></div>
      <div class="k"><div class="v">${Dc.confirmadas}<small>de ${Dc.total}</small></div><div class="l">decisiones confirmadas</div></div>
    </div>
    <h4>De qué hablan</h4>
    <div class="chips">${M.temas.map(t => `<span>${esc(t)}</span>`).join('')}</div>
    <h4>Lectura</h4>
    <ul class="plain">${M.lectura.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
  </section>`;

// ---------- 5. jornada y picos ----------
function coverageRows() {
  return D.personas.map(p => `
    <div class="cov">
      <div>${esc(p.nombre)}</div>
      <div class="bar" data-tip="${attr(`${p.nombre}: Maity encendida el ${p.cobertura} % de la jornada (${p.dias_con_maity} de ${D.dias_habiles} días); ${p.cobertura_analizada} % con conversación analizada`)}"><i class="faint" style="width:${p.cobertura}%"></i><i style="width:${p.cobertura_analizada}%"></i></div>
      <div class="t">${p.cobertura} % · ${p.cobertura_analizada} % con conversación</div>
    </div>`).join('');
}
function dailyChart() {
  const days = D.dias; const W = 1000, H = 280, L = 40, R = 12, T = 22, B = 46;
  const maxH = Math.max(22, ...days.map(d => d.h)); const pw = W - L - R, ph = H - T - B; const step = pw / days.length; const bw = Math.min(46, step * 0.66);
  const y = (h) => T + ph - (h / maxH) * ph;
  const peaks = new Map(D.picos.map((p, i) => [p.d, i + 1]));
  let g = '';
  [5, 10, 15, 20].forEach(v => { if (v <= maxH) g += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="lbl-muted">${v} h</text>`; });
  days.forEach((d, i) => {
    const cx = L + i * step + step / 2; const x = cx - bw / 2; const we = d.dow === 'sáb' || d.dow === 'dom';
    if (d.h > 0) {
      g += `<rect x="${x}" y="${y(d.h)}" width="${bw}" height="${ph + T - y(d.h)}" rx="4" class="bar${we ? ' we' : ''}"/>`;
      if (d.h_an > 0) g += `<rect x="${x}" y="${y(d.h_an)}" width="${bw}" height="${ph + T - y(d.h_an)}" rx="4" class="bar an"/>`;
      g += `<text x="${cx}" y="${y(d.h) - 6}" text-anchor="middle" class="lbl-strong">${d.h}</text>`;
    } else {
      g += `<rect x="${x}" y="${T + ph - 2}" width="${bw}" height="2" class="bar we"/>`;
    }
    const dayN = d.d.slice(8);
    g += `<text x="${cx}" y="${T + ph + 16}" text-anchor="middle" class="${we ? 'lbl-muted' : 'lbl-strong'}">${dayN}</text><text x="${cx}" y="${T + ph + 30}" text-anchor="middle" class="lbl-muted">${d.dow}</text>`;
    if (peaks.has(d.d)) { const py = y(d.h) - 22; g += `<circle cx="${cx}" cy="${py}" r="8" class="peak"/><text x="${cx}" y="${py + 3.5}" text-anchor="middle" class="peak-n">${peaks.get(d.d)}</text>`; }
    const tipTxt = d.h > 0 ? `${d.dow} ${dayN}: ${d.h} h con Maity encendida, ${d.h_an} h con conversación analizada\n${d.an} de ${d.conv} conversaciones analizadas · ${d.personas} personas\n${d.quienes}` : `${d.dow} ${dayN}: sin grabaciones`;
    g += `<rect x="${L + i * step}" y="${T}" width="${step}" height="${ph + B}" class="hit" data-tip="${attr(tipTxt)}"/>`;
  });
  g += `<line x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}" class="axis"/>`;
  return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas con Maity encendida por día, y cuántas tuvieron conversación analizada">${g}</svg>`;
}
const s5 = `
  <section id="jornada">
    <div class="eyebrow">Cuándo usa Maity el equipo y qué hay detrás de cada pico</div>
    <h2>Encendida una fracción de la jornada, y no siempre en una conversación</h2>
    <p class="sub">Jornada de referencia ${esc(D.jornada)} para todos (${D.dias_habiles} días hábiles). La barra clara es el tiempo con Maity encendida; la oscura, el tiempo que sí fue conversación analizada.</p>
    <div class="card">
      <div class="cap"><h3>Parte de la jornada con Maity encendida, por persona</h3><span class="u">% de ${D.dias_habiles} días × 9 h</span></div>
      ${coverageRows()}
      <div class="legend"><span style="--sw: var(--s1); --so: .38">Maity encendida</span><span style="--sw: var(--s1)">con conversación analizada</span></div>
    </div>
    <ul class="plain">${D.jornada_lectura.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <div class="card">
      <div class="cap"><h3>Horas por día y qué hubo detrás de los picos</h3><span class="u">horas · números = picos explicados abajo</span></div>
      <div class="chart">${dailyChart()}</div>
      <div class="legend"><span style="--sw: var(--s1); --so: .38">Maity encendida</span><span style="--sw: var(--s1)">con conversación analizada</span><span style="--sw: var(--muted); --so: .25">fin de semana</span></div>
      <div class="peaks">${D.picos.map((p, i) => `<div class="peak"><div class="t"><b>${i + 1}</b>${esc(p.titulo)}</div>${esc(p.texto)}</div>`).join('')}</div>
    </div>
  </section>`;

// ---------- 6. no graban ----------
const s6 = `
  <section id="no-graban">
    <div class="eyebrow">Quiénes no aparecen en las mediciones</div>
    <h2>Tres personas sin conversaciones analizadas, por tres razones distintas</h2>
    <div class="minis">${D.no_graban.map(n => `<div class="mini"><h3>${esc(n.nombre)}</h3><p>${esc(n.texto)}</p></div>`).join('')}</div>
  </section>`;

// ---------- 7. acciones ----------
const s7 = `
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
    <div class="card">
      <div class="cap"><h3>Lo que Maity necesita de ${esc(D.empresa)}</h3></div>
      <ul class="plain">${D.acciones.maity.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
  </section>`;

// ---------- 8. cómo leer ----------
const s8 = `
  <section id="como-leer">
    <div class="eyebrow">Cómo leer esto</div>
    <h2>Qué mide Maity y qué no</h2>
    <ul class="plain">${D.como_leer.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
  </section>`;

const html = skeleton
  .replace('{{TITLE}}', esc(D.titulo))
  .replace('{{MASTHEAD}}', masthead)
  .replace('{{TOC}}', toc)
  .replace('{{SECTIONS}}', [s1, s2, s3, s4, s5, s6, s7, s8].join('\n'))
  .replace('{{FOOTER}}', footer);
writeFileSync(outPath, html, 'utf8');
console.log(`ok ${outPath} ${html.length} bytes · ${D.personas.length} personas · ${D.competencias.length} competencias`);
