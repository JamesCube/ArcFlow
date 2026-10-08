import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const page = await fs.readFile(new URL('../../public/quote-discount.html', import.meta.url), 'utf8');
let sequence=0;
const process={id:'quote-discount',version:1,nodes:[{id:'start',type:'start',name:'Start'},{id:'salesManager',type:'approval',name:'Sales manager',assigneeId:'bob'},{id:'finance',type:'approval',name:'Finance',assigneeId:'carol'},{id:'end',type:'end',name:'End'}]};
const quote={businessId:'Q-DEMO-001',revision:1,customerRef:'CUSTOMER-DEMO-A',item:'Equipment',quantity:10,listUnitPrice:1000,currency:'CNY',validUntil:'2099-12-31',ownerId:'alice'};
const view={request:{id:'quote-request',business:{...quote,type:'quoteDiscount',quoteRevision:1,requestedUnitPrice:850},title:'Quote',applicantId:'alice',status:'PENDING',currentStepId:'salesManager',history:[],definition:process},listTotal:'10000.00',requestedTotal:'8500.00',reductionTotal:'1500.00',discountPercent:'15',expired:false,quoteUpdated:false,thresholdReached:true};
async function mount(actor='bob') {
  const dom=new JSDOM(page,{url:'http://localhost:5173/quote-discount.html'});
  globalThis.document=dom.window.document; globalThis.window=dom.window; globalThis.matchMedia=()=>({matches:false});
  const requests=[];
  globalThis.fetch=async(path,options)=>{
    requests.push({path,options});
    const data=path==='/api/me'?{id:actor,displayName:actor}:path==='/api/crm/process'?process:path==='/api/crm/quotes'?[quote]:[view];
    return {ok:true,json:async()=>structuredClone(data)};
  };
  await import(`../../public/crm-quote/app.mjs?test=${sequence++}`);
  const $=id=>document.getElementById(id);
  const submit=id=>$(id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  async function login(password='temporary-password'){ $('username').value=actor; $('password').value=password; submit('login-form'); await tick(); }
  return {dom,$,requests,submit,tick,login};
}
test('login, assigned decisions and sign out never store credentials or stale data',async()=>{
  const ui=await mount('bob'); await ui.login();
  assert.equal(ui.$('workspace').hidden,false); assert.equal(ui.$('password').value,'');
  assert.equal(ui.$('create-panel').hidden,true); assert.equal(ui.$('requests').querySelectorAll('button').length,2);
  assert.equal(ui.dom.window.localStorage.length,0); assert.equal(ui.dom.window.sessionStorage.length,0);
  ui.$('logout').click(); assert.equal(ui.$('workspace').hidden,true); assert.equal(ui.$('requests').children.length,0);
  ui.dom.window.close();
});
test('failed refresh clears old quote approvals rather than re-enabling them',async()=>{
  const ui=await mount(); await ui.login(); globalThis.fetch=async()=>{throw new Error('offline')};
  ui.$('refresh').click(); await ui.tick();
  assert.equal(ui.$('requests').querySelectorAll('button').length,0); assert.equal(ui.$('quote-form').closest('section').hidden,true);
  assert.match(ui.$('message').textContent,/读取数据/); ui.dom.window.close();
});
test('sign out during pending reload ignores late authenticated responses',async()=>{
  const ui=await mount(); await ui.login(); let finish;
  const original=globalThis.fetch; globalThis.fetch=(...args)=>new Promise(resolve=>{ finish ??= []; finish.push(async()=>resolve(await original(...args))); });
  ui.$('refresh').click(); ui.$('logout').click(); await Promise.all(finish.map(f=>f())); await ui.tick();
  assert.equal(ui.$('workspace').hidden,true); assert.equal(ui.$('requests').children.length,0); ui.dom.window.close();
});
test('changed or mixed-type snapshot response fails closed',async()=>{
  const ui=await mount(); await ui.login(); const original=globalThis.fetch;
  globalThis.fetch=async(path,options)=>path==='/api/crm/requests'?{ok:true,json:async()=>[{...view,requestedTotal:'1.00'}]}:original(path,options);
  ui.$('refresh').click(); await ui.tick(); assert.equal(ui.$('requests').querySelectorAll('button').length,0); ui.dom.window.close();
});
test('narrow screen cannot submit and repeated clicks while request pending do not duplicate write',async()=>{
  const ui=await mount('alice'); await ui.login(); globalThis.matchMedia=()=>({matches:true});
  ui.submit('quote-form'); await ui.tick(); assert.equal(ui.requests.filter(r=>r.options.method==='POST').length,0);
  globalThis.matchMedia=()=>({matches:false}); const original=globalThis.fetch; let resolve;
  globalThis.fetch=(path,options)=>options.method==='POST'?new Promise(r=>{resolve=r;ui.requests.push({path,options})}):original(path,options);
  ui.submit('quote-form'); ui.submit('quote-form'); assert.equal(ui.requests.filter(r=>r.options.method==='POST').length,1);
  resolve({ok:true,json:async()=>view}); await ui.tick(); await ui.tick(); ui.dom.window.close();
});

test('Unicode login credentials are sent as UTF-8 and cleared from the input',async()=>{
  const ui=await mount('alice'); await ui.login('演示密码-é');
  assert.equal(ui.requests[0].options.headers.Authorization,'Basic '+Buffer.from('alice:演示密码-é','utf8').toString('base64'));
  assert.equal(ui.$('password').value,''); ui.dom.window.close();
});

test('pagehide and restored history entries clear authorized snapshots and require a fresh login',async()=>{
  const ui=await mount('bob'); await ui.login();
  ui.dom.window.dispatchEvent(new ui.dom.window.PageTransitionEvent('pagehide',{persisted:true}));
  assert.equal(ui.$('workspace').hidden,true); assert.equal(ui.$('requests').children.length,0); assert.equal(ui.$('password').value,'');
  assert.equal(ui.$('quote-details').children.length,0); assert.equal(ui.$('identity').textContent,'');
  ui.dom.window.dispatchEvent(new ui.dom.window.PageTransitionEvent('pageshow',{persisted:true}));
  assert.equal(ui.$('login-panel').hidden,false); assert.equal(ui.$('requests').querySelectorAll('button').length,0);
  ui.dom.window.close();
});

test('logout clears source details and applicant draft rather than carrying them into the next login',async()=>{
  const ui=await mount('alice'); await ui.login();
  ui.$('title').value='Private applicant draft'; ui.$('reason').value='Unsubmitted reason'; ui.$('requested').value='800.00';
  ui.$('logout').click();
  assert.equal(ui.$('quote-details').children.length,0); assert.equal(ui.$('preview').children.length,0); assert.equal(ui.$('identity').textContent,'');
  assert.notEqual(ui.$('title').value,'Private applicant draft'); assert.notEqual(ui.$('reason').value,'Unsubmitted reason'); assert.equal(ui.$('requested').value,'850.00');
  ui.dom.window.close();
});

test('validation feedback translates with the UI and clears after the whole draft becomes valid',async()=>{
  const ui=await mount('alice'); await ui.login();
  ui.$('language').value='en'; ui.$('language').dispatchEvent(new ui.dom.window.Event('change'));
  ui.$('requested').value='1000'; ui.submit('quote-form');
  assert.equal(ui.$('message').textContent,'Requested unit price must be below list unit price.');
  ui.$('language').value='zh'; ui.$('language').dispatchEvent(new ui.dom.window.Event('change'));
  assert.equal(ui.$('message').textContent,'申请单价须低于目录单价。');
  ui.$('requested').value='850.00'; ui.$('requested').dispatchEvent(new ui.dom.window.Event('input'));
  assert.equal(ui.$('message').textContent,''); assert.match(ui.$('preview').textContent,/8500.00/); ui.dom.window.close();
});
test('editing a valid price never dismisses an unconfirmed server result, and that message also translates',async()=>{
  const ui=await mount('alice'); await ui.login(); const original=globalThis.fetch;
  globalThis.fetch=async(path,options)=>{if(options.method==='POST')throw new Error('lost acknowledgement');return original(path,options)};
  ui.submit('quote-form'); await ui.tick(); await ui.tick();
  assert.match(ui.$('message').textContent,/暂时无法确认/);
  ui.$('requested').value='800.00'; ui.$('requested').dispatchEvent(new ui.dom.window.Event('input'));
  assert.match(ui.$('message').textContent,/暂时无法确认/);
  const draft=[ui.$('title').value,ui.$('reason').value,ui.$('requested').value];
  ui.$('language').value='en'; ui.$('language').dispatchEvent(new ui.dom.window.Event('change'));
  assert.match(ui.$('message').textContent,/could not be confirmed/);
  assert.deepEqual([ui.$('title').value,ui.$('reason').value,ui.$('requested').value],draft); ui.dom.window.close();
});

test('language changes never fill intentionally empty authenticated draft fields',async()=>{
  const ui=await mount('alice'); await ui.login();
  ui.$('requested').value='1000'; ui.submit('quote-form');
  ui.$('title').value=''; ui.$('reason').value='';
  ui.$('requested').value='850.00'; ui.$('requested').dispatchEvent(new ui.dom.window.Event('input'));
  ui.$('language').value='en'; ui.$('language').dispatchEvent(new ui.dom.window.Event('change'));
  assert.equal(ui.$('title').value,''); assert.equal(ui.$('reason').value,'');
  assert.equal(ui.$('message').textContent,'Enter a title and a reason for the discount.'); ui.dom.window.close();
});
