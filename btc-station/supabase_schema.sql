-- 建立 profiles 表，用于存储用户除了邮箱密码外的扩展信息
create table public.profiles (
  id uuid not null references auth.users on delete cascade,
  updated_at timestamp with time zone,
  username text unique,
  full_name text,
  avatar_url text,
  
  primary key (id)
);

-- 开启行级安全策略（Row Level Security, RLS）
alter table public.profiles enable row level security;

-- 允许所有用户查看 profiles
create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

-- 仅允许用户修改自己的 profile
create policy "Users can insert their own profile." on profiles
  for insert with check ((select auth.uid()) = id);

create policy "Users can update own profile." on profiles
  for update using ((select auth.uid()) = id);

-- 监听 auth.users 注册事件，自动创建 public.profiles
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

-- 触发器：每次注册时执行 handle_new_user()
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
