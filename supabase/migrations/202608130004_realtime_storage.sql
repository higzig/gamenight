create policy game_night_public_topic_receive on realtime.messages
for select to authenticated using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() ~ '^event:[0-9a-f-]{36}:public$'
  and private.can_receive_public_event(split_part(realtime.topic(), ':', 2)::uuid)
);

create policy game_night_host_topic_receive on realtime.messages
for select to authenticated using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() ~ '^event:[0-9a-f-]{36}:host$'
  and private.is_event_host(split_part(realtime.topic(), ':', 2)::uuid)
);

create policy game_night_team_topic_receive on realtime.messages
for select to authenticated using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() ~ '^event:[0-9a-f-]{36}:team:[0-9a-f-]{36}$'
  and (
    private.can_receive_team_topic(
      split_part(realtime.topic(), ':', 2)::uuid,
      split_part(realtime.topic(), ':', 4)::uuid
    )
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('celebrity-images', 'celebrity-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy celebrity_images_public_read on storage.objects for select to anon, authenticated
using (bucket_id = 'celebrity-images');

create policy celebrity_images_host_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'celebrity-images'
  and not private.is_anonymous_user()
  and private.is_event_host((storage.foldername(name))[1]::uuid)
);
create policy celebrity_images_host_update on storage.objects for update to authenticated
using (bucket_id = 'celebrity-images' and not private.is_anonymous_user() and private.is_event_host((storage.foldername(name))[1]::uuid))
with check (bucket_id = 'celebrity-images' and not private.is_anonymous_user() and private.is_event_host((storage.foldername(name))[1]::uuid));
create policy celebrity_images_host_delete on storage.objects for delete to authenticated
using (bucket_id = 'celebrity-images' and not private.is_anonymous_user() and private.is_event_host((storage.foldername(name))[1]::uuid));
