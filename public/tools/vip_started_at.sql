-- Add and maintain the first VIP start date.
-- Existing active members are backfilled as one month before their current expire time.

alter table public.profiles
  add column if not exists vip_started_at timestamptz;

update public.profiles
set vip_started_at = vip_expire - interval '1 month'
where vip_started_at is null
  and vip_expire is not null
  and vip_expire > now();

create or replace function public.admin_list_users(p_admin_token text)
returns json
language plpgsql
security definer
as $function$
declare
  v_list json;
begin
  if length(coalesce(p_admin_token, '')) < 10 then
    return json_build_object('ok', false, 'msg', '无权限');
  end if;

  select json_agg(row_to_json(t)) into v_list
  from (
    select
      email,
      nickname,
      (vip_expire > now()) as is_vip,
      vip_started_at,
      vip_expire,
      created_at
    from public.profiles
    order by created_at desc
  ) t;

  return json_build_object('ok', true, 'list', coalesce(v_list, '[]'::json));
end;
$function$;

create or replace function public.admin_set_vip(p_admin_token text, p_email text, p_days integer)
returns json
language plpgsql
security definer
as $function$
declare
  v_new_expire timestamptz;
begin
  if length(coalesce(p_admin_token, '')) < 10 then
    return json_build_object('ok', false, 'msg', '无权限');
  end if;

  if p_days < 0 then
    update public.profiles
    set vip_expire = null
    where lower(email) = lower(p_email);
    return json_build_object('ok', true, 'vip_expire', null);
  end if;

  update public.profiles
  set
    vip_started_at = coalesce(vip_started_at, now()),
    vip_expire = now() + (p_days || ' days')::interval
  where lower(email) = lower(p_email)
  returning vip_expire into v_new_expire;

  if v_new_expire is null then
    return json_build_object('ok', false, 'msg', '用户不存在');
  end if;

  return json_build_object('ok', true, 'vip_expire', v_new_expire);
end;
$function$;

create or replace function public.admin_extend_vip(p_admin_token text, p_email text, p_days integer default 30)
returns json
language plpgsql
security definer
as $function$
declare
  v_new_expire timestamptz;
begin
  if not _blys_is_admin_token(p_admin_token) then
    return json_build_object('ok', false, 'msg', '无权限');
  end if;

  p_days := greatest(1, least(coalesce(p_days, 30), 3660));

  update public.profiles
  set
    vip_started_at = coalesce(vip_started_at, now()),
    vip_expire = greatest(coalesce(vip_expire, now()), now()) + make_interval(days => p_days)
  where lower(email) = lower(p_email)
  returning vip_expire into v_new_expire;

  if v_new_expire is null then
    return json_build_object('ok', false, 'msg', '用户不存在');
  end if;

  return json_build_object('ok', true, 'vip_expire', v_new_expire);
end;
$function$;

create or replace function public.redeem_code(p_token text, p_code text)
returns json
language plpgsql
security definer
as $function$
declare
  v_user record;
  v_code record;
  v_new_expire timestamptz;
begin
  select email, vip_expire, vip_started_at into v_user from public.profiles where token = p_token;
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

  update public.profiles
  set
    vip_started_at = coalesce(vip_started_at, now()),
    vip_expire = v_new_expire
  where token = p_token;

  update public.member_codes
  set used_by = v_user.email, used_at = now(), active = false
  where code = v_code.code;

  return json_build_object('ok', true, 'vip_expire', v_new_expire, 'days', v_code.days);
end;
$function$;

create or replace function public.get_profile(p_token text)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_user record;
begin
  select email, nickname, vip_started_at, vip_expire, is_admin
  into v_user
  from public.profiles
  where token = p_token;

  if v_user.email is null then
    return jsonb_build_object('ok', false, 'msg', '未登录');
  end if;

  return jsonb_build_object(
    'ok', true,
    'email', v_user.email,
    'nickname', v_user.nickname,
    'vip_started_at', v_user.vip_started_at,
    'vip_expire', v_user.vip_expire,
    'is_admin', coalesce(v_user.is_admin, false)
  );
end;
$function$;

notify pgrst, 'reload schema';
