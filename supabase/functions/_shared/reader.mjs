import {report,bankPeriod,paymentBreakdown,cents,sourceMonth} from '../../../app/finance.js';
export const VERSION='reader-v1.0.0';
const routes={'connection':'connection:read','people':'people:read','cards':'cards:read','purchases':'purchases:read','installments':'installments:read','monthly-summary':'summary:read'};
export async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');}
class ApiError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new ApiError(status,code);};
const encode=x=>btoa(JSON.stringify(x));
export function createReader({snapshot,basePath='/reader/v1',now=()=>new Date()}){
 return async request=>{
  const requestId=crypto.randomUUID();
  const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-ID':requestId,...(status===429?{'Retry-After':'60'}:{}),...(status===405?{'Allow':'GET'}:{})}});
  try{
   const url=new URL(request.url);
   if(request.method!=='GET')fail(405,'read_only');
   if(url.search.length>3000)fail(400,'query_too_long');
   const pathname=url.pathname.replace(/^\/functions\/v1(?=\/reader\/v1(?:\/|$))/,'');
   if(!pathname.startsWith(basePath+'/'))fail(404,'not_found');
   const route=pathname.slice(basePath.length+1),scope=routes[route];if(!scope)fail(404,'not_found');
   const token=/^Bearer (ctr_[a-f0-9]{64})$/.exec(request.headers.get('authorization')||'')?.[1];if(!token)fail(401,'unauthorized');
   const allowed=new Set(route==='connection'?[]:route==='people'||route==='cards'?['includeArchived','limit','cursor']:['month','personId','cardId',...(route==='monthly-summary'?[]:['limit','cursor'])]);
   for(const key of url.searchParams.keys())if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)fail(400,'invalid_query');
   const q=Object.fromEntries(url.searchParams),monthly=['purchases','installments','monthly-summary'].includes(route);
   if(monthly&&!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(q.month||''))fail(400,'invalid_month');
   if(q.includeArchived!==undefined&&!['true','false'].includes(q.includeArchived))fail(400,'invalid_filter');
   const limit=q.limit===undefined?50:Number(q.limit);if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'invalid_limit');
   for(const key of ['personId','cardId'])if(q[key]!==undefined&&(!q[key]||q[key].length>100))fail(400,'invalid_filter');
   const result=await snapshot({tokenHash:await hash(token),scope,requestId});
   if(!result||result.status!==200)fail([401,403,429].includes(result?.status)?result.status:503,result?.status===429?'rate_limited':result?.status===403?'scope_denied':result?.status===401?'unauthorized':'unavailable');
   const book=result.book;if(!book||!Array.isArray(book.people)||!Array.isArray(book.cards)||!Array.isArray(book.purchases))fail(503,'invalid_source');
   for(const [key,list] of [['personId',book.people],['cardId',book.cards]])if(q[key]&&!list.some(x=>x.id===q[key]))fail(404,'entity_not_found');
   const snapshotId=await hash(JSON.stringify(book)),warnings=[],meta={requestId,snapshotId,calculatedAt:now().toISOString(),calculationVersion:VERSION,warnings};
   if(route==='connection')return respond({data:{status:'authorized',mode:'read_only',grantedScopes:result.scopes},meta});
   const names={'TAR-BBVAORO-BBVA-01':'BBVA Oro','TAR-JOY-BANAMEX-02':'Banamex Joy','TAR-Platino-BANREJIO-03':'Banregio Platino','TAR-Mas-BANREJIO-04':'Banregio Más','TAR-Platino-BANORTE-05':'Banorte Platino','TAR-PlatinoAMEX-AMEX-06':'AMEX Platino','TAR-MercadoLibre-MercadoPago-08':'Mercado Pago'};
   const matches=p=>(!q.personId||p.person===q.personId)&&(!q.cardId||p.card===q.cardId);
   let rows;
   if(route==='people'||route==='cards')rows=book[route].filter(x=>q.includeArchived==='true'||!x.archived).map(x=>({id:x.id,name:route==='cards'?(x.displayName||names[x.id]||x.name):x.name,archived:!!x.archived,...(route==='cards'?{bank:x.bank||''}:{})}));
   else{
    const r=report(book,q.month),historical=q.month<(sourceMonth(book)||book.baseline);
    if(historical)fail(409,'period_not_confirmed');
    if(r.lines.some(p=>!Number.isSafeInteger(p.value)||p.value<0)||book.purchases.some(p=>!Number.isSafeInteger(cents(p.amount))||cents(p.amount)<=0||!Number.isInteger(p.terms)||p.terms<1))fail(503,'invalid_source');
    if(r.unknown.some(matches))warnings.push('Hay registros sin periodo o tipo confirmado; no se incluyen en los totales.');
    if(r.lines.some(p=>matches(p)&&p.estimate))warnings.push('Incluye recurrentes de referencia sujetos a confirmar vigencia e importe.');
    const related=[...r.lines,...r.skipped,...r.unknown].filter(matches);
    if(route==='purchases')rows=related.map(p=>({id:p.id,personId:p.person,cardId:p.card,description:p.description,amountCents:cents(p.amount),currency:'MXN',kind:p.msi?'msi':p.recurring?'recurring':'normal',terms:p.terms,startMonth:p.start||null}));
    if(route==='installments')rows=related.filter(p=>p.msi).map(p=>{const unknown=r.unknown.some(x=>x.id===p.id),skipped=r.skipped.some(x=>x.id===p.id);const detail=paymentBreakdown(book,q.month,[],p.person,p.card);const line=[...detail.lines,...detail.skipped].find(x=>x.id===p.id);return {purchaseId:p.id,personId:p.person,cardId:p.card,month:q.month,amountCents:unknown?null:p.value,currency:'MXN',status:unknown?'needs_review':skipped?'excluded':'scheduled',sequence:line?.sequence||null,terms:p.terms};});
    if(route==='monthly-summary'){
     const lines=r.lines.filter(matches),sum=kind=>lines.filter(p=>p.kind===kind).reduce((n,p)=>n+p.value,0);
     const statuses=bankPeriod(book,q.month,r).filter(x=>!q.cardId||x.card===q.cardId).filter(x=>!q.personId||related.some(p=>p.card===x.card)).map(x=>({cardId:x.card,status:x.status,source:book.bankPayments?.[q.month]?.[x.card]?'user_recorded':r.isSnapshot?'baseline':'unconfirmed'}));
     return respond({data:{month:q.month,currency:'MXN',basis:'planned_charges',totalCents:lines.reduce((n,p)=>n+p.value,0),msiCents:sum('msi'),recurringCents:sum('recurring'),normalCents:sum('normal'),excludedCount:r.skipped.filter(matches).length,unresolvedCount:r.unknown.filter(matches).length,bankStatuses:statuses},meta});
    }
   }
   rows.sort((a,b)=>(a.id||a.purchaseId).localeCompare(b.id||b.purchaseId));
   const filter=await hash(JSON.stringify({route,...Object.fromEntries(Object.entries(q).filter(([k])=>k!=='cursor').sort())}));let offset=0;
   if(q.cursor){try{const c=JSON.parse(atob(q.cursor));if(c.snapshot!==snapshotId)fail(409,'snapshot_changed');if(c.filter!==filter||!Number.isInteger(c.offset)||c.offset<0||c.offset>rows.length)fail(400,'invalid_cursor');offset=c.offset;}catch(e){if(e instanceof ApiError)throw e;fail(400,'invalid_cursor');}}
   const next=offset+limit;return respond({data:rows.slice(offset,next),meta,nextCursor:next<rows.length?encode({snapshot:snapshotId,filter,offset:next}):null});
  }catch(e){return respond({requestId,error:{code:e instanceof ApiError?e.code:'unavailable',message:e instanceof ApiError?'Consulta rechazada: '+e.code:'No se pudo completar la consulta.'}},e instanceof ApiError?e.status:503);}
 };
}
