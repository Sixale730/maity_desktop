/**
 * Shim de i18n para que los componentes del web que usan `useLanguage()`
 * sigan funcionando en el desktop sin instalar i18n. Hardcoded a español.
 *
 * Vive en `src/contexts/LanguageContext.tsx`. Si más adelante metes i18n
 * real (next-intl, react-i18next), reemplaza este archivo con tu integración
 * sin tocar los componentes del web.
 *
 * Si una llave no está aquí, `t(key)` devuelve la llave tal cual — así no
 * se rompe la UI, sólo verás texto tipo "chat.foo" donde falte traducción.
 */
'use client'

const STRINGS: Record<string, string> = {
  // === Chat (general) ===
  'chat.title': 'Chat con Maity',
  'chat.login_required': 'Inicia sesión para conversar con Maity y guardar tus memorias.',
  'chat.search': 'Buscar',
  'chat.notifications': 'Notificaciones',
  'chat.new_session': 'Nueva sesión',
  'chat.no_threads_filter': 'Sin entradas este día.',
  'chat.today_entries': 'Entradas de hoy',
  'chat.coming_soon': 'Próximamente',

  // === Zonas ===
  'chat.zone_productividad': 'Productividad',
  'chat.zone_productividad_hint': 'Tu día a día con Maity',
  'chat.zone_practica': 'Práctica',
  'chat.zone_practica_hint': 'Entrenar y aprender',

  // === Nav ===
  'chat.nav_hoy': 'Hoy',
  'chat.nav_conversaciones': 'Mis Conversaciones',
  'chat.nav_conv_badge': '',
  'chat.nav_progress': 'Mi Progreso',

  // === Calendario ===
  'chat.calendar': 'Calendario',
  'chat.this_week': 'Esta semana',
  'chat.last_week': 'Sem pasada',
  'chat.weeks_ago': 'Hace {n} sem',
  'chat.day_letters': 'L,M,M,J,V,S,D',

  // === Urgencia ===
  'chat.urgency_label': 'Urgencia',
  'chat.urgency_now': 'Hoy',
  'chat.urgency_week': 'Esta semana',
  'chat.urgency_calm': 'Calmado',

  // === Empty state ===
  'chat.empty_topbar_title': 'Nueva sesión',
  'chat.empty_topbar_sub': 'Empieza a escribir o elige un punto de partida',
  'chat.session_new': 'Sesión nueva',
  'chat.empty_hero_l1': '¿Qué te gustaría',
  'chat.empty_hero_l2': 'trabajar con Maity hoy?',
  'chat.empty_hero_sub':
    'Empieza a escribir, o elige un punto de partida. Maity te escucha — tú eliges cómo (si quieres).',

  // === Starter cards ===
  'chat.starter_thinking': 'Algo que estoy pensando',
  'chat.starter_thinking_hint': 'Maity ordena tus ideas en voz alta.',
  'chat.starter_thinking_message_open':
    'Quiero ordenar algo que tengo en la cabeza. ¿Por dónde empezamos?',
  'chat.starter_decision': 'Algo que tengo que decidir',
  'chat.starter_decision_hint': 'Estructuramos opciones, riesgos y criterios.',
  'chat.starter_decision_message_open':
    'Tengo una decisión que tomar y no la veo clara. ¿Me ayudas a estructurarla?',
  'chat.starter_rehearsal': 'Algo que quiero ensayar',
  'chat.starter_rehearsal_hint': 'Practicamos la conversación antes de tenerla.',
  'chat.starter_rehearsal_message_open':
    'Quiero ensayar una conversación antes de tenerla. ¿Empezamos?',
  'chat.starter_reflection': 'Algo que ya pasó',
  'chat.starter_reflection_hint': 'Procesamos sin que se pierda en la inercia.',
  'chat.starter_reflection_message_open':
    'Quiero procesar algo que ya pasó. ¿Me ayudas?',

  // === Ejemplos de cada starter card (pills) ===
  'chat.starter_thinking_ex_1': 'Cambio de equipo',
  'chat.starter_thinking_ex_2': 'Decisión que ronda',
  'chat.starter_thinking_ex_3': '1:1 del viernes',
  'chat.starter_decision_ex_1': 'Aceptar oferta',
  'chat.starter_decision_ex_2': 'Despedir o coachear',
  'chat.starter_decision_ex_3': 'Build vs buy',
  'chat.starter_rehearsal_ex_1': 'Pedir aumento',
  'chat.starter_rehearsal_ex_2': 'Feedback duro',
  'chat.starter_rehearsal_ex_3': 'Cerrar junta',
  'chat.starter_reflection_ex_1': 'La junta del jueves',
  'chat.starter_reflection_ex_2': 'Por qué me drené',
  'chat.starter_reflection_ex_3': '',

  // === Mis conversaciones (sidebar minimal) ===
  'chat.my_conversations': 'Mis conversaciones',
  'chat.no_conversations': 'Aún no tienes conversaciones. Crea una nueva para empezar.',

  // === Banner pendiente ===
  'chat.open_loop_label': '{n} entrada abierta',
  'chat.continue': 'Continuar',

  // === Turnos ===
  'chat.role_me': 'Yo',
  'chat.role_maity': 'Maity',

  // === Composer ===
  'chat.composer_placeholder': 'Pregúntale algo a Maity, o pídele que te rete…',
  'chat.composer_hint_send': 'Enter envía',
  'chat.composer_send': 'Enviar',
  'chat.composer_sending': 'Enviando…',

  // === Lentes ===
  'chat.lens_header': 'Cómo quieres que Maity escuche',
  'chat.lens_open': 'Abierta',
  'chat.lens_open_hint': 'Maity decide cómo escucharte.',
  'chat.lens_ask': 'Pregúntame',
  'chat.lens_ask_hint': 'Maity hace preguntas, no propone.',
  'chat.lens_mirror': 'Refléjame',
  'chat.lens_mirror_hint': 'Maity te devuelve lo que dijiste.',
  'chat.lens_push': 'Rétame',
  'chat.lens_push_hint': 'Maity cuestiona y empuja.',
  'chat.lens_sum': 'Resúmeme',
  'chat.lens_sum_hint': 'Maity sintetiza y deja por escrito.',

  // === Memorias ===
  'chat.memories': 'Memorias',
  'chat.memories_description':
    'Lo que Maity recuerda de ti entre sesiones. Tú apruebas qué se queda.',
  'chat.memories_tab_all': 'Todo',
  'chat.memories_tab_pending': 'Pendientes',
  'chat.memories_tab_approved': 'Aprobadas',
  'chat.memories_empty': 'Aún no hay memorias. Maity las irá creando.',
  'chat.memories_empty_pending': 'Sin memorias pendientes.',
  'chat.memories_empty_approved': 'Aún no apruebas ninguna memoria.',
  'chat.memories_add_placeholder': 'Agregar memoria manual…',
  'chat.memories_paused': 'Extracción pausada',
  'chat.memories_active': 'Extracción activa',
  'chat.memories_paused_hint': 'Maity no está creando memorias nuevas.',
  'chat.memories_active_hint': 'Maity propone memorias después de cada chat.',
  'chat.memories_approve': 'Aprobar',
  'chat.memories_reject': 'Descartar',
  'chat.memories_edit': 'Editar',
  'chat.memories_delete': 'Eliminar',
  'chat.memories_save': 'Guardar',
  'chat.memories_cancel': 'Cancelar',

  // === Top bar ===
  'chat.topbar_more': 'Más opciones',

  // === Roles + Nav (usados por SidebarFooterV5) ===
  'roles.default_user': 'Usuario',
  'nav.avatar': 'Mi Avatar',
  'nav.logout': 'Cerrar sesión',

  // === Composer (faltantes detectadas) ===
  'chat.send': 'Enviar',
  'chat.voice': 'Voz',
  'chat.attach': 'Adjuntar documento',

  // === Adjuntos (extracción de documentos) ===
  'chat.attachment_remove': 'Quitar adjunto',
  'chat.attachment_max': 'Máximo 3 documentos por mensaje.',
  'chat.attachment_error.unsupported': 'Formato no soportado. Usa PDF, Word, Excel o texto.',
  'chat.attachment_error.empty': 'No se encontró texto en el documento (¿es un PDF escaneado?).',
  'chat.attachment_error.failed': 'No se pudo leer el documento. Intenta con otro archivo.',

  // === TopBar / Conversación ===
  'chat.more': 'Más opciones',
  'chat.subtitle_messages_one': '1 mensaje',
  'chat.subtitle_messages_many': '{n} mensajes',
  'chat.entry_open': 'abierta',

  // === ChatConversation / ChatTurn ===
  'chat.loading': 'Cargando…',
  'chat.loading_messages': 'Cargando mensajes…',
  'chat.last_used': 'Usada',
  'chat.download_pdf': 'Descargar PDF',
  'chat.export_failed': 'No se pudo exportar',
  'chat.exporting': 'Exportando…',
  'chat.copy_markdown': 'Copiar Markdown',
  'chat.download_markdown': 'Descargar .md',
  'chat.copy_success': 'Copiado al portapapeles',
  'chat.copy_failed': 'No se pudo copiar',

  // === Presentaciones .pptx (artifact deck) ===
  'chat.download_pptx': 'Descargar .pptx',
  'chat.deck_slides': 'slides',

  // === Pills de tareas/notas (hidratadas desde BD) ===
  'chat.pill_task_saved': 'Tarea guardada',
  'chat.pill_note_saved': 'Nota guardada',

  // === Streaming ===
  'chat.streaming': 'Escribiendo…',

  // === Reportar bug/idea (BugReportDialog) ===
  'chat.report.button': 'Reportar un problema',
  'chat.report.title': 'Reportar un problema o idea',
  'chat.report.description':
    'Cuéntanos qué falló o qué te gustaría. Tu reporte llega directo al equipo.',
  'chat.report.category': 'Tipo',
  'chat.report.category.bug': 'Algo falló (bug)',
  'chat.report.category.idea': 'Idea o sugerencia',
  'chat.report.category.confusing': 'Algo confuso',
  'chat.report.category.other': 'Otro',
  'chat.report.detail': 'Descripción',
  'chat.report.placeholder': 'Describe qué pasó, qué esperabas, o tu idea…',
  'chat.report.include_context': 'Incluir el contexto de esta conversación',
  'chat.report.submit': 'Enviar reporte',
  'chat.report.sending': 'Enviando…',
  'chat.report.success': '¡Gracias! Tu reporte fue enviado.',
  'chat.report.error': 'No se pudo enviar el reporte. Intenta de nuevo.',
  'chat.report.empty': 'Escribe una descripción antes de enviar.',

  // === Hero del empty (variantes alternativas usadas) ===
  'chat.hero_title': '¿Qué te gustaría trabajar con Maity hoy?',
  'chat.hero_subtitle': 'Empieza a escribir, o elige un punto de partida.',

  // === OpenLoopBanner ===
  'chat.open_loop_yesterday': 'Ayer dejaste algo abierto',

  // === Sugerencias del empty ===
  'chat.suggestion_1': '¿Qué traes en la cabeza?',
  'chat.suggestion_2': 'Decisión pendiente',
  'chat.suggestion_3': 'Repaso del día',
  'chat.suggestion_4': 'Plan para mañana',

  // === Calendario (huérfanas pero usadas si se reactiva WeeklyCalendar) ===
  'chat.calendar_empty': 'Sin entradas',
  'chat.calendar_entry_one': '1 entrada',
  'chat.calendar_entry_many': '{n} entradas',

  // === Memorias overlay (faltantes — los memories_* genéricos ya están bajo otro nombre) ===
  'chat.approve': 'Aprobar',
  'chat.discard': 'Descartar',
  'chat.add': 'Agregar',
  'chat.add_memory_placeholder': 'Escribe la memoria…',
  'chat.save': 'Guardar',
  'chat.cancel': 'Cancelar',
  'chat.edit': 'Editar',
  'chat.delete': 'Eliminar',
  'chat.no_memories': 'Aún no hay memorias aprobadas.',
  'chat.memories_proposed': 'Propuestas',
  'chat.memories_approved': 'Aprobadas',
  'chat.memories_extraction': 'Extracción automática',
  'chat.memories_extraction_hint': 'Maity propondrá memorias después de cada chat',

  // === Starter seeds (faltantes — los _ex_* y _hint ya están) ===
  'chat.starter_thinking_seed': 'Estoy pensando en ',
  'chat.starter_decision_seed': 'Necesito decidir si ',
  'chat.starter_rehearsal_seed': 'Quiero ensayar cómo ',
  'chat.starter_reflection_seed': 'Quiero procesar ',
}

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}

type Language = 'es' | 'en'

interface LanguageContextValue {
  t: (key: string, params?: Record<string, string | number>) => string
  language: Language
}

/**
 * Hook usado por todos los componentes del web. Devuelve `t(key)` que busca en
 * el dict de arriba.
 *
 * Para agregar/cambiar strings: edita STRINGS al inicio del archivo. No hace
 * falta tocar los componentes del web.
 */
export function useLanguage(): LanguageContextValue {
  return {
    t: (key, params) => interpolate(STRINGS[key] ?? key, params),
    language: 'es',
  }
}

// No-op provider para el árbol si lo necesitas.
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
