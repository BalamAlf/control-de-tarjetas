import {createReader} from '../_shared/reader.mjs';
// Supabase's JWT gateway is disabled only for this function. The handler always
// validates the opaque delegated credential using a service-only database RPC.
const handler=createReader({snapshot:async ({tokenHash,scope,requestId})=>{
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)throw new Error('Configuration missing');
 const response=await fetch(url+'/rest/v1/rpc/ct_reader_snapshot',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_hash:tokenHash,p_scope:scope,p_request:requestId}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error('Database unavailable');
 return await response.json();
}});
Deno.serve(handler);
