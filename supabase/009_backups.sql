begin;
create table if not exists public.ct_restore_jobs(
 id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 input_hash text not null,before_hash text not null,plan_hash text not null,
 before_book jsonb,after_book jsonb not null,summary jsonb not null,
 state text not null default 'preview' check(state in ('preview','committed')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes',committed_at timestamptz
);
create index if not exists ct_restore_jobs_owner_created on public.ct_restore_jobs(owner_id,created_at desc);
alter table public.ct_restore_jobs enable row level security;
revoke all on public.ct_restore_jobs from public,anon,authenticated,service_role;

create or replace function public.ct_backup_book(p_owner uuid)
returns jsonb language sql stable set search_path='' as $$
 select b.settings||jsonb_build_object('purchases',coalesce((select jsonb_agg(p.payload order by p.id) from public.ct_purchases p where p.owner_id=b.owner_id),'[]'::jsonb)) from public.ct_books b where owner_id=p_owner
$$;
create or replace function public.ct_backup_export()
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;
begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 b:=public.ct_backup_book(auth.uid());
 if b is null then raise exception 'La cuenta todavía no tiene datos que respaldar.';end if;
 return jsonb_build_object('version',2,'ownerId',auth.uid(),'exportedAt',clock_timestamp(),'book',b);
end $$;

create or replace function public.ct_backup_validate(p_backup jsonb,p_owner uuid)
returns jsonb language plpgsql set search_path='' as $$
declare b jsonb;r jsonb;v jsonb;k text;item_id text;kind text;ids text[];people_ids text[];card_ids text[];purchase_ids text[];n numeric;has_owner boolean:=false;
begin
 if p_backup is null or jsonb_typeof(p_backup)<>'object' or pg_column_size(p_backup)>2000000 then raise exception 'Respaldo inválido o demasiado grande (máximo 2 MB).';end if;
 if p_backup->'version'='2'::jsonb then
  if (p_backup-array['version','ownerId','exportedAt','book'])<>'{}'::jsonb or jsonb_typeof(p_backup->'ownerId') is distinct from 'string' or p_backup->>'ownerId'<>p_owner::text then raise exception 'Este respaldo pertenece a otra cuenta o no indica su propietario.';end if;
  b:=p_backup->'book';has_owner:=true;
 elsif p_backup->'version'='1'::jsonb then
  if (p_backup-array['version','exportedAt','base','added'])<>'{}'::jsonb or jsonb_typeof(p_backup->'base') is distinct from 'object' or jsonb_typeof(p_backup->'added') is distinct from 'array' then raise exception 'Formato de respaldo antiguo inválido.';end if;
  b:=p_backup->'base';
  if jsonb_typeof(b->'purchases') is distinct from 'array' then raise exception 'Faltan las compras del respaldo.';end if;
  b:=jsonb_set(b,'{purchases}',(b->'purchases')||(p_backup->'added'));
 else raise exception 'Versión de respaldo no compatible.';end if;
 if b is null or jsonb_typeof(b)<>'object' or (b-array['baseline','paidThrough','snapshotMonth','people','cards','purchases','excludedCardIds','monthAdjustments','purchaseControls','bankPayments'])<>'{}'::jsonb then raise exception 'El respaldo contiene campos no compatibles.';end if;
 if coalesce(b->>'baseline','')!~'^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' then raise exception 'Falta el periodo de origen del respaldo.';end if;
 foreach k in array array['paidThrough','snapshotMonth'] loop
  if b ? k and b->k<>'null'::jsonb and coalesce(b->>k,'')!~'^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' then raise exception 'Periodo de origen inválido.';end if;
 end loop;
 foreach kind in array array['people','cards','purchases'] loop
  if jsonb_typeof(b->kind) is distinct from 'array' or jsonb_array_length(b->kind)>(case when kind='cards' then 100 when kind='people' then 1000 else 2000 end) then raise exception 'Lista de personas, tarjetas o compras inválida o demasiado grande.';end if;
  ids:=array[]::text[];
  for r in select value from jsonb_array_elements(b->kind) loop
   if jsonb_typeof(r)<>'object' or jsonb_typeof(r->'id') is distinct from 'string' or coalesce(length(r->>'id'),0) not between 1 and 100 or r->>'id'=any(ids) or (r->>'id')=any(array['__proto__','prototype','constructor']) then raise exception 'Identificador ausente, inválido o duplicado en %.',kind;end if;
   ids:=array_append(ids,r->>'id');
   if kind in ('people','cards') then
    if (r-array['id','name','displayName','bank','archived','revision'])<>'{}'::jsonb or jsonb_typeof(r->'name') is distinct from 'string' or length(trim(r->>'name')) not between 1 and 80 then raise exception 'Persona o tarjeta inválida.';end if;
    foreach k in array array['displayName','bank'] loop if r ? k and (jsonb_typeof(r->k)<>'string' or length(r->>k)>80) then raise exception 'Alias o banco inválido.';end if;end loop;
    if r ? 'archived' and jsonb_typeof(r->'archived')<>'boolean' then raise exception 'Estado de archivo inválido.';end if;
    if r ? 'revision' then if jsonb_typeof(r->'revision')<>'number' then raise exception 'Revisión inválida.';end if;n:=(r->>'revision')::numeric;if n<0 or n<>trunc(n) or n>2147483646 then raise exception 'Revisión inválida.';end if;end if;
   else
    if (r-array['id','person','card','description','amount','installment','lastInstallment','terms','paid','remaining','msi','recurring','legacy','start'])<>'{}'::jsonb or jsonb_typeof(r->'description') is distinct from 'string' or length(trim(r->>'description')) not between 1 and 160 then raise exception 'Compra inválida o con campos no compatibles.';end if;
    if jsonb_typeof(r->'person') is distinct from 'string' or jsonb_typeof(r->'card') is distinct from 'string' then raise exception 'Referencia de persona o tarjeta inválida.';end if;
    foreach k in array array['amount','installment','lastInstallment'] loop
     if jsonb_typeof(r->k) is distinct from 'number' then raise exception 'Importe ausente o inválido.';end if;n:=(r->>k)::numeric;
     if n<0 or (k='amount' and n=0) or n>100000000 or n<>round(n,2) then raise exception 'Importe inválido; usa centavos completos.';end if;
    end loop;
    foreach k in array array['terms','paid','remaining'] loop
     if jsonb_typeof(r->k) is distinct from 'number' then raise exception 'Cuotas o avance ausente.';end if;n:=(r->>k)::numeric;
     if n<>trunc(n) or n<0 or n>10000 or (k='terms' and n not between 1 and 120) then raise exception 'Cuotas o avance inválido.';end if;
    end loop;
    foreach k in array array['msi','recurring','legacy'] loop if jsonb_typeof(r->k) is distinct from 'boolean' then raise exception 'Tipo de compra ausente o inválido.';end if;end loop;
    if (r->>'msi')::boolean and (r->>'recurring')::boolean then raise exception 'Una compra no puede ser MSI y recurrente a la vez.';end if;
    if r->'start' is distinct from 'null'::jsonb and (r ? 'start') and coalesce(r->>'start','')!~'^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' then raise exception 'Primer mes de pago inválido.';end if;
    if not(r->>'legacy')::boolean and (coalesce(r->>'start','')='' or (not(r->>'msi')::boolean and (r->>'terms')::integer<>1)) then raise exception 'Tipo o periodo de compra nueva inválido.';end if;
    if not(r->>'legacy')::boolean and ((r->>'paid')::integer<>0 or (r->>'remaining')::integer<>(r->>'terms')::integer or (r->>'installment')::numeric<>round((r->>'amount')::numeric*100/(r->>'terms')::integer)/100 or (r->>'lastInstallment')::numeric<>((r->>'amount')::numeric*100-round((r->>'amount')::numeric*100/(r->>'terms')::integer)*((r->>'terms')::integer-1))/100) then raise exception 'Las cuotas de una compra nueva no concilian con su importe total.';end if;
   end if;
  end loop;
  if kind='people' then people_ids:=ids;elsif kind='cards' then card_ids:=ids;else purchase_ids:=ids;end if;
 end loop;
 for r in select value from jsonb_array_elements(b->'purchases') loop
  if not coalesce((r->>'person')=any(people_ids),false) or not coalesce((r->>'card')=any(card_ids),false) then raise exception 'Hay compras sin persona o tarjeta en el respaldo.';end if;
 end loop;
 if b ? 'excludedCardIds' then
  if jsonb_typeof(b->'excludedCardIds')<>'array' then raise exception 'Lista de tarjetas excluidas inválida.';end if;
  for r in select value from jsonb_array_elements(b->'excludedCardIds') loop
   if jsonb_typeof(r)<>'string' or length(r#>>'{}') not between 1 and 100 or (r#>>'{}')=any(card_ids) then raise exception 'El respaldo incluye una tarjeta excluida.';end if;
  end loop;
 end if;
 foreach kind in array array['monthAdjustments','bankPayments','purchaseControls'] loop
  if not(b ? kind) then continue;end if;
  if jsonb_typeof(b->kind)<>'object' then raise exception 'Ajustes o estados inválidos.';end if;
  for k,r in select key,value from jsonb_each(b->kind) loop
   if kind='purchaseControls' then
    if r ? 'updatedAt' and (jsonb_typeof(r->'updatedAt')<>'string' or length(r->>'updatedAt')>80) then raise exception 'Marca de actualización inválida.';end if;
    if not(k=any(purchase_ids)) or jsonb_typeof(r)<>'object' or (r-array['deleted','endMonth','updatedAt'])<>'{}'::jsonb then raise exception 'Control de compra inválido.';end if;
    if r ? 'deleted' and jsonb_typeof(r->'deleted')<>'boolean' then raise exception 'Papelera inválida.';end if;
    if r ? 'endMonth' and coalesce(r->>'endMonth','')!~'^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' then raise exception 'Mes de finalización inválido.';end if;
   else
    if k!~'^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' or jsonb_typeof(r)<>'object' then raise exception 'Mes de ajuste o estado inválido.';end if;
    for item_id,v in select key,value from jsonb_each(r) loop
     if jsonb_typeof(v)<>'object' then raise exception 'Ajuste o pago inválido.';end if;
     if v ? 'updatedAt' and (jsonb_typeof(v->'updatedAt')<>'string' or length(v->>'updatedAt')>80) then raise exception 'Marca de actualización inválida.';end if;
     if kind='monthAdjustments' then
      if not(item_id=any(purchase_ids)) or (v-array['amountCents','skipped','updatedAt'])<>'{}'::jsonb or jsonb_typeof(v->'skipped') is distinct from 'boolean' or not(v ? 'amountCents') then raise exception 'Ajuste de compra inválido.';end if;
      if v->'amountCents'<>'null'::jsonb then
       if jsonb_typeof(v->'amountCents')<>'number' then raise exception 'Ajuste inválido.';end if;n:=(v->>'amountCents')::numeric;if n<0 or n>10000000000 or n<>trunc(n) then raise exception 'Ajuste inválido.';end if;
      end if;
     else
      if not(item_id=any(card_ids)) or (v-array['paid','updatedAt'])<>'{}'::jsonb or jsonb_typeof(v->'paid') is distinct from 'boolean' then raise exception 'Estado bancario inválido.';end if;
     end if;
    end loop;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('book',b,'identified',has_owner);
end $$;

create or replace function public.ct_backup_plan(p_current jsonb,p_book jsonb,p_mode text)
returns jsonb language plpgsql set search_path='' as $$
declare target jsonb:=coalesce(p_current,p_book);kind text;r jsonb;old jsonb;item jsonb;items jsonb;map jsonb;k text;k2 text;changes jsonb:='[]';kept integer:=0;added integer:=0;changed integer:=0;v_excluded jsonb;scope_ids text[];
begin
 if p_mode is null or p_mode not in ('recover','restore') then raise exception 'Elige cómo recuperar el respaldo.';end if;
 if p_current is null then
  target:=p_book;changes:=jsonb_build_array(jsonb_build_object('kind','account','label','Cuenta nueva','before',null,'after',jsonb_build_object('people',jsonb_array_length(p_book->'people'),'cards',jsonb_array_length(p_book->'cards'),'purchases',jsonb_array_length(p_book->'purchases'))));added:=1;
 else
  foreach k in array array['baseline','snapshotMonth','paidThrough'] loop
   if p_book ? k and p_current ? k and p_book->k is distinct from p_current->k then raise exception 'El periodo de origen del archivo no coincide con tu cuenta. No se ha cambiado nada.';end if;
  end loop;
  v_excluded:=coalesce(p_current->'excludedCardIds','[]'::jsonb);
  for r in select value from jsonb_array_elements(p_book->'cards') loop if v_excluded ? (r->>'id') then raise exception 'El archivo contiene una tarjeta que excluiste de esta cuenta.';end if;end loop;
  foreach kind in array array['people','cards','purchases'] loop
   select coalesce(jsonb_object_agg(value->>'id',value),'{}'::jsonb) into map from jsonb_array_elements(p_current->kind);
   for r in select value from jsonb_array_elements(p_book->kind) loop
    old:=map->(r->>'id');item:=r;
    if old is null then added:=added+1;
    elsif (case when kind='purchases' then old=r else (old-'revision')=(r-'revision') end) or p_mode='recover' then kept:=kept+1;continue;
    else
     changed:=changed+1;
     if kind in ('people','cards') then item:=jsonb_set(r,'{revision}',to_jsonb(coalesce((old->>'revision')::integer,0)+1));end if;
    end if;
    map:=jsonb_set(map,array[r->>'id'],item);
    changes:=changes||jsonb_build_array(jsonb_build_object('kind',kind,'label',coalesce(r->>'description',r->>'name'),'before',old,'after',item));
   end loop;
   items:='[]'::jsonb;
   for old in select value from jsonb_array_elements(p_current->kind) loop items:=items||jsonb_build_array(map->(old->>'id'));map:=map-(old->>'id');end loop;
   for r in select value from jsonb_array_elements(p_book->kind) loop if map ? (r->>'id') then items:=items||jsonb_build_array(map->(r->>'id'));map:=map-(r->>'id');end if;end loop;
   target:=jsonb_set(target,array[kind],items);
  end loop;
  foreach kind in array array['monthAdjustments','purchaseControls','bankPayments'] loop
   select array_agg(value->>'id') into scope_ids from jsonb_array_elements(p_current->case when kind='bankPayments' then 'cards' else 'purchases' end);
   map:=coalesce(p_current->kind,'{}'::jsonb);
   -- In restore mode, absence in the backup restores the default for its IDs.
   -- Preserve controls and states for records created after the backup.
   if p_mode='restore' then
    select array_agg(value->>'id') into scope_ids from jsonb_array_elements(p_book->case when kind='bankPayments' then 'cards' else 'purchases' end);
    for k,r in select key,value from jsonb_each(map) loop
     if kind='purchaseControls' then
      if k=any(scope_ids) and not(coalesce(p_book->kind,'{}'::jsonb) ? k) then
       changes:=changes||jsonb_build_array(jsonb_build_object('kind',kind,'label',k,'before',r,'after',null));changed:=changed+1;map:=map-k;
      end if;
     else
      items:=r;
      for k2,item in select key,value from jsonb_each(r) loop
       if k2=any(scope_ids) and not(coalesce(p_book#>array[kind,k],'{}'::jsonb) ? k2) then
        changes:=changes||jsonb_build_array(jsonb_build_object('kind',kind,'label',k||' · '||k2,'before',item,'after',null));changed:=changed+1;items:=items-k2;
       end if;
      end loop;
      map:=jsonb_set(map,array[k],items);
     end if;
    end loop;
   end if;
   for k,r in select key,value from jsonb_each(coalesce(p_book->kind,'{}'::jsonb)) loop
    if kind='purchaseControls' then
     if p_mode='recover' and k=any(scope_ids) then kept:=kept+1;continue;end if;
     old:=map->k;
     if old is not null and ((old-'updatedAt')=(r-'updatedAt') or p_mode='recover') then kept:=kept+1;continue;end if;
     map:=jsonb_set(map,array[k],r);if old is null then added:=added+1;else changed:=changed+1;end if;
     changes:=changes||jsonb_build_array(jsonb_build_object('kind',kind,'label',k,'before',old,'after',r));
    else
     items:=coalesce(map->k,'{}'::jsonb);
     for k2,item in select key,value from jsonb_each(r) loop
      if p_mode='recover' and k2=any(scope_ids) then kept:=kept+1;continue;end if;
      old:=items->k2;
      if old is not null and ((old-'updatedAt')=(item-'updatedAt') or p_mode='recover') then kept:=kept+1;continue;end if;
      items:=jsonb_set(items,array[k2],item);if old is null then added:=added+1;else changed:=changed+1;end if;
      changes:=changes||jsonb_build_array(jsonb_build_object('kind',kind,'label',k||' · '||k2,'before',old,'after',item));
     end loop;
     map:=jsonb_set(map,array[k],items);
    end if;
   end loop;
   if p_current ? kind or p_book ? kind then target:=jsonb_set(target,array[kind],map);end if;
  end loop;
 end if;
 if jsonb_array_length(changes)>5000 then raise exception 'El archivo genera más de 5000 cambios; no se puede revisar de forma segura.';end if;
 return jsonb_build_object('book',target,'summary',jsonb_build_object('mode',p_mode,'added',added,'changed',changed,'kept',kept,'changes',changes,'bankChanges',(select count(*) from jsonb_array_elements(changes) x where x->>'kind'='bankPayments')));
end $$;

create or replace function public.ct_prepare_restore(p_id uuid,p_backup jsonb,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid();b jsonb;validated jsonb;plan jsonb;j public.ct_restore_jobs%rowtype;input text;
begin
 if owner is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 if p_id is null then raise exception 'Falta el identificador de revisión.';end if;
 perform 1 from public.ct_books where owner_id=owner for update;
 input:=encode(sha256(convert_to(jsonb_build_object('backup',p_backup,'mode',p_mode)::text,'UTF8')),'hex');
 select * into j from public.ct_restore_jobs where id=p_id;
 if found then
  if j.owner_id<>owner or j.input_hash<>input then raise exception 'La revisión no coincide; vuelve a revisar el archivo.';end if;
 else
  validated:=public.ct_backup_validate(p_backup,owner);b:=public.ct_backup_book(owner);plan:=public.ct_backup_plan(b,validated->'book',p_mode);
  perform public.ct_backup_validate(jsonb_build_object('version',2,'ownerId',owner,'book',plan->'book'),owner);
  insert into public.ct_restore_jobs(id,owner_id,input_hash,before_hash,plan_hash,before_book,after_book,summary)
  values(p_id,owner,input,encode(sha256(convert_to(coalesce(b,'null'::jsonb)::text,'UTF8')),'hex'),encode(sha256(convert_to((plan->'book')::text,'UTF8')),'hex'),b,plan->'book',(plan->'summary')||jsonb_build_object('identified',validated->'identified')) returning * into j;
  -- Reviewing files must not evict the ten most recent completed safety copies.
  delete from public.ct_restore_jobs r where r.owner_id=owner and r.id<>p_id and
   (r.created_at<now()-interval '7 days' or (r.state='preview' and r.id not in (select id from public.ct_restore_jobs where owner_id=owner and state='preview' order by created_at desc,id desc limit 10)) or (r.state='committed' and r.id not in (select id from public.ct_restore_jobs where owner_id=owner and state='committed' order by committed_at desc,id desc limit 10)));
 end if;
 return jsonb_build_object('id',j.id,'planHash',j.plan_hash,'expiresAt',j.expires_at,'state',j.state,'summary',j.summary,'hasBefore',j.before_book is not null);
end $$;
create or replace function public.ct_apply_restore(p_id uuid,p_hash text,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid();b jsonb;j public.ct_restore_jobs%rowtype;r jsonb;created integer;
begin
 if owner is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 if p_confirm is distinct from true then raise exception 'Revisa y confirma los cambios antes de restaurar.';end if;
 perform 1 from public.ct_books where owner_id=owner for update;
 select * into j from public.ct_restore_jobs where id=p_id and owner_id=owner for update;
 if not found or p_hash is null or j.plan_hash<>p_hash then raise exception 'No se encontró esta revisión o cambió su contenido.';end if;
 if j.state='committed' then return jsonb_build_object('id',j.id,'state',j.state,'summary',j.summary);end if;
 if j.expires_at<=clock_timestamp() then raise exception 'Esta revisión venció. Vuelve a revisar el archivo.';end if;
 b:=public.ct_backup_book(owner);
 if encode(sha256(convert_to(coalesce(b,'null'::jsonb)::text,'UTF8')),'hex')<>j.before_hash then raise exception 'Tu cuenta cambió después de la vista previa. Vuelve a revisar el respaldo; no se ha sobrescrito nada.';end if;
 if b is null then
  insert into public.ct_books(owner_id,settings) values(owner,j.after_book-'purchases') on conflict(owner_id) do nothing;get diagnostics created=row_count;
  if created<>1 then raise exception 'La cuenta cambió. Vuelve a revisar el respaldo.';end if;
 else update public.ct_books set settings=j.after_book-'purchases' where owner_id=owner;end if;
 for r in select value from jsonb_array_elements(j.after_book->'purchases') loop
  insert into public.ct_purchases(owner_id,id,payload) values(owner,r->>'id',r) on conflict(owner_id,id) do update set payload=excluded.payload;
 end loop;
 update public.ct_restore_jobs set state='committed',committed_at=clock_timestamp() where id=j.id;
 delete from public.ct_restore_jobs where owner_id=owner and state='committed' and id<>j.id and id not in (select id from public.ct_restore_jobs where owner_id=owner and state='committed' order by committed_at desc,id desc limit 10);
 return jsonb_build_object('id',j.id,'state','committed','summary',j.summary);
end $$;
create or replace function public.ct_restore_before(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ct_restore_jobs%rowtype;
begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 select * into j from public.ct_restore_jobs where id=p_id and owner_id=auth.uid();
 if not found or j.before_book is null then raise exception 'No hay una copia anterior para esta revisión.';end if;
 return jsonb_build_object('version',2,'ownerId',auth.uid(),'exportedAt',j.created_at,'book',j.before_book);
end $$;
create or replace function public.ct_restore_history()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'createdAt',committed_at,'hasBefore',before_book is not null) order by committed_at desc) from public.ct_restore_jobs where owner_id=auth.uid() and state='committed'),'[]'::jsonb);
end $$;
revoke all on function public.ct_backup_book(uuid),public.ct_backup_validate(jsonb,uuid),public.ct_backup_plan(jsonb,jsonb,text),public.ct_backup_export(),public.ct_prepare_restore(uuid,jsonb,text),public.ct_apply_restore(uuid,text,boolean),public.ct_restore_before(uuid),public.ct_restore_history() from public,anon,authenticated,service_role;
grant execute on function public.ct_backup_export(),public.ct_prepare_restore(uuid,jsonb,text),public.ct_apply_restore(uuid,text,boolean),public.ct_restore_before(uuid),public.ct_restore_history() to authenticated;
notify pgrst,'reload schema';
commit;
