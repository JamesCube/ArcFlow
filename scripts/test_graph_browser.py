import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib
from verify_graph_browser import (REQUIRED_CHECKPOINTS, RECOVERY_CHECKPOINTS, REQUIRED_SCREENSHOTS,
                                  canvas_state, designer_state, png_dimensions, provenance, rendered_state, restart_state, restart_capture, request_list_state, sha, validate)


def png(width=2, height=2):
    def chunk(kind,body):
        return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff\xff\xff'*width)*height))+chunk(b'IEND',b'')

def restart_fixture():
    # Synthetic unit-test data only; never saved as browser evidence.
    definition={'schemaVersion':5,'id':'graph','version':2,'name':'Graph',
                'nodes':[{'id':'start'}, {'id':'financeFinal','name':'Finance confirmation','assigneeIds':['bob'],'completionMode':'ALL'}],
                'edges':[{'id':'condition','label':'High','defaultBranch':False,
                          'condition':{'mode':'ALL','predicates':[{'field':'payment.netTotal','operator':'GTE','currency':'CNY','threshold':12500}]}},
                         {'id':'fallback','defaultBranch':True}]}
    first={'id':'first','taskId':'restart:businessReview','actorId':'bob','decision':'APPROVE','comment':'Reviewed','at':'2026-10-12T01:00:50Z'}
    def task(node,status,votes,branch):
        return {'id':'restart:'+node,'nodeInstanceId':'restart:'+node,'nodeId':node,'status':status,
                'participants':['bob'],'completionMode':'ALL','votes':votes,
                'lineage':[{'forkActivationId':'fork','branchId':branch}]}
    first_vote={k:first[k] for k in ('actorId','decision','comment','at')};first_vote['commandId']='first'
    before={'id':'restart','submissionKey':'synthetic-only','applicantId':'alice','status':'PENDING','commandRevision':1,
            'createdAt':'2026-10-12T01:00:40Z','updatedAt':first['at'],'definition':definition,
            'business':{'businessId':'synthetic-restart'},'routes':[], 'commands':[first],
            'events':[{'sequence':1,'type':'TASK_COMPLETED','nodeId':'businessReview','taskId':first['taskId'],'detail':'Voting rule satisfied','at':first['at']}],
            'tasks':[task('finance','ACTIVE',[],'financeBranch'),task('businessReview','COMPLETED',[first_vote],'businessBranch')],
            'forks':[{'id':'fork','joinId':'join','fired':False,'arrivedBranchIds':['businessBranch'],
                      'expectedBranchIds':['businessBranch','financeBranch']}]}
    after=copy.deepcopy(before);after['commandRevision']=2
    second=dict(first,id='second',taskId='restart:finance',at='2026-10-12T01:03:00Z');after['commands'].append(second);after['updatedAt']=second['at']
    vote={k:second[k] for k in ('actorId','decision','comment','at')};vote['commandId']='second'
    after['tasks'][0].update(status='COMPLETED',votes=[vote]);after['tasks'].append(task('financeFinal','ACTIVE',[],'financeBranch'))
    for kind,node,detail in [('TASK_VOTED','finance','bob:APPROVE'),('TASK_COMPLETED','finance','Voting rule satisfied'),
                             ('TASK_ACTIVATED','financeFinal','Finance confirmation')]:
        after['events'].append(dict(sequence=len(after['events'])+1,type=kind,nodeId=node,taskId='restart:'+node,detail=detail,at=second['at']))
    old={'pid':100,'spawnedAt':'2026-10-12T01:00:00Z','observedAt':'2026-10-12T01:01:00Z',
         'linuxStartTicks':'1000','startTimeSource':'linux-proc-stat'}
    new={'pid':101,'spawnedAt':'2026-10-12T01:02:01Z','observedAt':'2026-10-12T01:02:02Z',
         'linuxStartTicks':'1300','startTimeSource':'linux-proc-stat'}
    witness={'schemaVersion':1,'nonce':'123e4567-e89b-42d3-a456-426614174000','result':'restarted','platform':'linux',
            'captureSessionId':'s','captureRunId':'r','captureRunAttempt':'1','captureRepository':'synthetic-only','captureRunUrl':'synthetic-only',
            'startedAt':'2026-10-12T01:01:01Z','completedAt':'2026-10-12T01:02:06Z',
            'processBefore':old,'processAfter':new,
            'independentlyObservedProcessBefore':dict(old,observedAt='2026-10-12T01:01:02Z'),
            'independentlyObservedProcessAfter':dict(new,observedAt='2026-10-12T01:02:04Z'),
            'oldProcessExit':{'code':None,'signal':'SIGTERM','observedAt':'2026-10-12T01:02:00Z'},
            'exitedBeforeReplacement':True,'oldProcessAbsentAfterReady':True,'readyAt':'2026-10-12T01:02:03Z',
            'backendJarSHA256':'b'*64,'graphFileSHA256Before':'d'*64,'graphFileSHA256AfterReady':'d'*64,
            'graphFileSHA256AfterAuthenticatedRead':'d'*64,'graphFileSHA256AfterDecision':'e'*64,
            'unauthenticatedReadStatus':401,'authenticatedUser':'bob',
            'requestBefore':before,'requestAfterReady':copy.deepcopy(before),'requestAfterAuthenticatedRead':copy.deepcopy(before),'requestAfterDecision':after,
            'renderedAfterReload':{'id':'restart','status':'PENDING','commandRevision':1,'definitionVersion':2,
                                  'activeTaskCount':1,'tasks':[{'id':t['id'],'status':t['status'],'voteCount':len(t['votes'])} for t in before['tasks']],
                                  'forks':[{k:f[k] for k in ('id','fired','arrivedBranchIds','expectedBranchIds')} for f in before['forks']]}}
    for suffix,at in [('Before','2026-10-12T01:01:03Z'),('AfterReady','2026-10-12T01:02:05Z'),
                      ('AfterAuthenticatedRead','2026-10-12T01:02:10Z'),('AfterDecision','2026-10-12T01:03:01Z')]:
        witness['persisted'+suffix]={'observedAt':at,'graphFileSHA256':witness['graphFileSHA256'+suffix],
                                    'storageSchemaVersion':14,'request':copy.deepcopy(witness['request'+suffix])}
    return witness

def restart_receipt(witness=None):
    witness=copy.deepcopy(witness or restart_fixture())
    final=copy.deepcopy(witness['requestAfterDecision']);final.update(status='APPROVED',commandRevision=3,updatedAt='2026-10-12T01:04:00Z')
    command=dict(final['commands'][-1],id='third',taskId='restart:financeFinal',at=final['updatedAt']);final['commands'].append(command)
    vote={k:command[k] for k in ('actorId','decision','comment','at')};vote['commandId']='third'
    final['tasks'][-1].update(status='COMPLETED',votes=[vote]);final['forks'][0].update(fired=True,arrivedBranchIds=['businessBranch','financeBranch'])
    final['events'].append(dict(sequence=len(final['events'])+1,type='JOIN_FIRED',nodeId='join',taskId=None,detail='fork',at=command['at']))
    return {'restartWitness':witness,'requests':[final],'capturedAt':'2026-10-12T01:05:00Z',
            **{k:witness[k] for k in ('captureSessionId','captureRunId','captureRunAttempt','captureRepository','captureRunUrl')}}

class GraphBrowserEvidenceTests(unittest.TestCase):
    def test_real_restart_requires_process_bytes_normal_auth_and_unchanged_partial_state(self):
        original=restart_receipt();restart_state(original,'b'*64)
        mutations=[('missing-witness',lambda w:w.clear()),
                   ('same-pid',lambda w:w['processAfter'].update(pid=w['processBefore']['pid'])),
                   ('same-start',lambda w:w['processAfter'].update(linuxStartTicks=w['processBefore']['linuxStartTicks'])),
                   ('unobserved-new-process',lambda w:w['independentlyObservedProcessAfter'].update(linuxStartTicks='9999')),
                   ('no-exit',lambda w:w.update(exitedBeforeReplacement=False)),
                   ('old-still-alive',lambda w:w.update(oldProcessAbsentAfterReady=False)),
                   ('replacement-before-exit',lambda w:w['oldProcessExit'].update(observedAt='2026-10-12T01:03:00Z')),
                   ('ready-only',lambda w:w.update(graphFileSHA256AfterReady='c'*64)),
                   ('no-durable-decision',lambda w:w.update(graphFileSHA256AfterDecision='d'*64)),
                   ('auth-bypassed',lambda w:w.update(unauthenticatedReadStatus=200)),
                   ('wrong-principal',lambda w:w.update(authenticatedUser='alice')),
                   ('lost-state',lambda w:w['requestAfterReady'].update(commandRevision=0)),
                   ('new-business',lambda w:w['requestAfterDecision']['business'].update(businessId='changed')),
                   ('double-transition',lambda w:w['requestAfterDecision'].update(commandRevision=3)),
                   ('rewritten-history',lambda w:w['requestAfterDecision']['events'].__setitem__(0,{'type':'ALTERED'})),
                   ('duplicate-vote',lambda w:w['requestAfterDecision']['tasks'][0]['votes'].append({'actorId':'bob'})),
                   ('stale-browser',lambda w:w['renderedAfterReload'].update(commandRevision=0))]
        for name, mutate in mutations:
            receipt=copy.deepcopy(original);mutate(receipt['restartWitness'])
            with self.subTest(name=name),self.assertRaises(ValueError):restart_state(receipt,'b'*64)
    def test_restart_witness_is_bound_to_its_journey_and_target_disk_record(self):
        original=restart_receipt()
        mutations=[('wrong-session',lambda r:r.update(captureSessionId='other')),
                   ('wrong-run',lambda r:r['restartWitness'].update(captureRunId='other')),
                   ('old-receipt',lambda r:r.update(capturedAt='2020-01-01T00:00:00Z')),
                   ('different-request',lambda r:r['requests'][0].update(id='not-restarted')),
                   ('duplicate-request',lambda r:r['requests'].append(copy.deepcopy(r['requests'][0]))),
                   ('missing-full-identity',lambda r:r['requests'][0].pop('applicantId')),
                   ('lower-proc-ticks',lambda r:[r['restartWitness'][key].update(linuxStartTicks='1') for key in ('processAfter','independentlyObservedProcessAfter')]),
                   ('wrong-observed-start',lambda r:r['restartWitness']['independentlyObservedProcessAfter'].update(spawnedAt='2026-10-12T01:02:00Z')),
                   ('missing-disk',lambda r:r['restartWitness'].pop('persistedAfterDecision')),
                   ('wrong-disk-schema',lambda r:r['restartWitness']['persistedAfterDecision'].update(storageSchemaVersion=13)),
                   ('wrong-disk-hash',lambda r:r['restartWitness']['persistedAfterDecision'].update(graphFileSHA256='f'*64)),
                   ('stale-target-disk',lambda r:r['restartWitness']['persistedAfterDecision'].update(request=copy.deepcopy(r['restartWitness']['requestBefore']))),
                   ('disk-read-after-receipt',lambda r:r['restartWitness']['persistedAfterDecision'].update(observedAt='2026-10-12T01:06:00Z')),
                   ('auth-read-altered-state',lambda r:r['restartWitness']['requestAfterAuthenticatedRead'].update(applicantId='mallory'))]
        for name,mutate in mutations:
            receipt=copy.deepcopy(original);mutate(receipt)
            with self.subTest(name=name),self.assertRaises(ValueError):restart_state(receipt,'b'*64)

    def test_next_durable_transition_preserves_old_votes_and_requires_real_matching_events(self):
        original=restart_receipt()
        mutations=[('rewritten-old-vote',lambda w:w['tasks'][1]['votes'][0].update(actorId='mallory',decision='REJECT')),
                   ('wrong-successor',lambda w:w['tasks'][2].update(id='unrelated',status='CANCELLED')),
                   ('no-new-events',lambda w:w.update(events=w['events'][:1])),
                   ('extra-event',lambda w:w['events'].append(copy.deepcopy(w['events'][-1]))),
                   ('wrong-event-task',lambda w:w['events'][1].update(taskId='unrelated')),
                   ('wrong-event-time',lambda w:w['events'][1].update(at='2026-10-12T01:02:00Z')),
                   ('wrong-event-sequence',lambda w:w['events'][1].update(sequence=1)),
                   ('wrong-command-task',lambda w:w['commands'][-1].update(taskId='unrelated')),
                   ('wrong-vote-key',lambda w:w['tasks'][0]['votes'][0].update(commandId='other')),
                   ('wrong-frozen-assignees',lambda w:w['tasks'][2].update(participants=['mallory'])),
                   ('lost-lineage',lambda w:w['tasks'][2].update(lineage=[])),
                   ('early-join',lambda w:w['forks'][0].update(fired=True)),
                   ('wrong-update-time',lambda w:w.update(updatedAt='2026-10-12T01:02:00Z'))]
        for name,mutate in mutations:
            receipt=copy.deepcopy(original);w=receipt['restartWitness'];mutate(w['requestAfterDecision'])
            # Keep exported disk bytes/state coherent to exercise the transition
            # checker itself, rather than failing only the snapshot equality.
            w['persistedAfterDecision']['request']=copy.deepcopy(w['requestAfterDecision'])
            with self.subTest(name=name),self.assertRaises(ValueError):restart_state(receipt,'b'*64)

    def test_waiting_screenshots_must_show_this_request_after_its_real_restart(self):
        receipt=restart_receipt();w=receipt['restartWitness'];state=w['requestAfterReady']
        item={key:receipt[key] for key in ('captureSessionId','captureRunId','captureRunAttempt','captureRepository','captureRunUrl')}
        item.update(state='waiting-join',capturedAt='2026-10-12T01:02:30Z',request={key:state[key] for key in ('id','status','commandRevision','definition','tasks','forks','routes','commands')})
        restart_capture(item,receipt)
        mutations=[('old-pixels',lambda i:i.update(capturedAt='2020-01-01T00:00:00Z')),
                   ('already-decided',lambda i:i.update(capturedAt='2026-10-12T01:03:01Z')),
                   ('other-run',lambda i:i.update(captureRunId='other')),
                   ('other-session',lambda i:i.update(captureSessionId='other')),
                   ('other-request',lambda i:i['request'].update(id='different')),
                   ('stale-revision',lambda i:i['request'].update(commandRevision=0))]
        for name,mutate in mutations:
            altered=copy.deepcopy(item);mutate(altered)
            with self.subTest(name=name),self.assertRaises(ValueError):restart_capture(altered,receipt)
    def test_complete_png_pixels_and_crc_are_checked(self):
        self.assertEqual((2,2),png_dimensions(png()))
        for data in (png()[:-1],png()[:-12],png()[:45]+b'\0'+png()[46:]):
            with self.assertRaises((ValueError,zlib.error)):png_dimensions(data)
    def test_dirty_or_cross_revision_and_backend_evidence_rejected(self):
        source='a'*40;backend='b'*64
        base={'sourceRevision':source,'sourceWorkingTree':'clean-commit','trackedDiffSHA256':sha(b''),'backendJarSHA256':backend,'uiSourceTreeSHA256':'c'*64,'captureSessionId':'s','captureRunId':'r'}
        provenance(base,source,backend)
        for field,value in [('sourceRevision','c'*40),('sourceWorkingTree','modified-local-worktree'),('backendJarSHA256','d'*64),('trackedDiffSHA256','a'*64)]:
            with self.assertRaises(ValueError):provenance(dict(base,**{field:value}),source,backend)
    def test_missing_completed_receipt_never_passes_from_screenshot_count(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for i in range(20):(root/f'graph-{i}.png').write_bytes(png())
            with self.assertRaises(ValueError):validate(root,'a'*40,'b'*64)
    def test_runtime_screenshot_requires_actual_matching_dom_state(self):
        request={'id':'request-1','status':'PENDING','commandRevision':1,'definition':{'version':2},
                 'tasks':[{'id':'request-1:a','status':'COMPLETED','votes':[{'actorId':'bob'}]},
                          {'id':'request-1:b','status':'ACTIVE','votes':[]}],
                 'forks':[{'id':'request-1:fork','fired':False,'arrivedBranchIds':['branch-a'],
                           'expectedBranchIds':['branch-a','branch-b']}]}
        displayed={'id':'request-1','status':'PENDING','commandRevision':1,'definitionVersion':2,'activeTaskCount':1,
                   'tasks':[{'id':'request-1:a','status':'COMPLETED','voteCount':1},
                            {'id':'request-1:b','status':'ACTIVE','voteCount':0}],
                   'forks':copy.deepcopy(request['forks'])}
        item={'state':'waiting-join','request':request,'renderedState':displayed}
        rendered_state(item)
        reordered=copy.deepcopy(item);reordered['renderedState']['forks'][0]['expectedBranchIds'].reverse()
        rendered_state(reordered) # Branch sets need not arrive in definition order.
        cases=[('id','different-request'),('status','APPROVED'),('commandRevision',0),
               ('definitionVersion',1),('activeTaskCount',2),('commandRevision',True),
               ('tasks',[]),('forks',[])]
        for field,value in cases:
            changed=copy.deepcopy(item);changed['renderedState'][field]=value
            with self.subTest(field=field,value=value),self.assertRaises(ValueError):rendered_state(changed)
        for collection,field,value in [('tasks','status','ACTIVE'),('tasks','voteCount',0),
                                       ('forks','fired',True),('forks','arrivedBranchIds',[]),
                                       ('forks','expectedBranchIds',['branch-a']),
                                       ('forks','expectedBranchIds',['branch-a','branch-a'])]:
            changed=copy.deepcopy(item);changed['renderedState'][collection][0][field]=value
            with self.subTest(collection=collection,field=field),self.assertRaises(ValueError):rendered_state(changed)
        with self.assertRaisesRegex(ValueError,'Missing rendered runtime state'):
            rendered_state({'state':'approved','request':request})
    def test_designer_capture_cannot_be_mislabeled_as_runtime_evidence(self):
        rendered_state({'state':'designer','request':None,'renderedState':None})
        with self.assertRaises(ValueError):rendered_state({'state':'designer','request':{'id':'x'}})
    def test_canvas_origin_and_internal_clipping_are_explicit(self):
        item={'viewport':{'width':390},'designerDefinition':{'nodes':[{'id':'start'},{'id':'left'}]},
              'canvases':[{'scrollLeft':0,'scrollTop':0,'clientWidth':350,
              'scrollWidth':350,'clientHeight':900,'scrollHeight':900,'visibleNodeIds':['left','start'],
              'allNodeIds':['left','start'],'fullyVisibleNodeIds':['left','start'],'nodeHorizontalClipping':[],
              'clientBounds':{'left':20,'top':100,'right':370,'bottom':1000}}]}
        canvas_state(item)
        for field,value in [('scrollLeft',200),('scrollTop',300),('clientWidth',400),('scrollWidth',200),
                            ('clientHeight',0),('visibleNodeIds',[]),('visibleNodeIds',['left','left']),
                            ('visibleNodeIds',['left']),('allNodeIds',['left']),('fullyVisibleNodeIds',['left']),
                            ('nodeHorizontalClipping',['start']),('clientBounds',None),
                            ('clientBounds',{'left':20,'top':100,'right':370,'bottom':float('nan')})]:
            changed=copy.deepcopy(item);changed['canvases'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):canvas_state(changed)
        with self.assertRaisesRegex(ValueError,'Missing visible graph canvas evidence'):
            canvas_state({'viewport':{'width':390}})
        dense=copy.deepcopy(item);dense['state']='designer-dense';dense['canvases'][0]['minimumNodeWidth']=140
        canvas_state(dense)
        for width in (None, True, 139.9, float('inf')):
            dense['canvases'][0]['minimumNodeWidth']=width
            with self.subTest(width=width),self.assertRaises(ValueError):canvas_state(dense)
        canvas_state({'state':'designer-properties','canvases':[]})
        with self.assertRaises(ValueError):canvas_state({'state':'designer-properties','canvases':item['canvases']})
    def test_selected_request_row_must_be_fully_visible_in_its_own_scroll_viewport(self):
        item={'state':'approved','request':{'id':'chosen'},'requestList':{'selectedId':'chosen','scrollTop':250,
              'scrollHeight':600,'clientHeight':280,'clientBounds':{'left':16,'top':210,'right':374,'bottom':490},
              'selectedBounds':{'left':17,'top':355,'right':373,'bottom':475}}}
        request_list_state(item)
        for field,value in [('selectedId','other'),('scrollTop',-1),('scrollTop',999),('clientHeight',0),
                            ('selectedBounds',{'left':17,'top':475,'right':373,'bottom':595}),
                            ('selectedBounds',{'left':17,'top':float('nan'),'right':373,'bottom':475}),
                            ('clientBounds',{'left':16,'top':210,'right':374,'bottom':500})]:
            changed=copy.deepcopy(item);changed['requestList'][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):request_list_state(changed)
        del item['requestList']
        with self.assertRaises(ValueError):request_list_state(item)

    def test_condition_property_witness_cannot_hide_stale_or_default_controls(self):
        edge={'id':'condition','label':'High','defaultBranch':False,
              'condition':{'mode':'ALL','predicates':[{'field':'payment.netTotal','operator':'GTE','currency':'CNY','threshold':12500}]}}
        definition={'schemaVersion':5,'id':'graph','version':2,'name':'Graph','edges':[edge]}
        observed={'definitionId':'graph','definitionVersion':2,'definitionName':'Graph','selectedKind':'edge',
                  'selectedId':'condition','edge':copy.deepcopy(edge)}
        item={'state':'designer-properties','designerDefinition':definition,'designerState':observed}
        designer_state(item)
        for field,value in [('selectedId','other'),('selectedKind','node'),('definitionVersion',1),
                            ('definitionName','Stale'),('edge',dict(edge,defaultBranch=True))]:
            altered=copy.deepcopy(item);altered['designerState'][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):designer_state(altered)
        altered=copy.deepcopy(item);altered['designerState']['edge']['condition']['predicates'][0]['threshold']=10000
        with self.assertRaises(ValueError):designer_state(altered)
    def test_complete_synthetic_evidence_fixture_fails_when_api_is_newer_than_display(self):
        # These generated pixels are unit-test fixtures only, never browser evidence.
        source='a'*40;backend='b'*64
        base={'sourceRevision':source,'sourceWorkingTree':'clean-commit','trackedDiffSHA256':sha(b''),
              'backendJarSHA256':backend,'uiSourceTreeSHA256':'c'*64,'captureSessionId':'s','captureRunId':'r'}
        journey=restart_receipt();base.update({k:journey[k] for k in ('captureSessionId','captureRunId','captureRunAttempt','captureRepository','captureRunUrl')})
        approved=journey['requests'][0];definition=approved['definition']
        default=copy.deepcopy(approved);default.update(id='default',forks=[],events=[],routes=[{'selectedEdgeId':'fallback'}])
        default['tasks'][-1]['completionMode']='ANY'
        rejected=copy.deepcopy(approved);rejected.update(id='rejected',status='REJECTED',events=[])
        rejected['tasks'][0]['status']='REJECTED';rejected['tasks'][1]['status']='CANCELLED'
        rejected['forks'][0].update(fired=False,arrivedBranchIds=[])
        waiting=copy.deepcopy(journey['restartWitness']['requestAfterReady'])
        active=copy.deepcopy(waiting)
        for task in active['tasks']:task.update(status='ACTIVE',votes=[])
        active['forks'][0]['arrivedBranchIds']=[];active['tasks'][1]['participants']=['carol']
        states={'designer':None,'designer-dense':None,'designer-properties':None,'default-approved':default,'waiting-join':waiting,'rejected':rejected,'approved':approved,
                'distinct-actors-active':active,'distinct-actors-completed':approved}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name,checkpoints,requests in [('graph-receipt.json',REQUIRED_CHECKPOINTS,[approved,default,rejected]),
                                              ('graph-recovery-receipt.json',RECOVERY_CHECKPOINTS,[approved])]:
                (root/name).write_text(json.dumps(dict(base,result='passed',realBackend=True,browser='Chromium',
                                                       checkpoints=list(checkpoints),requests=requests,restartWitness=journey['restartWitness'],capturedAt=journey['capturedAt'])))
            for state,locale,width in REQUIRED_SCREENSHOTS:
                request=states[state]
                displayed=None if request is None else {
                    'id':request['id'],'status':request['status'],'commandRevision':request['commandRevision'],
                    'definitionVersion':2,'activeTaskCount':sum(t['status']=='ACTIVE' for t in request['tasks']),
                    'tasks':[{'id':t['id'],'status':t['status'],'voteCount':len(t['votes'])} for t in request['tasks']],
                    'forks':[{k:f[k] for k in ['id','fired','arrivedBranchIds','expectedBranchIds']} for f in request['forks']]}
                name=f'graph-{state}-{locale}-{width}';data=png(width,2)
                (root/f'{name}.png').write_bytes(data)
                item=dict(base,scenario='graph-workflow',state=state,locale=locale,image=f'{name}.png',
                          imageSHA256=sha(data),viewport={'width':width,'height':2},scrollOrigin={'x':0,'y':0},
                          capturedAt='2026-10-12T01:02:30Z',request=None if request is None else {key:request[key] for key in ('id','status','commandRevision','definition','tasks','forks','routes','commands')},renderedState=displayed,designerDefinition=definition,
                          canvases=[{'scrollLeft':0,'scrollTop':0,
                          'clientWidth':width,'scrollWidth':width,'clientHeight':2,'scrollHeight':2,'visibleNodeIds':['financeFinal','start'],
                          'allNodeIds':['financeFinal','start'],'fullyVisibleNodeIds':['financeFinal','start'],'nodeHorizontalClipping':[],
                          'minimumNodeWidth':140,
                          'clientBounds':{'left':0,'top':0,'right':width,'bottom':2}}])
                if request is not None:
                    item['requestList']={'selectedId':request['id'],'scrollTop':0,'scrollHeight':2,'clientHeight':2,
                        'clientBounds':{'left':0,'top':0,'right':width,'bottom':2},
                        'selectedBounds':{'left':0,'top':0,'right':width,'bottom':2}}
                if state=='designer-properties':
                    item['canvases']=[]
                    item['designerState']={'definitionId':'graph','definitionVersion':2,'definitionName':'Graph',
                                           'selectedKind':'edge','selectedId':'condition','edge':definition['edges'][0]}
                (root/f'{name}.json').write_text(json.dumps(item))
            self.assertEqual(40,validate(root,source,backend))
            path=root/'graph-approved-en-1440.json';stale=json.loads(path.read_text())
            stale['renderedState'].update(status='PENDING',commandRevision=1)
            path.write_text(json.dumps(stale))
            with self.assertRaisesRegex(ValueError,'Screenshot DOM does not match'):
                validate(root,source,backend)

if __name__=='__main__':unittest.main()
