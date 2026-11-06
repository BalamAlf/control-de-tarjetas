import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {build,PUBLIC_APP_FILES} from '../scripts/build.mjs';
test('El build excluye archivos antiguos, datos y fuentes fuera del manifiesto',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ct-build-test-'));
 try{
  await fs.mkdir(root+'/app');await fs.mkdir(root+'/scripts');await fs.writeFile(root+'/package.json','{"type":"module"}');await fs.writeFile(root+'/index.html','<html lang="es"></html>');
  for(const name of PUBLIC_APP_FILES)await fs.writeFile(root+'/app/'+name,name==='config.js'?"export const supabaseConfig={url:'https://example.supabase.co',publishableKey:'sb_publishable_test'};":'/* public fixture */');
  await fs.writeFile(root+'/app/private-canary.txt','NOT PUBLIC');await fs.mkdir(root+'/dist/app',{recursive:true});await fs.writeFile(root+'/dist/app/stale.js','STALE');await fs.mkdir(root+'/.build-staging/app',{recursive:true});await fs.writeFile(root+'/.build-staging/app/stale.js','STALE');
  if(process.platform==='win32'){await fs.chmod(root+'/dist/app',0o444);await fs.chmod(root+'/dist',0o444);}
  await build(root);assert.deepEqual((await fs.readdir(root+'/dist')).sort(),['_headers','app','index.html']);assert.deepEqual((await fs.readdir(root+'/dist/app')).sort(),[...PUBLIC_APP_FILES].sort());
  assert.match(await fs.readFile(root+'/dist/_headers','utf8'),/img-src 'self' data: blob:;/);
  await fs.writeFile(root+'/dist/app/stale-again.js','STALE');await build(root);assert.deepEqual((await fs.readdir(root+'/dist/app')).sort(),[...PUBLIC_APP_FILES].sort());
  const before=await fs.readFile(root+'/dist/index.html','utf8'),old=process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try{process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY='secret-not-for-browser';await assert.rejects(build(root),/clave publicable/);}finally{if(old===undefined)delete process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY=old;}
  assert.equal(await fs.readFile(root+'/dist/index.html','utf8'),before);
 }finally{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('ct-build-test-'));await fs.rm(resolved,{recursive:true,force:true});}
});
