-- Regression test for a disposable/assay database after migrations 001-009.
-- Creates fictitious users and records inside a rolled-back transaction.
-- Do not use this file as an installation script.
begin;
do $$
declare owner_id_test uuid:=gen_random_uuid();other_id_test uuid:=gen_random_uuid();purchase_id_test text:=gen_random_uuid()::text;extra_id text:=gen_random_uuid()::text;
 b jsonb;e jsonb;changed_backup jsonb;legacy jsonb;j jsonb;r jsonb;before_data jsonb;stale jsonb;denied boolean;
begin
 insert into auth.users(id) values(owner_id_test),(other_id_test);
 perform set_config('request.jwt.claim.sub',owner_id_test::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id_test,'role','authenticated')::text,true);
 insert into public.ct_books(owner_id,settings) values(owner_id_test,jsonb_build_object('baseline','2099-12','people',jsonb_build_array(jsonb_build_object('id','person-test','name','Persona ficticia')),'cards',jsonb_build_array(jsonb_build_object('id','card-test','name','Tarjeta ficticia'))));
 insert into public.ct_purchases(owner_id,id,payload) values(owner_id_test,purchase_id_test,jsonb_build_object('id',purchase_id_test,'person','person-test','card','card-test','description','Compra ficticia','amount',100.03,'installment',33.34,'lastInstallment',33.35,'terms',3,'paid',0,'remaining',3,'msi',true,'recurring',false,'legacy',false,'start','2099-12'));
 e:=public.ct_backup_export();b:=e->'book';
 assert e->>'ownerId'=owner_id_test::text,'Export must bind owner';
 assert not(e ? 'token') and not(e ? 'access_token'),'Export must not contain credentials';
 changed_backup:=jsonb_set(e,'{book,purchases,0,amount}','300');
 changed_backup:=jsonb_set(changed_backup,'{book,purchases,0,installment}','100');
 changed_backup:=jsonb_set(changed_backup,'{book,purchases,0,lastInstallment}','100');
 changed_backup:=jsonb_set(changed_backup,'{book,purchases}',(changed_backup#>'{book,purchases}')||jsonb_build_array(jsonb_set(b#>'{purchases,0}','{id}',to_jsonb(extra_id))));
 changed_backup:=jsonb_set(changed_backup,'{book,bankPayments}',jsonb_build_object('2099-12',jsonb_build_object('card-test',jsonb_build_object('paid',true))));
 j:=public.ct_prepare_restore(gen_random_uuid(),changed_backup,'recover');
 assert (j#>>'{summary,added}')::integer=1 and (j#>>'{summary,changed}')::integer=0,'Recovery adds missing purchase, preserving current defaults and amounts';
 assert public.ct_backup_book(owner_id_test)=b,'Preview must not change financial records';
 denied:=false;begin perform public.ct_apply_restore((j->>'id')::uuid,j->>'planHash',false);exception when others then denied:=true;end;assert denied,'Explicit confirmation required';
 r:=public.ct_apply_restore((j->>'id')::uuid,j->>'planHash',true);assert r->>'state'='committed','Apply expected';
 assert (select (payload->>'amount')::numeric=100.03 from public.ct_purchases where owner_id=owner_id_test and id=purchase_id_test),'Recovery must not overwrite existing purchase';
 assert public.ct_backup_book(owner_id_test)#>'{bankPayments,2099-12,card-test}' is null,'Recovery must preserve current bank defaults';
 r:=public.ct_apply_restore((j->>'id')::uuid,j->>'planHash',true);assert r->>'state'='committed','Retry must be idempotent';
 assert (select count(*)=2 from public.ct_purchases where owner_id=owner_id_test),'No duplicated purchase on retry';
 j:=public.ct_prepare_restore(gen_random_uuid(),changed_backup,'restore');r:=public.ct_apply_restore((j->>'id')::uuid,j->>'planHash',true);
 assert (select (payload->>'amount')::numeric=300 from public.ct_purchases where owner_id=owner_id_test and id=purchase_id_test),'Explicit restore must apply reviewed amount';
 before_data:=public.ct_restore_before((j->>'id')::uuid);assert (select (value->>'amount')::numeric=100.03 from jsonb_array_elements(before_data#>'{book,purchases}') where value->>'id'=purchase_id_test),'Safety copy must preserve prior amount';
 j:=public.ct_prepare_restore(gen_random_uuid(),e,'restore');r:=public.ct_apply_restore((j->>'id')::uuid,j->>'planHash',true);
 assert (select count(*)=2 from public.ct_purchases where owner_id=owner_id_test),'Records absent from old file must be preserved';
 assert public.ct_backup_book(owner_id_test)#>'{bankPayments,2099-12,card-test}' is null,'Explicit restore must remove override absent from backup';
 stale:=public.ct_prepare_restore(gen_random_uuid(),changed_backup,'restore');update public.ct_books set settings=jsonb_set(settings,'{people,0,name}','"Edición posterior ficticia"') where owner_id=owner_id_test;
 before_data:=public.ct_backup_book(owner_id_test);denied:=false;begin perform public.ct_apply_restore((stale->>'id')::uuid,stale->>'planHash',true);exception when others then denied:=true;end;assert denied,'Concurrent financial edit must block stale restore';assert public.ct_backup_book(owner_id_test)=before_data,'Failed restore must not partially change book';
 j:=public.ct_prepare_restore(gen_random_uuid(),changed_backup,'restore');update public.ct_restore_jobs set expires_at=now()-interval '1 second' where id=(j->>'id')::uuid;denied:=false;begin perform public.ct_apply_restore((j->>'id')::uuid,j->>'planHash',true);exception when others then denied:=true;end;assert denied,'Expired review must be rejected';
 denied:=false;begin perform public.ct_prepare_restore(gen_random_uuid(),jsonb_set(e,'{ownerId}',to_jsonb(other_id_test::text)),'recover');exception when others then denied:=true;end;assert denied,'Foreign owner backup must be rejected';
 legacy:=jsonb_build_object('version',1,'exportedAt','2099-12-01','base',b,'added','[]'::jsonb);j:=public.ct_prepare_restore(gen_random_uuid(),legacy,'recover');assert j#>'{summary,identified}'='false'::jsonb,'Old backup must be marked unidentified';
 perform set_config('request.jwt.claim.sub',other_id_test::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id_test,'role','authenticated')::text,true);
 denied:=false;begin perform public.ct_restore_before((j->>'id')::uuid);exception when others then denied:=true;end;assert denied,'Other owner must not read prior snapshot';assert public.ct_restore_history()='[]'::jsonb,'Other owner must not list history';
 assert not has_function_privilege('anon','public.ct_apply_restore(uuid,text,boolean)','EXECUTE'),'Anon denied';
 assert not has_function_privilege('service_role','public.ct_apply_restore(uuid,text,boolean)','EXECUTE'),'Agent denied';
 assert not has_function_privilege('authenticated','public.ct_backup_book(uuid)','EXECUTE'),'Private helper denied';
 assert not has_table_privilege('authenticated','public.ct_restore_jobs','SELECT'),'No direct client snapshots';
end $$;
rollback;
