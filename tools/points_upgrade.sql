-- ============================================================
-- 浏览统计 + 积分体系 升级脚本（v20260820）
-- 在 Supabase SQL Editor 中执行一次即可
-- 包含：浏览量统计、每日签到、评论积分、积分兑换专享内容
-- ============================================================

-- ---------- 1. 页面浏览记录 ----------
create table if not exists page_views (
  id bigserial primary key,
  page_type text not null,          -- 'review'（每日复盘）| 'article'（文章）
  ref_id text not null,             -- 复盘：'2026-08-19'；文章：'market-overview' 等
  viewer_key text not null,         -- 登录用户 email；游客用浏览器生成的匿名 id
  view_date date default current_date,
  unique (page_type, ref_id, viewer_key, view_date)
);
create index if not exists idx_page_views_lookup on page_views(page_type, ref_id);

-- ---------- 2. 用户积分 ----------
create table if not exists user_points (
  email text primary key,
  points int not null default 0,
  total_earned int not null default 0,
  updated_at timestamptz default now()
);

-- ---------- 3. 积分流水 ----------
create table if not exists point_logs (
  id bigserial primary key,
  email text not null,
  amount int not null,              -- +2 / -50 等
  reason text not null,             -- '每日签到' / '评论奖励' / '兑换XXX'
  created_at timestamptz default now()
);
create index if not exists idx_point_logs_email on point_logs(email, created_at desc);

-- ---------- 4. 每日签到 ----------
create table if not exists checkins (
  email text not null,
  checkin_date date not null,
  amount int not null default 5,
  created_at timestamptz default now(),
  primary key (email, checkin_date)
);

-- ---------- 5. 积分兑换解锁内容 ----------
create table if not exists content_locks (
  email text not null,
  page text not null,               -- vipzone 卡片标识，如 '盘中提示' / '周报' / '战法'
  amount int not null default 0,
  unlocked_at timestamptz default now(),
  primary key (email, page)
);

-- ============================================================
-- RPC 函数
-- ============================================================

-- ---------- A. 记录一次浏览（同设备/账号同页每天只计 1 次） ----------
drop function if exists record_view(text, text, text);
create or replace function record_view(p_page_type text, p_ref_id text, p_viewer_key text)
returns json
language plpgsql security definer
as $$
begin
  if p_page_type is null or p_ref_id is null or p_viewer_key is null then
    return json_build_object('ok', false, 'msg', '参数缺失');
  end if;
  insert into page_views (page_type, ref_id, viewer_key)
  values (p_page_type, p_ref_id, p_viewer_key)
  on conflict on constraint page_views_page_type_ref_id_viewer_key_view_date_key do nothing;
  return json_build_object('ok', true);
end;
$$;

-- ---------- B. 查询浏览量（独立访客数） ----------
drop function if exists get_views(text, text);
create or replace function get_views(p_page_type text, p_ref_id text)
returns json
language plpgsql security definer
as $$
declare
  v_count int;
begin
  select count(distinct viewer_key) into v_count
  from page_views
  where page_type = p_page_type and ref_id = p_ref_id;
  return json_build_object('ok', true, 'views', coalesce(v_count, 0));
end;
$$;

-- ---------- C. 查询我的积分 ----------
drop function if exists get_points(text);
create or replace function get_points(p_token text)
returns json
language plpgsql security definer
as $$
declare
  v_user record;
  v_points int default 0;
  v_total int default 0;
  v_checked boolean default false;
begin
  select email into v_user from profiles where token = p_token;
  if v_user is null then
    return json_build_object('ok', false, 'msg', '登录已过期');
  end if;
  select points, total_earned into v_points, v_total
  from user_points where email = v_user.email;
  select exists (
    select 1 from checkins where email = v_user.email and checkin_date = current_date
  ) into v_checked;
  return json_build_object(
    'ok', true,
    'points', coalesce(v_points, 0),
    'total_earned', coalesce(v_total, 0),
    'today_checked', v_checked
  );
end;
$$;

-- ---------- D. 每日签到（+5 积分，一天一次，连续签到有累计奖励） ----------
drop function if exists checkin(text);
create or replace function checkin(p_token text)
returns json
language plpgsql security definer
as $$
declare
  v_user record;
  v_streak int := 1;      -- 含今天的连续签到天数
  v_reward int := 5;
begin
  select email into v_user from profiles where token = p_token;
  if v_user is null then
    return json_build_object('ok', false, 'msg', '登录已过期');
  end if;
  -- 今天已签到？
  if exists (select 1 from checkins where email = v_user.email and checkin_date = current_date) then
    return json_build_object('ok', false, 'msg', '今天已签到');
  end if;
  -- 计算含今天的连续签到天数（用 row_number 差值分组判定连续）
  with rec as (
    select checkin_date,
           checkin_date - (row_number() over (order by checkin_date desc))::int as grp
    from checkins
    where email = v_user.email and checkin_date < current_date
  )
  select count(*) + 1 into v_streak
  from rec
  where grp = (select max(grp) from rec);
  -- 无历史签到记录时 count 为空 → 保持 v_streak = 1
  if v_streak is null or v_streak < 1 then v_streak := 1; end if;
  -- 第 3/7/15/30 天额外奖励
  if v_streak = 3 then v_reward := 8; end if;
  if v_streak = 7 then v_reward := 15; end if;
  if v_streak = 15 then v_reward := 30; end if;
  if v_streak = 30 then v_reward := 60; end if;

  insert into checkins (email, checkin_date, amount) values (v_user.email, current_date, v_reward);
  insert into user_points (email, points, total_earned)
  values (v_user.email, v_reward, v_reward)
  on conflict (email) do update
    set points = user_points.points + v_reward,
        total_earned = user_points.total_earned + v_reward,
        updated_at = now();
  insert into point_logs (email, amount, reason)
  values (v_user.email, v_reward, case
    when v_reward > 5 then '连续签到' || v_streak || '天奖励'
    else '每日签到'
  end);
  -- 返回最新积分
  select points into v_reward from user_points where email = v_user.email;
  return json_build_object('ok', true, 'points', coalesce(v_reward, 0), 'streak', v_streak, 'reward', true, 'msg', '签到成功');
end;
$$;

-- ---------- E. 发表评论（+2 积分，每天最多 20 分，防刷） ----------
drop function if exists add_comment(text, text, text);
create or replace function add_comment(p_token text, p_article text, p_content text)
returns json
language plpgsql security definer
as $$
declare
  v_user record;
  v_today_rewards int;
  v_points int;
begin
  select email, nickname into v_user from profiles where token = p_token;
  if v_user is null then
    return json_build_object('ok', false, 'msg', '登录已过期');
  end if;
  if p_content is null or length(trim(p_content)) = 0 then
    return json_build_object('ok', false, 'msg', '内容为空');
  end if;
  insert into comments (article, email, nickname, content)
  values (p_article, v_user.email, coalesce(v_user.nickname, split_part(v_user.email, '@', 1)), trim(p_content));

  -- 今日评论奖励次数
  select count(*) into v_today_rewards
  from point_logs
  where email = v_user.email and reason = '评论奖励' and created_at::date = current_date;

  if v_today_rewards < 10 then
    insert into user_points (email, points, total_earned)
    values (v_user.email, 2, 2)
    on conflict (email) do update
      set points = user_points.points + 2,
          total_earned = user_points.total_earned + 2,
          updated_at = now();
    insert into point_logs (email, amount, reason) values (v_user.email, 2, '评论奖励');
    select points into v_points from user_points where email = v_user.email;
    return json_build_object('ok', true, 'msg', '评论成功 +2积分', 'points', coalesce(v_points, 0));
  end if;
  select points into v_points from user_points where email = v_user.email;
  return json_build_object('ok', true, 'msg', '评论成功', 'points', coalesce(v_points, 0));
end;
$$;

-- ---------- F. 积分兑换专享内容 ----------
drop function if exists redeem_content(text, text, int);
create or replace function redeem_content(p_token text, p_page text, p_points int)
returns json
language plpgsql security definer
as $$
declare
  v_user record;
  v_points int default 0;
begin
  select email into v_user from profiles where token = p_token;
  if v_user is null then
    return json_build_object('ok', false, 'msg', '登录已过期');
  end if;
  -- 已解锁过？
  if exists (select 1 from content_locks where email = v_user.email and page = p_page) then
    return json_build_object('ok', false, 'msg', '已解锁过该内容');
  end if;
  select points into v_points from user_points where email = v_user.email;
  if coalesce(v_points, 0) < p_points then
    return json_build_object('ok', false, 'msg', '积分不足', 'need', p_points, 'have', coalesce(v_points, 0));
  end if;
  update user_points set points = points - p_points, updated_at = now()
  where email = v_user.email;
  insert into point_logs (email, amount, reason) values (v_user.email, -p_points, '兑换' || p_page);
  insert into content_locks (email, page, amount) values (v_user.email, p_page, p_points);
  return json_build_object('ok', true, 'msg', '兑换成功', 'points', coalesce(v_points, 0) - p_points);
end;
$$;

-- ---------- G. 查询已解锁内容 ----------
drop function if exists get_locks(text);
create or replace function get_locks(p_token text)
returns json
language plpgsql security definer
as $$
declare
  v_user record;
  v_list text[] := '{}';
begin
  select email into v_user from profiles where token = p_token;
  if v_user is null then
    return json_build_object('ok', false, 'msg', '登录已过期');
  end if;
  select array_agg(page) into v_list from content_locks where email = v_user.email;
  return json_build_object('ok', true, 'list', coalesce(v_list, '{}'));
end;
$$;