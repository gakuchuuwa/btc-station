-- 先清理掉之前创建的简易版表和触发器
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles cascade;
drop table if exists public.user_preferences cascade;
drop table if exists public.parameter_optimizations cascade;
drop table if exists public.backtests cascade;
drop table if exists public.strategies cascade;

-- 3.1 profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  avatar_url text,

  plan text not null default 'free' check (plan in ('free', 'pro')),
  plan_expires_at timestamptz,
  stripe_customer_id text,

  ai_provider text check (ai_provider in ('claude', 'openai')),
  ai_key_encrypted text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- 3.2 user_preferences
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table user_preferences enable row level security;
create policy "Users can manage own preferences" on user_preferences
  for all using (auth.uid() = user_id);

-- 3.3 strategies（Phase 3 启用，预先建表）
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  code text not null,
  params jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_strategies_user on strategies(user_id);
alter table strategies enable row level security;
create policy "Users can manage own strategies" on strategies
  for all using (auth.uid() = user_id);
create policy "Anyone can view public strategies" on strategies
  for select using (is_public = true);

-- 3.4 backtests（Phase 3 启用，预先建表）
create table public.backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid not null references strategies(id) on delete cascade,
  config jsonb not null,
  metrics jsonb not null,
  trades jsonb,
  start_date timestamptz not null,
  end_date timestamptz not null,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index idx_backtests_user on backtests(user_id);
create index idx_backtests_strategy on backtests(strategy_id);
alter table backtests enable row level security;
create policy "Users can manage own backtests" on backtests
  for all using (auth.uid() = user_id);

-- 3.5 parameter_optimizations（Phase 4 启用，预先建表）
create table public.parameter_optimizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid not null references strategies(id) on delete cascade,
  param_ranges jsonb not null,
  results_csv_path text,
  best_params jsonb,
  best_metrics jsonb,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  total_combinations integer,
  completed_combinations integer default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_opt_user on parameter_optimizations(user_id);
alter table parameter_optimizations enable row level security;
create policy "Users can manage own optimizations" on parameter_optimizations
  for all using (auth.uid() = user_id);

-- 3.6 触发器（每次注册用户自动生成 profile 和 preference 记录）
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  insert into public.user_preferences (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
