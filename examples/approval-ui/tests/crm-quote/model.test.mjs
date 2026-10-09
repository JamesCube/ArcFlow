import test from 'node:test';
import assert from 'node:assert/strict';
import {authorization, priceMinor, money, preview, submissionBody, canDecide, validateViews, currentStepName} from '../../public/crm-quote/model.mjs';
const quote = {businessId:'Q-DEMO-001', revision:1, customerRef:'CUSTOMER-DEMO-A', item:'Equipment', quantity:10, listUnitPrice:1000, currency:'CNY', validUntil:'2099-12-31'};
test('exact 15 percent sample and small decimals', () => {
  assert.deepEqual(preview(quote,'850.00'),{listTotal:'10000.00', requestedTotal:'8500.00', reductionTotal:'1500.00'});
  assert.equal(preview({...quote, quantity:3, listUnitPrice:0.2},'0.10').requestedTotal,'0.30');
  assert.equal(preview({...quote, quantity:100000, listUnitPrice:1000000000},'999999999.99').requestedTotal,'99999999999000.00');
});
test('invalid precision bounds currencies and injective decimal input', () => {
  for (const value of ['0','-1','0.001','1e3','1000000000.01','850,"evil":true','NaN','01',' 850']) assert.throws(()=>priceMinor(value,'CNY'));
  assert.throws(()=>priceMinor('1.50','JPY')); assert.equal(money(priceMinor('1.00','JPY'),'JPY'),'1');
  assert.throws(()=>preview(quote,'1000')); assert.throws(()=>preview({...quote,quantity:0},'850'));
});
test('wire serialization keeps decimal text and ignores extra source routing fields', () => {
  const result = submissionBody({...quote,approverId:'mallory'}, {title:'__PRICE__', reason:'Synthetic',requested:'850.00'},1);
  assert.match(result,/"requestedUnitPrice":850\.00/); const parsed=JSON.parse(result);
  assert.equal(parsed.business.title,'__PRICE__'); assert.equal(parsed.business.requestedUnitPrice,850); assert.equal(parsed.business.approverId,undefined);
  assert.equal(parsed.business.quoteRevision,1); assert.equal(parsed.processId,undefined);
});
test('decision controls only for current assigned actor and unvoted step', () => {
  const request={business:{type:'quoteDiscount'},status:'PENDING',currentStepId:'salesManager',history:[],definition:{nodes:[{id:'salesManager',type:'approval',assigneeId:'bob'}]}};
  assert.equal(canDecide(request,'bob'),true); assert.equal(canDecide(request,'carol'),false);
  assert.equal(canDecide({...request,status:'APPROVED'},'bob'),false);
  assert.equal(canDecide({...request,history:[{actorId:'bob',stepId:'salesManager'}]},'bob'),false);
});
test('response amount checks reject stale mixed-document or corrupted data',()=>{
  const view={request:{id:'x',status:'PENDING',business:{...quote,type:'quoteDiscount',quoteRevision:1,requestedUnitPrice:850}},listTotal:'10000.00',requestedTotal:'8500.00',reductionTotal:'1500.00',discountPercent:'15',expired:false,quoteUpdated:false,thresholdReached:true};
  assert.equal(validateViews([view]).length,1); assert.throws(()=>validateViews([{...view,requestedTotal:'8501.00'}]));
  assert.throws(()=>validateViews([{...view,request:{...view.request,business:{...quote,type:'procurement'}}}]));
});

test('UTF-8 Basic authorization accepts Chinese and accented passwords',()=>{
  assert.equal(authorization('alice','演示密码-é'), 'Basic '+Buffer.from('alice:演示密码-é','utf8').toString('base64'));
});

for (const [id, name, zh, en] of [
  ['salesManager', '销售经理审核 / Sales manager review', '销售经理审核', 'Sales manager review'],
  ['finance', '财务复核 / Finance review', '财务复核', 'Finance review'],
]) test(`current step uses the frozen ${id} name in both locales without changing its ID`, () => {
  const request = { currentStepId: id, definition: { nodes: [{ id, name }] } };
  assert.equal(currentStepName(request, 'zh'), zh); assert.equal(currentStepName(request, 'en'), en);
  assert.equal(request.currentStepId, id); assert.equal(request.definition.nodes[0].name, name);
});
for (const name of ['Historic custom review', 'Sales manager', '<img src=x onerror=alert(1)>']) test(`current step preserves custom name ${name}`, () => {
  const request = { currentStepId: 'salesManager', definition: { nodes: [{ id: 'salesManager', name }] } };
  for (const language of ['en', 'zh']) assert.equal(currentStepName(request, language), name);
});
for (const request of [null, {}, {currentStepId:null}, {currentStepId:42}]) test(`missing current step safely displays no stage: ${JSON.stringify(request)}`, () => {
  for (const language of ['en','zh']) assert.equal(currentStepName(request, language), '—');
});
for (const definition of [undefined, {nodes:null}, {nodes:{}}, {nodes:[]}, {nodes:[null]}, {nodes:[{id:'salesManager',name:42}]}, {nodes:[{id:'salesManager',name:'  '}]}]) test(`unknown snapshot stage is not inferred from its ID: ${JSON.stringify(definition)}`, () => {
  const request = {currentStepId:'salesManager',definition};
  assert.equal(currentStepName(request,'en'),'Unknown step'); assert.equal(currentStepName(request,'zh'),'未知步骤');
});
