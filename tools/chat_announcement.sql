create table if not exists public.chat_announcements (
  room text primary key,
  content text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.chat_announcements enable row level security;

create or replace function public.get_chat_announcement(p_room text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content text;
  v_updated_at timestamptz;
begin
  select content, updated_at
    into v_content, v_updated_at
    from public.chat_announcements
   where room = coalesce(nullif(trim(p_room), ''), 'vip');

  return jsonb_build_object(
    'ok', true,
    'room', coalesce(nullif(trim(p_room), ''), 'vip'),
    'content', coalesce(v_content, ''),
    'updated_at', v_updated_at
  );
end;
$$;

create or replace function public.set_chat_announcement(p_token text, p_room text, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_room text := coalesce(nullif(trim(p_room), ''), 'vip');
  v_content text := left(trim(coalesce(p_content, '')), 500);
begin
  select email, nickname, is_admin
    into v_admin
    from public.profiles
   where token = p_token;

  if v_admin.email is null or not coalesce(v_admin.is_admin, false) then
    return jsonb_build_object('ok', false, 'msg', '没有权限');
  end if;

  if v_room <> 'vip' then
    return jsonb_build_object('ok', false, 'msg', '暂时只支持会员群公告');
  end if;

  if v_content = '' then
    return jsonb_build_object('ok', false, 'msg', '公告内容不能为空');
  end if;

  insert into public.chat_announcements(room, content, updated_by, updated_at)
  values (v_room, v_content, v_admin.email, now())
  on conflict (room) do update
     set content = excluded.content,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'room', v_room, 'content', v_content);
end;
$$;

grant execute on function public.get_chat_announcement(text) to anon, authenticated;
grant execute on function public.set_chat_announcement(text, text, text) to anon, authenticated;
