-- Cricket War Room — initial schema (matches HTML migration + Judge/share stores)
-- Run in Supabase SQL editor or via supabase db push.

create extension if not exists "pgcrypto";

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  match_label text not null,
  team_a text,
  team_b text,
  venue text,
  format text,
  match_date timestamptz,
  result text,
  created_at timestamptz default now()
);

create index if not exists idx_matches_label on matches (match_label);

-- Short-link share payloads (POST /api/share-prediction)
create table if not exists share_packs (
  share_id text primary key check (share_id ~ '^[a-f0-9]{8}$'),
  pack jsonb not null,
  created_at timestamptz default now()
);

create index if not exists idx_share_packs_created on share_packs (created_at asc);

-- Judge service predictions (integer id, compatible with existing FastAPI responses)
create table if not exists judge_predictions (
  id bigserial primary key,
  match_id text not null,
  predicted_winner text not null,
  actual_winner text,
  confidence integer not null,
  created_at timestamptz default now()
);

create index if not exists idx_judge_predictions_match_id on judge_predictions (match_id);
create index if not exists idx_judge_predictions_created_at on judge_predictions (created_at desc);

create table if not exists accuracy_log (
  id uuid primary key default gen_random_uuid(),
  prediction_id bigint not null references judge_predictions (id) on delete cascade,
  actual_winner text not null,
  was_correct boolean not null,
  resolved_at timestamptz default now()
);

create index if not exists idx_accuracy_log_prediction on accuracy_log (prediction_id);

-- RLS on: access only via Supabase **service role** from Node/Judge (bypasses RLS).
-- Do not expose service_role to browsers; use anon + RPC later if you need client reads.
alter table share_packs enable row level security;
alter table judge_predictions enable row level security;
alter table accuracy_log enable row level security;
