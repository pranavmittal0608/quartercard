-- ============================================================
-- Twenty-Five — chip economy schema
-- ============================================================
-- Run this once in your Supabase project's SQL editor (Database > SQL Editor).
--
-- THE ONE RULE THIS FILE ENFORCES:
-- No client ever writes a balance directly. A balance is a SUM over a
-- ledger of individual entries, and the only way to add a ledger entry
-- is through one of the three functions at the bottom. Row Level Security
-- lets a signed-in user READ their own rows and calls those functions —
-- nothing else. This is what stops someone opening dev tools and giving
-- themselves a million chips: there is no table cell holding "your
-- balance" for them to edit. Balance is always recomputed from history.
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  welcome_bonus_claimed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Every chip movement, ever. Nothing is deleted or edited after the fact —
-- if a mistake happens, you reverse it with a new entry, the same way a
-- real ledger works. This is what makes the balance auditable: you can
-- always answer "where did this player's chips come from" by reading history,
-- not by trusting a number.
create table if not exists public.chip_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null,                 -- positive = credit, negative = debit
  kind text not null check (kind in ('welcome_bonus', 'purchase', 'buy_in', 'cash_out', 'adjustment')),
  ref text,                               -- table/session id, or a payment provider's charge id
  created_at timestamptz not null default now()
);
create index if not exists chip_ledger_user_idx on public.chip_ledger(user_id);

-- A player's current wallet, outside of any table they're sitting at. This
-- is a VIEW, not a stored number, so it can never drift from the ledger —
-- it IS the ledger, summed.
create or replace view public.chip_balance as
  select user_id, coalesce(sum(amount), 0) as balance
  from public.chip_ledger
  group by user_id;

alter table public.profiles enable row level security;
alter table public.chip_ledger enable row level security;

-- Read your own profile and your own ledger. Nobody reads anyone else's —
-- your chip count is between you and the table you're sitting at, same as
-- how a real cash game doesn't publish everyone's net worth.
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "read own ledger" on public.chip_ledger
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies are defined for chip_ledger at all.
-- Under RLS that means the table is a closed box from the client's side —
-- direct writes are refused regardless of who's signed in. The three
-- functions below are SECURITY DEFINER, which means they run with the
-- schema owner's rights and step around that wall deliberately, but only
-- to do exactly the one thing each is written to do.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Player'));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- the three ways chips ever move ----------

-- 1. The welcome bonus. Runs once per account, ever — the second call is a
-- no-op, not a second payout, so there's no "call it 50 times" version of
-- this bug regardless of what the client does or how many times it retries.
create or replace function public.claim_welcome_bonus(bonus_amount bigint default 200)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  already boolean;
begin
  select welcome_bonus_claimed into already
  from public.profiles where id = auth.uid()
  for update;                              -- locks the row so two rapid
                                            -- clicks can't both slip through
  if already is null then
    raise exception 'no profile for this user';
  end if;
  if already then
    return 0;                              -- already claimed: pay nothing, don't error
  end if;
  update public.profiles set welcome_bonus_claimed = true where id = auth.uid();
  insert into public.chip_ledger (user_id, amount, kind)
  values (auth.uid(), bonus_amount, 'welcome_bonus');
  return bonus_amount;
end;
$$;

-- 2. Buying into a table. Fails cleanly if they can't afford it — never
-- lets a balance go negative, which is what "the game gave someone chips
-- that don't exist" would look like from the ledger's point of view.
create or replace function public.buy_in(amount bigint, table_ref text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance bigint;
begin
  if amount <= 0 then
    raise exception 'buy-in must be positive';
  end if;
  -- FOR UPDATE can't be combined with sum() directly, and locking existing
  -- ledger rows wouldn't stop a concurrent insert anyway. Lock the profile
  -- row instead, the same mutex claim_welcome_bonus uses: only one
  -- transaction for this user can hold it at a time, so two rapid buy-in
  -- clicks can't both read the same balance and both succeed.
  perform 1 from public.profiles where id = auth.uid() for update;
  select coalesce(sum(c.amount), 0) into current_balance
  from public.chip_ledger c where c.user_id = auth.uid();
  if current_balance < amount then
    raise exception 'insufficient balance: have %, need %', current_balance, amount;
  end if;
  insert into public.chip_ledger (user_id, amount, kind, ref)
  values (auth.uid(), -amount, 'buy_in', table_ref);
  return current_balance - amount;
end;
$$;

-- 3. Cashing back in whatever's left of your stack when you leave a table.
--
-- IMPORTANT LIMIT OF THIS DESIGN: the live game itself still runs in the
-- player's own browser, not on a server, so this function has no way to
-- independently know what actually happened at the table -- it can only
-- check that the claimed amount is IN THE RANGE of what real play could
-- plausibly have produced. Closing that fully means the game logic itself
-- has to move server-side -- worth doing before any real cash-out-adjacent
-- feature exists, even though there isn't one yet. This bound exists so a
-- mistake or a casual cheat attempt fails loudly and immediately, not so a
-- determined attacker is stopped for good.
--
-- The ceiling is scoped to the PLAYER over a rolling window, not to the
-- table_ref they pass in -- table_ref is just a string the client picks,
-- so a per-table ceiling can be reset for free by making up a new one each
-- time. Tying it to the account instead means that trick doesn't work.
create or replace function public.cash_out(amount bigint, table_ref text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_buy_in bigint;
  recent_cash_out bigint;
  ceiling_multiple constant bigint := 50;
  window_hours constant int := 24;
begin
  if amount < 0 then
    raise exception 'cash-out cannot be negative';
  end if;
  perform 1 from public.profiles where id = auth.uid() for update;

  select coalesce(sum(-c.amount), 0) into recent_buy_in
  from public.chip_ledger c
  where c.user_id = auth.uid() and c.kind = 'buy_in'
    and c.created_at > now() - (window_hours || ' hours')::interval;
  if recent_buy_in = 0 then
    raise exception 'no recent buy-in on record, nothing to cash out from';
  end if;

  select coalesce(sum(c.amount), 0) into recent_cash_out
  from public.chip_ledger c
  where c.user_id = auth.uid() and c.kind = 'cash_out'
    and c.created_at > now() - (window_hours || ' hours')::interval;
  if recent_cash_out + amount > recent_buy_in * ceiling_multiple then
    raise exception 'cash-out of % (% in the last % hours) exceeds % bought in over the same window, times a %x ceiling',
      amount, recent_cash_out + amount, window_hours, recent_buy_in, ceiling_multiple;
  end if;

  -- The ratio check above is honest about what it does and doesn't stop:
  -- it bounds the ratio between cash-out and buy-in, not the raw number of
  -- cycles someone runs through that ratio. A script firing many small
  -- buy-in/cash-out pairs can stay within the ratio at every single step
  -- and still add up to a large total before the window rolls over, since
  -- the window is a rolling 24 hours, not a fixed daily allowance. A real
  -- human playing normally cashes out a handful of times a session, not
  -- dozens of times in a minute -- so a plain rate limit closes the gap a
  -- ratio alone can't, without needing to understand anything about the
  -- game itself.
  if (select count(*) from public.chip_ledger
      where user_id = auth.uid() and kind in ('buy_in', 'cash_out')
        and created_at > now() - interval '10 minutes') > 20 then
    raise exception 'too many buy-in/cash-out calls in a short window -- slow down';
  end if;

  insert into public.chip_ledger (user_id, amount, kind, ref)
  values (auth.uid(), amount, 'cash_out', table_ref);
  return amount;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default -- that
-- includes anon, i.e. a genuinely unauthenticated visitor. These three
-- functions happen to reject an unauthenticated caller anyway (no matching
-- profile row), so this was accidentally safe, not actually safe. Revoke
-- first so the only thing standing between a stranger and these functions
-- is the explicit grant below, not an accident of what the function body
-- happens to check.
revoke execute on function public.claim_welcome_bonus(bigint) from public;
revoke execute on function public.buy_in(bigint, text) from public;
revoke execute on function public.cash_out(bigint, text) from public;

grant execute on function public.claim_welcome_bonus(bigint) to authenticated;
grant execute on function public.buy_in(bigint, text) to authenticated;
grant execute on function public.cash_out(bigint, text) to authenticated;
grant select on public.chip_balance to authenticated;
