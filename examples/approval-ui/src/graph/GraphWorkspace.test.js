import {mount,flushPromises} from '@vue/test-utils'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import GraphWorkspace from './GraphWorkspace.vue'
import GraphRuntime from './GraphRuntime.vue'
import GraphInspector from './GraphInspector.vue'
import GraphPaymentForm from './GraphPaymentForm.vue'
import {api} from '../api.js'
import {readRenderedGraphState,assertRenderedGraphState,expectedRenderedGraphState,readGraphCanvasState,readDesignerProperties,assertDesignerProperties} from '../../e2e/graph-rendered-state.mjs'
import {definition,business,directory,instance} from './fixtures.test-support.js'
vi.mock('../api.js',()=>({api:{request:vi.fn()}}))
const mounted=[]
const copy=value=>JSON.parse(JSON.stringify(value)), button=(w,id)=>w.get(`[data-testid="${id}"]`)
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function setup({publisher=true,items=[],attached=false}={}){const server={definition:definition(),draft:{revision:0,baseVersion:1,definition:definition()},items:copy(items)};api.request.mockImplementation(async(path,options)=>{if(path.endsWith('/capabilities'))return {schemaVersion:5,businessType:'paymentRequest',facts:[{field:'payment.netTotal',type:'money',currencies:['CNY','USD','EUR','GBP','JPY'],operators:['EQ','GT','GTE','LT','LTE']}],permissions:{canPublish:publisher,canSubmit:true}};if(path.endsWith('/users'))return directory;if(path.endsWith('/process'))return copy(server.definition);if(path.endsWith('/workspace'))return{definition:copy(server.definition),draft:copy(server.draft)};if(path.endsWith('/requests'))return copy(server.items);if(path.endsWith('/draft')){const input=JSON.parse(options.body);server.draft={revision:server.draft.revision+1,baseVersion:1,definition:input.definition};return copy(server.draft)}if(path.endsWith('/validate'))return {diagnostics:[]};if(path.endsWith('/publish')){server.definition={...copy(server.draft.definition),version:server.definition.version+1};server.draft={revision:server.draft.revision+1,baseVersion:server.definition.version,definition:copy(server.definition)};return copy(server.definition)}throw new Error(`Unhandled mock ${path}`)});const wrapper=mount(GraphWorkspace,{props:{actor:directory[publisher?0:1],locale:'en'},...(attached?{attachTo:document.body}:{})});mounted.push(wrapper);return{server,wrapper}}
beforeEach(()=>vi.resetAllMocks())
afterEach(()=>{mounted.splice(0).forEach(wrapper=>wrapper.unmount());document.body.innerHTML=''})
describe('graph designer DOM',()=>{
 it('loads actual directory options and shows graph nodes/edges without hardcoded participants',async()=>{const{wrapper}=setup();await flushPromises();expect(wrapper.findAll('.gf-node')).toHaveLength(7);await button(wrapper,'graph-node-first').trigger('click');expect(wrapper.get('.gf-participants').text()).toContain('Mira');expect(wrapper.get('.gf-participants').text()).not.toContain('Bob');expect(wrapper.get('[data-testid="graph-person-reviewer-a"]').element.checked).toBe(true)})
 it('edits a node, saves to durable draft, confirms discard, reloads and publishes expected revisions',async()=>{const{wrapper,server}=setup();await flushPromises();await button(wrapper,'graph-node-first').trigger('click');await button(wrapper,'graph-node-name').setValue('Changed');expect(button(wrapper,'graph-publish').element.disabled).toBe(true);await button(wrapper,'graph-save').trigger('click');await flushPromises();expect(server.draft.definition.nodes.find(n=>n.id==='first').name).toBe('Changed');await button(wrapper,'graph-node-name').setValue('Unsaved');await button(wrapper,'graph-reload').trigger('click');expect(wrapper.find('[role=alertdialog]').exists()).toBe(true);await button(wrapper,'graph-confirm-reload').trigger('click');await flushPromises();expect(wrapper.text()).not.toContain('Unsaved');await button(wrapper,'graph-publish').trigger('click');await flushPromises();const call=api.request.mock.calls.find(([path])=>path.endsWith('/publish'));expect(JSON.parse(call[1].body)).toEqual({expectedVersion:1,expectedDraftRevision:1});expect(server.definition.version).toBe(2)})
 it('inserts paired regions with undo/redo and excludes illegal edits from persisted state',async()=>{const{wrapper}=setup();await flushPromises();await button(wrapper,'graph-edge-finish').trigger('click');await button(wrapper,'graph-insert-exclusiveGateway').trigger('click');expect(wrapper.findAll('.gf-node')).toHaveLength(11);await button(wrapper,'graph-undo').trigger('click');expect(wrapper.findAll('.gf-node')).toHaveLength(7);await button(wrapper,'graph-redo').trigger('click');expect(wrapper.findAll('.gf-node')).toHaveLength(11)})
 it('preserves local edits after CAS conflict and requires explicit reload',async()=>{const{wrapper}=setup();await flushPromises();await button(wrapper,'graph-process-name').setValue('Keep my edits');api.request.mockRejectedValueOnce(Object.assign(new Error('stale'),{status:409}));await button(wrapper,'graph-save').trigger('click');await flushPromises();expect(button(wrapper,'graph-process-name').element.value).toBe('Keep my edits');expect(button(wrapper,'graph-save').element.disabled).toBe(true);expect(wrapper.get('[role=alert]').text()).toContain('preserved')})
 it('suppresses duplicate save and ignores late response after unmount',async()=>{const{wrapper}=setup();await flushPromises();await button(wrapper,'graph-process-name').setValue('Pending');const wait=deferred();api.request.mockImplementationOnce(()=>wait.promise);await button(wrapper,'graph-save').trigger('click');await button(wrapper,'graph-save').trigger('click');expect(api.request.mock.calls.filter(([p])=>p.endsWith('/draft'))).toHaveLength(1);wrapper.unmount();wait.resolve({revision:1,definition:definition()});await flushPromises()})
 it('uses server publisher permission instead of actor name and localizes while preserving input',async()=>{const{wrapper}=setup({publisher:false});await flushPromises();expect(wrapper.find('[data-testid="graph-save"]').exists()).toBe(false);expect(wrapper.text()).toContain('publisher access');await wrapper.setProps({locale:'zh'});expect(wrapper.text()).toContain('图定义版本 5');expect(wrapper.get('[data-testid="graph-process-name"]').element.value).toBe('Invoice review')})
})
describe('multiple active task DOM',()=>{
 it('renders two task-specific decision controls for the same user and join 0/2',async()=>{const wrapper=mount(GraphRuntime,{props:{instance:instance(),people:directory,actor:directory[1],locale:'en'}});expect(wrapper.findAll('.gf-task.active')).toHaveLength(2);expect(wrapper.get('[data-testid="graph-join-join"]').text()).toContain('0 / 2');await button(wrapper,'graph-comment-second').setValue('Independent branch');await button(wrapper,'graph-approve-second').trigger('click');expect(wrapper.emitted('decide')[0][0]).toMatchObject({task:{id:'request-1:second'},decision:'APPROVE',comment:'Independent branch'});expect(wrapper.text()).toContain('Frozen graph · v1')})
 it('shows partial joins, real cancelled tasks, and only original retry after uncertain decision',()=>{const value=instance();value.status='REJECTED';value.tasks[0].status='REJECTED';value.tasks[1].status='CANCELLED';const wrapper=mount(GraphRuntime,{props:{instance:value,people:directory,actor:directory[1],locale:'zh'}});expect(wrapper.text()).toContain('已取消');expect(wrapper.find('[data-testid="graph-approve-second"]').exists()).toBe(false);const retry=mount(GraphRuntime,{props:{instance:instance(),people:directory,actor:directory[1],locale:'en',uncertain:{'request-1:first':true}}});expect(retry.find('[data-testid="graph-retry-first"]').exists()).toBe(true);expect(retry.find('[data-testid="graph-approve-first"]').exists()).toBe(false)})
})

describe('graph interrupted write recovery',()=>{
 it('retains the original submission body/key across mode changes and empty refresh, then reconciles only the matching durable key',async()=>{
  const{wrapper,server}=setup();await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-new-request').trigger('click');wrapper.getComponent(GraphPaymentForm).vm.$emit('update:modelValue',business());await flushPromises();
  const original=api.request.getMockImplementation();let savedIntent;api.request.mockImplementation(async(path,options)=>{if(path.endsWith('/requests')&&options?.method==='POST'){savedIntent=options;throw new Error('Response lost')}return original(path,options)});
  await button(wrapper,'graph-submit').trigger('click');await flushPromises();expect(wrapper.get('[data-testid="graph-payment-title"]').element.disabled).toBe(true);expect(button(wrapper,'graph-submit').text()).toBe('Retry original request');
  await wrapper.setProps({mode:'designer'});await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-refresh').trigger('click');await flushPromises();await button(wrapper,'graph-submit').trigger('click');await flushPromises();
  const attempts=api.request.mock.calls.filter(([path,options])=>path.endsWith('/requests')&&options?.method==='POST');expect(attempts).toHaveLength(2);expect(attempts[0][1].body).toBe(attempts[1][1].body);expect(attempts[0][1].headers).toEqual(attempts[1][1].headers);
  const committed=instance();committed.submissionKey=savedIntent.headers['Idempotency-Key'];server.items=[committed];await button(wrapper,'graph-refresh').trigger('click');await flushPromises();expect(wrapper.find('[data-testid="graph-payment-form"]').exists()).toBe(false);expect(wrapper.get('[data-testid="graph-runtime"]').text()).toContain('Two invoices');
 })
 it('keeps uncertain decisions after empty-command refresh and retries their exact original key and payload',async()=>{
  const{wrapper}=setup({publisher:false,items:[instance()]});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-request-request-1').trigger('click');const original=api.request.getMockImplementation();api.request.mockImplementation(async(path,options)=>{if(path.endsWith('/decision'))throw new Error('Response lost');return original(path,options)});
  await button(wrapper,'graph-comment-first').setValue('Original review');await button(wrapper,'graph-approve-first').trigger('click');await flushPromises();expect(wrapper.find('[data-testid="graph-approve-first"]').exists()).toBe(false);await button(wrapper,'graph-refresh').trigger('click');await flushPromises();expect(wrapper.find('[data-testid="graph-retry-first"]').exists()).toBe(true);await button(wrapper,'graph-retry-first').trigger('click');await flushPromises();const attempts=api.request.mock.calls.filter(([path])=>path.endsWith('/decision'));expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1]);
 })
 it('keyboard undo ignores input and composition and only runs in active graph mode',async()=>{const{wrapper}=setup();await flushPromises();await button(wrapper,'graph-process-name').setValue('Edited');const event=()=>new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});button(wrapper,'graph-process-name').element.dispatchEvent(event());await flushPromises();expect(button(wrapper,'graph-process-name').element.value).toBe('Edited');window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,isComposing:true}));await flushPromises();expect(button(wrapper,'graph-process-name').element.value).toBe('Edited');await wrapper.setProps({active:false});window.dispatchEvent(event());await flushPromises();expect(button(wrapper,'graph-process-name').element.value).toBe('Edited');await wrapper.setProps({active:true});window.dispatchEvent(event());await flushPromises();expect(button(wrapper,'graph-process-name').element.value).toBe('Invoice review');wrapper.unmount()})
})

describe('graph focus and operation scope regressions',()=>{
 it('moves focus into visible edge properties and Escape restores the selected edge control',async()=>{const{wrapper}=setup({attached:true});await flushPromises();await button(wrapper,'graph-edge-entry').trigger('click');await flushPromises();expect(document.activeElement.dataset.testid).toBe('graph-insert-approval');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flushPromises();expect(document.activeElement.dataset.testid).toBe('graph-edge-entry');await button(wrapper,'graph-node-first').trigger('click');await flushPromises();expect(document.activeElement.dataset.testid).toBe('graph-node-name');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flushPromises();expect(document.activeElement.dataset.testid).toBe('graph-node-first')})
 it('a delayed task409 after mode navigation does not stale an unrelated editable draft',async()=>{const{wrapper}=setup({items:[instance()]});await flushPromises();await wrapper.setProps({actor:directory[1]});await button(wrapper,'graph-process-name').setValue('Keep editable');await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-request-request-1').trigger('click');const wait=deferred(),original=api.request.getMockImplementation();api.request.mockImplementation((path,options)=>path.endsWith('/decision')?wait.promise:original(path,options));await button(wrapper,'graph-approve-first').trigger('click');await wrapper.setProps({mode:'designer'});wait.reject(Object.assign(new Error('task changed'),{status:409}));await flushPromises();expect(button(wrapper,'graph-save').element.disabled).toBe(false);expect(button(wrapper,'graph-process-name').element.value).toBe('Keep editable');expect(wrapper.get('[role=alert]').text()).toContain('task changed')})
})

describe('structured responsive graph controls',()=>{
 it('encloses independently numbered parallel tracks and places their shared join after the whole region',async()=>{
  const {wrapper}=setup();await flushPromises()
  const region=wrapper.get('[data-region-id="fork"]')
  expect(region.get('.gf-region-heading').text()).toContain('ALL · Independent parallel paths')
  expect(region.get('.gf-region-heading').text()).toContain('waits for every branch')
  expect(region.findAll(':scope > .gf-lane')).toHaveLength(2)
  expect(region.findAll(':scope > .gf-connector')).toHaveLength(0)
  expect(region.findAll('.gf-branch-order').map(label=>label.text())).toEqual(['Branch 01','Branch 02'])
  expect(region.element.nextElementSibling.dataset.testid).toBe('graph-node-join')
  expect(region.attributes('data-pair-id')).toBe('join')
  await wrapper.setProps({locale:'zh'});expect(region.get('.gf-region-heading').text()).toContain('多条路径独立并行')
 })
 it('offers a full-width canvas and restores the selected inspector without changing its values',async()=>{
  const {wrapper}=setup({attached:true});await flushPromises();await button(wrapper,'graph-node-first').trigger('click');await button(wrapper,'graph-node-name').setValue('Keep selected node')
  await button(wrapper,'graph-expand-canvas').trigger('click');expect(wrapper.get('.gf-workbench').classes()).toContain('gf-expanded');expect(button(wrapper,'graph-expand-canvas').attributes('aria-pressed')).toBe('true')
  await button(wrapper,'graph-node-first').trigger('click');await flushPromises();expect(wrapper.get('.gf-workbench').classes()).not.toContain('gf-expanded');expect(button(wrapper,'graph-node-name').element.value).toBe('Keep selected node');expect(document.activeElement.dataset.testid).toBe('graph-node-name')
 })
 it('reads published conditional properties from live controls and rejects stale or changed witnesses',async()=>{
  const {wrapper,server}=setup();await flushPromises();await button(wrapper,'graph-edge-finish').trigger('click');await button(wrapper,'graph-insert-exclusiveGateway').trigger('click');await button(wrapper,'graph-save').trigger('click');await flushPromises();await button(wrapper,'graph-publish').trigger('click');await flushPromises()
  const edge=server.definition.edges.find(edge=>edge.condition);await button(wrapper,`graph-branch-${edge.id}`).trigger('click')
  const root=wrapper.element,observed=readDesignerProperties(root)
  expect(assertDesignerProperties(observed,server.definition,edge.id)).toEqual(observed)
  expect(wrapper.get('[data-testid="graph-properties"]').text()).toContain('FIRST_MATCH')
  await wrapper.setProps({locale:'zh'});expect(readDesignerProperties(root)).toEqual(observed)
  expect(()=>assertDesignerProperties({...observed,selectedId:'other'},server.definition,edge.id)).toThrow('differ')
  expect(()=>assertDesignerProperties({...observed,definitionVersion:99},server.definition,edge.id)).toThrow('differ')
  button(wrapper,'graph-threshold-0').element.value='12500'
  expect(()=>assertDesignerProperties(readDesignerProperties(root),server.definition,edge.id)).toThrow('differ')
  button(wrapper,'graph-threshold-0').element.value='19999999999.999999'
  expect(()=>readDesignerProperties(root)).toThrow('Invalid visible threshold')
 })
 it('opens the exact region named by a server pairing diagnostic',async()=>{
  const {wrapper}=setup({attached:true});await flushPromises();const original=api.request.getMockImplementation();api.request.mockImplementation((path,options)=>path.endsWith('/validate')?Promise.resolve({diagnostics:[{code:'INVALID_PAIR',message:'Wrong matching join',nodeId:'fork',edgeId:null}]}):original(path,options))
  await button(wrapper,'graph-validate').trigger('click');await flushPromises();await wrapper.get('.gf-diagnostics button').trigger('click');await flushPromises()
  expect(wrapper.get('[data-testid="graph-properties"]').attributes('data-selected-id')).toBe('fork');expect(button(wrapper,'graph-node-name').element.value).toBe('fork');expect(document.activeElement.dataset.testid).toBe('graph-node-name')
 })
})

describe('graph operation notice localization',()=>{
 it('retranslates saved-draft feedback without repeating the save',async()=>{
  const {wrapper}=setup();await flushPromises();await button(wrapper,'graph-process-name').setValue('Bilingual feedback');await button(wrapper,'graph-save').trigger('click');await flushPromises()
  expect(wrapper.get('.gf-notice').text()).toBe('Draft saved.')
  const calls=api.request.mock.calls.length
  await wrapper.setProps({locale:'zh'});expect(wrapper.get('.gf-notice').text()).toBe('草稿已保存。')
  await wrapper.setProps({locale:'en'});expect(wrapper.get('.gf-notice').text()).toBe('Draft saved.')
  expect(api.request).toHaveBeenCalledTimes(calls)
 })
 it('retranslates a recorded decision without replaying its command',async()=>{
  const value=instance(),{wrapper}=setup({publisher:false,items:[value]});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-request-request-1').trigger('click')
  const original=api.request.getMockImplementation()
  api.request.mockImplementation(async(path,options)=>{
   if(!path.endsWith('/decision'))return original(path,options)
   const result=copy(value),id=options.headers['Idempotency-Key'],input=JSON.parse(options.body),at='2026-10-11T00:01:00Z'
   result.commandRevision=1;result.updatedAt=at;result.tasks[0].status='COMPLETED';result.tasks[0].votes=[{actorId:'reviewer-a',decision:input.decision,comment:input.comment,at,commandId:id}];result.forks[0].arrivedBranchIds=['branchA']
   result.commands=[{id,taskId:result.tasks[0].id,actorId:'reviewer-a',decision:input.decision,comment:input.comment,at}]
   return result
  })
  await button(wrapper,'graph-approve-first').trigger('click');await flushPromises();expect(wrapper.find('.gf-alert').exists()).toBe(false);expect(wrapper.get('.gf-notice').text()).toBe('Decision recorded.')
  const calls=api.request.mock.calls.length
  await wrapper.setProps({locale:'zh'});expect(wrapper.get('.gf-notice').text()).toBe('审批决定已记录。')
  await wrapper.setProps({locale:'en'});expect(wrapper.get('.gf-notice').text()).toBe('Decision recorded.')
  expect(api.request).toHaveBeenCalledTimes(calls)
 })
})

describe('newer request navigation wins over late submit',()=>{
 it('merges a newly saved request without stealing a newer user selection',async()=>{const existing=instance();existing.id='existing';existing.tasks=existing.tasks.map(task=>({...task,id:`existing:${task.nodeId}`,nodeInstanceId:`existing:${task.nodeId}`,lineage:task.lineage.map(frame=>({...frame,forkActivationId:'existing:fork'}))}));existing.forks[0].id='existing:fork';existing.business.title='Existing request';const{wrapper}=setup({items:[existing]});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-new-request').trigger('click');wrapper.getComponent(GraphPaymentForm).vm.$emit('update:modelValue',business());await flushPromises();const wait=deferred(),original=api.request.getMockImplementation();let attempt;api.request.mockImplementation((path,options)=>{if(path.endsWith('/requests')&&options?.method==='POST'){attempt=options;return wait.promise}return original(path,options)});await button(wrapper,'graph-submit').trigger('click');await button(wrapper,'graph-request-existing').trigger('click');const created=instance();created.submissionKey=attempt.headers['Idempotency-Key'];wait.resolve(created);await flushPromises();expect(wrapper.get('.gf-runtime-heading h2').text()).toBe('Existing request');expect(wrapper.find('[data-testid="graph-request-request-1"]').exists()).toBe(true);expect(wrapper.find('[data-testid="graph-payment-form"]').exists()).toBe(false)})
})

describe('screenshot DOM witnesses',()=>{
 it('updates request, task, vote and join witness attributes when the rendered instance changes',async()=>{
  const initial=instance(),wrapper=mount(GraphRuntime,{props:{instance:initial,people:directory,actor:directory[1],locale:'en'}});mounted.push(wrapper)
  const root=wrapper.get('[data-testid="graph-runtime"]').element
  expect(assertRenderedGraphState(readRenderedGraphState(root),initial)).toEqual(expectedRenderedGraphState(initial))
  const updated=copy(initial);updated.id='request-2';updated.commandRevision=3;updated.status='APPROVED';updated.definition.version=2;updated.tasks=updated.tasks.map((task,index)=>({...task,id:`request-2:${task.nodeId}`,nodeInstanceId:`request-2:${task.nodeId}`,status:'COMPLETED',votes:[{actorId:'reviewer-a',decision:'APPROVE',comment:`Review ${index}`,at:'2026-10-11T00:01:00Z',commandId:`command-${index}`}]}));updated.forks[0]={...updated.forks[0],id:'request-2:fork',fired:true,arrivedBranchIds:['branchB','branchA']}
  await wrapper.setProps({instance:updated,locale:'zh'})
  expect(wrapper.get('[data-testid="graph-runtime"]').attributes()).toMatchObject({'data-request-id':'request-2','data-command-revision':'3','data-request-status':'APPROVED','data-definition-version':'2'})
  expect(wrapper.get('[data-testid="graph-task-first"]').attributes()).toMatchObject({'data-task-id':'request-2:first','data-task-status':'COMPLETED','data-vote-count':'1'})
  expect(wrapper.get('[data-testid="graph-join-join"]').attributes()).toMatchObject({'data-fork-id':'request-2:fork','data-fork-fired':'true','data-arrived-branch-ids':'["branchB","branchA"]','data-expected-branch-ids':'["branchA","branchB"]'})
  expect(wrapper.get('.gf-runtime-heading > .gf-status').text()).toBe('已通过');expect(wrapper.get('[data-testid="graph-active-count"]').text()).toBe('0')
  expect(assertRenderedGraphState(readRenderedGraphState(root),updated)).toEqual(expectedRenderedGraphState(updated))
  expect(()=>assertRenderedGraphState(readRenderedGraphState(root),initial)).toThrow('does not match')
 })
 it('the exact capture helper rejects stale revisions, different requests, task votes, joins and displayed active counts',()=>{
  const value=instance(),wrapper=mount(GraphRuntime,{props:{instance:value,people:directory,actor:directory[1],locale:'en'}});mounted.push(wrapper);const root=wrapper.get('[data-testid="graph-runtime"]').element
  for(const changed of [{...value,id:'other-request'},{...value,commandRevision:1},{...value,status:'APPROVED'},{...value,definition:{...value.definition,version:2}}])expect(()=>assertRenderedGraphState(readRenderedGraphState(root),changed)).toThrow('does not match')
  const voted=copy(value);voted.tasks[0].votes=[{actorId:'reviewer-a',decision:'APPROVE'}];expect(()=>assertRenderedGraphState(readRenderedGraphState(root),voted)).toThrow('does not match')
  const joined=copy(value);joined.forks[0].arrivedBranchIds=['branchA'];expect(()=>assertRenderedGraphState(readRenderedGraphState(root),joined)).toThrow('does not match')
  const fired=copy(value);fired.forks[0].fired=true;expect(()=>assertRenderedGraphState(readRenderedGraphState(root),fired)).toThrow('does not match')
  root.querySelector('[data-testid="graph-active-count"]').textContent='0';expect(()=>assertRenderedGraphState(readRenderedGraphState(root),value)).toThrow('active task count')
  root.querySelector('[data-testid="graph-active-count"]').textContent='2';root.querySelector('.gf-task').setAttribute('data-vote-count','1');expect(()=>readRenderedGraphState(root)).toThrow('visible vote rows')
  root.querySelector('.gf-task').setAttribute('data-vote-count','0');root.removeAttribute('data-command-revision');expect(()=>readRenderedGraphState(root)).toThrow('Missing rendered graph attribute')
 })
 it('records only nodes intersecting the canvas viewport and preserves clipping dimensions',()=>{
  const root=document.createElement('div');root.innerHTML='<div class="gf-canvas"><button class="gf-node" data-testid="graph-node-left"></button><button class="gf-node" data-testid="graph-node-right"></button></div>';const canvas=root.firstElementChild
  Object.defineProperties(canvas,{clientLeft:{value:0},clientTop:{value:0},clientWidth:{value:300},scrollWidth:{value:900},clientHeight:{value:400},scrollHeight:{value:700}});canvas.getBoundingClientRect=()=>({left:0,top:0,right:300,bottom:400,width:300,height:400});canvas.children[0].getBoundingClientRect=()=>({left:10,top:10,right:100,bottom:100,width:90,height:90});canvas.children[1].getBoundingClientRect=()=>({left:600,top:10,right:700,bottom:100,width:100,height:90})
  expect(readGraphCanvasState(root)).toEqual([{scrollLeft:0,scrollTop:0,clientWidth:300,scrollWidth:900,clientHeight:400,scrollHeight:700,minimumNodeWidth:90,visibleNodeIds:['left'],allNodeIds:['left','right'],fullyVisibleNodeIds:['left'],nodeHorizontalClipping:['right'],clientBounds:{left:0,top:0,right:300,bottom:400}}])
  canvas.children[1].getBoundingClientRect=()=>({left:250,top:10,right:350,bottom:100,width:100,height:90})
  expect(readGraphCanvasState(root)[0]).toMatchObject({visibleNodeIds:['left','right'],fullyVisibleNodeIds:['left'],nodeHorizontalClipping:['right']})
 })
})

describe('selected request list visibility',()=>{
 let geometry, observers, scrollWrites, scrollValues
 const request=id=>{const value=JSON.parse(JSON.stringify(instance()).replaceAll('request-1',id));value.submissionKey=`submit-${id}`;value.business.title=`Request ${id}`;return value}
 const items=()=>Array.from({length:8},(_,index)=>request(`item-${index}`))
 const listOf=wrapper=>wrapper.get('.gf-request-list').element
 const visibleRow=(wrapper,id)=>{
  const list=listOf(wrapper),row=button(wrapper,`graph-request-${id}`).element.getBoundingClientRect(),top=list.getBoundingClientRect().top+list.clientTop
  expect(row.top).toBeGreaterThanOrEqual(top);expect(row.bottom).toBeLessThanOrEqual(top+list.clientHeight)
 }
 beforeEach(()=>{
  geometry={height:280,top:120,rowHeight:100,hidden:false};observers=[];scrollWrites=[];scrollValues=new WeakMap()
  vi.stubGlobal('innerWidth',390)
  vi.stubGlobal('ResizeObserver',class{
   constructor(callback){this.callback=callback;this.disconnect=vi.fn();observers.push(this)}
   observe(element){this.element=element}
   fire(){this.callback([{target:this.element}])}
  })
  const clientHeight=Object.getOwnPropertyDescriptor(Element.prototype,'clientHeight').get,clientTop=Object.getOwnPropertyDescriptor(Element.prototype,'clientTop').get,rect=Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype,'clientHeight','get').mockImplementation(function(){return this.matches('.gf-request-list')?(geometry.hidden?0:geometry.height):clientHeight.call(this)})
  vi.spyOn(Element.prototype,'clientTop','get').mockImplementation(function(){return this.matches('.gf-request-list')?1:clientTop.call(this)})
  vi.spyOn(Element.prototype,'scrollTop','get').mockImplementation(function(){return scrollValues.get(this)||0})
  vi.spyOn(Element.prototype,'scrollTop','set').mockImplementation(function(value){scrollValues.set(this,value);scrollWrites.push({element:this,value})})
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(function(){
   if(this.matches('.gf-request-list'))return{top:geometry.top,bottom:geometry.top+geometry.height+2,height:geometry.height+2}
   if(this.matches('.gf-request-item')){
    const list=this.parentElement,index=[...list.querySelectorAll('.gf-request-item')].indexOf(this),top=geometry.top+1+40+index*geometry.rowHeight-list.scrollTop
    return{top,bottom:top+geometry.rowHeight,height:geometry.rowHeight}
   }
   return rect.call(this)
  })
 })
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
 it('reveals below/above rows and a repeated selection using only the minimum list scroll without focus or canvas movement',async()=>{
  const {wrapper}=setup({items:items(),attached:true});await flushPromises();await wrapper.setProps({mode:'requests'});await flushPromises()
  expect(scrollWrites).toHaveLength(0)
  const list=listOf(wrapper);await button(wrapper,'graph-request-item-7').trigger('click');await flushPromises();expect(list.scrollTop).toBe(560);visibleRow(wrapper,'item-7')
  const canvas=wrapper.get('.gf-runtime-canvas').element;canvas.scrollTop=73;canvas.scrollLeft=91;document.documentElement.scrollTop=142
  button(wrapper,'graph-new-request').element.focus();const focus=document.activeElement
  list.scrollTop=0;scrollWrites=[];await button(wrapper,'graph-request-item-7').trigger('click');await flushPromises()
  expect(scrollWrites).toEqual([{element:list,value:560}]);expect(canvas.scrollTop).toBe(73);expect(canvas.scrollLeft).toBe(91);expect(document.documentElement.scrollTop).toBe(142);expect(document.activeElement).toBe(focus)
  await button(wrapper,'graph-request-item-0').trigger('click');await flushPromises();expect(list.scrollTop).toBe(40);visibleRow(wrapper,'item-0')
  scrollWrites=[];await button(wrapper,'graph-request-item-1').trigger('click');await flushPromises();expect(scrollWrites).toHaveLength(0);visibleRow(wrapper,'item-1')
 })
 it('reveals the newly submitted request after the DOM inserts its selected row',async()=>{
  const {wrapper}=setup({items:items(),attached:true});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-request-item-7').trigger('click');await flushPromises()
  const original=api.request.getMockImplementation();api.request.mockImplementation(async(path,options)=>{
   if(path.endsWith('/requests')&&options?.method==='POST'){const created=instance();created.submissionKey=options.headers['Idempotency-Key'];return created}
   return original(path,options)
  })
  await button(wrapper,'graph-new-request').trigger('click');wrapper.getComponent(GraphPaymentForm).vm.$emit('update:modelValue',business());await flushPromises()
  button(wrapper,'graph-refresh').element.focus();const focus=document.activeElement
  await button(wrapper,'graph-submit').trigger('click');await flushPromises()
  expect(button(wrapper,'graph-request-request-1').attributes('aria-pressed')).toBe('true');expect(listOf(wrapper).scrollTop).toBe(40);visibleRow(wrapper,'request-1');expect(document.activeElement).toBe(focus)
 })
 it('reveals the original-key request when an uncertain submission is reconciled at the back of a refreshed list',async()=>{
  const {wrapper,server}=setup({items:items()});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-new-request').trigger('click');wrapper.getComponent(GraphPaymentForm).vm.$emit('update:modelValue',business());await flushPromises()
  const original=api.request.getMockImplementation();let key
  api.request.mockImplementation(async(path,options)=>{if(path.endsWith('/requests')&&options?.method==='POST'){key=options.headers['Idempotency-Key'];throw new Error('Response lost')}return original(path,options)})
  await button(wrapper,'graph-submit').trigger('click');await flushPromises();const created=instance();created.submissionKey=key;server.items.push(created)
  await button(wrapper,'graph-refresh').trigger('click');await flushPromises()
  expect(button(wrapper,'graph-request-request-1').attributes('aria-pressed')).toBe('true');expect(listOf(wrapper).scrollTop).toBe(660);visibleRow(wrapper,'request-1');expect(wrapper.find('[data-testid="graph-payment-form"]').exists()).toBe(false)
 })
 it('restores the selected row after designer navigation and inactive workspace restoration',async()=>{
  const {wrapper}=setup({items:items()});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-request-item-7').trigger('click');await flushPromises()
  listOf(wrapper).scrollTop=0;await wrapper.setProps({mode:'designer'});expect(observers[0].disconnect).toHaveBeenCalledOnce();await wrapper.setProps({mode:'requests'});await flushPromises();visibleRow(wrapper,'item-7')
  await wrapper.setProps({active:false});listOf(wrapper).scrollTop=0;await flushPromises();expect(listOf(wrapper).scrollTop).toBe(0)
  await wrapper.setProps({active:true});await flushPromises();visibleRow(wrapper,'item-7')
 })
 it('reveals only on hidden-list restoration or entry into mobile layout, not every resize observation',async()=>{
  vi.stubGlobal('innerWidth',1200);geometry.height=900
  const {wrapper}=setup({items:items()});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-request-item-7').trigger('click');await flushPromises()
  const list=listOf(wrapper),observer=observers[0];expect(list.scrollTop).toBe(0)
  vi.stubGlobal('innerWidth',390);geometry.height=280;observer.fire();await flushPromises();visibleRow(wrapper,'item-7')
  list.scrollTop=113;observer.fire();await flushPromises();expect(list.scrollTop).toBe(113)
  geometry.height=260;observer.fire();await flushPromises();expect(list.scrollTop).toBe(113)
  vi.stubGlobal('innerWidth',1200);await button(wrapper,'graph-expand-runtime').trigger('click');geometry.hidden=true;observer.fire();await flushPromises();expect(list.scrollTop).toBe(113)
  list.scrollTop=0;await button(wrapper,'graph-expand-runtime').trigger('click');geometry.hidden=false;observer.fire();await flushPromises();visibleRow(wrapper,'item-7')
  list.scrollTop=81;observer.fire();await flushPromises();expect(list.scrollTop).toBe(81)
  wrapper.unmount();expect(observer.disconnect).toHaveBeenCalledOnce();scrollWrites=[];observer.fire();await flushPromises();expect(scrollWrites).toHaveLength(0)
 })
 it('preserves manual browsing through list reordering, localization, and task updates',async()=>{
  const {wrapper,server}=setup({publisher:false,items:items()});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-request-item-7').trigger('click');await flushPromises()
  const list=listOf(wrapper);list.scrollTop=123;scrollWrites=[];server.items.reverse()
  await button(wrapper,'graph-refresh').trigger('click');await flushPromises();await wrapper.setProps({locale:'zh'});observers[0].fire();await flushPromises()
  expect(list.scrollTop).toBe(123);expect(scrollWrites).toHaveLength(0)
  const original=api.request.getMockImplementation();api.request.mockImplementation(async(path,options)=>{
   if(!path.endsWith('/decision'))return original(path,options)
   const result=copy(server.items[0]),id=options.headers['Idempotency-Key'],input=JSON.parse(options.body),at='2026-10-11T00:01:00Z'
   result.commandRevision=1;result.updatedAt=at;result.tasks[0].status='COMPLETED';result.tasks[0].votes=[{actorId:'reviewer-a',decision:input.decision,comment:input.comment,at,commandId:id}];result.forks[0].arrivedBranchIds=['branchA']
   result.commands=[{id,taskId:result.tasks[0].id,actorId:'reviewer-a',decision:input.decision,comment:input.comment,at}];return result
  })
  await button(wrapper,'graph-approve-first').trigger('click');await flushPromises();observers[0].fire();await flushPromises()
  expect(wrapper.get('[data-testid="graph-runtime"]').attributes('data-command-revision')).toBe('1');expect(list.scrollTop).toBe(123);expect(scrollWrites).toHaveLength(0)
 })
 it('does not scroll to an old submit result after the user chose another request and resumed manual browsing',async()=>{
  const {wrapper}=setup({items:items()});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-new-request').trigger('click');wrapper.getComponent(GraphPaymentForm).vm.$emit('update:modelValue',business());await flushPromises()
  const wait=deferred(),original=api.request.getMockImplementation();let key
  api.request.mockImplementation((path,options)=>{if(path.endsWith('/requests')&&options?.method==='POST'){key=options.headers['Idempotency-Key'];return wait.promise}return original(path,options)})
  await button(wrapper,'graph-submit').trigger('click');await button(wrapper,'graph-request-item-7').trigger('click');await flushPromises();visibleRow(wrapper,'item-7')
  const list=listOf(wrapper);list.scrollTop=119;scrollWrites=[];const created=instance();created.submissionKey=key;wait.resolve(created);await flushPromises();observers[0].fire();await flushPromises()
  expect(wrapper.get('[data-testid="graph-runtime"]').attributes('data-request-id')).toBe('item-7');expect(button(wrapper,'graph-request-request-1').exists()).toBe(true);expect(list.scrollTop).toBe(119);expect(scrollWrites).toHaveLength(0)
 })
 it('does not scroll to an old uncertain submission during reconciliation after newer request navigation',async()=>{
  const {wrapper,server}=setup({items:items()});await flushPromises();await wrapper.setProps({mode:'requests'});await button(wrapper,'graph-new-request').trigger('click');wrapper.getComponent(GraphPaymentForm).vm.$emit('update:modelValue',business());await flushPromises()
  const original=api.request.getMockImplementation();let key
  api.request.mockImplementation(async(path,options)=>{if(path.endsWith('/requests')&&options?.method==='POST'){key=options.headers['Idempotency-Key'];throw new Error('Response lost')}return original(path,options)})
  await button(wrapper,'graph-submit').trigger('click');await flushPromises();await button(wrapper,'graph-request-item-7').trigger('click');await flushPromises()
  const list=listOf(wrapper);list.scrollTop=83;scrollWrites=[];const created=instance();created.submissionKey=key;server.items.unshift(created)
  await button(wrapper,'graph-refresh').trigger('click');await flushPromises();observers[0].fire();await flushPromises()
  expect(wrapper.get('[data-testid="graph-runtime"]').attributes('data-request-id')).toBe('item-7');expect(list.scrollTop).toBe(83);expect(scrollWrites).toHaveLength(0)
 })
 it('does not act on superseded, hidden, or unmounted selection work',async()=>{
  const {wrapper}=setup({items:items()});await flushPromises();await wrapper.setProps({mode:'requests'});await flushPromises()
  const last=button(wrapper,'graph-request-item-7'),first=button(wrapper,'graph-request-item-0')
  last.element.click();first.element.click();await flushPromises();expect(scrollWrites).toHaveLength(0);expect(first.attributes('aria-pressed')).toBe('true')
  geometry.hidden=true;await last.trigger('click');await flushPromises();expect(scrollWrites).toHaveLength(0)
  geometry.hidden=false;observers[0].fire();await flushPromises();scrollWrites=[];first.element.click();wrapper.unmount();await flushPromises();expect(scrollWrites).toHaveLength(0)
 })
})
