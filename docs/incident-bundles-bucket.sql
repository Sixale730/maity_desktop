-- Bucket privado para los bundles de incidente del desktop (maity_desktop #61).
--
-- Este repo NO tiene migraciones de Postgres (viven en Sixale730/maity): este
-- archivo es el contrato que la web debe aplicar como migración. Se aplicó a
-- mano en producción el 2026-09-10 (04:15Z) y se corrigió el mismo día (ver
-- abajo). Si el bucket no existe, `upload_incident_bundle` (Rust) falla con un
-- error corto y SIN reintentos — el bundle es best-effort.
--
-- Contrato de ruta (lo arma `src-tauri/src/logging/incident.rs`):
--   incident-bundles/{auth.users.id}/{YYYYMMDD-HHMMSS}-{kind}-{proc-session}.txt
-- `kind` ∈ app-rss-critical | system-memory-pressure | rust-panic | manual.
-- El primer segmento es `auth.uid()` (NO `maity.users.id`): el desktop lo saca
-- del claim `sub` del JWT para que la policy de abajo cierre con la identidad
-- que Storage conoce.
--
-- Contrato de MIME (`allowed_mime_types`): Supabase Storage
-- (`src/storage/uploader.ts::validateMimeType`) parte el `Content-Type` en
-- `tipo/subtipo` y compara el subtipo LITERAL, parámetros incluidos —
-- `text/plain; charset=utf-8` NO iguala a `text/plain` (415 InvalidMimeType,
-- envuelto en HTTP 400). Así falló el primer bundle real, el 2026-09-10.
--   * 'text/plain'                 → lo que manda Rust (`BUNDLE_CONTENT_TYPE`,
--                                    sin parámetros; un test lo ata a este
--                                    archivo: `content_type_esta_en_el_contrato_del_bucket`).
--   * 'text/plain; charset=utf-8'  → lo que manda el build piloto 0.2.59 ya
--                                    instalado en testers. Retirar cuando ese
--                                    build muera.
-- Nada de `text/*` ni NULL: el bucket sigue aceptando solo texto.
--
-- Escritura ciega: los clientes solo pueden INSERTAR en su propia carpeta. No
-- hay SELECT/UPDATE/DELETE para `authenticated` — soporte lee los bundles
-- desde el dashboard / service role. Tamaño máximo 1 MB (el bundle es ~200 KB
-- de tail + cabecera JSON + system_info).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'incident-bundles',
  'incident-bundles',
  false,
  1048576,
  array['text/plain', 'text/plain; charset=utf-8']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "incident-bundles: insert own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'incident-bundles'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
