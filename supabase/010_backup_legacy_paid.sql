-- Compatibility only: preserves null paid counts in original imports. No record restoration.
begin;
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
     -- Unknown paid counts in original imports are evidence gaps, not zero.
     if k='paid' and r->'legacy'='true'::jsonb and r->'paid'='null'::jsonb then continue;end if;
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
revoke all on function public.ct_backup_validate(jsonb,uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
