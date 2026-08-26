-- Bucket privado para los bundles de incidente del desktop (maity_desktop #61).
--
-- Este repo NO tiene migraciones de Postgres (viven en Sixale730/maity): este
-- archivo es el contrato que la web debe aplicar como migración. Hasta que
-- exista el bucket, `upload_incident_bundle` (Rust) falla con un error corto y
-- SIN reintentos — el bundle es best-effort.
--
-- Contrato de ruta (lo arma `src-tauri/src/logging/incident.rs`):
--   incident-bundles/{auth.users.id}/{YYYYMMDD-HHMMSS}-{kind}-{proc-session}.txt
-- `kind` ∈ app-rss-critical | system-memory-pressure | rust-panic | manual.
-- El primer segmento es `auth.uid()` (NO `maity.users.id`): el desktop lo saca
-- del claim `sub` del JWT para que la policy de abajo cierre con la identidad
-- que Storage conoce.
--
-- Escritura ciega: los clientes solo pueden INSERTAR en su propia carpeta. No
-- hay SELECT/UPDATE/DELETE para `authenticated` — soporte lee los bundles
-- desde el dashboard / service role. Tamaño máximo 1 MB (el bundle es ~200 KB
-- de tail + cabecera JSON + system_info), solo text/plain.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-bundles', 'incident-bundles', false, 1048576, array['text/plain'])
on conflict (id) do nothing;

create policy "incident-bundles: insert own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'incident-bundles'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
