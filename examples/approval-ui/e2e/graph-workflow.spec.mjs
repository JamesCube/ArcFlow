import { test, expect } from '@playwright/test'
import { randomUUID, createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { sourceProvenance } from './complex-evidence.mjs'
import { restartBackend, readPersistedRequest, restartRequestState } from './backend-restart.mjs'
import { readRenderedGraphState, assertRenderedGraphState, renderedStatusLabel, readGraphCanvasState, readDesignerProperties, assertDesignerProperties } from './graph-rendered-state.mjs'
const BASE='/graphs/payment', DESKTOP={width:1440,height:1000}, MOBILE={width:390,height:844}
test.use({locale:'en-GB',timezoneId:'UTC',reducedMotion:'reduce',actionTimeout:15000})
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function api(request,user,path,{method='GET',data,key,status=200}={}){
 let response;try{response=await request.fetch(`http://127.0.0.1:8080/api${path}`,{method,headers:{Authorization:`Basic ${Buffer.from(`${user}:${process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]}`).toString('base64')}`,'Content-Type':'application/json','X-Arcflow-Client':'approval-demo',...(key?{'Idempotency-Key':key}:{})},...(data===undefined?{}:{data})})}catch{throw new Error('Graph HTTP transport failed; private request details omitted')}
 expect(response.status(),`Graph API ${method} ${path}`).toBe(status);return response.json()
}
async function login(page,user){await page.goto('/');await page.getByLabel('Demo account').selectOption(user);try{await page.getByLabel('Password',{exact:true}).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`])}catch{throw new Error('Unable to enter disposable credentials; private input omitted')};await page.getByRole('button',{name:'Enter workspace →'}).click();await expect(page.getByTestId('process-tab')).toBeVisible()}
async function designer(page){await page.getByTestId('process-tab').click();await page.getByTestId('graph-mode').click();await expect(page.getByTestId('graph-process-name')).toBeVisible();await expect(page.getByTestId('graph-refresh')).toBeEnabled()}
async function requests(page){await page.getByTestId('graph-requests-tab').click();await expect(page.getByTestId('graph-new-request')).toBeVisible();await expect(page.getByTestId('graph-refresh')).toBeEnabled()}
async function mutation(page,path,action,method='POST') {const[response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/api${path}`)&&r.request().method()===method),action()]);expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);const value=await response.json();await expect(page.getByTestId('graph-refresh')).toBeEnabled();return value}
async function save(page){return mutation(page,`${BASE}/draft`,()=>page.getByTestId('graph-save').click(),'PUT')}
async function publish(page){return mutation(page,`${BASE}/publish`,()=>page.getByTestId('graph-publish').click())}
async function select(page,id){await requests(page);await page.getByTestId('graph-refresh').click();await expect(page.getByTestId('graph-refresh')).toBeEnabled();await page.getByTestId(`graph-request-${id}`).click();await expect(page.getByTestId('graph-runtime')).toBeVisible()}
async function fillPayment(page,tag,{high=true}={}){
 const values={businessId:`GRAPH-${tag}`,supplierRef:'SUP-SYNTHETIC',title:`Graph payment ${tag}`,requestedPaymentOn:'2026-10-20',reason:'Synthetic graph workflow acceptance'}
 for(const[key,value]of Object.entries(values))await page.getByTestId(`graph-payment-${key}`).fill(value)
 await page.getByTestId('graph-payment-currency').selectOption('CNY')
 const lines=high?[{invoiceRef:`INV-${tag}-1`,description:'First allocation',invoiceAmount:'10000',previouslySettledAmount:'0',allocationAmount:'10000',deductionAmount:'500',deductionReason:'Adjustment'},{invoiceRef:`INV-${tag}-2`,description:'Second allocation',invoiceAmount:'5000',previouslySettledAmount:'1000',allocationAmount:'4000',deductionAmount:'1000',deductionReason:'Adjustment'}]:[{invoiceRef:`INV-${tag}-1`,description:'Standard allocation',invoiceAmount:'100',previouslySettledAmount:'0',allocationAmount:'100',deductionAmount:'0',deductionReason:''}]
 while(await page.locator('.gf-invoice').count()<lines.length)await page.getByTestId('graph-add-invoice').click()
 for(const[index,line]of lines.entries())for(const[key,value]of Object.entries(line))await page.getByTestId(`graph-payment-${index}-${key}`).fill(value)
 await expect(page.getByTestId('graph-net-total')).toHaveText(`CNY ${high?'12500.00':'100.00'}`)
}
async function submit(page,tag,options){await requests(page);await page.getByTestId('graph-new-request').click();await fillPayment(page,tag,options);return mutation(page,`${BASE}/requests`,()=>page.getByTestId('graph-submit').click())}
async function vote(page,instance,nodeId,decision='APPROVE',comment='Reviewed synthetic request') {await page.getByTestId(`graph-comment-${nodeId}`).fill(comment);const task=instance.tasks.find(task=>task.nodeId===nodeId);return mutation(page,`${BASE}/requests/${instance.id}/tasks/${encodeURIComponent(task.id)}/decision`,()=>page.getByTestId(`graph-${decision==='APPROVE'?'approve':'reject'}-${nodeId}`).click())}
async function capture(page,info,state,instance=null,designerDefinition=null){
 for(const locale of ['en','zh']){await page.getByTestId('workspace-language').selectOption(locale);for(const viewport of ['designer','designer-dense'].includes(state)?[DESKTOP,MOBILE,{width:320,height:844}]:[DESKTOP,MOBILE]){
  await page.setViewportSize(viewport)
  if(await page.locator('.gf-mobile-switch').isVisible())await page.locator('.gf-mobile-switch button').first().click()
  let originalSelection
  if(['designer','designer-dense'].includes(state)&&viewport.width===1440){
   originalSelection=await page.getByTestId('graph-properties').getAttribute('data-selected-id')
   await page.getByTestId('graph-expand-canvas').click()
   await expect(page.getByTestId('graph-expand-canvas')).toHaveAttribute('aria-pressed','true')
   await expect(page.getByTestId('graph-properties')).not.toBeVisible()
   const parallelLanes=await page.locator('.gf-canvas .gf-region.parallelFork').first().evaluate(region=>Array.from(region.querySelectorAll(':scope > .gf-lane'),lane=>{const box=lane.getBoundingClientRect();return{left:box.left,right:box.right,top:box.top}}))
   if(state==='designer'){expect(parallelLanes).toHaveLength(2);expect(parallelLanes[1].left).toBeGreaterThanOrEqual(parallelLanes[0].right);expect(Math.abs(parallelLanes[0].top-parallelLanes[1].top)).toBeLessThan(1)}
  }
  await page.locator('.gf-canvas').evaluateAll(elements=>{for(const canvas of elements){const bounds=canvas.getBoundingClientRect();if(bounds.width>0&&bounds.height>0){canvas.scrollLeft=0;canvas.scrollTop=0}}})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.locator('.gf-alert')).toHaveCount(0)
  await expect(page.getByTestId('graph-refresh')).toBeEnabled()
  let renderedState
  if(instance){
   const runtime=page.getByTestId('graph-runtime')
   await expect(runtime).toBeVisible()
   await expect(runtime).toHaveAttribute('data-request-id',instance.id)
   await expect(runtime).toHaveAttribute('data-command-revision',String(instance.commandRevision))
   await expect(runtime).toHaveAttribute('data-request-status',instance.status)
   await expect(runtime).toHaveAttribute('data-definition-version',String(instance.definition.version))
   await expect(runtime.locator('.gf-runtime-heading > .gf-status')).toHaveText(renderedStatusLabel(instance.status,locale))
   await expect(runtime.locator('.gf-runtime-heading p')).toHaveText(`${locale==='zh'?'提交时冻结的流程':'Frozen graph'} · v${instance.definition.version} · ${locale==='zh'?'决策修订号':'Decision revision'} ${instance.commandRevision}`)
   await expect(runtime.getByTestId('graph-active-count')).toHaveText(String(instance.tasks.filter(task=>task.status==='ACTIVE').length))
   for(const task of instance.tasks){
    const card=runtime.getByTestId(`graph-task-${task.nodeId}`)
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-task-id',task.id)
    await expect(card.locator('header > span')).toHaveText(renderedStatusLabel(task.status,locale))
    await expect(card.locator('.gf-votes > li')).toHaveCount(task.votes.length)
   }
   for(const fork of instance.forks){
    const join=runtime.getByTestId(`graph-join-${fork.joinId}`)
    await expect(join).toBeVisible()
    const name=instance.definition.nodes.find(node=>node.id===fork.joinId).name
    const stateText=fork.fired?(locale==='zh'?'全部分支已汇合':'All branches arrived'):instance.status==='REJECTED'?(locale==='zh'?'已取消':'Cancelled'):(locale==='zh'?'等待分支汇合':'Waiting for branches')
    await expect(join.locator('div > strong')).toHaveText(`${name} · ${stateText}`)
    await expect(join.locator('p')).toContainText(`${fork.arrivedBranchIds.length} / ${fork.expectedBranchIds.length}`)
   }
   renderedState=assertRenderedGraphState(await runtime.evaluate(readRenderedGraphState),instance)
  }else{
   expect(['designer','designer-dense']).toContain(state)
   await expect(page.getByTestId('graph-canvas')).toBeVisible()
   await expect(page.getByTestId('graph-process-name')).toBeVisible()
   await expect(page.getByTestId('graph-process-name')).not.toHaveValue('')
  }
  await page.evaluate(()=>document.fonts.ready)
  await page.evaluate(()=>{scrollTo({top:0,left:0,behavior:'instant'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})
  const layout=await page.evaluate(()=>({inner:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,origin:{x:scrollX,y:scrollY}}));expect(layout.document).toBeLessThanOrEqual(layout.inner);expect(layout.body).toBeLessThanOrEqual(layout.inner)
  for(const box of await page.locator('.gf-canvas:visible .gf-node').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.testid,width:node.getBoundingClientRect().width}))))expect(box.width,`Readable ${box.id} at ${viewport.width}px`).toBeGreaterThanOrEqual(140)
  const canvases=await page.evaluate(readGraphCanvasState)
  expect(canvases.length).toBeGreaterThan(0)
  for(const canvas of canvases){expect(canvas.scrollLeft).toBe(0);expect(canvas.scrollTop).toBe(0);expect(canvas.clientWidth).toBeGreaterThan(0);expect(canvas.clientHeight).toBeGreaterThan(0);expect(canvas.scrollWidth).toBeGreaterThanOrEqual(canvas.clientWidth);expect(canvas.scrollHeight).toBeGreaterThanOrEqual(canvas.clientHeight);expect(canvas.visibleNodeIds.length).toBeGreaterThan(0);expect(canvas.nodeHorizontalClipping).toEqual([]);expect(canvas.fullyVisibleNodeIds).toEqual(canvas.allNodeIds);expect(canvas.allNodeIds).toEqual((instance?.definition||designerDefinition).nodes.map(node=>node.id).sort())}
  const stem=`graph-${state}-${locale}-${viewport.width===1440?'desktop':`${viewport.width}px`}`,bytes=await page.screenshot({fullPage:true,animations:'disabled'})
  // Reject a state change while the screenshot was being generated, before
  // saving either artifact. The witness is always read from the actual DOM.
  await expect(page.locator('.gf-alert')).toHaveCount(0)
  if(instance)expect(assertRenderedGraphState(await page.getByTestId('graph-runtime').evaluate(readRenderedGraphState),instance)).toEqual(renderedState)
  expect(await page.evaluate(readGraphCanvasState)).toEqual(canvases)
  writeFileSync(info.outputPath(`${stem}.png`),bytes)
  writeFileSync(info.outputPath(`${stem}.json`),JSON.stringify({schemaVersion:1,...await sourceProvenance(),scenario:'graph-workflow',state,locale,viewport:page.viewportSize(),fullPage:true,image:`${stem}.png`,imageSHA256:hash(bytes),capturedAt:new Date().toISOString(),scrollOrigin:layout.origin,canvases,...(instance?{renderedState}:{designerDefinition}),request:instance?{id:instance.id,status:instance.status,commandRevision:instance.commandRevision,definition:instance.definition,tasks:instance.tasks,forks:instance.forks,routes:instance.routes,commands:instance.commands}:null},null,2))
  if(['designer','designer-dense'].includes(state)&&viewport.width===1440){
   await page.getByTestId('graph-expand-canvas').click();await expect(page.getByTestId('graph-expand-canvas')).toHaveAttribute('aria-pressed','false');await expect(page.getByTestId('graph-properties')).toBeVisible()
   expect(await page.getByTestId('graph-properties').getAttribute('data-selected-id')).toBe(originalSelection)
  }
 }}await page.setViewportSize(DESKTOP);await page.getByTestId('workspace-language').selectOption('en')
}


async function captureProperties(page,info,definition,edgeId){
 for(const locale of ['en','zh'])for(const width of [320,390]){
  await page.setViewportSize({width,height:844});await page.getByTestId('workspace-language').selectOption(locale)
  await page.locator('.gf-mobile-switch button').first().click();await page.getByTestId(`graph-branch-${edgeId}`).click()
  await expect(page.getByTestId('graph-properties')).toBeVisible();await expect(page.getByTestId('graph-canvas')).not.toBeVisible()
  await expect(page.getByTestId('graph-properties')).toContainText('FIRST_MATCH')
  await expect(page.getByTestId('graph-threshold-0')).toBeVisible();await expect(page.locator('.gf-alert')).toHaveCount(0)
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>{scrollTo({top:0,left:0,behavior:'instant'});return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})
  const designerState=assertDesignerProperties(await page.getByTestId('graph-workspace').evaluate(readDesignerProperties),definition,edgeId)
  const canvases=await page.evaluate(readGraphCanvasState);expect(canvases).toEqual([])
  const layout=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,origin:{x:scrollX,y:scrollY}}));expect(layout.document).toBeLessThanOrEqual(layout.width)
  const stem=`graph-designer-properties-${locale}-${width}px`,bytes=await page.screenshot({fullPage:true,animations:'disabled'})
  expect(assertDesignerProperties(await page.getByTestId('graph-workspace').evaluate(readDesignerProperties),definition,edgeId)).toEqual(designerState)
  await expect(page.locator('.gf-alert')).toHaveCount(0)
  writeFileSync(info.outputPath(`${stem}.png`),bytes)
  writeFileSync(info.outputPath(`${stem}.json`),JSON.stringify({schemaVersion:1,...await sourceProvenance(),scenario:'graph-workflow',state:'designer-properties',locale,viewport:page.viewportSize(),fullPage:true,image:`${stem}.png`,imageSHA256:hash(bytes),capturedAt:new Date().toISOString(),scrollOrigin:layout.origin,canvases,designerState,designerDefinition:definition,request:null},null,2))
 }
 await page.setViewportSize(DESKTOP);await page.getByTestId('workspace-language').selectOption('en')
}

test('graph workflow: author, persist, preview, execute independent paths, freeze versions and cancel siblings',async({page,browser,request},info)=>{
 test.setTimeout(300000);const suffix=randomUUID().slice(0,8),errors=[],checkpoints=[];page.on('pageerror',e=>errors.push(e.message));await login(page,'alice');await designer(page)
 const initial=await api(request,'alice',`${BASE}/workspace`);expect(initial.definition.schemaVersion).toBe(5)
 // Every structural authoring action goes through the actual designer.
 const beforeIds=await page.locator('.gf-canvas [data-node-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.nodeId))
 await page.getByTestId('graph-edge-toEnd').click();await page.getByTestId('graph-insert-parallelFork').click();const afterIds=await page.locator('.gf-canvas [data-node-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.nodeId));const created=afterIds.filter(id=>!beforeIds.includes(id));expect(created).toHaveLength(3)
 await page.getByTestId(`graph-node-${created[0]}`).click();await page.getByTestId('graph-delete').click();await expect(page.getByTestId(`graph-node-${created[0]}`)).toHaveCount(0);await page.getByTestId('graph-undo').click();await expect(page.getByTestId(`graph-node-${created[0]}`)).toBeVisible();await page.getByTestId('graph-redo').click()
 await page.getByTestId('graph-node-financeFinal').click();await page.getByTestId('graph-move-target').selectOption('toEnd');await page.getByTestId('graph-move').click();await page.getByTestId('graph-undo').click()
 await page.getByTestId('graph-node-amount').click();await page.getByTestId('graph-add-branch').click();const branches=page.locator('.gf-canvas [data-node-id="amount"]>.gf-region>.gf-lane');expect(await branches.count()).toBe(3);const extra=await branches.nth(1).getAttribute('data-branch-id');await branches.nth(1).locator(':scope>.gf-branch-label').click();await page.getByRole('button',{name:'↑ Move earlier',exact:true}).click();expect(await branches.first().getAttribute('data-branch-id')).toBe(extra);await page.getByRole('button',{name:'Remove branch',exact:true}).click();expect(await branches.count()).toBe(2)
 // Exercise the supported four-lane, two-level topology at real readable widths.
 for(const split of ['amount','reviewFork']){await page.getByTestId(`graph-node-${split}`).click();await page.getByTestId('graph-add-branch').click();await page.getByTestId('graph-add-branch').click();await expect(page.locator(`[data-region-id="${split}"] > .gf-lane`)).toHaveCount(4)}
 await page.getByTestId('graph-preview-toggle').click();await fillPayment(page,`dense-${suffix}`);const densePreview=await mutation(page,`${BASE}/preview`,()=>page.getByTestId('graph-preview').click());await page.getByTestId('graph-preview-toggle').click();await capture(page,info,'designer-dense',null,densePreview.definition)
 for(const width of [1440,320]){
  await page.setViewportSize({width,height:1000})
  if(await page.locator('.gf-mobile-switch').isVisible())await page.locator('.gf-mobile-switch button').first().click()
  const widths=await page.locator('.gf-canvas .gf-node').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.testid,width:node.getBoundingClientRect().width})))
  for(const node of widths)expect(node.width,`Readable ${node.id} at ${width}px`).toBeGreaterThanOrEqual(140)
  for(const canvas of await page.evaluate(readGraphCanvasState)){expect(canvas.nodeHorizontalClipping).toEqual([]);expect(canvas.fullyVisibleNodeIds).toEqual(canvas.allNodeIds)}
 }
 await page.setViewportSize(DESKTOP);for(let i=0;i<4;i++)await page.getByTestId('graph-undo').click()
 await expect(page.locator('[data-region-id="amount"] > .gf-lane')).toHaveCount(2);await expect(page.locator('[data-region-id="reviewFork"] > .gf-lane')).toHaveCount(2)
 checkpoints.push('four-branches-two-levels-readable-at-320px-and-desktop')
 // One person owns two independent active tasks; final review is group ALL.
 await page.getByTestId('graph-node-businessReview').click();await page.getByTestId('graph-person-bob').check();await page.getByTestId('graph-node-final').click();await page.getByTestId('graph-node-type').selectOption('parallelApproval');await page.getByTestId('graph-person-bob').check();await page.getByTestId('graph-person-carol').check();await page.getByTestId('graph-vote-mode').selectOption('ALL')
 await page.getByTestId('graph-branch-highValue').click()
 await page.getByTestId('graph-operator-0').selectOption('GT');await expect(page.getByTestId('graph-operator-0')).toHaveValue('GT')
 await page.getByTestId('graph-operator-0').selectOption('GTE')
 await page.getByTestId('graph-condition-currency-0').selectOption('JPY');await expect(page.getByTestId('graph-condition-currency-0')).toHaveValue('JPY')
 await page.getByTestId('graph-condition-currency-0').selectOption('CNY')
 await page.getByTestId('graph-threshold-0').fill('19999999999.999999')
 await expect(page.getByTestId('graph-threshold-error-0')).toBeVisible()
 await expect(page.getByTestId('graph-threshold-0')).toHaveValue('19999999999.999999')
 await expect(page.getByTestId('graph-publish')).toBeDisabled()
 await expect(page.locator('.gf-alert')).toHaveCount(0)
 await page.getByTestId('graph-save').click()
 await expect(page.locator('.gf-alert')).toBeVisible()
 await expect(page.getByTestId('graph-refresh')).toBeEnabled()
 const afterInvalidSave=await api(request,'alice',`${BASE}/workspace`)
 expect(afterInvalidSave.draft.revision).toBe(initial.draft.revision)
 expect(afterInvalidSave.draft.definition.edges.find(edge=>edge.id==='highValue').condition).toEqual(initial.draft.definition.edges.find(edge=>edge.id==='highValue').condition)
 await page.getByTestId('graph-threshold-0').fill('12500');await expect(page.getByTestId('graph-threshold-error-0')).toHaveCount(0)
 const branchName=`Exact net boundary ${suffix}`
 await page.getByTestId('graph-branch-name').fill(branchName)
 await page.getByTestId('graph-process-name').fill(`Graph acceptance ${suffix}`)
 const saved=await save(page);expect(saved.revision).toBeGreaterThan(initial.draft.revision)
 const boundaryRule={mode:'ALL',predicates:[{field:'payment.netTotal',operator:'GTE',currency:'CNY',threshold:12500}]}
 expect(saved.definition.edges.find(edge=>edge.id==='highValue')).toMatchObject({label:branchName,condition:boundaryRule,defaultBranch:false})
 await page.getByTestId('graph-process-name').fill('Discard this local edit');await page.getByTestId('graph-reload').click();await page.getByTestId('graph-confirm-reload').click();await expect(page.getByTestId('graph-process-name')).toHaveValue(`Graph acceptance ${suffix}`)
 await page.getByTestId('graph-branch-highValue').click()
 await expect(page.getByTestId('graph-branch-name')).toHaveValue(branchName)
 await expect(page.getByTestId('graph-operator-0')).toHaveValue('GTE')
 await expect(page.getByTestId('graph-condition-currency-0')).toHaveValue('CNY')
 await expect(page.getByTestId('graph-threshold-0')).toHaveValue('12500')
 const published=await publish(page);expect(published.version).toBe(initial.definition.version+1)
 expect(published.edges.find(edge=>edge.id==='highValue')).toMatchObject({label:branchName,condition:boundaryRule,defaultBranch:false})
 checkpoints.push('ui-insert-paired-region-delete-undo-redo-move-branches-save-reload-publish','ui-condition-editor-save-reload-exact-threshold-boundary')
 await page.getByTestId('graph-preview-toggle').click();await fillPayment(page,`preview-${suffix}`);const preview=await mutation(page,`${BASE}/preview`,()=>page.getByTestId('graph-preview').click());expect(preview.tasks.filter(t=>t.status==='ACTIVE')).toHaveLength(2);expect(preview.routes[0].selectedEdgeId).toBe('highValue');await expect(page.getByTestId('graph-server-fact')).toContainText('CNY 12500')
 await page.getByTestId('graph-payment-1-allocationAmount').fill('3999.99')
 await expect(page.getByTestId('graph-net-total')).toHaveText('CNY 12499.99')
 const belowBoundary=await mutation(page,`${BASE}/preview`,()=>page.getByTestId('graph-preview').click())
 expect(belowBoundary.routes[0].selectedEdgeId).toBe('otherwise')
 expect(belowBoundary.tasks.filter(task=>task.status==='ACTIVE').map(task=>task.nodeId)).toEqual(['standard'])
 await expect(page.getByTestId('graph-server-fact')).toContainText('CNY 12499.99')
 await expect(page.getByTestId('graph-active-count')).toHaveText('1')
 await page.getByTestId('graph-payment-1-allocationAmount').fill('4000')
 await expect(page.getByTestId('graph-net-total')).toHaveText('CNY 12500.00')
 await page.getByTestId('graph-preview-toggle').click()
 // Main mode navigation keeps editor state and keyboard undo does not consume input typing.
 await page.getByTestId('graph-process-name').fill(`Keyboard ${suffix}`);await page.getByTestId('graph-node-start').focus();await page.keyboard.press('Control+z');await expect(page.getByTestId('graph-process-name')).toHaveValue(`Graph acceptance ${suffix}`)
 await page.getByTestId('sequential-mode').click();await page.getByTestId('graph-mode').click();await expect(page.getByTestId('graph-process-name')).toHaveValue(`Graph acceptance ${suffix}`);await capture(page,info,'designer',null,published);checkpoints.push('server-preview-multiline-netTotal-12500-keyboard-mode-navigation')
 // Clear preview's form through a submitted real request, preserving the original netTotal.
 await requests(page);await page.getByTestId('graph-new-request').click();const high=await mutation(page,`${BASE}/requests`,()=>page.getByTestId('graph-submit').click());expect(high.definition.version).toBe(published.version);expect(high.tasks.filter(t=>t.status==='ACTIVE').map(t=>t.nodeId).sort()).toEqual(['businessReview','finance']);expect(high.routes[0].selectedEdgeId).toBe('highValue')
 // Publishing ANY changes only future requests; old request stays frozen ALL.
 await designer(page);await page.getByTestId('graph-node-final').click();await page.getByTestId('graph-vote-mode').selectOption('ANY');await save(page);const next=await publish(page);expect(next.version).toBe(published.version+1)
 const bobContext=await browser.newContext({baseURL:'http://localhost:5173',viewport:DESKTOP,locale:'en-GB'}),carolContext=await browser.newContext({baseURL:'http://localhost:5173',viewport:DESKTOP,locale:'en-GB'});const bob=await bobContext.newPage(),carol=await carolContext.newPage();bob.on('pageerror',e=>errors.push(e.message));carol.on('pageerror',e=>errors.push(e.message));await Promise.all([login(bob,'bob'),login(carol,'carol')]);await select(bob,high.id)
 await expect(bob.getByTestId('graph-approve-finance')).toBeVisible();await expect(bob.getByTestId('graph-approve-businessReview')).toBeVisible();let current=await vote(bob,high,'businessReview');expect(current.forks[0].arrivedBranchIds).toHaveLength(1);expect(current.forks[0].fired).toBe(false);await expect(bob.getByTestId('graph-join-reviewJoin')).toContainText('1 / 2')
 // Stop the actual Java child, retain its frozen store, then use normal auth/UI.
 const beforeRestart=current, restartWitness=await restartBackend(beforeRestart,await sourceProvenance())
 expect(restartWitness.backendJarSHA256).toBe((await sourceProvenance()).backendJarSHA256)
 const unauthorized=await request.get(`http://127.0.0.1:8080/api${BASE}/requests/${high.id}`)
 expect(unauthorized.status()).toBe(401)
 await bob.reload()
 const[identityResponse]=await Promise.all([bob.waitForResponse(response=>response.url().endsWith('/api/me')&&response.request().method()==='GET'),login(bob,'bob')])
 expect(identityResponse.status()).toBe(200);const authenticatedIdentity=await identityResponse.json();expect(authenticatedIdentity.id).toBe('bob')
 await select(bob,high.id)
 const restored=await api(request,'bob',`${BASE}/requests/${high.id}`)
 expect(restored).toEqual(beforeRestart)
 expect(restored.definition).toEqual(high.definition)
 expect(restored.tasks.filter(task=>task.status==='ACTIVE').map(task=>task.nodeId)).toEqual(['finance'])
 expect(restored.forks[0].arrivedBranchIds).toHaveLength(1);expect(restored.forks[0].expectedBranchIds).toHaveLength(2);expect(restored.forks[0].fired).toBe(false)
 await expect(bob.getByTestId('graph-join-reviewJoin')).toContainText('1 / 2')
 restartWitness.unauthenticatedReadStatus=unauthorized.status();restartWitness.authenticatedUser=authenticatedIdentity.id
 restartWitness.requestBefore=restartRequestState(beforeRestart);restartWitness.requestAfterReady=restartRequestState(restored)
 restartWitness.renderedAfterReload=assertRenderedGraphState(await bob.getByTestId('graph-runtime').evaluate(readRenderedGraphState),restored)
 restartWitness.requestAfterAuthenticatedRead=restartRequestState(restored)
 restartWitness.persistedAfterAuthenticatedRead=await readPersistedRequest(restored)
 restartWitness.graphFileSHA256AfterAuthenticatedRead=restartWitness.persistedAfterAuthenticatedRead.graphFileSHA256
 expect(restartWitness.graphFileSHA256AfterAuthenticatedRead).toBe(restartWitness.graphFileSHA256Before)
 current=restored;await capture(bob,info,'waiting-join',current)
 checkpoints.push('child-JVM-restart-at-partial-join-unchanged-store-frozen-runtime-normal-auth')
 current=await vote(bob,current,'finance')
 restartWitness.persistedAfterDecision=await readPersistedRequest(current)
 restartWitness.graphFileSHA256AfterDecision=restartWitness.persistedAfterDecision.graphFileSHA256;restartWitness.requestAfterDecision=restartRequestState(current)
 expect(restartWitness.graphFileSHA256AfterDecision).not.toBe(restartWitness.graphFileSHA256Before)
 expect(current.commandRevision).toBe(beforeRestart.commandRevision+1)
 expect(current.commands).toHaveLength(beforeRestart.commands.length+1)
 expect(current.definition).toEqual(beforeRestart.definition);expect(current.business).toEqual(beforeRestart.business);expect(current.routes).toEqual(beforeRestart.routes)
 expect(current.commands.slice(0,-1)).toEqual(beforeRestart.commands);expect(current.events.slice(0,beforeRestart.events.length)).toEqual(beforeRestart.events)
 checkpoints.push('post-restart-durable-decision-changes-store-and-advances-once')
 expect(current.tasks.find(t=>t.nodeId==='financeFinal').status).toBe('ACTIVE');expect(current.tasks.some(t=>t.nodeId==='final')).toBe(false);current=await vote(bob,current,'financeFinal');expect(current.forks[0].fired).toBe(true);expect(current.tasks.filter(t=>t.nodeId==='final')).toHaveLength(1);expect(current.tasks.find(t=>t.nodeId==='final').completionMode).toBe('ALL');current=await vote(bob,current,'final');expect(current.status).toBe('PENDING');await select(carol,high.id);current=await vote(carol,current,'final');expect(current.status).toBe('APPROVED');expect(current.definition).toEqual(high.definition);checkpoints.push('same-actor-multiple-tasks-independent-progress-join-once-frozen-ALL')
 const low=await submit(page,`low-${suffix}`,{high:false});expect(low.routes[0].selectedEdgeId).toBe('otherwise');expect(low.definition.version).toBe(next.version);expect(low.tasks.map(t=>t.nodeId)).toEqual(['standard']);await select(bob,low.id);let lowState=await vote(bob,low,'standard');lowState=await vote(bob,lowState,'final');expect(lowState.status).toBe('APPROVED');expect(lowState.tasks.find(t=>t.nodeId==='final').votes).toHaveLength(1);await capture(bob,info,'default-approved',lowState);checkpoints.push('default-selected-unselected-skipped-group-ANY')
 await bob.getByTestId('graph-expand-runtime').click();await expect(bob.getByTestId('graph-expand-runtime')).toHaveAttribute('aria-pressed','true');await expect(bob.locator('.gf-request-list')).not.toBeVisible()
 await bob.setViewportSize({width:320,height:844});await expect(bob.locator('.gf-request-list')).toBeVisible();await bob.getByTestId(`graph-request-${high.id}`).click();await expect(bob.getByTestId('graph-runtime')).toHaveAttribute('data-request-id',high.id)
 await bob.setViewportSize(DESKTOP);await expect(bob.locator('.gf-request-list')).toBeVisible();await expect(bob.getByTestId('graph-expand-runtime')).toHaveAttribute('aria-pressed','false');checkpoints.push('runtime-expanded-resize-restores-request-navigation')
 const rejected=await submit(page,`reject-${suffix}`);await select(bob,rejected.id);const rejectedState=await vote(bob,rejected,'finance','REJECT','Reject synthetic allocation');expect(rejectedState.status).toBe('REJECTED');expect(rejectedState.tasks.find(t=>t.nodeId==='businessReview').status).toBe('CANCELLED');await expect(bob.getByTestId('graph-join-reviewJoin')).toContainText('Cancelled');await expect(bob.getByTestId('graph-branch-highValue')).toContainText('Selected');await expect(bob.getByTestId('graph-branch-otherwise')).toContainText('Skipped');await expect(bob.getByTestId('graph-branch-financeBranch')).toContainText('Cancelled');await expect(bob.getByTestId('graph-branch-businessBranch')).toContainText('Cancelled');await expect(bob.getByTestId('graph-node-financeFinal')).toContainText('Not reached');await expect(bob.getByTestId('graph-node-final')).toContainText('Not reached');await expect(bob.getByTestId('graph-node-end')).toContainText('Not reached');await capture(bob,info,'rejected',rejectedState);checkpoints.push('rejection-cancels-active-sibling-and-unfired-join')
 await page.reload();await login(page,'alice');await select(page,high.id);await expect(page.getByTestId('graph-runtime')).toContainText('Approved');await capture(page,info,'approved',current);checkpoints.push('browser-reload-preserves-durable-runtime')
 await designer(page);await page.setViewportSize({width:320,height:844});await page.getByTestId('graph-node-final').click();await expect(page.getByTestId('graph-properties')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByTestId('graph-canvas')).toBeVisible();
 for(const nodeId of ['finance','businessReview','standard']){
  const node=page.getByTestId(`graph-node-${nodeId}`)
  await node.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
  await expect(node).toBeFocused()
  const inCanvas=await node.evaluate(element=>{const canvas=element.closest('.gf-canvas'),a=element.getBoundingClientRect(),b=canvas.getBoundingClientRect();return a.right>b.left+canvas.clientLeft&&a.left<b.left+canvas.clientLeft+canvas.clientWidth&&a.bottom>b.top+canvas.clientTop&&a.top<b.top+canvas.clientTop+canvas.clientHeight})
  expect(inCanvas,`Keyboard can reveal graph node ${nodeId} inside the horizontal canvas`).toBe(true)
 }
 const width=await page.evaluate(()=>({inner:innerWidth,document:document.documentElement.scrollWidth}));expect(width.document).toBeLessThanOrEqual(width.inner);checkpoints.push('320px-keyboard-properties-escape')
 await captureProperties(page,info,next,'highValue');checkpoints.push('condition-properties-320px-390px-bilingual-paired-regions-visible')
 expect(errors).toEqual([]);writeFileSync(info.outputPath('graph-receipt.json'),JSON.stringify({schemaVersion:1,...await sourceProvenance(),result:'passed',realBackend:true,browser:'Chromium',capturedAt:new Date().toISOString(),checkpoints,restartWitness,requests:[current,lowState,rejectedState].map(restartRequestState)},null,2));await bobContext.close();await carolContext.close()
})

test('graph workflow: distinct actors converge concurrently and recover committed responses with original keys',async({page,browser,request},info)=>{
 test.setTimeout(240000);const suffix=randomUUID().slice(0,8),checkpoints=[],errors=[];page.on('pageerror',e=>errors.push(e.message));await login(page,'alice');await designer(page)
 await page.getByTestId('graph-node-businessReview').click();await page.getByTestId('graph-person-carol').check();await page.getByTestId('graph-node-final').click();await page.getByTestId('graph-node-type').selectOption('approval');await page.getByTestId('graph-person-carol').check();await page.getByTestId('graph-process-name').fill(`Concurrent graph ${suffix}`);await save(page);const version=await publish(page)
 let dropSubmission=true,created,originalSubmission
 await page.route('**/api/graphs/payment/requests',async route=>{
  if(route.request().method()!=='POST'||!dropSubmission){await route.continue();return}
  dropSubmission=false;originalSubmission={key:route.request().headers()['idempotency-key'],body:route.request().postData()};const response=await route.fetch();expect(response.status()).toBe(201);created=await response.json();await route.abort('failed')
 })
 await requests(page);await page.getByTestId('graph-new-request').click();await fillPayment(page,`lost-${suffix}`);await page.getByTestId('graph-submit').click();await expect(page.locator('.gf-alert')).toBeVisible();expect(created.tasks.filter(task=>task.status==='ACTIVE')).toHaveLength(2);await expect(page.getByTestId('graph-payment-title')).toBeDisabled()
 await page.getByTestId('process-tab').click();await page.getByTestId('graph-mode').click();await requests(page);await page.getByTestId('graph-new-request').click();await expect(page.getByTestId('graph-payment-form')).toHaveCount(0);await page.getByTestId('graph-new-request').click();await expect(page.getByTestId('graph-submit')).toHaveText('Retry original request')
 const[retryRequest,response]=await Promise.all([page.waitForRequest(r=>r.url().endsWith(`/api${BASE}/requests`)&&r.method()==='POST'),mutation(page,`${BASE}/requests`,()=>page.getByTestId('graph-submit').click())]);expect(retryRequest.headers()['idempotency-key']).toBe(originalSubmission.key);expect(retryRequest.postData()).toBe(originalSubmission.body);expect(response.id).toBe(created.id);const all=await api(request,'alice',`${BASE}/requests`);expect(all.filter(item=>item.submissionKey===originalSubmission.key)).toHaveLength(1);checkpoints.push('committed-submission-response-loss-original-key-body-mode-close-back-retry')
 const bobContext=await browser.newContext({baseURL:'http://localhost:5173',viewport:DESKTOP,locale:'en-GB'}),carolContext=await browser.newContext({baseURL:'http://localhost:5173',viewport:DESKTOP,locale:'en-GB'}),bob=await bobContext.newPage(),carol=await carolContext.newPage();bob.on('pageerror',e=>errors.push(e.message));carol.on('pageerror',e=>errors.push(e.message));await Promise.all([login(bob,'bob'),login(carol,'carol')]);await Promise.all([select(bob,created.id),select(carol,created.id)]);await expect(bob.getByTestId('graph-approve-finance')).toBeVisible();await expect(carol.getByTestId('graph-approve-businessReview')).toBeVisible();await expect(bob.getByTestId('graph-approve-businessReview')).toHaveCount(0);await expect(carol.getByTestId('graph-approve-finance')).toHaveCount(0);await capture(bob,info,'distinct-actors-active',created)
 let dropDecision=true,afterFinance,originalDecision
 await bob.route('**/api/graphs/payment/requests/*/tasks/*/decision',async route=>{if(!dropDecision){await route.continue();return}dropDecision=false;originalDecision={key:route.request().headers()['idempotency-key'],body:route.request().postData()};const committed=await route.fetch();expect(committed.status()).toBe(200);afterFinance=await committed.json();await route.abort('failed')})
 await bob.getByTestId('graph-comment-finance').fill('Original decision survives lost response');await bob.getByTestId('graph-approve-finance').click();await expect(bob.getByTestId('graph-retry-finance')).toBeVisible();await bob.getByTestId('process-tab').click();await bob.getByTestId('graph-mode').click();await requests(bob);await expect(bob.getByTestId('graph-retry-finance')).toBeVisible()
 const[retryVote,decision]=await Promise.all([bob.waitForRequest(r=>r.url().endsWith('/decision')&&r.method()==='POST'),mutation(bob,`${BASE}/requests/${created.id}/tasks/${encodeURIComponent(`${created.id}:finance`)}/decision`,()=>bob.getByTestId('graph-retry-finance').click())]);expect(retryVote.headers()['idempotency-key']).toBe(originalDecision.key);expect(retryVote.postData()).toBe(originalDecision.body);expect(decision.commandRevision).toBe(afterFinance.commandRevision);expect(decision.tasks.find(t=>t.nodeId==='finance').votes).toHaveLength(1);checkpoints.push('committed-decision-response-loss-original-key-body-mode-retry')
 await select(carol,created.id);const results=await Promise.all([vote(bob,decision,'financeFinal'),vote(carol,decision,'businessReview')]);await Promise.all([bob.getByTestId('graph-refresh').click(),carol.getByTestId('graph-refresh').click()]);await expect(carol.getByTestId('graph-approve-final')).toBeVisible();const converged=await api(request,'alice',`${BASE}/requests/${created.id}`);expect(converged.forks[0].fired).toBe(true);expect(converged.forks[0].arrivedBranchIds).toHaveLength(2);expect(converged.events.filter(e=>e.type==='JOIN_FIRED')).toHaveLength(1);expect(converged.tasks.filter(t=>t.nodeId==='final')).toHaveLength(1);expect(converged.commands).toHaveLength(3);expect(converged.commands.filter(c=>c.actorId==='bob')).toHaveLength(2);expect(converged.commands.filter(c=>c.actorId==='carol')).toHaveLength(1);expect(results.every(value=>value.definition.version===version.version)).toBe(true);checkpoints.push('distinct-actor-simultaneous-branch-arrival-one-join-one-successor-no-lost-vote')
 const completed=await vote(carol,converged,'final');expect(completed.status).toBe('APPROVED');await capture(carol,info,'distinct-actors-completed',completed);expect(errors).toEqual([])
 writeFileSync(info.outputPath('graph-recovery-receipt.json'),JSON.stringify({schemaVersion:1,...await sourceProvenance(),result:'passed',realBackend:true,browser:'Chromium',capturedAt:new Date().toISOString(),checkpoints,requests:[completed].map(value=>({id:value.id,status:value.status,commandRevision:value.commandRevision,definition:value.definition,business:value.business,tasks:value.tasks,forks:value.forks,routes:value.routes,commands:value.commands,events:value.events}))},null,2));await bobContext.close();await carolContext.close()
})
