-- Registra de forma explícita se cada jogador está no app instalado, na web
-- mobile ou na web desktop. O JSON mantém detalhes úteis sem exigir uma nova
-- migração para cada sinal de plataforma adicionado no futuro.
alter table public.lobby_players
  add column if not exists client_type text,
  add column if not exists client_version text,
  add column if not exists client_session_id text,
  add column if not exists client_info jsonb not null default '{}'::jsonb,
  add column if not exists client_updated_at timestamptz;

alter table public.lobby_players
  drop constraint if exists lobby_players_client_type_check,
  add constraint lobby_players_client_type_check
    check (client_type is null or client_type in ('app', 'web_mobile', 'web_desktop')),
  drop constraint if exists lobby_players_client_info_object_check,
  add constraint lobby_players_client_info_object_check
    check (jsonb_typeof(client_info) = 'object');

comment on column public.lobby_players.client_type is
  'Canal real do cliente: app instalado, navegador mobile ou navegador desktop.';
comment on column public.lobby_players.client_version is
  'Versão nativa do app ou versão/release do cliente web.';
comment on column public.lobby_players.client_info is
  'Metadados de diagnóstico do cliente, incluindo runtime, plataforma, navegador e dimensões.';

-- O snapshot de matches também guarda os dados, mesmo depois de a presença do
-- lobby ser removida. O roster autoritativo de rooms recebe o mesmo clientInfo
-- no bootstrap feito pelo frontend.
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
  select * into v_lobby from public.lobbies where id = p_lobby_id for update;
  if not found then raise exception 'Sala não encontrada.' using errcode = 'P0001'; end if;
  if v_lobby.host_id is distinct from p_host_player_id then
    raise exception 'Somente o host pode iniciar a partida.' using errcode = 'P0001';
  end if;

  if v_lobby.status <> 'open' then
    select * into v_existing_match from public.matches
     where lobby_id = p_lobby_id order by created_at desc limit 1;
    if found then
      return jsonb_build_object('id', v_existing_match.id, 'already_started', true);
    end if;
    raise exception 'Sala fechada.' using errcode = 'P0001';
  end if;

  select count(*), count(*) filter (where ready is true)
    into v_player_count, v_ready_count
    from public.lobby_players where lobby_id = p_lobby_id;
  if v_player_count = 0 or v_ready_count <> v_player_count then
    raise exception 'Todos os jogadores precisam estar prontos.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', player_id,
    'player_name', player_name,
    'ready', ready,
    'client_type', client_type,
    'client_version', client_version,
    'client_session_id', client_session_id,
    'client_info', client_info,
    'client_updated_at', client_updated_at
  ) order by joined_at), '[]'::jsonb)
    into v_players from public.lobby_players where lobby_id = p_lobby_id;

  insert into public.matches (lobby_id, host_id, state, created_at)
  values (p_lobby_id, p_host_player_id, jsonb_build_object('players', v_players), clock_timestamp())
  returning * into v_match;

  update public.lobbies set status = 'locked' where id = p_lobby_id;
  return jsonb_build_object('id', v_match.id, 'already_started', false);
end;
$function$;

grant execute on function public.start_match_atomic(uuid, uuid) to anon, authenticated;
