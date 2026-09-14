-- Serializa entrada e início de partida para impedir excesso de jogadores e
-- criação duplicada de partidas quando vários clientes agem ao mesmo tempo.
create or replace function public.join_lobby_atomic(
  p_lobby_id uuid,
  p_player_id uuid,
  p_player_name text,
  p_ready boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_lobby public.lobbies%rowtype;
  v_player_count integer;
begin
  select *
    into v_lobby
    from public.lobbies
   where id = p_lobby_id
   for update;

  if not found then
    raise exception 'Sala não encontrada.' using errcode = 'P0001';
  end if;

  if v_lobby.status <> 'open' then
    raise exception 'Sala fechada.' using errcode = 'P0001';
  end if;

  if nullif(btrim(p_player_name), '') is null then
    raise exception 'Nome do jogador é obrigatório.' using errcode = 'P0001';
  end if;

  -- Reconexões do mesmo jogador não consomem uma nova vaga.
  if not exists (
    select 1
      from public.lobby_players
     where lobby_id = p_lobby_id
       and player_id = p_player_id
  ) then
    select count(*)
      into v_player_count
      from public.lobby_players
     where lobby_id = p_lobby_id;

    if v_player_count >= v_lobby.max_players then
      raise exception 'Sala cheia.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.lobby_players (
    lobby_id,
    player_id,
    player_name,
    ready,
    joined_at,
    last_seen
  ) values (
    p_lobby_id,
    p_player_id,
    nullif(btrim(p_player_name), ''),
    coalesce(p_ready, false),
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (lobby_id, player_id) do update
    set player_name = excluded.player_name,
        ready = excluded.ready,
        last_seen = excluded.last_seen;

  if v_lobby.host_id is null then
    update public.lobbies
       set host_id = p_player_id
     where id = p_lobby_id;
  end if;

  select count(*)
    into v_player_count
    from public.lobby_players
   where lobby_id = p_lobby_id;

  return jsonb_build_object(
    'lobby_id', p_lobby_id,
    'player_id', p_player_id,
    'player_count', v_player_count
  );
end;
$function$;

create or replace function public.start_match_atomic(
  p_lobby_id uuid,
  p_host_player_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_lobby public.lobbies%rowtype;
  v_existing_match public.matches%rowtype;
  v_match public.matches%rowtype;
  v_players jsonb;
  v_player_count integer;
  v_ready_count integer;
begin
  select *
    into v_lobby
    from public.lobbies
   where id = p_lobby_id
   for update;

  if not found then
    raise exception 'Sala não encontrada.' using errcode = 'P0001';
  end if;

  if v_lobby.host_id is distinct from p_host_player_id then
    raise exception 'Somente o host pode iniciar a partida.' using errcode = 'P0001';
  end if;

  -- Torna o segundo clique/reenvio idempotente.
  if v_lobby.status <> 'open' then
    select *
      into v_existing_match
      from public.matches
     where lobby_id = p_lobby_id
     order by created_at desc
     limit 1;

    if found then
      return jsonb_build_object('id', v_existing_match.id, 'already_started', true);
    end if;

    raise exception 'Sala fechada.' using errcode = 'P0001';
  end if;

  select count(*), count(*) filter (where ready is true)
    into v_player_count, v_ready_count
    from public.lobby_players
   where lobby_id = p_lobby_id;

  if v_player_count = 0 or v_ready_count <> v_player_count then
    raise exception 'Todos os jogadores precisam estar prontos.' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_id', player_id,
        'player_name', player_name,
        'ready', ready
      ) order by joined_at
    ),
    '[]'::jsonb
  )
    into v_players
    from public.lobby_players
   where lobby_id = p_lobby_id;

  insert into public.matches (lobby_id, host_id, state, created_at)
  values (
    p_lobby_id,
    p_host_player_id,
    jsonb_build_object('players', v_players),
    clock_timestamp()
  )
  returning * into v_match;

  update public.lobbies
     set status = 'locked'
   where id = p_lobby_id;

  return jsonb_build_object('id', v_match.id, 'already_started', false);
end;
$function$;

grant execute on function public.join_lobby_atomic(uuid, uuid, text, boolean) to anon, authenticated;
grant execute on function public.start_match_atomic(uuid, uuid) to anon, authenticated;

-- A leitura e a remoção de rooms antigas passam a usar o mesmo índice.
create index if not exists rooms_code_updated_at_idx
  on public.rooms (code, updated_at desc);

create index if not exists matches_lobby_id_created_at_idx
  on public.matches (lobby_id, created_at desc);

create schema if not exists private;

create or replace function private.cleanup_sales_game_orphan_rooms(
  p_stale_before timestamptz default (clock_timestamp() - interval '2 hours')
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  delete from public.rooms as room
   where room.updated_at < p_stale_before
     and not exists (
       select 1
         from public.lobbies as lobby
        where lobby.id::text = room.code::text
     );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function private.cleanup_sales_game_orphan_rooms(timestamptz) from public, anon, authenticated;

-- Supabase Cron usa pg_cron. A criação é idempotente e o job não fica exposto
-- pela Data API, pois chama uma função do schema private.
create extension if not exists pg_cron with schema extensions;

do $block$
begin
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'sales-game-cleanup-orphan-rooms';

  perform cron.schedule(
    'sales-game-cleanup-orphan-rooms',
    '*/15 * * * *',
    'select private.cleanup_sales_game_orphan_rooms();'
  );
end;
$block$;
