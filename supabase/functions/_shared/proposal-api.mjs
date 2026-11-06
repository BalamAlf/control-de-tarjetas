export function createProposalApi({rpc,basePath='/proposals/v1'}){
 return async req=>{
  const requestId=crypto.randomUUID();
  const reply=(status,body)=>new Response(JSON.stringify({...body,requestId}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-ID':requestId,...(status===429?{'Retry-After':'60'}:{})}});
  try{
   const url=new URL(req.url),path=url.pathname.replace(/^\/functions\/v1(?=\/proposals\/v1(?:\/|$))/,'');
   if(url.search||!path.startsWith(basePath+'/'))return reply(400,{error:{code:'invalid_route'}});
   const route=path.slice(basePath.length),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
   const parts=route.split('/').filter(Boolean),create=req.method==='POST'&&route==='/proposals',lookup=req.method==='GET'&&parts.length===2&&['proposals','intents'].includes(parts[0])&&uuid.test(parts[1]);
   if(!create&&!lookup)return reply(404,{error:{code:'unsupported_operation'}});
   const token=/^Bearer (ctr_[a-f0-9]{64})$/.exec(req.headers.get('authorization')||'')?.[1];if(!token)return reply(401,{error:{code:'unauthorized'}});
   const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
   let fn,args={p_hash:tokenHash,p_request:requestId};
   if(create){
    const intent=req.headers.get('idempotency-key');if(!intent||!uuid.test(intent)||!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return reply(400,{error:{code:'invalid_input'}});
    const reader=req.body?.getReader();if(!reader)return reply(400,{error:{code:'invalid_input'}});let size=0,chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return reply(413,{error:{code:'body_too_large'}});}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply(400,{error:{code:'invalid_json'}});}
    fn='ct_agent_proposal';args={...args,p_intent:intent,p_body:body};
   }else{fn='ct_agent_proposal_status';args={...args,p_id:parts[1],p_by_intent:parts[0]==='intents'};}
   const result=await rpc(fn,args);const status=result?.status;
   if(![200,201,400,401,403,404,409,429].includes(status))return reply(503,{error:{code:'unavailable'}});
   return status<300?reply(status,{proposal:result.proposal}):reply(status,{error:{code:result.code||({401:'unauthorized',403:'scope_denied',429:'rate_limited'}[status])||'rejected'}});
  }catch{return reply(503,{error:{code:'unavailable'}});}
 };
}
