import {readFile,open,lstat} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
const COOKIE='__Host-owner-app-setup',TTL=600;
const failure=(code,status=400)=>Object.assign(new Error(code),{status});
const cookie=(state,age)=>`${COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const html=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function config(env){
  let owners,page,callback;
  try{owners=JSON.parse(env.OWNER_CONFIG_JSON).ownerLogins;page=new URL(env.PAGES_URL);callback=new URL(env.OAUTH_CALLBACK_URL);}catch{throw failure('SETUP_CONFIG_INVALID',503);}
  const base=env.BASE_PATH??'';
  if(page.protocol!=='https:'||callback.protocol!=='https:'||page.username||page.password||page.search||page.hash||callback.username||callback.password||callback.search||callback.hash
    ||! /^(?:\/[a-z0-9-]+)*$/.test(base)||callback.pathname!==base+'/auth/callback'||!Array.isArray(owners)||!owners.length||owners.some(login=>typeof login!=='string'||! /^[a-z\d-]+$/i.test(login))
    ||typeof env.SESSION_SECRET!=='string'||env.SESSION_SECRET.length<32)throw failure('SETUP_CONFIG_INVALID',503);
  return {owners,page,callback,base,api:callback.origin+base};
}
function signature(env,text){return createHmac('sha256',env.SESSION_SECRET).update(text).digest('base64url');}
function state(env,settings){const value=Buffer.from(JSON.stringify({nonce:randomUUID(),exp:Math.floor(Date.now()/1000)+TTL,aud:settings.api,page:settings.page.href})).toString('base64url');return value+'.'+signature(env,value);}
function valid(env,input,settings){
  try{const [value,sig,extra]=input.split('.');if(extra||!value||!sig)return false;const expected=Buffer.from(signature(env,value));const actual=Buffer.from(sig);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return false;
    const data=JSON.parse(Buffer.from(value,'base64url').toString());const now=Math.floor(Date.now()/1000);
    return /^[a-f\d-]{36}$/i.test(data.nonce)&&Number.isSafeInteger(data.exp)&&data.exp>now&&data.exp<=now+TTL&&data.aud===settings.api&&data.page===settings.page.href;
  }catch{return false;}
}
async function credentials(path){
  if(!isAbsolute(path))throw failure('SETUP_CREDENTIAL_PATH_INVALID',503);
  const parent=await lstat(dirname(path));if(!parent.isDirectory()||parent.isSymbolicLink())throw failure('SETUP_CREDENTIAL_PATH_INVALID',503);
  let info;try{info=await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!info.isFile()||info.isSymbolicLink()||info.size>4096||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw failure('SETUP_CREDENTIAL_FILE_INVALID',503);
  let value;try{value=JSON.parse(await readFile(path,'utf8'));}catch{throw failure('SETUP_CREDENTIAL_FILE_INVALID',503);}
  if(Object.keys(value).sort().join(',')!=='client_id,client_secret'||! /^[a-z\d_.-]{3,200}$/i.test(value.client_id??'')||! /^[a-z\d_-]{10,500}$/i.test(value.client_secret??''))throw failure('SETUP_CREDENTIAL_FILE_INVALID',503);
  return value;
}
function enable(env,value){env.GITHUB_CLIENT_ID=value.client_id;env.GITHUB_CLIENT_SECRET=value.client_secret;env.GITHUB_APP_MODE='true';}
export async function bootstrap(request,env,{credentialPath='/run/secrets/owner-github-oauth.json',fetch:fetcher=globalThis.fetch}={}){
  const url=new URL(request.url),base=env.BASE_PATH??'',route=url.pathname.slice(base.length);
  if(!url.pathname.startsWith(base+'/'))return null;
  let settings;
  const response=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer',
    ...(settings&&request.headers.get('origin')===settings.page.origin?{'Access-Control-Allow-Origin':settings.page.origin,Vary:'Origin'}:{}),...headers}});
  try{
    settings=config(env);if(url.origin!==settings.callback.origin)throw failure('SETUP_ORIGIN_INVALID',403);
    const stored=await credentials(credentialPath);if(stored)enable(env,stored);
    const configured=Boolean(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET);
    if((env.GITHUB_CLIENT_ID||env.GITHUB_CLIENT_SECRET)&&!configured)throw failure('SETUP_CONFIG_INVALID',503);
    if(route==='/health'&&request.method==='GET')return configured?null:response({status:'SETUP_REQUIRED',setup_url:settings.api+'/setup/start'});
    if(!route.startsWith('/setup/'))return null;
    if(configured)throw failure('SETUP_ALREADY_CONFIGURED',409);
    if(request.method!=='GET')throw failure('SETUP_METHOD_NOT_ALLOWED',405);
    if(route==='/setup/start'){
      if(url.search)throw failure('SETUP_QUERY_INVALID');
      const token=state(env,settings),nonce=randomUUID();
      const manifest={name:'Product Owner Review',url:settings.page.href,redirect_url:settings.api+'/setup/callback',callback_urls:[settings.callback.href],setup_url:settings.page.href,public:false,
        default_permissions:{issues:'write',contents:'read'},hook_attributes:{url:settings.api+'/setup/webhook',active:false}};
      const action='https://github.com/settings/apps/new?'+new URLSearchParams({state:token});
      const body=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>首次连接 GitHub</title><form method="post" action="${html(action)}"><input type="hidden" name="manifest" value="${html(JSON.stringify(manifest))}"><button type="submit">在 GitHub 创建 Product Owner Review</button></form><script nonce="${nonce}">document.forms[0].submit()</script></html>`;
      return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookie(token,TTL),
        'Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'`}});
    }
    if(route!=='/setup/callback')throw failure('SETUP_NOT_FOUND',404);
    if([...url.searchParams.keys()].some(key=>!['code','state'].includes(key))||url.searchParams.getAll('code').length!==1||url.searchParams.getAll('state').length!==1)throw failure('SETUP_QUERY_INVALID');
    const token=url.searchParams.get('state'),browser=request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    if(!token||token!==browser||!valid(env,token,settings))throw failure('SETUP_STATE_INVALID',403);
    const code=url.searchParams.get('code');if(! /^[a-z\d_-]{1,1000}$/i.test(code??''))throw failure('SETUP_CODE_INVALID');
    let converted;
    try{converted=await fetcher('https://api.github.com/app-manifests/'+encodeURIComponent(code)+'/conversions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'owner-review-app-bootstrap'}});}catch{throw failure('SETUP_GITHUB_UNAVAILABLE',502);}
    if(converted.status!==201)throw failure('SETUP_CONVERSION_FAILED',502);
    const bytes=await converted.text();if(bytes.length>100000)throw failure('SETUP_CONVERSION_INVALID',502);
    let app;try{app=JSON.parse(bytes);}catch{throw failure('SETUP_CONVERSION_INVALID',502);}
    if(!Number.isSafeInteger(app.id)||app.id<1||!Number.isSafeInteger(app.owner?.id)||app.owner.id<1||typeof app.owner.login!=='string'||app.owner.type!=='User'
      ||!settings.owners.some(login=>login.toLowerCase()===app.owner.login.toLowerCase()))throw failure('SETUP_OWNER_REQUIRED',403);
    if(app.permissions?.issues!=='write'||app.permissions?.contents!=='read'||Object.keys(app.permissions).some(key=>!['issues','contents','metadata'].includes(key))
      ||(app.permissions.metadata!==undefined&&app.permissions.metadata!=='read')||! /^[a-z\d_.-]{3,200}$/i.test(app.client_id??'')||! /^[a-z\d_-]{10,500}$/i.test(app.client_secret??''))throw failure('SETUP_CONVERSION_INVALID',502);
    if(typeof app.slug!=='string'||! /^[a-z0-9-]+$/.test(app.slug)||app.slug.length>100||app.html_url!=='https://github.com/apps/'+app.slug)throw failure('SETUP_INSTALL_TARGET_INVALID',502);
    const install='https://github.com/apps/'+app.slug+'/installations/new';
    const value={client_id:app.client_id,client_secret:app.client_secret};let file;
    try{file=await open(credentialPath,'wx',0o600);await file.writeFile(JSON.stringify(value)+'\n','utf8');await file.sync();}catch(error){throw failure(error.code==='EEXIST'?'SETUP_ALREADY_CONFIGURED':'SETUP_STORAGE_FAILED',error.code==='EEXIST'?409:503);}finally{await file?.close();}
    enable(env,value);
    return new Response(null,{status:303,headers:{Location:install,'Set-Cookie':cookie('',0),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }catch(error){return response({error:error.status?error.message:'SETUP_INTERNAL_ERROR'},error.status??503,route==='/setup/callback'?{'Set-Cookie':cookie('',0)}:{});}
}
