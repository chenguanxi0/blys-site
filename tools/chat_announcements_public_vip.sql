-- Allow pinned announcements for both public and vip chat rooms.
-- Safe to run more than once.

create table if not exists public.chat_announcements (
  room text primary key,
  content text not null,
  updated_by text,
  created_at timestamptz not null default now(),
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
  v_room text := lower(btrim(coalesce(p_room, '')));
  v_content text;
begin
  if v_room not in ('public', 'vip') then
    return jsonb_build_object('ok', false, 'msg', '不支持的群公告');
  end if;

  select content
    into v_content
    from public.chat_announcements
   where room = v_room
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'room', v_room,
    'content', coalesce(v_content, case
      when v_room = 'vip' then '会员群文明交流，禁止荐股与广告；重要通知会在这里置顶。'
      else '普通群文明交流，禁止荐股与广告；重要通知会在这里置顶。'
    end)
  );
end;
$$;

create or replace function public.set_chat_announcement(
  p_token text,
  p_room text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_room text := lower(btrim(coalesce(p_room, '')));
  v_content text := btrim(coalesce(p_content, ''));
begin
  if v_room not in ('public', 'vip') then
    return jsonb_build_object('ok', false, 'msg', '只支持普通群和会员群公告');
  end if;

  select email, is_admin
    into v_user
    from public.profiles
   where token = p_token
   limit 1;

  if not found or coalesce(v_user.is_admin, false) is not true then
    return jsonb_build_object('ok', false, 'msg', '只有管理员可以编辑群公告');
  end if;

  if length(v_content) = 0 then
    return jsonb_build_object('ok', false, 'msg', '公告内容不能为空');
  end if;

  if length(v_content) > 500 then
    return jsonb_build_object('ok', false, 'msg', '公告最多 500 个字');
  end if;

  insert into public.chat_announcements (room, content, updated_by, created_at, updated_at)
  values (v_room, v_content, v_user.email, now(), now())
  on conflict (room) do update set
    content = excluded.content,
    updated_by = excluded.updated_by,
    updated_at = now();

  return jsonb_build_object('ok', true, 'room', v_room, 'content', v_content);
end;
$$;

grant execute on function public.get_chat_announcement(text) to anon, authenticated;
grant execute on function public.set_chat_announcement(text, text, text) to anon, authenticated;
