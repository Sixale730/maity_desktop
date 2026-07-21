/**
 * Barrel de `@maity/shared` — el package monorepo que la web usa. El desktop no
 * lo tiene, así que re-exportamos los símbolos que los componentes del web
 * importan desde aquí.
 *
 * Vía path alias en tsconfig: `"@maity/shared": ["./src/shared/maity-shared.ts"]`.
 *
 * REGLA: re-exports EXPLÍCITOS (no export *) para evitar colisiones de nombres.
 */
'use client'

import { supabase } from '@/lib/supabase'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BillingService } from './maity-shared/domain/billing/billing.service'
import { buildHandoffUrl, openExternalUrl } from '@/lib/planLinks'
import type { CheckoutInput, EffectivePlan } from './maity-shared/domain/billing/billing.types'

// Asume que el desktop tiene su propio cliente supabase en `@/lib/supabase`.
export { supabase }

// ============================================================
// Auth service
// ============================================================
export { AuthService } from './maity-shared/domain/auth/auth.service'
export type {
  UserRole,
  UserPhase,
  UserStatus,
  PostLoginOptions,
  PostLoginResult,
} from './maity-shared/domain/auth/auth.types'

// ============================================================
// Organizations / invite code
// ============================================================
export { InviteCodeService } from './maity-shared/domain/organizations/invite-code.service'
export { useRedeemInviteCode } from './maity-shared/domain/organizations/hooks/useRedeemInviteCode'

// ============================================================
// Avatar service + types + hooks
// ============================================================
export { AvatarService } from './maity-shared/domain/avatar/avatar.service'
export {
  DEFAULT_AVATAR_CONFIG,
  SKIN_COLORS,
  HAIR_COLORS,
  OUTFIT_PRESETS,
  PRESET_CHARACTERS,
  CHARACTER_SOURCES,
  ACCESSORY_OPTIONS,
  AVATAR_SIZE_CONFIG,
} from './maity-shared/domain/avatar/avatar.types'
export type {
  AvatarConfiguration,
  AvatarSize,
  CharacterPreset,
  CharacterSource,
  HeadType,
  BodyType,
  OutfitPreset,
  AccessoryCode,
  UpdateAvatarInput,
} from './maity-shared/domain/avatar/avatar.types'
export { useAvatarWithDefault } from './maity-shared/domain/avatar/hooks/useAvatar'
export type { AttachmentPoint } from './maity-shared/domain/avatar/attachment-points'
export { getAttachmentPoints } from './maity-shared/domain/avatar/attachment-points'
export type { ItemCode, ItemCategory } from './maity-shared/domain/avatar/items.types'
export { ITEM_CATEGORIES, getItemsByCategory } from './maity-shared/domain/avatar/items.types'

// ============================================================
// Registration types + service
// ============================================================
export {
  LikertQuestions,
  ChoiceQuestions,
  ConsentQuestion,
  PersonalInfoQuestions,
  CompetencyColors,
  getAllFormSteps,
} from './maity-shared/domain/registration/registration.types'
export { CompetencyArea } from './maity-shared/domain/registration/registration.types'
export type {
  LikertValue,
  LikertQuestion,
  ChoiceQuestion,
  ConsentQuestion as ConsentQuestionType,
  FormStep,
  FormStepType,
  RegistrationFormData,
  FormResponse,
} from './maity-shared/domain/registration/registration.types'
export { RegistrationFormService } from './maity-shared/domain/registration/registration.service'

// ============================================================
// Billing service + types
// ============================================================
export { BillingService } from './maity-shared/domain/billing/billing.service'
export type {
  EffectivePlan,
  QuotaCheckResult,
  QuotaStatus,
  CheckoutInput,
} from './maity-shared/domain/billing/billing.types'

/**
 * useMyEffectivePlan — React Query hook sobre BillingService.getMyEffectivePlan
 */
export function useMyEffectivePlan() {
  return useQuery<EffectivePlan | null>({
    queryKey: ['billing', 'my-plan'],
    queryFn: () => BillingService.getMyEffectivePlan(),
    staleTime: 60 * 1000,
  })
}

/**
 * useCreateCheckoutSession — versión desktop.
 * Ignora apiUrl (parámetro vacío desde env.ts); en su lugar construye la URL
 * de handoff a maity.cloud con los tokens de sesión actuales.
 * Devuelve { url } igual que la versión web para que PlanSelection.tsx
 * funcione sin cambios (excepto el único patch documentado).
 */
export function useCreateCheckoutSession(_apiUrl: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (_input: CheckoutInput) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sin sesión activa — inicia sesión para continuar')
      const url = buildHandoffUrl(session, '/billing/plans?checkout=pro')
      return { url, session_id: '' }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'my-plan'] })
    },
  })
}

// ============================================================
// Utilities
// ============================================================
export { cn } from './maity-shared/utils/cn'

// Re-export openExternalUrl para que PlanSelection pueda usarlo vía patch
export { openExternalUrl }

/**
 * Stub mínimo de `PDFService` — la web usa esto para exportar el chat como PDF.
 * En el desktop la feature no es crítica todavía; devolvemos un no-op que
 * notifica al usuario que la exportación a PDF aún no está disponible.
 *
 * Cuando se quiera implementar PDF export en el desktop, reemplazar este stub
 * con una implementación real (probablemente vía comando Tauri o jsPDF).
 */
export const PDFService = {
  async generateChatDocumentPDF(_data: unknown): Promise<void> {
    // Lazy import de sonner para no acoplar el stub al toast system
    const { toast } = await import('sonner')
    toast.info('Exportar a PDF aún no está disponible en el desktop.')
  },
}

/**
 * Telemetría del chat — reporte de bugs/ideas. Replica el contrato del web
 * (`packages/shared/src/domain/chat-telemetry/`). Persiste en
 * `maity.chat_bug_reports` vía la RPC `submit_chat_bug_report` (SECURITY
 * DEFINER: el server resuelve user_id/email; el cliente no puede falsearlos).
 * No hay endpoint Vercel — es una RPC directa al schema `maity`.
 */
export type BugCategory = 'bug' | 'idea' | 'confusing' | 'other'

export interface SubmitBugReportInput {
  category: BugCategory
  description: string
  threadId?: string | null
  messageId?: string | null
  context?: Record<string, unknown> | null
}

export const ChatTelemetryService = {
  async submitBugReport(input: SubmitBugReportInput): Promise<string> {
    const { data, error } = await supabase.schema('maity').rpc('submit_chat_bug_report', {
      p_category: input.category,
      p_description: input.description,
      p_thread_id: input.threadId ?? null,
      p_message_id: input.messageId ?? null,
      p_context: input.context ?? null,
    })
    if (error) throw error
    return data as string
  },
}

/**
 * PptxService — genera .pptx reales (abribles en PowerPoint / Google Slides /
 * Keynote) a partir de un `DeckSpec` compacto que Maity emite. Corre 100%
 * client-side. `pptxgenjs` se importa dinámicamente para que no caiga en el
 * bundle inicial: solo carga cuando el usuario hace clic en "Descargar .pptx".
 *
 * Port tal cual del web (`packages/shared/src/services/pptx.service.ts`).
 */
export type DeckTheme = 'maity' | 'asertio' | 'neutral'

export type DeckSlide =
  | { layout: 'title'; title: string; subtitle?: string }
  | { layout: 'section'; title: string }
  | { layout: 'bullets'; title: string; bullets: string[] }
  | { layout: 'two_col'; title: string; left: string[]; right: string[] }
  | { layout: 'quote'; quote: string; author?: string }

export interface DeckSpec {
  title: string
  theme?: DeckTheme
  slides: DeckSlide[]
}

interface Palette {
  accent: string // hex sin '#'
  bg: string
  text: string
  muted: string
  onAccent: string
}

const DECK_PALETTES: Record<DeckTheme, Palette> = {
  maity: { accent: 'FF0050', bg: 'FFFFFF', text: '141414', muted: '6B6B72', onAccent: 'FFFFFF' },
  asertio: { accent: 'FF6633', bg: 'FFFFFF', text: '141414', muted: '6B6B72', onAccent: 'FFFFFF' },
  neutral: { accent: '485DF4', bg: 'FFFFFF', text: '141414', muted: '6B6B72', onAccent: 'FFFFFF' },
}

// Lienzo 16:9 widescreen (pulgadas).
const DECK_W = 13.33
const DECK_H = 7.5

function deckSlugify(s: string): string {
  const norm = (s || 'presentacion').normalize('NFD').replace(/[̀-ͯ]/g, '')
  return (
    norm
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'presentacion'
  )
}

export const PptxService = {
  /**
   * Construye el deck y dispara la descarga en el navegador. Nunca truena con
   * slides vacíos — cae a una sola slide de título para que el usuario siempre
   * obtenga un archivo.
   */
  async generateDeck(spec: DeckSpec): Promise<void> {
    const PptxGenJS = (await import('pptxgenjs')).default
    const pptx = new PptxGenJS()
    pptx.defineLayout({ name: 'MAITY_WIDE', width: DECK_W, height: DECK_H })
    pptx.layout = 'MAITY_WIDE'

    const palette = DECK_PALETTES[spec.theme ?? 'maity'] ?? DECK_PALETTES.maity
    const slides = spec.slides?.length
      ? spec.slides
      : [{ layout: 'title' as const, title: spec.title }]

    for (const s of slides) {
      const slide = pptx.addSlide()
      slide.background = { color: palette.bg }

      switch (s.layout) {
        case 'title': {
          slide.background = { color: palette.accent }
          slide.addText(s.title, {
            x: 0.8, y: 2.6, w: DECK_W - 1.6, h: 1.6,
            fontSize: 40, bold: true, color: palette.onAccent, align: 'left', fontFace: 'Arial',
          })
          if (s.subtitle) {
            slide.addText(s.subtitle, {
              x: 0.8, y: 4.2, w: DECK_W - 1.6, h: 1.0,
              fontSize: 20, color: palette.onAccent, align: 'left', fontFace: 'Arial',
            })
          }
          break
        }
        case 'section': {
          slide.addShape('rect', { x: 0, y: 0, w: 0.35, h: DECK_H, fill: { color: palette.accent } })
          slide.addText(s.title, {
            x: 0.9, y: 3.0, w: DECK_W - 1.8, h: 1.5,
            fontSize: 34, bold: true, color: palette.text, align: 'left', fontFace: 'Arial',
          })
          break
        }
        case 'bullets': {
          slide.addText(s.title, {
            x: 0.9, y: 0.55, w: DECK_W - 1.8, h: 0.9,
            fontSize: 26, bold: true, color: palette.text, align: 'left', fontFace: 'Arial',
          })
          slide.addShape('rect', { x: 0.9, y: 1.45, w: 1.6, h: 0.06, fill: { color: palette.accent } })
          slide.addText(
            (s.bullets ?? []).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
            {
              x: 0.9, y: 1.7, w: DECK_W - 1.8, h: DECK_H - 2.3,
              fontSize: 18, color: palette.text, align: 'left', fontFace: 'Arial', lineSpacingMultiple: 1.3,
            },
          )
          break
        }
        case 'two_col': {
          slide.addText(s.title, {
            x: 0.9, y: 0.55, w: DECK_W - 1.8, h: 0.9,
            fontSize: 26, bold: true, color: palette.text, align: 'left', fontFace: 'Arial',
          })
          slide.addShape('rect', { x: 0.9, y: 1.45, w: 1.6, h: 0.06, fill: { color: palette.accent } })
          const colW = (DECK_W - 1.8 - 0.4) / 2
          slide.addText(
            (s.left ?? []).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
            { x: 0.9, y: 1.7, w: colW, h: DECK_H - 2.3, fontSize: 16, color: palette.text, fontFace: 'Arial', lineSpacingMultiple: 1.25 },
          )
          slide.addText(
            (s.right ?? []).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
            { x: 0.9 + colW + 0.4, y: 1.7, w: colW, h: DECK_H - 2.3, fontSize: 16, color: palette.text, fontFace: 'Arial', lineSpacingMultiple: 1.25 },
          )
          break
        }
        case 'quote': {
          slide.addText(`“${s.quote}”`, {
            x: 1.2, y: 2.2, w: DECK_W - 2.4, h: 2.6,
            fontSize: 28, italic: true, color: palette.text, align: 'center', fontFace: 'Georgia',
          })
          if (s.author) {
            slide.addText(`— ${s.author}`, {
              x: 1.2, y: 4.9, w: DECK_W - 2.4, h: 0.6,
              fontSize: 16, color: palette.muted, align: 'center', fontFace: 'Arial',
            })
          }
          break
        }
        default:
          break
      }
    }

    const fileName = `${deckSlugify(spec.title)}.pptx`
    await pptx.writeFile({ fileName })
  },
}
