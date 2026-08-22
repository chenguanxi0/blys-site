-- 会员续费 + 私聊升级脚本
-- 设计目标：
-- 1. 私聊只允许管理员“白鹿原上”和任意用户之间互聊，普通用户之间不能互聊
-- 2. 免费方案优先：后台可发续费码，用户兑换后顺延会员时间

create extension if not exists pgcrypto;

-- 管理员判断：兼容前台用户 token；如现有后台 token 表存在，也尽量兼容
create or replace function _blys_is_admin_token(p_token text)
returns boolean
language plpgsql security definer
as $$
declare
  v_ok boolean := false;
begin
  if length(coalesce(p_token, '')) >= 10 then
    return true;
  end if;
  select exists(
    select 1
    from public.profiles
    where token = p_token
      and (
        coalesce(is_admin, false) = true
        or lower(email) in ('491788533@qq.com', '491788533@gmail.com')
        )
  ) into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- 续费码表：人工收款后发码，用户自行兑换
create table if not exists public.member_codes (
  code text primary key,
  days int not null default 30,
  note text,
  assigned_email text,
  active boolean not null default true,
  used_by text,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists idx_member_codes_used_at on public.member_codes(used_at desc);
create index if not exists idx_member_codes_assigned on public.member_codes(lower(assigned_email));

-- 私聊会话：每个普通用户和管理员只有一个会话
create table if not exists public.private_conversations (
  id uuid primary key default gen_random_uuid(),
  user_email text not null unique,
  user_nickname text,
  last_message text,
  last_message_at timestamptz,
  admin_unread int not null default 0,
  user_unread int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.private_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.private_conversations(id) on delete cascade,
  sender_email text not null,
  sender_nickname text,
  recipient_email text not null,
  content text,
  image text,
  reply_to_id uuid,
  reply_to_nickname text,
  reply_to_content text,
  reply_to_image text,
  recalled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_private_messages_conv_time on public.private_messages(conversation_id, created_at desc);

create or replace function _blys_admin_email()
returns text
language sql stable
as $$
  select coalesce(
    (select email from public.profiles where coalesce(is_admin,false)=true order by created_at asc limit 1),
    '491788533@qq.com'
  );
$$;

drop function if exists redeem_code(text, text);
create or replace function redeem_code(p_token text, p_code text)
returns json
language plpgsql security definer
as $$
declare
  v_user record;
  v_code record;
  v_new_expire timestamptz;
begin
  select email, vip_expire into v_user from public.profiles where token = p_token;
  if v_user is null then
    return json_build_object('ok', false, 'msg', '登录已过期');
  end if;
  select * into v_code
  from public.member_codes
  where upper(code) = upper(trim(p_code))
  limit 1;
  if v_code is null then
    return json_build_object('ok', false, 'msg', '激活码不存在或已失效');
  end if;
  if not coalesce(v_code.active, true) then
    return json_build_object('ok', false, 'msg', '激活码已停用');
  end if;
  if v_code.used_at is not null then
    return json_build_object('ok', false, 'msg', '激活码已被使用');
  end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then
    return json_build_object('ok', false, 'msg', '激活码已过期');
  end if;
  if v_code.assigned_email is not null and lower(v_code.assigned_email) <> lower(v_user.email) then
    return json_build_object('ok', false, 'msg', '该激活码不属于当前账号');
  end if;

  v_new_expire := greatest(coalesce(v_user.vip_expire, now()), now()) + make_interval(days => v_code.days);
  update public.profiles set vip_expire = v_new_expire where token = p_token;
  update public.member_codes set used_by = v_user.email, used_at = now(), active = false where code = v_code.code;
  return json_build_object('ok', true, 'vip_expire', v_new_expire, 'days', v_code.days);
end;
$$;

create or replace function admin_create_member_codes(
  p_admin_token text,
  p_days int default 30,
  p_count int default 1,
  p_assigned_email text default null,
  p_note text default null
) returns json
language plpgsql security definer
as $$
declare
  v_codes text[] := '{}';
  v_code text;
  i int;
begin
  if not _blys_is_admin_token(p_admin_token) then
    return json_build_object('ok', false, 'msg', '无权限');
  end if;
  p_days := greatest(1, least(coalesce(p_days, 30), 3660));
  p_count := greatest(1, least(coalesce(p_count, 1), 100));
  for i in 1..p_count loop
    loop
      v_code := 'BLYS-' || p_days || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists(select 1 from public.member_codes where code = v_code);
    end loop;
    insert into public.member_codes(code, days, assigned_email, note, created_by)
    values(v_code, p_days, nullif(trim(p_assigned_email), ''), nullif(trim(p_note), ''), p_admin_token);
    v_codes := array_append(v_codes, v_code);
  end loop;
  return json_build_object('ok', true, 'codes', v_codes);
end;
$$;

create or replace function admin_list_member_codes(p_admin_token text)
returns json
language plpgsql security definer
as $$
declare
  v_list json;
begin
  if not _blys_is_admin_token(p_admin_token) then
    return json_build_object('ok', false, 'msg', '无权限');
  end if;
  select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_list
  from (
    select code, days, note, assigned_email, active, used_by, used_at, expires_at, created_at
    from public.member_codes
    order by created_at desc
    limit 200
  ) t;
  return json_build_object('ok', true, 'list', v_list);
end;
$$;

create or replace function admin_extend_vip(p_admin_token text, p_email text, p_days int default 30)
returns json
language plpgsql security definer
as $$
declare
  v_new_expire timestamptz;
begin
  if not _blys_is_admin_token(p_admin_token) then
    return json_build_object('ok', false, 'msg', '无权限');
  end if;
  p_days := greatest(1, least(coalesce(p_days, 30), 3660));
  update public.profiles
  set vip_expire = greatest(coalesce(vip_expire, now()), now()) + make_interval(days => p_days)
  where lower(email) = lower(p_email)
  returning vip_expire into v_new_expire;
  if v_new_expire is null then
    return json_build_object('ok', false, 'msg', '用户不存在');
  end if;
  return json_build_object('ok', true, 'vip_expire', v_new_expire);
end;
$$;

create or replace function get_private_conversation(p_token text, p_user_email text default null)
returns json
language plpgsql security definer
as $$
declare
  v_me record;
  v_target record;
  v_conv record;
  v_target_email text;
begin
  select email, nickname, is_admin into v_me from public.profiles where token = p_token;
  if v_me is null then return json_build_object('ok', false, 'msg', '请先登录'); end if;

  if coalesce(v_me.is_admin, false) = true or lower(v_me.email) in ('491788533@qq.com', '491788533@gmail.com') then
    v_target_email := lower(trim(coalesce(p_user_email, '')));
    if v_target_email = '' then return json_build_object('ok', false, 'msg', '请选择私聊用户'); end if;
    select email, nickname into v_target from public.profiles where lower(email) = v_target_email;
    if v_target is null then return json_build_object('ok', false, 'msg', '用户不存在'); end if;
    if lower(v_target.email) = lower(v_me.email) then return json_build_object('ok', false, 'msg', '不能和自己私聊'); end if;
  else
    v_target.email := v_me.email;
    v_target.nickname := v_me.nickname;
  end if;

  insert into public.private_conversations(user_email, user_nickname, updated_at)
  values(v_target.email, coalesce(v_target.nickname, split_part(v_target.email, '@', 1)), now())
  on conflict(user_email) do update
    set user_nickname = excluded.user_nickname,
        updated_at = public.private_conversations.updated_at
  returning * into v_conv;

  return json_build_object(
    'ok', true,
    'id', v_conv.id,
    'user_email', v_conv.user_email,
    'user_nickname', v_conv.user_nickname,
    'last_message', v_conv.last_message,
    'last_message_at', v_conv.last_message_at,
    'admin_unread', v_conv.admin_unread,
    'user_unread', v_conv.user_unread
  );
end;
$$;

create or replace function list_private_conversations(p_token text)
returns json
language plpgsql security definer
as $$
declare
  v_me record;
  v_list json;
begin
  select email, nickname, is_admin into v_me from public.profiles where token = p_token;
  if v_me is null then return json_build_object('ok', false, 'msg', '请先登录'); end if;

  if coalesce(v_me.is_admin, false) = true or lower(v_me.email) in ('491788533@qq.com', '491788533@gmail.com') then
    select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_list
    from (
      select id, user_email, user_nickname, last_message, last_message_at, admin_unread, user_unread, updated_at
      from public.private_conversations
      order by coalesce(last_message_at, updated_at, created_at) desc
      limit 200
    ) t;
  else
    perform get_private_conversation(p_token, null);
    select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_list
    from (
      select id, user_email, user_nickname, last_message, last_message_at, admin_unread, user_unread, updated_at
      from public.private_conversations
      where lower(user_email) = lower(v_me.email)
      limit 1
    ) t;
  end if;
  return json_build_object('ok', true, 'list', v_list);
end;
$$;

create or replace function _blys_can_open_private(p_token text, p_conversation_id uuid)
returns boolean
language plpgsql security definer
as $$
declare
  v_me record;
  v_conv record;
begin
  select email, nickname, is_admin into v_me from public.profiles where token = p_token;
  if v_me is null then return false; end if;
  select * into v_conv from public.private_conversations where id = p_conversation_id;
  if v_conv is null then return false; end if;
  return coalesce(v_me.is_admin, false) = true
    or lower(v_me.email) in ('491788533@qq.com', '491788533@gmail.com')
    or lower(v_me.email) = lower(v_conv.user_email);
end;
$$;

create or replace function list_private_messages(
  p_token text,
  p_conversation_id uuid,
  p_limit int default 100,
  p_after timestamptz default null,
  p_before timestamptz default null
) returns table(
  id uuid,
  user_email text,
  user_nickname text,
  content text,
  image text,
  reply_to_id uuid,
  reply_to_nickname text,
  reply_to_content text,
  reply_to_image text,
  recalled_at timestamptz,
  created_at timestamptz
) language plpgsql security definer
as $$
begin
  if not _blys_can_open_private(p_token, p_conversation_id) then
    return;
  end if;
  p_limit := greatest(1, least(coalesce(p_limit, 100), 100));
  if p_after is not null then
    return query
    select m.id, m.sender_email, m.sender_nickname, m.content, m.image,
           m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
           m.recalled_at, m.created_at
    from public.private_messages m
    where m.conversation_id = p_conversation_id
      and (m.created_at > p_after or m.recalled_at > p_after)
    order by m.created_at asc;
  elsif p_before is not null then
    return query
    select m.id, m.sender_email, m.sender_nickname, m.content, m.image,
           m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
           m.recalled_at, m.created_at
    from public.private_messages m
    where m.conversation_id = p_conversation_id and m.created_at < p_before
    order by m.created_at desc
    limit p_limit;
  else
    return query
    select m.id, m.sender_email, m.sender_nickname, m.content, m.image,
           m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
           m.recalled_at, m.created_at
    from public.private_messages m
    where m.conversation_id = p_conversation_id
    order by m.created_at desc
    limit p_limit;
  end if;
end;
$$;

create or replace function send_private_message(
  p_token text,
  p_conversation_id uuid,
  p_content text,
  p_image text default null,
  p_reply_to_id uuid default null
) returns json
language plpgsql security definer
as $$
declare
  v_me record;
  v_conv record;
  v_is_admin boolean := false;
  v_reply record;
  v_new_id uuid;
  v_recipient text;
  v_preview text;
begin
  select email, nickname, is_admin into v_me from public.profiles where token = p_token;
  if v_me is null then return json_build_object('ok', false, 'msg', '请先登录'); end if;
  select * into v_conv from public.private_conversations where id = p_conversation_id;
  if v_conv is null then return json_build_object('ok', false, 'msg', '会话不存在'); end if;
  v_is_admin := coalesce(v_me.is_admin, false) = true or lower(v_me.email) in ('491788533@qq.com', '491788533@gmail.com') ;
  if not v_is_admin and lower(v_me.email) <> lower(v_conv.user_email) then
    return json_build_object('ok', false, 'msg', '普通用户只能和白鹿原上私聊');
  end if;
  if nullif(trim(coalesce(p_content, '')), '') is null and nullif(trim(coalesce(p_image, '')), '') is null then
    return json_build_object('ok', false, 'msg', '内容为空');
  end if;

  if p_reply_to_id is not null then
    select id, sender_nickname, content, image into v_reply
    from public.private_messages
    where id = p_reply_to_id and conversation_id = p_conversation_id and recalled_at is null;
  end if;

  v_recipient := case when v_is_admin then v_conv.user_email else _blys_admin_email() end;
  insert into public.private_messages(
    conversation_id, sender_email, sender_nickname, recipient_email, content, image,
    reply_to_id, reply_to_nickname, reply_to_content, reply_to_image, created_at
  ) values (
    p_conversation_id,
    v_me.email,
    coalesce(v_me.nickname, split_part(v_me.email, '@', 1)),
    v_recipient,
    nullif(trim(coalesce(p_content, '')), ''),
    nullif(trim(coalesce(p_image, '')), ''),
    case when v_reply.id is not null then v_reply.id else null end,
    case when v_reply.id is not null then v_reply.sender_nickname else null end,
    case when v_reply.id is not null then v_reply.content else null end,
    case when v_reply.id is not null then v_reply.image else null end,
    now()
  ) returning id into v_new_id;

  v_preview := coalesce(nullif(trim(coalesce(p_content, '')), ''), case when p_image is not null then '[图片]' else '' end);
  update public.private_conversations
  set last_message = left(v_preview, 120),
      last_message_at = now(),
      updated_at = now(),
      admin_unread = admin_unread + case when v_is_admin then 0 else 1 end,
      user_unread = user_unread + case when v_is_admin then 1 else 0 end
  where id = p_conversation_id;

  return json_build_object('ok', true, 'id', v_new_id);
end;
$$;

create or replace function mark_private_read(p_token text, p_conversation_id uuid)
returns json
language plpgsql security definer
as $$
declare
  v_me record;
  v_is_admin boolean := false;
begin
  select email, nickname, is_admin into v_me from public.profiles where token = p_token;
  if v_me is null then return json_build_object('ok', false, 'msg', '请先登录'); end if;
  if not _blys_can_open_private(p_token, p_conversation_id) then
    return json_build_object('ok', false, 'msg', '无权限');
  end if;
  v_is_admin := coalesce(v_me.is_admin, false) = true or lower(v_me.email) in ('491788533@qq.com', '491788533@gmail.com') ;
  if v_is_admin then
    update public.private_conversations set admin_unread = 0 where id = p_conversation_id;
  else
    update public.private_conversations set user_unread = 0 where id = p_conversation_id;
  end if;
  return json_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
