import {createProposalApi} from '../_shared/proposal-api.mjs';
const handler=createProposalApi({rpc:async(fn,args)=>{
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)throw Error('Missing server configuration');
 const r=await fetch(url+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('RPC unavailable');return await r.json();
}});
Deno.serve(handler);
