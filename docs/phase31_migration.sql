-- Phase 3.1 Supabase migration
-- Run in Supabase Dashboard → SQL Editor

-- 0. Relax NOT NULL constraints on backtests table for Phase 3.1
ALTER TABLE public.backtests ALTER COLUMN metrics     DROP NOT NULL;
ALTER TABLE public.backtests ALTER COLUMN trades      DROP NOT NULL;
ALTER TABLE public.backtests ALTER COLUMN start_date  DROP NOT NULL;
ALTER TABLE public.backtests ALTER COLUMN end_date    DROP NOT NULL;
ALTER TABLE public.backtests ALTER COLUMN strategy_id DROP NOT NULL;

-- Drop check constraints that block partial inserts (re-add if needed later)
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.backtests'::regclass AND contype = 'c'
  LOOP
    EXECUTE 'ALTER TABLE public.backtests DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- 1. Add class_name & strategy_type to strategies table
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS class_name text,
  ADD COLUMN IF NOT EXISTS strategy_type text DEFAULT 'freqtrade';

-- 2. Extend backtests table for Phase 3.1
ALTER TABLE public.backtests
  ADD COLUMN IF NOT EXISTS celery_task_id text,
  ADD COLUMN IF NOT EXISTS csv_data text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 3. freqtrade_jobs table (ops monitoring)
CREATE TABLE IF NOT EXISTS public.freqtrade_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  backtest_id uuid REFERENCES public.backtests(id) ON DELETE SET NULL,
  container_id text,
  container_name text,
  cpu_seconds float,
  memory_peak_mb integer,
  duration_seconds integer,
  status text NOT NULL CHECK (status IN ('queued','starting','running','completed','failed','killed')),
  exit_code integer,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ft_jobs_user   ON public.freqtrade_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_ft_jobs_status ON public.freqtrade_jobs(status);

ALTER TABLE public.freqtrade_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs" ON public.freqtrade_jobs
  FOR SELECT USING (auth.uid() = user_id);

-- 4. subscriptions table (plan tracking)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);
