import type { MeetingMinutesData } from '../services/conversations.service';

/**
 * Detecta si una minuta tiene datos insuficientes para mostrar el render
 * completo. Si todos los campos clave estan vacios (decisiones, acciones,
 * temas, efectividad), debe mostrarse un placeholder generico en su lugar.
 *
 * Sin esto, una minuta con todos los arrays vacios pero estructura presente
 * (`meeting_minutes_data: { meta: {}, decisiones: [], temas: undefined, ... }`)
 * intenta renderear todos los subcomponentes y el primero con un guard
 * incompleto crashea la pagina entera.
 */
export function isMinutaInsufficient(nm: MeetingMinutesData | null | undefined): boolean {
  if (!nm) return true;

  const noDecisiones = !nm.decisiones || nm.decisiones.length === 0;
  const noAcciones = !nm.acciones?.lista || nm.acciones.lista.length === 0;
  const noTemas = !nm.temas || nm.temas.length === 0;
  const noEfectividad = !nm.efectividad?.componentes || nm.efectividad.componentes.length === 0;

  return noDecisiones && noAcciones && noTemas && noEfectividad;
}
