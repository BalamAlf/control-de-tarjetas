export class CloudError extends Error {
  constructor(message, status=0, code='') { super(message); this.status=status; this.code=code; }
}
export class CardCloud {
  constructor(config, {fetcher=globalThis.fetch, storage=globalThis.localStorage, now=Date.now}={}) {
    this.url=config.url.replace(/\/$/,''); this.key=config.publishableKey;
    this.fetcher=fetcher.bind(globalThis); this.storage=storage; this.now=now;
    this.sessionKey='ct-session-v1:'+new URL(this.url).hostname;
    this.refreshing=null;
  }
  session() {
    try { return JSON.parse(this.storage.getItem(this.sessionKey)||'null'); }
    catch { return null; }
  }
  storeSession(value) {
    const session={access_token:value.access_token,refresh_token:value.refresh_token,
      expires_at:Math.floor(this.now()/1000)+(value.expires_in||3600),user:value.user};
    if(!session.access_token||!session.refresh_token||!session.user?.id)throw new CloudError('No se pudo validar la sesión.');
    this.storage.setItem(this.sessionKey,JSON.stringify(session)); return session;
  }
  async raw(path,{method='GET',body,token}={}) {
    let response;
    try { response=await this.fetcher(this.url+path,{method,headers:{apikey:this.key,
      ...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)}); }
    catch {throw new CloudError('No se pudo conectar. Comprueba internet y vuelve a intentarlo; no cierres la compra si está pendiente de guardar.');}
    const text=await response.text();let result;
    try{result=text?JSON.parse(text):null;}catch{throw new CloudError('El servidor devolvió una respuesta inesperada.',response.status);}
    if(!response.ok) {
      const code=result?.code||result?.error_code||'';
      let message=result?.message||result?.msg||result?.error_description||'No se pudo completar la operación.';
      if(response.status===401||code==='invalid_credentials')message='Revisa el correo y la contraseña de acceso a la aplicación.';
      if(code==='PGRST205'||code==='PGRST202'||code==='42P01'||code==='42501')message='Falta preparar la base de datos. Ejecuta el archivo Configurar Supabase.sql en el SQL Editor de tu proyecto.';
      if(response.status===429)message='Hubo demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
      throw new CloudError(message,response.status,code);
    }
    return result;
  }
  async signIn(email,password) {
    const value=await this.raw('/auth/v1/token?grant_type=password',{method:'POST',body:{email:email.trim(),password}});
    return this.storeSession(value);
  }
  async token() {
    const current=this.session(); if(!current)throw new CloudError('Inicia sesión para sincronizar.',401);
    if(current.expires_at>this.now()/1000+60)return current.access_token;
    if(!this.refreshing)this.refreshing=this.refresh().finally(()=>{this.refreshing=null;});
    return (await this.refreshing).access_token;
  }
  async refresh() {
    const work=async()=>{
      const session=this.session();if(!session)throw new CloudError('Vuelve a iniciar sesión.',401);
      if(session.expires_at>this.now()/1000+60)return session;
      try{return this.storeSession(await this.raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}));}
      catch(error){if(error.status===400||error.status===401)this.storage.removeItem(this.sessionKey);throw error;}
    };
    return globalThis.navigator?.locks?globalThis.navigator.locks.request(this.sessionKey,work):work();
  }
  async request(path,options={}) {
    const session=this.session();if(!session)throw new CloudError('Inicia sesión para continuar.',401);
    const result=await this.raw(path,{...options,token:await this.token()});
    if(this.session()?.user?.id!==session.user.id)throw new CloudError('La cuenta cambió. Vuelve a cargar los datos.');
    return result;
  }
  async load() {
    const owner=this.session()?.user?.id;
    const books=await this.request('/rest/v1/ct_books?select=settings&limit=1');
    if(!books.length)return null;
    const purchases=[];let offset=0;
    while(true){const page=await this.request('/rest/v1/ct_purchases?select=payload&order=created_at.asc,id.asc&limit=1000&offset='+offset);purchases.push(...page.map(p=>p.payload));if(page.length<1000)break;offset+=1000;}
    if(this.session()?.user?.id!==owner)throw new CloudError('La cuenta cambió. Vuelve a cargar los datos.');
    return {...books[0].settings,purchases};
  }
  initialize(book){return this.request('/rest/v1/rpc/ct_initialize_book',{method:'POST',body:{p_book:book}});}
  savePurchase(purchase){return this.request('/rest/v1/rpc/ct_save_purchase',{method:'POST',body:{p_purchase:purchase}});}
  async saveMonthAdjustment(change){
    try{return await this.request('/rest/v1/rpc/ct_save_month_adjustment',{method:'POST',body:{p_purchase_id:change.id,p_month:change.month,p_amount:change.amountCents===null?null:change.amountCents/100,p_skipped:change.skipped}});}
    catch(error){if(error.code==='PGRST202')throw new CloudError('Falta activar los ajustes mensuales en Supabase. Ejecuta Habilitar ajustes mensuales.sql en SQL Editor.',error.status,error.code);throw error;}
  }
  async savePurchaseControl(id,action,month){
    try{return await this.request('/rest/v1/rpc/ct_manage_purchase',{method:'POST',body:{p_purchase_id:id,p_action:action,p_month:month||null}});}
    catch(error){if(error.code==='PGRST202')throw new CloudError('Ejecuta Habilitar ajustes mensuales.sql en SQL Editor para activar estas opciones.',error.status,error.code);throw error;}
  }
  async signOut() {
    const session=this.session();
    // Clear this device even when the remote logout is temporarily unavailable.
    try{if(session)await this.raw('/auth/v1/logout?scope=local',{method:'POST',token:await this.token()});}
    finally{this.storage.removeItem(this.sessionKey);}
  }
}
