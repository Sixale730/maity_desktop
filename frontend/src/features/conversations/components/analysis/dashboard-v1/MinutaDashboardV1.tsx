'use client';
import { useState } from 'react';
import { GaugeChart } from './GaugeChart';
import { CapaLabel } from './CapaLabel';
import type {
  MeetingMinutesData,
  MinutaDecision,
  MinutaAccionCompleta,
  MinutaAccionIncompleta,
  MinutaComponenteEfectividad,
  MinutaSeguimientoData,
  MinutaTema,
  MinutaMeta,
} from '../../../services/conversations.service';

// ─── Helpers ────────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

function getScoreClasses(score: number): { border: string; badge: string; fill: string; text: string } {
  if (score >= 70)
    return { border: 'border-green', badge: 'badge-green', fill: 'fill-green', text: 'text-green' };
  if (score >= 40)
    return {
      border: 'border-yellow',
      badge: 'badge-yellow',
      fill: 'fill-yellow',
      text: 'text-yellow',
    };
  return { border: 'border-red', badge: 'badge-red', fill: 'fill-red', text: 'text-red' };
}

function getDecisionBadge(clasificacion?: string, estado?: string): { label: string; cls: string } {
  const c = (clasificacion || estado || '').toUpperCase();
  if (c === 'CONFIRMADA') return { label: 'CONFIRMADA', cls: 'badge-green' };
  if (c === 'TENTATIVA') return { label: 'TENTATIVA', cls: 'badge-yellow' };
  if (c === 'DIFERIDA') return { label: 'DIFERIDA', cls: 'badge-red' };
  return { label: c || 'SIN ESTADO', cls: 'badge-yellow' };
}

function getPriorityBadge(prioridad?: string): { label: string; cls: string } {
  const p = (prioridad || '').toLowerCase();
  if (p.includes('alta') || p === 'high') return { label: 'Alta', cls: 'badge-red' };
  if (p.includes('media') || p === 'medium') return { label: 'Media', cls: 'badge-yellow' };
  if (p.includes('baja') || p === 'low') return { label: 'Baja', cls: 'badge-green' };
  return { label: prioridad || '—', cls: 'badge-yellow' };
}

// ─── Hero ───────────────────────────────────────────────────────────

function MinutaHero({
  meta,
  temas,
  efectividad,
}: {
  meta: MinutaMeta;
  temas: MinutaTema[] | undefined;
  efectividad: MeetingMinutesData['efectividad'] | undefined;
}) {
  const score = efectividad?.score_global ?? 0;
  const color = getScoreColor(score);
  const bullets = (temas ?? [])
    .slice(0, 3)
    .map((t) => t.titulo || t.nombre || t.resumen)
    .filter((b): b is string => typeof b === 'string' && b.length > 0);

  return (
    <div className="resumen-hero">
      <div className="gauge-container">
        <GaugeChart score={score} maxScore={100} size={200} />
        <div className="gauge-score" style={{ color }}>
          {score}
        </div>
        {efectividad?.etiqueta && <div className="gauge-label">{efectividad.etiqueta}</div>}
      </div>
      <div className="resumen-text">
        {meta.titulo && (
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 12 }}>{meta.titulo}</h2>
        )}
        {bullets.length > 0 && (
          <ul>
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        {efectividad?.veredicto && (
          <div className="patron-cambio">
            <div>💡 {efectividad.veredicto}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI Strip ──────────────────────────────────────────────────────

function MinutaKPIStrip({
  decisionesCount,
  accionesCount,
  pendientesCount,
  participacionPct,
}: {
  decisionesCount: number;
  accionesCount: number;
  pendientesCount: number;
  participacionPct: number | null;
}) {
  return (
    <div className="kpi-grid">
      <div className="kpi-card accent-blue">
        <div className="kpi-icon">🎯</div>
        <div className="kpi-number">{decisionesCount}</div>
        <div className="kpi-label">Decisiones</div>
        <div className="kpi-detail">tomadas</div>
      </div>
      <div className="kpi-card accent-purple">
        <div className="kpi-icon">📌</div>
        <div className="kpi-number">{accionesCount}</div>
        <div className="kpi-label">Acciones</div>
        <div className="kpi-detail">comprometidas</div>
      </div>
      <div className="kpi-card accent-red">
        <div className="kpi-icon">⚠️</div>
        <div className="kpi-number">{pendientesCount}</div>
        <div className="kpi-label">Pendientes</div>
        <div className="kpi-detail">sin cerrar</div>
      </div>
      <div className="kpi-card accent-orange">
        <div className="kpi-icon">🗣</div>
        <div className="kpi-number">{participacionPct != null ? `${participacionPct}%` : '—'}</div>
        <div className="kpi-label">Participación</div>
        <div className="kpi-detail">vs. interlocutor</div>
      </div>
    </div>
  );
}

// ─── Decisión Card ──────────────────────────────────────────────────

function DecisionCard({ dec, index }: { dec: MinutaDecision; index: number }) {
  const [open, setOpen] = useState(false);
  const badge = getDecisionBadge(dec.clasificacion, dec.estado);
  const title = dec.titulo || `Decisión ${index + 1}`;
  const body = dec.descripcion;
  const cita = dec.cita_textual || dec.cita;

  return (
    <div className={`hallazgo-card border-yellow${open ? ' open' : ''}`}>
      <h3>
        {title}
        <span className={`score-badge ${badge.cls}`}>{badge.label}</span>
      </h3>
      {body && <p className="que-significa">{body}</p>}
      <div className="hallazgo-toggle" onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        Ver detalles
      </div>
      <div className="hallazgo-details">
        {(dec.decidio || dec.responsable) && (
          <p style={{ fontSize: '.9rem', marginTop: 8 }}>
            <strong>Decidió:</strong> {dec.decidio || dec.responsable}
          </p>
        )}
        {dec.razonamiento && (
          <p style={{ fontSize: '.9rem', marginTop: 6 }}>
            <strong>Razonamiento:</strong> {dec.razonamiento}
          </p>
        )}
        {dec.condiciones && (
          <p style={{ fontSize: '.9rem', marginTop: 6 }}>
            <strong>Condiciones:</strong> {dec.condiciones}
          </p>
        )}
        {dec.fecha_resolucion && (
          <p style={{ fontSize: '.9rem', marginTop: 6 }}>
            <strong>Fecha de resolución:</strong> {dec.fecha_resolucion}
          </p>
        )}
        {dec.voto && (
          <p style={{ fontSize: '.9rem', marginTop: 6 }}>
            <strong>Voto:</strong> {dec.voto}
          </p>
        )}
        {cita && (
          <p style={{ fontSize: '.85rem', marginTop: 8, fontStyle: 'italic', opacity: 0.85 }}>
            «{cita}»
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Desglose Efectividad ───────────────────────────────────────────

function MinutaEfectividadDesglose({ componentes }: { componentes: MinutaComponenteEfectividad[] }) {
  if (!componentes || componentes.length === 0) return null;
  return (
    <div className="hallazgo-card border-yellow open">
      <div className="hallazgo-details" style={{ paddingTop: 0 }}>
        <div className="sub-scores">
          {componentes.map((c, i) => {
            const cls = getScoreClasses(c.score);
            return (
              <div key={i}>
                <div className="sub-score-row">
                  <span className="sub-score-label">{c.nombre}</span>
                  <div className="sub-score-track">
                    <div className={`sub-score-fill ${cls.fill}`} style={{ width: `${c.score}%` }} />
                  </div>
                  <span className={`sub-score-val ${cls.text}`}>{c.score}</span>
                </div>
                {c.justificacion && (
                  <p style={{ fontSize: '.78rem', opacity: 0.7, margin: '2px 0 8px 0', paddingLeft: 4 }}>
                    {c.justificacion}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Acción Card ────────────────────────────────────────────────────

function AccionCard({ acc, index, defaultOpen }: { acc: MinutaAccionCompleta; index: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const title = acc.descripcion || acc.accion || `Acción ${index + 1}`;
  const prio = getPriorityBadge(acc.prioridad);

  return (
    <div className={`reco-card${open ? ' open' : ''}`}>
      <span className="reco-num">{index + 1}</span>
      <h4 onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        {title}
        <span className="reco-toggle-hint">{open ? 'Ocultar' : 'Ver más'}</span>
      </h4>
      <div className="reco-details">
        <p className="impacto" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {acc.responsable && (
            <span>
              <strong>Responsable:</strong> {acc.responsable}
            </span>
          )}
          {acc.fecha_limite && (
            <span>
              <strong>Fecha límite:</strong> {acc.fecha_limite}
            </span>
          )}
        </p>
        <p className="impacto" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {acc.prioridad && (
            <span className={`score-badge ${prio.cls}`} style={{ fontSize: '.7rem' }}>
              {prio.label}
            </span>
          )}
          {acc.estado && (
            <span className="score-badge badge-yellow" style={{ fontSize: '.7rem' }}>
              {acc.estado}
            </span>
          )}
        </p>
        {acc.criterio_exito && (
          <div className="mejorado">
            <strong>Criterio de éxito:</strong> {acc.criterio_exito}
          </div>
        )}
        {acc.dependencias && acc.dependencias.length > 0 && (
          <p className="por-que">
            <strong>Dependencias:</strong> {acc.dependencias.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Acción Incompleta Card ─────────────────────────────────────────

function IncompleteCard({ acc, index, defaultOpen }: { acc: MinutaAccionIncompleta; index: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const title = acc.descripcion || acc.compromiso || `Pendiente ${index + 1}`;
  const quien = typeof acc.quien_lo_dijo === 'string'
    ? acc.quien_lo_dijo
    : acc.quien_lo_dijo?.nombre;

  return (
    <div className={`reco-card warning${open ? ' open' : ''}`}>
      <span className="reco-num" style={{ color: '#ef4444' }}>
        ⚠
      </span>
      <h4 onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        {title}
        <span className="reco-toggle-hint">{open ? 'Ocultar' : 'Ver más'}</span>
      </h4>
      <div className="reco-details">
        {quien && (
          <p className="impacto">
            <strong>Quién lo dijo:</strong> {quien}
          </p>
        )}
        {acc.falta && acc.falta.length > 0 && (
          <p className="impacto" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <strong style={{ marginRight: 4 }}>Falta:</strong>
            {acc.falta.map((f, i) => (
              <span key={i} className="score-badge badge-red" style={{ fontSize: '.7rem' }}>
                {f}
              </span>
            ))}
          </p>
        )}
        {acc.que_falta && (
          <p className="impacto">
            <strong>Qué falta:</strong> {acc.que_falta}
          </p>
        )}
        {acc.sugerencia && <p className="descripcion">{acc.sugerencia}</p>}
        {acc.cita && (
          <div className="original">
            <strong>Cita:</strong> «{acc.cita}»
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Seguimiento Card ───────────────────────────────────────────────

function SeguimientoCard({ seguimiento }: { seguimiento: MinutaSeguimientoData }) {
  if (!seguimiento) return null;
  const proxima = seguimiento.proxima_reunion;
  const agenda = seguimiento.agenda_sugerida ?? seguimiento.agenda_preliminar;
  const preparacion = seguimiento.preparacion_requerida ?? seguimiento.preparacion;
  const distribucion = seguimiento.distribucion_minuta ?? seguimiento.distribucion;

  const hasAny = !!(proxima || seguimiento.evento_adicional || agenda?.length || preparacion?.length || distribucion?.length);
  if (!hasAny) return null;

  return (
    <div className="insight-card open" style={{ paddingTop: 16 }}>
      <div className="insight-details" style={{ marginTop: 0 }}>
        {proxima && (
          <div className="minuta-info-section">
            <strong>📅 Próxima reunión:</strong>
            {typeof proxima === 'string' ? (
              <span> {proxima}</span>
            ) : (
              <span>
                {' '}
                {proxima.fecha} {proxima.hora && `· ${proxima.hora}`}
                {proxima.lugar && ` · ${proxima.lugar}`}
                {proxima.proposito && ` — ${proxima.proposito}`}
              </span>
            )}
          </div>
        )}
        {seguimiento.evento_adicional && (
          <div className="minuta-info-section">
            <strong>📍 Evento adicional:</strong> {seguimiento.evento_adicional}
          </div>
        )}
        {agenda && agenda.length > 0 && (
          <div className="minuta-info-section">
            <strong>📋 Agenda sugerida:</strong>
            <ul>
              {agenda.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {preparacion && preparacion.length > 0 && (
          <div className="minuta-info-section">
            <strong>📝 Preparación requerida:</strong>
            <ul>
              {preparacion.map((p, i) => {
                if (typeof p === 'string') return <li key={i}>{p}</li>;
                return (
                  <li key={i}>
                    <strong>{p.participante}:</strong> {p.preparacion}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {distribucion && distribucion.length > 0 && (
          <div className="minuta-info-section">
            <strong>📤 Distribución:</strong> {distribucion.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function MinutaDashboardV1({
  minuta,
}: {
  minuta: MeetingMinutesData;
  userName?: string;
}) {
  const decisiones = minuta.decisiones ?? [];
  const acciones = minuta.acciones?.lista ?? [];
  const pendientes = minuta.acciones_incompletas ?? [];
  const seguimiento = minuta.acciones?.seguimiento;
  const componentes = Array.isArray(minuta.efectividad?.componentes)
    ? minuta.efectividad.componentes
    : [];

  // Calcular % participación del usuario principal
  const distribucion = minuta.meta?.distribucion_participacion ?? [];
  const participacionPct = distribucion.length > 0
    ? Math.round(distribucion[0]?.porcentaje ?? 0)
    : null;

  return (
    <div className="space-y-4 py-2">
      <MinutaHero meta={minuta.meta} temas={minuta.temas} efectividad={minuta.efectividad} />

      <CapaLabel text="Resumen Ejecutivo" />
      <MinutaKPIStrip
        decisionesCount={decisiones.length}
        accionesCount=  {acciones.length}
        pendientesCount={pendientes.length}
        participacionPct={participacionPct}
      />

      {decisiones.length > 0 && (
        <>
          <CapaLabel text="Decisiones" />
          {decisiones.map((d, i) => (
            <DecisionCard key={d.id ?? i} dec={d} index={i} />
          ))}
        </>
      )}

      {componentes.length > 0 && (
        <>
          <CapaLabel text="Desglose de Efectividad" />
          <MinutaEfectividadDesglose componentes={componentes} />
        </>
      )}

      {acciones.length > 0 && (
        <>
          <CapaLabel text="Acciones" />
          {acciones.map((a, i) => (
            <AccionCard key={a.id ?? i} acc={a} index={i} defaultOpen={i === 0} />
          ))}
        </>
      )}

      {pendientes.length > 0 && (
        <>
          <CapaLabel text="Acciones Pendientes" />
          {pendientes.map((p, i) => (
            <IncompleteCard key={p.id ?? i} acc={p} index={i} defaultOpen={i === 0} />
          ))}
        </>
      )}

      {seguimiento && (
        <>
          <CapaLabel text="Seguimiento" />
          <SeguimientoCard seguimiento={seguimiento} />
        </>
      )}
    </div>
  );
}
