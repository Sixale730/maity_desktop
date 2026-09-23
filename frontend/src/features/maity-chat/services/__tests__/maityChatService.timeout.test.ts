/**
 * Caso Kari 2026-09-23: con supabase-js colgado (deadlock del lock de auth ≤0.2.59)
 * "Enviar" y las tarjetas del chat no hacían nada — `createThread` nunca volvía y no
 * había toast ni log. Ahora el camino de envío vence con un mensaje accionable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => {
  // Dentro de la factory: vi.mock se iza por encima de cualquier const del archivo.
  const never = () => new Promise<never>(() => {})
  const chain = {
    from: () => chain,
    insert: () => chain,
    select: () => chain,
    single: () => never(),
  }
  return { supabase: { schema: () => chain, auth: { getSession: never } } }
})
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/fileLogger', () => ({ fileLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createThread } from '../maityChatService'
import { fileLogger } from '@/lib/fileLogger'

describe('maityChatService — plazos del camino de envío', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('createThread colgado rechaza a los 15 s con un mensaje accionable y deja rastro en el log', async () => {
    vi.useFakeTimers()
    const result = createThread('user-1')
    const assertion = expect(result).rejects.toThrow('Cierra Maity desde la bandeja y vuelve a abrirla')

    await vi.advanceTimersByTimeAsync(15_000)
    await assertion

    expect(vi.mocked(fileLogger).warn).toHaveBeenCalledWith('chat', 'supabase call timed out', {
      label: 'createThread',
      ms: 15_000,
    })
  })
})
