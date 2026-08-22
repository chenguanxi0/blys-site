-- 聊天室成员统计与在线列表
-- 执行后：进入过聊天室的用户会计入总人数；2分钟内有心跳的排在最前并显示在线

alter table public.online_users add column if not exists user_email text;
alter table public.online_users add column if not exists user_nickname text;

create table if not exists public.chat_room_members (
  room text not null,
  user_email text not null,
  user_nickname text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room, user_email)
);

create index if not exists idx_chat_room_members_room_last_seen
on public.chat_room_members(room, last_seen desc);

create index if not exists idx_online_users_room_last_seen
on public.online_users(room, last_seen desc);

do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc where proname = 'heartbeat'
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

create or replace function public.heartbeat(p_session text, p_room text default null, p_token text default null)
returns void as $$
declare
  v_user record;
begin
  if p_token is not null then
    select email, nickname into v_user from public.profiles where token = p_token;
  end if;

  insert into public.online_users (session_id, room, last_seen, user_email, user_nickname)
  values (p_session, p_room, now(), v_user.email, v_user.nickname)
  on conflict (session_id) do update
  set room = excluded.room,
      last_seen = now(),
      user_email = coalesce(excluded.user_email, public.online_users.user_email),
      user_nickname = coalesce(excluded.user_nickname, public.online_users.user_nickname);

  if v_user.email is not null and p_room is not null and p_room <> 'private' then
    insert into public.chat_room_members (room, user_email, user_nickname, first_seen, last_seen)
    values (p_room, v_user.email, coalesce(v_user.nickname, split_part(v_user.email, '@', 1)), now(), now())
    on conflict (room, user_email) do update
    set user_nickname = coalesce(excluded.user_nickname, public.chat_room_members.user_nickname),
        last_seen = now();
  end if;

  delete from public.online_users where last_seen < now() - interval '3 minutes';
end;
$$ language plpgsql security definer;

create or replace function public.chat_room_members(p_room text)
returns jsonb as $$
declare
  v_total int;
  v_online int;
  v_list jsonb;
begin
  select count(*) into v_total
  from public.chat_room_members m
  where m.room = p_room;

  select count(distinct m.user_email) into v_online
  from public.chat_room_members m
  join public.online_users o on lower(o.user_email) = lower(m.user_email) and o.room = p_room
  where m.room = p_room and o.last_seen > now() - interval '2 minutes';

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_list
  from (
    select
      m.user_email as email,
      coalesce(m.user_nickname, split_part(m.user_email, '@', 1)) as nickname,
      m.last_seen,
      exists (
        select 1 from public.online_users o
        where lower(o.user_email) = lower(m.user_email)
          and o.room = p_room
          and o.last_seen > now() - interval '2 minutes'
      ) as online
    from public.chat_room_members m
    where m.room = p_room
    order by online desc, m.last_seen desc
    limit 60
  ) x;

  return jsonb_build_object('ok', true, 'total', coalesce(v_total, 0), 'online', coalesce(v_online, 0), 'list', v_list);
end;
$$ language plpgsql security definer;

insert into public.chat_room_members(room, user_email, user_nickname, first_seen, last_seen)
select room, user_email, coalesce(max(user_nickname), split_part(user_email, '@', 1)), min(created_at), max(created_at)
from public.messages
where user_email is not null and room in ('public', 'vip')
group by room, user_email
on conflict (room, user_email) do update
set user_nickname = coalesce(excluded.user_nickname, public.chat_room_members.user_nickname),
    last_seen = greatest(public.chat_room_members.last_seen, excluded.last_seen);

notify pgrst, 'reload schema';


-- 白鹿原上专用：从群聊成员统计列表移除某个用户（不删除账号、不影响会员身份）
create or replace function public.admin_remove_chat_room_member(p_admin_token text, p_room text, p_user_email text)
returns jsonb as $$
declare
  v_admin record;
begin
  select email, nickname, is_admin into v_admin from public.profiles where token = p_admin_token;
  if v_admin.email is null or not (coalesce(v_admin.is_admin, false) or v_admin.email = '491788533@qq.com' or v_admin.nickname = '白鹿原上') then
    return jsonb_build_object('ok', false, 'msg', '无权限');
  end if;

  if p_room not in ('public', 'vip') then
    return jsonb_build_object('ok', false, 'msg', '房间无效');
  end if;

  delete from public.chat_room_members
  where room = p_room and lower(user_email) = lower(p_user_email);

  return jsonb_build_object('ok', true);
end;
$$ language plpgsql security definer;

notify pgrst, 'reload schema';


-- 轻量统计：只返回总人数/在线人数，不返回成员列表，用于会员群聊标签第二行
create or replace function public.chat_room_member_counts(p_room text)
returns jsonb as $$
declare
  v_total int;
  v_online int;
begin
  select count(*) into v_total
  from public.chat_room_members m
  where m.room = p_room;

  select count(distinct m.user_email) into v_online
  from public.chat_room_members m
  join public.online_users o on lower(o.user_email) = lower(m.user_email) and o.room = p_room
  where m.room = p_room and o.last_seen > now() - interval '2 minutes';

  return jsonb_build_object('ok', true, 'total', coalesce(v_total, 0), 'online', coalesce(v_online, 0));
end;
$$ language plpgsql security definer;

notify pgrst, 'reload schema';
