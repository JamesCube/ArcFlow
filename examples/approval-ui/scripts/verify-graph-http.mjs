// Real disposable HTTP host plus production browser codecs. This does not
// replace browser or visual verification.
import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {createApi} from '../src/api.js'
import {graphDefinition,graphInstance,submissionBody,previewBody,verifySubmission,verifyDecision} from '../src/graph/api.js'
import {graphSequence} from '../src/graph/model.js'
const directory=await mkdtemp(join(tmpdir(),'arcflow-graph-client-')),port=Number(process.env.GRAPH_HTTP_PORT||18084)
const passwords=Object.fromEntries(['alice','bob','carol'].map(actor=>[actor,randomUUID()]))
const env={...process.env,APPROVAL_DATA_FILE:join(directory,'requests.json'),APPROVAL_UI_ORIGIN:'http://localhost:5173',...Object.fromEntries(Object.entries(passwords).map(([actor,password])=>[`APPROVAL_${actor.toUpperCase()}_PASSWORD`,password]))}
const child=spawn(process.env.JAVA||'java',['-jar',resolve(process.env.ARCFLOW_BACKEND_JAR||'../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar'),`--server.port=${port}`],{env,stdio:['ignore','ignore','ignore']})
const clients=Object.fromEntries(Object.entries(passwords).map(([actor,password])=>{const client=createApi((path,options)=>fetch(`http://127.0.0.1:${port}${path}`,options));client.login(actor,password);return[actor,client]}))
const base='/graphs/payment',checks=[]
try{
 let ready=false;for(let i=0;i<100;i++){try{await clients.alice.request('/me');ready=true;break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}assert.ok(ready,'Disposable backend readiness')
 const workspace=await clients.alice.request(`${base}/workspace`),definition=graphDefinition(workspace.definition);assert.equal(graphSequence(definition)[1].node.type,'exclusiveGateway')
 const payment={type:'paymentRequest',documentVersion:1,businessId:'HTTP-GRAPH-1',title:'HTTP codec integration',reason:'Synthetic integration',supplierRef:'SUP-1',currency:'CNY',requestedPaymentOn:'2026-10-20',lines:[{lineId:'one',invoiceRef:'INV-1',description:'Invoice one',invoiceAmount:'10000',previouslySettledAmount:'0',allocationAmount:'10000',deductionAmount:'500',deductionReason:'Adjustment'},{lineId:'two',invoiceRef:'INV-2',description:'Invoice two',invoiceAmount:'5000',previouslySettledAmount:'1000',allocationAmount:'4000',deductionAmount:'1000',deductionReason:'Adjustment'}]}
 const preview=graphInstance(await clients.alice.request(`${base}/preview`,{method:'POST',body:previewBody(definition,payment)}));assert.equal(preview.routes[0].selectedEdgeId,'highValue');assert.equal(preview.routes[0].evaluations[0].facts[0].actualValue,'CNY 12500');checks.push('server-preview-exact-multiline-netTotal')
 const intent={key:randomUUID(),business:payment,body:submissionBody(payment,definition.version)};let state=verifySubmission(await clients.alice.request(`${base}/requests`,{method:'POST',body:intent.body,headers:{'Idempotency-Key':intent.key}}),intent,'alice');assert.equal(state.tasks.filter(t=>t.status==='ACTIVE').length,2);checks.push('client-submission-frozen-business-and-two-tasks')
 for(const[nodeId,actor]of[['businessReview','carol'],['finance','bob'],['financeFinal','bob'],['final','carol']]){const task=state.tasks.find(t=>t.nodeId===nodeId),command={key:randomUUID(),instanceId:state.id,taskId:task.id,actorId:actor,decision:'APPROVE',comment:'Synthetic integration review'};const next=await clients[actor].request(`${base}/requests/${state.id}/tasks/${encodeURIComponent(task.id)}/decision`,{method:'POST',headers:{'Idempotency-Key':command.key},body:JSON.stringify({decision:command.decision,comment:command.comment})});state=verifyDecision(next,command,state);if(nodeId==='businessReview'){assert.equal(state.forks[0].arrivedBranchIds.length,1);assert.equal(state.forks[0].fired,false)}}
 assert.equal(state.status,'APPROVED');assert.equal(state.forks[0].fired,true);checks.push('client-decision-verification-and-join-completion');console.log(JSON.stringify({result:'passed',realBackend:true,browser:false,checks,requestId:state.id,commandRevision:state.commandRevision}))
}finally{Object.values(clients).forEach(client=>client.logout());child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));await rm(directory,{recursive:true,force:true})}
