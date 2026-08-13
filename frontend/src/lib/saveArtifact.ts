'use client';

import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

export interface SaveArtifactArgs {
  /** Nombre sugerido CON extensión, p.ej. "mi-documento.pdf". */
  fileName: string;
  /** Contenido ya materializado; se convierte a base64 antes del IPC. */
  blob: Blob;
  /** Etiqueta del filtro en el diálogo nativo, p.ej. "Documento PDF". */
  filterName: string;
  /** Extensiones SIN punto, p.ej. ["pdf"]. */
  extensions: string[];
  /** `t` de useLanguage. Se recibe por parámetro para que el helper no dependa
   *  del contexto de React y se pueda testear puro. */
  t: (key: string) => string;
}

/**
 * Guarda un archivo generado por la app vía el comando Rust `save_artifact_file`.
 *
 * Vive en `lib/` (no dentro de una feature) porque lo usan varias: los tres
 * botones de Maity Chat (.md / .pdf / .pptx) y el "Descargar PDF" de la minuta.
 *
 * Por qué no un `<a download>`: dentro de WebView2 el destino lo decide el
 * WebView, guarda en su propia carpeta sin preguntar y la app nunca aprende la
 * ruta — por eso el botón "parecía no hacer nada". Con el comando nativo el
 * usuario elige dónde (o se guarda en Descargas según la preferencia) y siempre
 * sabemos la ruta final para confirmarla y poder abrir la carpeta.
 *
 * Un solo lugar para el toast + "Abrir carpeta" + la cancelación, para que todos
 * los botones de guardado se comporten igual.
 *
 * @returns la ruta guardada, o `null` si el usuario canceló el diálogo.
 * @throws  si el guardado falló de verdad — el caller muestra su propio error.
 */
export async function saveArtifact({
  fileName,
  blob,
  filterName,
  extensions,
  t,
}: SaveArtifactArgs): Promise<string | null> {
  const contentsBase64 = await blobToBase64(blob);

  // Claves en camelCase: convención del proyecto (los comandos no usan
  // `rename_all`, y con snake_case los Option<> llegarían como None sin error).
  const path = await invoke<string | null>('save_artifact_file', {
    defaultFileName: fileName,
    contentsBase64,
    filterName,
    extensions,
  });

  // Cancelar es un no-op silencioso: nada de toast de error.
  if (!path) return null;

  toast.success(t('export.save_success'), {
    description: path,
    duration: 8000,
    action: {
      label: t('export.save_reveal'),
      onClick: () => {
        invoke('reveal_in_folder', { path }).catch(() => {});
      },
    },
  });

  return path;
}

/**
 * Blob → base64 sin el prefijo `data:`. Usa `FileReader` porque hace el encode
 * en código nativo; el clásico `btoa(String.fromCharCode(...bytes))` revienta el
 * stack con arrays grandes (un PDF de varios cientos de KB).
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader falló'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
