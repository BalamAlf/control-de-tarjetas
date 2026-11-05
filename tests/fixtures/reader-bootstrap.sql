begin;
do $$
declare v_owner uuid:='00000000-0000-0000-0000-000000000000';
begin
 if not exists(select 1 from auth.users where id=v_owner) then raise exception 'Set the UUID of the fictitious TEST user first';end if;
 if exists(select 1 from public.ct_books where owner_id=v_owner) then raise exception 'Book already exists: no data was replaced';end if;
 insert into public.ct_books(owner_id,settings) values(v_owner,'{"baseline": "2099-12", "snapshotMonth": "2099-11", "people": [{"id": "person-a", "name": "Persona ficticia"}, {"id": "person-b", "name": "Otra persona"}], "cards": [{"id": "card-a", "name": "Tarjeta ficticia"}]}'::jsonb);
 insert into public.ct_purchases(owner_id,id,payload) values(v_owner,'purchase-a','{"id": "purchase-a", "person": "person-a", "card": "card-a", "description": "Compra ficticia", "amount": 100, "terms": 3, "paid": 0, "remaining": 3, "installment": 33.33, "lastInstallment": 33.34, "msi": true, "recurring": false, "start": "2099-12", "legacy": false}'::jsonb);
 insert into public.ct_purchases(owner_id,id,payload) values(v_owner,'purchase-b','{"id": "purchase-b", "person": "person-b", "card": "card-a", "description": "Servicio ficticio", "amount": 20, "terms": 1, "paid": 0, "remaining": 1, "installment": 20, "lastInstallment": 20, "msi": false, "recurring": true, "start": "2099-12", "legacy": false}'::jsonb);
end $$;
commit;
