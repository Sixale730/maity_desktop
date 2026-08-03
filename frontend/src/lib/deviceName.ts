/**
 * Formato canónico de nombre de dispositivo: el nombre CRUDO tal como lo
 * enumera el OS (`get_audio_devices`), SIN sufijo. Es el formato que aceptan
 * `switch_audio_device`, `start_audio_level_monitoring` y (con compat legacy)
 * `start_recording_with_devices_and_meeting`.
 *
 * Las preferencias guardadas por versiones viejas traen "Nombre (input)" /
 * "Nombre (output)"; este helper normaliza al leerlas. NO volver a concatenar
 * sufijos en la UI — el backend resuelve el tipo (Input/Output) por contexto.
 */
export function stripDeviceTypeSuffix(name: string | null | undefined): string | null {
  if (!name) return null;
  const stripped = name.replace(/\s*\((input|output)\)\s*$/i, '').trim();
  return stripped || null;
}
