-- O estado autoritativo da partida vive em public.rooms. Todos os clientes
-- assinam UPDATEs dessa tabela; sem ela na publicação, só o polling de
-- segurança (10 s) consegue atualizar os demais jogadores.
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then
    null;
end
$$;
