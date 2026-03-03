'use client';

import { Card, CardContent } from '@/components/ui/card';
import type {
  MinutaMeta,
  MinutaDecision,
  MinutaAccionIncompleta,
  MinutaAccionCompleta,
  MinutaGraficas,
} from '../../services/conversations.service';
import { getClasificacion } from '../../utils/normalize-meeting-minutes';

interface RadiografiaPalabras {
  palabras_usuario?: number;
  palabras_otros?: number;
}

interface MinutaKPIStripProps {
  meta: MinutaMeta;
  decisiones: MinutaDecision[];
  accionesIncompletas: MinutaAccionIncompleta[];
  acciones: MinutaAccionCompleta[];
  graficas?: MinutaGraficas;
  userName?: string;
  radiografia?: RadiografiaPalabras | null;
}

const ACCENT_BORDER: Record<string, string> = {
  blue: 'border-t-blue-500',
  purple: 'border-t-purple-500',
  green: 'border-t-green-500',
  amber: 'border-t-amber-500',
  cyan: 'border-t-cyan-500',
  orange: 'border-t-orange-500',
};

const ACCENT_TEXT: Record<string, string> = {
  blue: 'text-blue-400',
  purple: 'text-purple-400',
  green: 'text-green-400',
  amber: 'text-amber-400',
  cyan: 'text-cyan-400',
  orange: 'text-orange-400',
};

function getDecisionBreakdown(decisiones: MinutaDecision[]): string {
  if (decisiones.length === 0) return 'Sin decisiones formales';
  const conf = decisiones.filter(d => getClasificacion(d) === 'CONFIRMADA').length;
  const tent = decisiones.filter(d => getClasificacion(d) === 'TENTATIVA').length;
  const dif = decisiones.filter(d => getClasificacion(d) === 'DIFERIDA').length;
  const parts: string[] = [];
  if (conf > 0) parts.push(`${conf} confirmadas`);
  if (tent > 0) parts.push(`${tent} tentativas`);
  if (dif > 0) parts.push(`${dif} diferidas`);
  return parts.join(', ');
}

function getInterlocutorDetail(meta: MinutaMeta, graficas?: MinutaGraficas): string {
  const GENERIC_NAMES = ['user', 'usuario', 'otro', 'unknown', 'no especificado'];
  const roles = [...new Set(
    (meta.participantes || []).map(p => p.rol).filter(r => r && !GENERIC_NAMES.includes(r.toLowerCase()))
  )];

  const leaderName = graficas?.participacion_kpi?.principal?.nombre
    || meta.distribucion_participacion?.[0]?.nombre;

  const parts: string[] = [];
  if (roles.length > 0) parts.push(roles.join(', '));
  if (leaderName && !GENERIC_NAMES.includes(leaderName.toLowerCase())) {
    parts.push(`Lidera: ${leaderName}`);
  }
  if (parts.length === 0) {
    const count = meta.participantes?.length || 0;
    return count > 0 ? `${count} participantes` : '-';
  }
  return parts.join('. ');
}

function getTasksPendingDetail(
  incompletas: MinutaAccionIncompleta[],
  totalCompletas: number,
): string {
  const total = incompletas.length + totalCompletas;
  if (total === 0 && incompletas.length === 0) return 'Sin tareas definidas';
  if (incompletas.length === 0) return 'Todo asignado y con fecha';
  const sinDueno = incompletas.filter(a => {
    const falta = a.falta || [];
    const queFalta = a.que_falta || '';
    return falta.some(f => f.toLowerCase().includes('dueño') || f.toLowerCase().includes('responsable'))
      || queFalta.toLowerCase().includes('dueño') || queFalta.toLowerCase().includes('responsable');
  }).length;
  const sinFecha = incompletas.filter(a => {
    const falta = a.falta || [];
    const queFalta = a.que_falta || '';
    return falta.some(f => f.toLowerCase().includes('fecha'))
      || queFalta.toLowerCase().includes('fecha');
  }).length;
  const parts: string[] = [];
  if (sinDueno > 0) parts.push(`${sinDueno} sin dueño`);
  if (sinFecha > 0) parts.push(`${sinFecha} sin fecha`);
  return parts.length > 0 ? parts.join(', ') : `${incompletas.length} incompletas`;
}

function getParticipacionKPI(
  meta: MinutaMeta,
  graficas?: MinutaGraficas,
  userName?: string,
  radiografia?: RadiografiaPalabras | null,
) {
  const NON_USER_NAMES = ['interlocutor', 'otro', 'otros', 'unknown', 'no especificado'];
  const name = userName || '';

  if (radiografia && ((radiografia.palabras_usuario || 0) + (radiografia.palabras_otros || 0)) > 0) {
    const total = (radiografia.palabras_usuario || 0) + (radiografia.palabras_otros || 0);
    const userPct = Math.round(((radiografia.palabras_usuario || 0) / total) * 100);
    const intPct = 100 - userPct;
    return {
      value: `${userPct}% / ${intPct}%`,
      detail: `${name} ${userPct}%, Interlocutor ${intPct}%`,
    };
  }

  if (graficas?.participacion_kpi) {
    const { principal, interlocutores_porcentaje } = graficas.participacion_kpi;
    const restPct = (principal.porcentaje + interlocutores_porcentaje > 100)
      ? (100 - principal.porcentaje)
      : interlocutores_porcentaje;

    const principalIsUser = userName
      ? principal.nombre.toLowerCase().includes(userName.split(' ')[0].toLowerCase())
      : !NON_USER_NAMES.includes(principal.nombre.toLowerCase());

    const userPct = principalIsUser ? principal.porcentaje : restPct;
    const intPct = principalIsUser ? restPct : principal.porcentaje;

    return {
      value: `${userPct}% / ${intPct}%`,
      detail: `${name} ${userPct}%, Interlocutor ${intPct}%`,
    };
  }

  const dist = meta.distribucion_participacion;
  if (dist && dist.length > 0) {
    const principal = dist[0];
    const restoPct = dist.slice(1).reduce((sum, d) => sum + d.porcentaje, 0);

    const principalIsUser = userName
      ? principal.nombre.toLowerCase().includes(userName.split(' ')[0].toLowerCase())
      : !NON_USER_NAMES.includes(principal.nombre.toLowerCase());

    const userPct = principalIsUser ? principal.porcentaje : restoPct;
    const intPct = principalIsUser ? restoPct : principal.porcentaje;

    return {
      value: `${userPct}% / ${intPct}%`,
      detail: `${name} ${userPct}%, Interlocutor ${intPct}%`,
    };
  }
  return { value: '-', detail: '-' };
}

export function MinutaKPIStrip({ meta, decisiones, accionesIncompletas, acciones, graficas, userName, radiografia }: MinutaKPIStripProps) {
  const conf = decisiones.filter(d => getClasificacion(d) === 'CONFIRMADA').length;
  const totalDecisiones = decisiones.length;
  const totalTareas = accionesIncompletas.length + acciones.length;
  const participacion = getParticipacionKPI(meta, graficas, userName, radiografia);

  const kpis = [
    {
      icon: '🏷️',
      number: meta.tipo_reunion,
      label: 'Tipo de reunión',
      detail: meta.tipo_secundario || meta.categoria_interlocutor || '-',
      accent: 'blue',
    },
    {
      icon: '👥',
      number: meta.categoria_interlocutor || '-',
      label: 'Interlocutor',
      detail: getInterlocutorDetail(meta, graficas),
      accent: 'purple',
    },
    {
      icon: '✅',
      number: `${conf}/${totalDecisiones}`,
      label: 'Decisiones',
      detail: getDecisionBreakdown(decisiones),
      accent: 'green',
    },
    {
      icon: '📋',
      number: `${accionesIncompletas.length}/${totalTareas}`,
      label: 'Pendientes',
      detail: getTasksPendingDetail(accionesIncompletas, acciones.length),
      accent: 'amber',
    },
    {
      icon: '⏱️',
      number: meta.duracion_minutos ? `${meta.duracion_minutos} min` : '-',
      label: 'Duración',
      detail: meta.hora_inicio && meta.hora_fin
        && !meta.hora_inicio.toLowerCase().includes('no especificad')
        && !meta.hora_fin.toLowerCase().includes('no especificad')
        ? `${meta.hora_inicio} – ${meta.hora_fin}` : meta.fecha,
      accent: 'cyan',
    },
    {
      icon: '💬',
      number: participacion.value,
      label: 'Participación',
      detail: participacion.detail,
      accent: 'orange',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {kpis.map((kpi, index) => (
        <Card
          key={index}
          className={`bg-card border border-border border-t-[3px] ${ACCENT_BORDER[kpi.accent]} hover:-translate-y-0.5 hover:shadow-lg transition-all`}
        >
          <CardContent className="p-4 text-center">
            <div className="text-2xl mb-1.5">{kpi.icon}</div>
            <div className={`text-xl font-extrabold leading-tight ${ACCENT_TEXT[kpi.accent]} capitalize`}>
              {kpi.number}
            </div>
            <div className="text-xs font-semibold mt-1 text-foreground">{kpi.label}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
              {kpi.detail}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
