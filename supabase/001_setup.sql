-- Control de Tarjetas. Ejecutar una sola vez en Supabase > SQL Editor.
-- No contiene compras, contraseñas ni claves. Puede volver a ejecutarse.
begin;

create table if not exists public.ct_books (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings)='object'),
  created_at timestamptz not null default now()
);
create table if not exists public.ct_purchases (
  owner_id uuid not null references public.ct_books(owner_id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'id'=id),
  created_at timestamptz not null default now(),
  primary key(owner_id,id)
);
alter table public.ct_books enable row level security;
alter table public.ct_purchases enable row level security;
drop policy if exists ct_read_own_book on public.ct_books;
create policy ct_read_own_book on public.ct_books for select to authenticated using(owner_id=(select auth.uid()));
drop policy if exists ct_read_own_purchases on public.ct_purchases;
create policy ct_read_own_purchases on public.ct_purchases for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.ct_books,public.ct_purchases from public,anon,authenticated;
grant usage on schema public to authenticated;
grant select on public.ct_books,public.ct_purchases to authenticated;

create or replace function public.ct_initialize_book(p_book jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := auth.uid(); v_created integer; v_p jsonb;
begin
  if v_owner is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  if p_book is null or jsonb_typeof(p_book)<>'object' or pg_column_size(p_book)>2000000
     or jsonb_typeof(p_book->'people') is distinct from 'array'
     or jsonb_typeof(p_book->'cards') is distinct from 'array'
     or jsonb_typeof(p_book->'purchases') is distinct from 'array'
     or (p_book->>'baseline') is null or (p_book->>'baseline') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'La base de compras no es válida.';
  end if;
  if jsonb_array_length(p_book->'purchases')>1000 or jsonb_array_length(p_book->'people')>1000 or jsonb_array_length(p_book->'cards')>100 then raise exception 'La base supera el límite de importación.'; end if;
  insert into public.ct_books(owner_id,settings) values(v_owner,p_book-'purchases') on conflict(owner_id) do nothing;
  get diagnostics v_created = row_count;
  if v_created=0 then return jsonb_build_object('created',false); end if;
  for v_p in select value from jsonb_array_elements(p_book->'purchases') loop
    if jsonb_typeof(v_p) is distinct from 'object' or coalesce(v_p->>'id','')='' or coalesce(v_p->>'description','')=''
       or jsonb_typeof(v_p->'amount') is distinct from 'number' or (v_p->>'amount')::numeric<=0
       or coalesce((v_p->>'legacy')::boolean,false)<>true
       or not exists(select 1 from jsonb_array_elements(p_book->'people') x where x->>'id'=v_p->>'person')
       or not exists(select 1 from jsonb_array_elements(p_book->'cards') x where x->>'id'=v_p->>'card') then
      raise exception 'Una compra original no es válida. No se importó ningún registro.';
    end if;
    insert into public.ct_purchases(owner_id,id,payload) values(v_owner,v_p->>'id',v_p);
  end loop;
  return jsonb_build_object('created',true,'count',jsonb_array_length(p_book->'purchases'));
end $$;

create or replace function public.ct_save_purchase(p_purchase jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := auth.uid(); v_settings jsonb; v_payload jsonb; v_existing jsonb;
  v_id text; v_amount numeric; v_cents bigint; v_terms integer; v_regular bigint; v_last bigint;
  v_msi boolean; v_recurring boolean;
begin
  if v_owner is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  select settings into v_settings from public.ct_books where owner_id=v_owner;
  if not found then raise exception 'Primero importa tus compras originales.'; end if;
  if p_purchase is null or jsonb_typeof(p_purchase)<>'object' or pg_column_size(p_purchase)>10000 then raise exception 'Compra inválida.'; end if;
  v_id:=p_purchase->>'id';
  if v_id is null or v_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Falta el identificador de la compra.'; end if;
  if coalesce(length(trim(p_purchase->>'description')),0) not between 1 and 160
     or jsonb_typeof(p_purchase->'amount') is distinct from 'number'
     or jsonb_typeof(p_purchase->'terms') is distinct from 'number'
     or jsonb_typeof(p_purchase->'msi') is distinct from 'boolean'
     or jsonb_typeof(p_purchase->'recurring') is distinct from 'boolean'
     or (p_purchase->>'start') is null or (p_purchase->>'start') !~ '^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' then raise exception 'Completa los datos de la compra.'; end if;
  v_amount:=(p_purchase->>'amount')::numeric;
  if v_amount<=0 or v_amount>100000000 or round(v_amount,2)<>v_amount then raise exception 'El importe debe ser positivo y tener como máximo dos decimales.'; end if;
  if (p_purchase->>'terms')::numeric<>trunc((p_purchase->>'terms')::numeric) then raise exception 'Las mensualidades deben ser enteras.'; end if;
  v_terms:=(p_purchase->>'terms')::integer;
  v_msi:=(p_purchase->>'msi')::boolean; v_recurring:=(p_purchase->>'recurring')::boolean;
  if v_terms not between 1 and 120 or (v_msi and v_recurring) or (not v_msi and v_terms<>1) then raise exception 'Tipo o mensualidades inválidas.'; end if;
  if not exists(select 1 from jsonb_array_elements(v_settings->'people') x where x->>'id'=p_purchase->>'person')
     or not exists(select 1 from jsonb_array_elements(v_settings->'cards') x where x->>'id'=p_purchase->>'card') then raise exception 'Persona o tarjeta no válida.'; end if;
  v_cents:=(v_amount*100)::bigint; v_regular:=round(v_cents::numeric/v_terms)::bigint; v_last:=v_cents-v_regular*(v_terms-1);
  if v_last<0 then raise exception 'El importe es demasiado pequeño para ese número de mensualidades.'; end if;
  v_payload:=jsonb_build_object('id',v_id,'person',p_purchase->>'person','card',p_purchase->>'card',
    'description',trim(p_purchase->>'description'),'amount',v_amount,'terms',v_terms,'paid',0,'remaining',v_terms,
    'installment',v_regular::numeric/100,'lastInstallment',v_last::numeric/100,'msi',v_msi,'recurring',v_recurring,
    'start',p_purchase->>'start','legacy',false);
  insert into public.ct_purchases(owner_id,id,payload) values(v_owner,v_id,v_payload) on conflict(owner_id,id) do nothing;
  select payload into v_existing from public.ct_purchases where owner_id=v_owner and id=v_id;
  if v_existing<>v_payload then raise exception 'Este identificador ya corresponde a otra compra. No se guardó un duplicado.'; end if;
  return v_existing;
end $$;
revoke all on function public.ct_initialize_book(jsonb) from public,anon;
revoke all on function public.ct_save_purchase(jsonb) from public,anon;
grant execute on function public.ct_initialize_book(jsonb),public.ct_save_purchase(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
