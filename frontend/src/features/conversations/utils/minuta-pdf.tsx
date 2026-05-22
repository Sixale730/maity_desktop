/**
 * PDF document for Minuta v2.
 *
 * Cargado vía dynamic import desde MinutaToolbar — mantiene
 * @react-pdf/renderer fuera del bundle inicial de Next.js.
 */
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import type { MeetingMinutesDataV2 } from '@/features/conversations/services/conversations.service';

Font.registerHyphenationCallback((w) => [w]);

const palette = {
  ink: '#111827',
  text: '#1f2937',
  muted: '#6b7280',
  hairline: '#e5e7eb',
  accent: '#0891b2',
  amber: '#b45309',
  slate: '#475569',
};

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: palette.text,
    lineHeight: 1.5,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
    paddingBottom: 12,
    marginBottom: 18,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: palette.ink,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    fontSize: 9,
    color: palette.muted,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 6,
  },
  tldrBox: {
    backgroundColor: '#f9fafb',
    borderLeftWidth: 2,
    borderLeftColor: palette.accent,
    padding: 10,
    fontSize: 11,
    color: palette.ink,
  },
  keywordsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
  },
  keyword: {
    fontSize: 8,
    color: palette.muted,
    borderWidth: 0.5,
    borderColor: palette.hairline,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  chapterTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: palette.ink,
    marginTop: 8,
    marginBottom: 3,
  },
  bullet: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  bulletDot: {
    width: 10,
    color: palette.accent,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    color: palette.text,
  },
  card: {
    borderWidth: 0.5,
    borderColor: palette.hairline,
    padding: 8,
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 10.5,
    fontFamily: 'Helvetica-Bold',
    color: palette.ink,
    marginBottom: 2,
  },
  cardMeta: {
    fontSize: 9,
    color: palette.muted,
  },
  cite: {
    fontSize: 9,
    fontStyle: 'italic',
    color: palette.muted,
    borderLeftWidth: 1.5,
    borderLeftColor: palette.hairline,
    paddingLeft: 6,
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: palette.muted,
    textAlign: 'center',
    borderTopWidth: 0.5,
    borderTopColor: palette.hairline,
    paddingTop: 6,
  },
});

interface MinutaPdfDocumentProps {
  minuta: MeetingMinutesDataV2;
}

export function MinutaPdfDocument({ minuta }: MinutaPdfDocumentProps) {
  const idioma = minuta.meta.idioma ?? 'es';
  const labels = LABELS[idioma];

  return (
    <Document title={minuta.meta.titulo}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{minuta.meta.titulo}</Text>
          <View style={styles.metaRow}>
            <Text>{minuta.meta.tipo_reunion}</Text>
            {minuta.meta.fecha && <Text>· {minuta.meta.fecha}</Text>}
            {minuta.meta.duracion_minutos != null && (
              <Text>· {minuta.meta.duracion_minutos} {labels.minutes_abbr}</Text>
            )}
            {minuta.meta.participantes?.length > 0 && (
              <Text>· {minuta.meta.participantes.length} {labels.participants.toLowerCase()}</Text>
            )}
          </View>
          {minuta.meta.participantes?.length > 0 && (
            <Text style={[styles.cardMeta, { marginTop: 4 }]}>
              {minuta.meta.participantes.map((p) => (p.rol ? `${p.nombre} (${p.rol})` : p.nombre)).join(', ')}
            </Text>
          )}
        </View>

        {minuta.tldr && (
          <>
            <Text style={styles.sectionTitle}>{labels.tldr_label}</Text>
            <View style={styles.tldrBox}>
              <Text>{minuta.tldr}</Text>
            </View>
          </>
        )}

        {minuta.keywords?.length > 0 && (
          <View style={styles.keywordsRow}>
            {minuta.keywords.map((kw, i) => (
              <Text key={i} style={styles.keyword}>
                {kw}
              </Text>
            ))}
          </View>
        )}

        {minuta.chapters?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{labels.chapters}</Text>
            {minuta.chapters.map((ch) => (
              <View key={ch.id} wrap={false} style={{ marginBottom: 6 }}>
                <Text style={styles.chapterTitle}>{ch.titulo}</Text>
                {ch.bullets?.map((b, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>{b.texto}</Text>
                  </View>
                ))}
              </View>
            ))}
          </>
        )}

        {minuta.decisiones?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              {labels.decisions} ({minuta.decisiones.length})
            </Text>
            {minuta.decisiones.map((d) => (
              <View key={d.id} style={styles.card} wrap={false}>
                <Text style={styles.cardTitle}>
                  {d.titulo}
                  {d.estado !== 'confirmada' && (
                    <Text style={{ color: d.estado === 'tentativa' ? palette.amber : palette.slate }}>
                      {' '}
                      [{d.estado === 'tentativa' ? labels.tentative : labels.deferred}]
                    </Text>
                  )}
                </Text>
                {d.descripcion && <Text style={styles.cardMeta}>{d.descripcion}</Text>}
                <Text style={[styles.cardMeta, { marginTop: 3 }]}>
                  {d.decidio && (
                    <Text>
                      <Text style={{ color: palette.ink }}>{labels.decided_by}:</Text> {d.decidio}
                      {'   '}
                    </Text>
                  )}
                  {d.condiciones && (
                    <Text>
                      <Text style={{ color: palette.ink }}>{labels.conditions}:</Text> {d.condiciones}
                    </Text>
                  )}
                </Text>
                {d.cita && <Text style={styles.cite}>«{d.cita}»</Text>}
              </View>
            ))}
          </>
        )}

        {minuta.acciones?.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              {labels.actions} ({minuta.acciones.length})
            </Text>
            {minuta.acciones.map((a) => (
              <View key={a.id} style={styles.card} wrap={false}>
                <Text style={styles.cardTitle}>{a.accion}</Text>
                <Text style={styles.cardMeta}>
                  <Text style={{ color: palette.ink }}>{labels.owner}:</Text>{' '}
                  {a.responsable || `[${labels.missing_owner}]`}
                  {'   '}
                  <Text style={{ color: palette.ink }}>{labels.due_date}:</Text>{' '}
                  {a.fecha_limite || `[${labels.missing_date}]`}
                  {a.prioridad && (
                    <Text>
                      {'   '}
                      <Text style={{ color: palette.ink }}>{labels.priority}:</Text>{' '}
                      {labels[`priority_${a.prioridad}` as keyof typeof labels]}
                    </Text>
                  )}
                </Text>
                {!a.completa && a.falta && a.falta.length > 0 && (
                  <Text style={[styles.cardMeta, { color: palette.amber, marginTop: 2 }]}>
                    ⚠ {labels.missing_label}: {a.falta.map((f) => labels[`missing_${f}` as keyof typeof labels]).join(', ')}
                  </Text>
                )}
                {a.cita && <Text style={styles.cite}>«{a.cita}»</Text>}
              </View>
            ))}
          </>
        )}

        {minuta.seguimiento && renderSeguimiento(minuta.seguimiento, labels)}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${labels.generated_by} — ${pageNumber}/${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function renderSeguimiento(
  s: NonNullable<MeetingMinutesDataV2['seguimiento']>,
  labels: (typeof LABELS)[keyof typeof LABELS],
) {
  const hasContent =
    s.proxima_reunion ||
    (s.agenda_preliminar?.length ?? 0) > 0 ||
    (s.preparacion_requerida?.length ?? 0) > 0 ||
    (s.distribucion?.length ?? 0) > 0;
  if (!hasContent) return null;

  return (
    <>
      <Text style={styles.sectionTitle}>{labels.followup}</Text>
      <View style={styles.card}>
        {s.proxima_reunion && (
          <Text style={styles.cardMeta}>
            <Text style={{ color: palette.ink, fontFamily: 'Helvetica-Bold' }}>{labels.next_meeting}:</Text>{' '}
            {[s.proxima_reunion.fecha, s.proxima_reunion.hora, s.proxima_reunion.proposito]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}
        {s.agenda_preliminar?.length > 0 && (
          <Text style={[styles.cardMeta, { marginTop: 3 }]}>
            <Text style={{ color: palette.ink, fontFamily: 'Helvetica-Bold' }}>{labels.agenda}:</Text>{' '}
            {s.agenda_preliminar.join(' · ')}
          </Text>
        )}
        {s.preparacion_requerida?.length > 0 && (
          <Text style={[styles.cardMeta, { marginTop: 3 }]}>
            <Text style={{ color: palette.ink, fontFamily: 'Helvetica-Bold' }}>{labels.preparation}:</Text>{' '}
            {s.preparacion_requerida.map((p) => `${p.participante}: ${p.preparacion}`).join(' · ')}
          </Text>
        )}
        {s.distribucion?.length > 0 && (
          <Text style={[styles.cardMeta, { marginTop: 3 }]}>
            <Text style={{ color: palette.ink, fontFamily: 'Helvetica-Bold' }}>{labels.distribution}:</Text>{' '}
            {s.distribucion.join(', ')}
          </Text>
        )}
      </View>
    </>
  );
}

const LABELS = {
  es: {
    tldr_label: 'En 30 segundos',
    chapters: 'Capítulos',
    decisions: 'Decisiones',
    actions: 'Acciones',
    followup: 'Seguimiento',
    participants: 'Participantes',
    minutes_abbr: 'min',
    decided_by: 'Decidió',
    conditions: 'Condiciones',
    owner: 'Responsable',
    due_date: 'Fecha límite',
    priority: 'Prioridad',
    priority_alta: 'Alta',
    priority_media: 'Media',
    priority_baja: 'Baja',
    tentative: 'Tentativa',
    deferred: 'Diferida',
    missing_label: 'Falta',
    missing_owner: 'Sin responsable',
    missing_date: 'Sin fecha',
    'missing_dueño': 'responsable',
    missing_fecha: 'fecha',
    next_meeting: 'Próxima reunión',
    agenda: 'Agenda',
    preparation: 'Preparación',
    distribution: 'Distribución',
    generated_by: 'Generado por Maity',
  },
  en: {
    tldr_label: 'TL;DR',
    chapters: 'Chapters',
    decisions: 'Decisions',
    actions: 'Actions',
    followup: 'Follow-up',
    participants: 'Participants',
    minutes_abbr: 'min',
    decided_by: 'Decided by',
    conditions: 'Conditions',
    owner: 'Owner',
    due_date: 'Due date',
    priority: 'Priority',
    priority_alta: 'High',
    priority_media: 'Medium',
    priority_baja: 'Low',
    tentative: 'Tentative',
    deferred: 'Deferred',
    missing_label: 'Missing',
    missing_owner: 'No owner',
    missing_date: 'No date',
    'missing_dueño': 'owner',
    missing_fecha: 'date',
    next_meeting: 'Next meeting',
    agenda: 'Agenda',
    preparation: 'Preparation',
    distribution: 'Distribution',
    generated_by: 'Generated by Maity',
  },
} as const;
