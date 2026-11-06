import test from 'node:test';import assert from 'node:assert/strict';
import {CardCloud} from '../app/cloud.js';
const config={url:'https://example.supabase.co',publishableKey:'sb_publishable_test'};
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
const session={access_token:'access',refresh_token:'refresh',expires_in:3600,user:{id:'owner',email:'owner@example.invalid'}};
test('La contraseña no se guarda; las consultas usan el token del usuario',async()=>{
 const store=storage(),calls=[];const client=new CardCloud(config,{storage:store,fetcher:async(url,options)=>{calls.push({url,options});return url.includes('/auth/')?response(session):response([]);}});
 await client.signIn(' owner@example.invalid ','password-not-stored');await client.load();
 assert.ok(!store.getItem(client.sessionKey).includes('password-not-stored'));
 assert.equal(calls[1].options.headers.Authorization,'Bearer access');assert.equal(calls[1].options.headers.apikey,config.publishableKey);
});
test('Lecturas sin sesión no llegan a la base',async()=>{
 let calls=0;const client=new CardCloud(config,{storage:storage(),fetcher:async()=>{calls++;return response([]);}});
 await assert.rejects(client.load(),/Inicia sesión/);assert.equal(calls,0);
});
test('La renovación de sesión se comparte entre peticiones simultáneas',async()=>{
 let refreshes=0;const client=new CardCloud(config,{storage:storage(),now:()=>100000,fetcher:async(url)=>{if(url.includes('refresh_token')){refreshes++;return response(session);}return response([]);}});
 client.storeSession(session);const old=client.session();old.expires_at=99;client.storage.setItem(client.sessionKey,JSON.stringify(old));
 await Promise.all([client.token(),client.token()]);assert.equal(refreshes,1);
});
test('La compra conserva su identificador al reintentar',async()=>{
 const payload={id:'same-id',description:'Compra'};const ids=[];const client=new CardCloud(config,{storage:storage(),fetcher:async(url,options)=>{ids.push(JSON.parse(options.body).p_purchase.id);return response(payload);}});
 client.storeSession(session);await client.savePurchase(payload);await client.savePurchase(payload);assert.deepEqual(ids,['same-id','same-id']);
});
test('Una tabla ausente muestra la instrucción de instalación',async()=>{
 const client=new CardCloud(config,{storage:storage(),fetcher:async()=>response({code:'PGRST205',message:'missing'},404)});client.storeSession(session);
 await assert.rejects(client.load(),/Configurar Supabase.sql/);
});
test('Los datos se paginan sin perder registros después de mil compras',async()=>{
 const client=new CardCloud(config,{storage:storage(),fetcher:async url=>url.includes('ct_books')?response([{settings:{baseline:'2026-12'}}]):url.includes('offset=0')?response(Array.from({length:1000},(_,i)=>({payload:{id:String(i)}}))):response([{payload:{id:'1000'}}])});client.storeSession(session);
 assert.equal((await client.load()).purchases.length,1001);
});
test('Salir cierra la sesión local aunque no haya internet',async()=>{
 const client=new CardCloud(config,{storage:storage(),fetcher:async()=>{throw Error('offline');}});client.storeSession(session);
 await assert.rejects(client.signOut());assert.equal(client.session(),null);
});
test('Un ajuste mensual conserva cero, omisión y el mes elegido al enviarse',async()=>{
 const calls=[];const client=new CardCloud(config,{storage:storage(),fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response({purchaseId:'p',month:'2026-12',adjustment:{amountCents:0,skipped:true}});}});client.storeSession(session);
 await client.saveMonthAdjustment({id:'p',month:'2026-12',amountCents:0,skipped:true});
 assert.ok(calls[0].url.endsWith('/rpc/ct_save_month_adjustment'));assert.deepEqual(calls[0].body,{p_purchase_id:'p',p_month:'2026-12',p_amount:0,p_skipped:true});
});
test('La restauración envía null y una función ausente pide solo la nueva migración',async()=>{
 const client=new CardCloud(config,{storage:storage(),fetcher:async(url,options)=>{assert.equal(JSON.parse(options.body).p_amount,null);return response({code:'PGRST202'},404);}});client.storeSession(session);
 await assert.rejects(client.saveMonthAdjustment({id:'p',month:'2026-12',amountCents:null,skipped:false}),/Habilitar ajustes mensuales.sql/);
});

test('Gestión envía identificador, acción y mes exactos sin alterar la compra',async()=>{
 const calls=[];const client=new CardCloud(config,{storage:storage(),fetcher:async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return response({purchaseId:'p',control:{}});}});client.storeSession(session);
 await client.savePurchaseControl('p','end','2026-11');await client.savePurchaseControl('p','delete',null);
 assert.ok(calls[0].url.endsWith('/rpc/ct_manage_purchase'));assert.deepEqual(calls.map(x=>x.body),[{p_purchase_id:'p',p_action:'end',p_month:'2026-11'},{p_purchase_id:'p',p_action:'delete',p_month:null}]);
});

test('El estado bancario envía false y el mes sin inventar importe o fecha de pago',async()=>{let sent;const client=new CardCloud(config,{storage:storage(),fetcher:async(url,o)=>{sent=JSON.parse(o.body);return response({cardId:'card',month:'2026-11',status:{paid:false}});}});client.storeSession(session);await client.saveBankPayment('card','2026-11',false);assert.deepEqual(sent,{p_card_id:'card',p_month:'2026-11',p_paid:false});});

test('Editar entidad conserva revisión cero y no envía listas completas',async()=>{let sent;const client=new CardCloud(config,{storage:storage(),fetcher:async(url,o)=>{sent=JSON.parse(o.body);return response({id:'example',name:'Nuevo nombre'});}});client.storeSession(session);await client.saveEntity({kind:'people',id:'example',name:'Nuevo nombre',archived:true,revision:0});assert.deepEqual(sent,{p_kind:'people',p_id:'example',p_name:'Nuevo nombre',p_bank:'',p_archived:true,p_revision:0});});

test('Administrar accesos usa la sesión y solo envía perfil o identificador',async()=>{
 const calls=[],store=storage();const client=new CardCloud(config,{storage:store,fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return response([]);}});client.storeSession(session);
 await client.connections();await client.createConnection('proposals');await client.disconnect('credential-id');
 assert.ok(calls[0].url.endsWith('/rpc/ct_list_connections'));assert.deepEqual(calls[0].body,{});
 assert.ok(calls[1].url.endsWith('/rpc/ct_create_connection'));assert.deepEqual(calls[1].body,{p_profile:'proposals'});
 assert.ok(calls[2].url.endsWith('/rpc/ct_disconnect'));assert.deepEqual(calls[2].body,{p_id:'credential-id'});
 assert.equal(store.getItem(client.sessionKey).includes('ctr_'),false);
});
