alter table public.messages
  drop constraint if exists messages_room_check;

alter table public.messages
  add constraint messages_room_check
  check (room = any (array['public'::text, 'vip'::text, 'vip_chat'::text]));
