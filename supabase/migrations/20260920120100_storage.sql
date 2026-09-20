-- ============================================================================
-- Storage: bucket privado y políticas de acceso
--
-- Esta migración es la que hace posible que el navegador suba directamente a
-- Storage sin pasar por código nuestro. La política RLS sobre storage.objects
-- sustituye al handler de upload de un backend tradicional
-- (doc/02-adr-backend-serverless.md).
-- ============================================================================

-- Bucket PRIVADO. Uno público saltaría el control de acceso por completo:
-- cualquiera con la URL leería el archivo (doc/08-seguridad.md § T2).
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 10737418240)  -- 10 GiB
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Política de acceso por ruta
--
-- Convención de rutas: {user_id}/{media_asset_id}/{archivo}
--
-- Poner el user_id como primer segmento hace que la política sea trivial y
-- difícil de escribir mal. Los identificadores son UUID, así que una signed URL
-- filtrada no permite enumerar los archivos de otros usuarios.
-- --------------------------------------------------------------------------

create policy "lectura de la carpeta propia" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "escritura en la carpeta propia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- TUS reanuda subidas actualizando el objeto, así que UPDATE es necesario
-- para que una subida interrumpida pueda continuar.
create policy "actualizacion en la carpeta propia" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "borrado en la carpeta propia" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
