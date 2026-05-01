'use client';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ResumenHero } from './ResumenHero';
import { TuRadarCard } from './TuRadarCard';
import { KPIGrid } from './KPIGrid';
import { InsightsGrid } from './InsightsGrid';
import { HallazgosSection } from './HallazgosSection';
import { RecomendacionesSection } from './RecomendacionesSection';
import { CapaLabel } from './CapaLabel';
import type { CommunicationFeedbackV4 } from './types';
import './dashboard.css';

const MOCK: CommunicationFeedbackV4 = {
  resumen: {
    puntuacion_global: 78,
    nivel: 'Bueno',
    bullets: [
      'Excelente conexión empática con el interlocutor en momentos clave de la conversación.',
      'La estructura del discurso pierde fuerza en las transiciones entre temas.',
      'Cierres vagos que generan ambigüedad sobre los acuerdos y compromisos pactados.',
    ],
    fortaleza: 'Empatía',
    fortaleza_hint: 'Captas y validas emociones del otro de forma natural',
    mejorar: 'Estructura',
    mejorar_hint: 'Define apertura, desarrollo y cierre claros',
  },
  calidad_global: {
    puntaje: 78,
    componentes: {
      claridad: 82,
      estructura: 65,
      persuasion: 74,
      proposito: 80,
      adaptacion: 78,
      empatia: 88,
    },
  },
  radiografia: {
    muletillas_total: 23,
    muletillas_frecuencia: '1 cada 43 palabras',
    preguntas_total: 12,
    ratio_habla: 58,
  },
  patron: {
    actual: 'Conversador empático pero disperso',
    evolucion: 'Comunicador estructurado y preciso',
    que_cambiaria: 'Si trabajas la estructura sin perder la calidez, multiplicas tu impacto.',
  },
  insights: [
    {
      dato: 'Hablaste un 58% del tiempo, dejando 42% al interlocutor.',
      por_que: 'En conversaciones de venta el ratio ideal es 30/70 (escuchas más).',
      sugerencia: 'Haz 1 pregunta abierta por cada bloque de 2 minutos hablando.',
    },
    {
      dato: 'Usaste "básicamente" 14 veces y "en realidad" 9 veces.',
      por_que: 'Estas muletillas comunican inseguridad y diluyen la autoridad de tu mensaje.',
      sugerencia: 'Reemplaza por silencios cortos. Practica leer en voz alta sin estas palabras.',
    },
    {
      dato: 'En el minuto 12 hubo un silencio de 8 segundos después de una pregunta del cliente.',
      por_que: 'Silencios largos post-pregunta sugieren falta de preparación o duda.',
      sugerencia: 'Prepara respuestas a las 5 preguntas más comunes de tu rol.',
    },
  ],
  dimensiones: {
    claridad: {
      puntaje: 82,
      nivel: 'Bueno',
      que_significa: 'Tus ideas se entendieron sin esfuerzo en el 82% de las intervenciones.',
      cita: 'El objetivo es revisar resultados Q3 y definir 3 acciones',
      prueba_esto: 'Resumir al inicio establece foco y reduce confusiones.',
      sub_scores: [
        { label: 'Vocabulario', valor: 85 },
        { label: 'Sintaxis', valor: 80 },
        { label: 'Concisión', valor: 78 },
      ],
    },
    estructura: {
      puntaje: 65,
      nivel: 'Aceptable',
      que_significa: 'Las transiciones entre temas no fueron explícitas, generando saltos.',
      cita: 'Bueno, pasando a otro tema, pero antes...',
      prueba_esto: 'Usa frases de transición claras: "Cerrando este punto, pasemos a X".',
    },
    persuasion: {
      puntaje: 74,
      nivel: 'Bueno',
      que_significa: 'Usaste evidencia y ejemplos concretos para 7 de tus argumentos.',
      cita: 'En el último Q vimos un crecimiento del 23% en MRR',
      prueba_esto: 'Anchora cada argumento principal a una métrica o evidencia concreta.',
    },
    proposito: {
      puntaje: 80,
      nivel: 'Bueno',
      que_significa: 'El objetivo de la conversación quedó claro desde el primer minuto.',
      cita: 'Hoy quiero alinear contigo el plan del próximo sprint',
      prueba_esto: 'Cierra confirmando que el objetivo se cumplió antes de despedirte.',
    },
    empatia: {
      puntaje: 88,
      nivel: 'Excelente',
      que_significa: 'Validaste emociones del interlocutor en 6 momentos clave.',
      cita: 'Entiendo que es frustrante cuando el equipo no responde a tiempo',
      prueba_esto: 'Sigue usando reformulaciones empáticas; son tu mayor ventaja.',
    },
    adaptacion: {
      puntaje: 78,
      nivel: 'Bueno',
      que_significa: 'Ajustaste el tono y vocabulario al perfil técnico del interlocutor.',
      cita: 'Te lo explico en términos de la arquitectura que ya conoces',
      prueba_esto: 'Pregunta el background del interlocutor al inicio para calibrar mejor.',
    },
  },
  recomendaciones: [
    {
      prioridad: 1,
      titulo: 'Mejorar estructura de apertura',
      descripcion: 'El inicio carece de un encuadre claro que establezca el propósito.',
      texto_original: 'Bueno, pues aquí estamos para hablar de...',
      texto_mejorado:
        'El objetivo de esta reunión es revisar los resultados del Q3 y definir tres acciones concretas.',
      impacto: '+20% claridad percibida desde el primer minuto',
      por_que: 'Sin estructura inicial, el interlocutor tarda en sintonizar el contexto.',
    },
    {
      prioridad: 2,
      titulo: 'Reforzar cierre con llamada a acción',
      descripcion: 'Las conclusiones no definen responsables ni fechas.',
      texto_original: 'Entonces quedamos en eso, ¿no?',
      texto_mejorado:
        'Para confirmar: tú llevas el informe el viernes y yo preparo la presentación para el lunes.',
      impacto: '+35% tasa de seguimiento de compromisos',
      por_que: 'Los cierres vagos generan ambigüedad y falta de accountability.',
    },
    {
      prioridad: 3,
      titulo: 'Reducir muletillas de relleno',
      descripcion: '"Básicamente" y "en realidad" aparecen 23 veces y diluyen la autoridad.',
      texto_original: 'Básicamente, en realidad lo que pasa es...',
      texto_mejorado: 'El problema central es...',
      impacto: '+15% percepción de confianza y autoridad',
      por_que: 'Las muletillas señalan inseguridad y fragmentan el mensaje.',
    },
  ],
};

export default function DashboardV1Preview() {
  const router = useRouter();
  return (
    <div className="dashboard-v1-scope" style={{ minHeight: '100vh', overflowY: 'auto', height: '100vh' }}>
      <div className="container">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <button
            onClick={() => router.back()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '.85rem',
              color: '#6b7280',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
          <span
            style={{
              padding: '2px 10px',
              fontSize: '.72rem',
              fontWeight: 600,
              borderRadius: 999,
              background: 'rgba(59,130,246,.15)',
              color: '#3b82f6',
            }}
          >
            Preview Dashboard V1 (datos MOCK)
          </span>
        </div>
        <ResumenHero feedback={MOCK} />
        <TuRadarCard feedback={MOCK} />
        <CapaLabel text="Radiografía Rápida" />
        <KPIGrid feedback={MOCK} />
        <CapaLabel text="Lo Que Quizás No Notaste" />
        <InsightsGrid feedback={MOCK} />
        <CapaLabel text="Capa 2 — Hallazgos Detallados" />
        <HallazgosSection feedback={MOCK} />
        <CapaLabel text="Top 3 Recomendaciones" />
        <RecomendacionesSection feedback={MOCK} />
      </div>
    </div>
  );
}
