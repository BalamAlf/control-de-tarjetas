import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const defaultRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PUBLIC_APP_FILES=['cloud.js','config.js','finance.js','main.js','share.js','style.css'];
export async function build(projectRoot=defaultRoot){
 const root=await fs.realpath(projectRoot),dist=path.join(root,'dist');
 // Copy an explicit manifest into a new, empty directory. Never merge old output.
 const {supabaseConfig:configured}=await import(pathToFileURL(path.join(root,'app/config.js')).href);
 const config={url:process.env.PUBLIC_SUPABASE_URL||configured.url,publishableKey:process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY||configured.publishableKey};
 if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.url)||!config.publishableKey.startsWith('sb_publishable_'))throw Error('Usa la URL y la clave publicable. Nunca uses una clave secret o service_role.');
 const staging=await fs.mkdtemp(path.join(root,'.build-'));
 const removeInsideRoot=async target=>{
  if(path.dirname(target)!==root||!['dist',path.basename(staging)].includes(path.basename(target)))throw Error('Ruta de publicación fuera del proyecto.');
  const stat=await fs.lstat(target).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(stat?.isSymbolicLink())throw Error('La carpeta de publicación no puede ser un enlace.');
  // OneDrive can mark generated folders read-only on Windows.
  // Only normalize directories inside the already-verified build target.
  const writable=async dir=>{
   const info=await fs.lstat(dir);
   if(info.isSymbolicLink())throw Error('La salida contiene un enlace; revisar antes de publicar.');
   if(info.isDirectory()){
    await fs.chmod(dir,0o700);
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){
     if(entry.isSymbolicLink())throw Error('La salida contiene un enlace; revisar antes de publicar.');
     if(entry.isDirectory())await writable(path.join(dir,entry.name));
    }
   }
  };
  if(stat&&process.platform==='win32')await writable(target);
  await fs.rm(target,{recursive:true,force:true,maxRetries:2,retryDelay:100});
 };
 try{
  await fs.mkdir(path.join(staging,'app'));
  await fs.copyFile(path.join(root,'index.html'),path.join(staging,'index.html'));
  for(const name of PUBLIC_APP_FILES)if(name!=='config.js')await fs.copyFile(path.join(root,'app',name),path.join(staging,'app',name));
  await fs.writeFile(path.join(staging,'app/config.js'),'export const supabaseConfig = Object.freeze('+JSON.stringify(config)+');\n');
  await fs.writeFile(path.join(staging,'_headers'),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${config.url}; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
  Cache-Control: no-store
`);
  await removeInsideRoot(dist);
  await fs.cp(staging,dist,{recursive:true,errorOnExist:true,force:false});
 }finally{await removeInsideRoot(staging);}
 return dist;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){await build();console.log('Build listo. Solo archivos públicos; sin restos de publicaciones anteriores.');}
