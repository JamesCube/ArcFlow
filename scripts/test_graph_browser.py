import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib
from verify_graph_browser import (REQUIRED_CHECKPOINTS, RECOVERY_CHECKPOINTS, REQUIRED_STATES,
                                  canvas_state, png_dimensions, provenance, rendered_state, sha, validate)


def png(width=2, height=2):
    def chunk(kind,body):
        return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff\xff\xff'*width)*height))+chunk(b'IEND',b'')

class GraphBrowserEvidenceTests(unittest.TestCase):
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
        item={'viewport':{'width':390},'canvases':[{'scrollLeft':0,'scrollTop':0,'clientWidth':350,
              'scrollWidth':800,'clientHeight':900,'scrollHeight':900,'visibleNodeIds':['start','left']}]}
        canvas_state(item) # A narrow viewport can honestly expose only part of a horizontally browsable graph.
        for field,value in [('scrollLeft',200),('scrollTop',300),('clientWidth',400),('scrollWidth',200),
                            ('clientHeight',0),('visibleNodeIds',[]),('visibleNodeIds',['left','left'])]:
            changed=copy.deepcopy(item);changed['canvases'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):canvas_state(changed)
        with self.assertRaisesRegex(ValueError,'Missing visible graph canvas evidence'):
            canvas_state({'viewport':{'width':390}})
    def test_complete_synthetic_evidence_fixture_fails_when_api_is_newer_than_display(self):
        # These generated pixels are unit-test fixtures only, never browser evidence.
        source='a'*40;backend='b'*64
        base={'sourceRevision':source,'sourceWorkingTree':'clean-commit','trackedDiffSHA256':sha(b''),
              'backendJarSHA256':backend,'uiSourceTreeSHA256':'c'*64,'captureSessionId':'s','captureRunId':'r'}
        approved={'id':'joined','status':'APPROVED','commandRevision':2,'commands':[{},{}],
                  'definition':{'schemaVersion':5,'version':1},
                  'tasks':[{'id':'a','status':'COMPLETED','votes':[{}],'participants':['bob']},
                           {'id':'b','status':'COMPLETED','votes':[{}],'participants':['carol']}],
                  'forks':[{'id':'fork','joinId':'join','fired':True,'arrivedBranchIds':['left','right'],
                            'expectedBranchIds':['left','right']}],
                  'events':[{'type':'JOIN_FIRED','nodeId':'join'}]}
        default=copy.deepcopy(approved);default.update(id='default',forks=[],events=[])
        rejected=copy.deepcopy(approved);rejected.update(id='rejected',status='REJECTED',events=[])
        rejected['tasks'][0]['status']='REJECTED';rejected['tasks'][1]['status']='CANCELLED'
        rejected['forks'][0].update(fired=False,arrivedBranchIds=[])
        waiting=copy.deepcopy(approved);waiting.update(status='PENDING',events=[])
        waiting['tasks'][1].update(status='ACTIVE',votes=[]);waiting['forks'][0].update(fired=False,arrivedBranchIds=['left'])
        active=copy.deepcopy(waiting)
        for task in active['tasks']:task.update(status='ACTIVE',votes=[])
        active['forks'][0]['arrivedBranchIds']=[]
        states={'designer':None,'waiting-join':waiting,'rejected':rejected,'approved':approved,
                'distinct-actors-active':active,'distinct-actors-completed':approved}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name,checkpoints,requests in [('graph-receipt.json',REQUIRED_CHECKPOINTS,[approved,default,rejected]),
                                              ('graph-recovery-receipt.json',RECOVERY_CHECKPOINTS,[approved])]:
                (root/name).write_text(json.dumps(dict(base,result='passed',realBackend=True,browser='Chromium',
                                                       checkpoints=list(checkpoints),requests=requests)))
            for state in REQUIRED_STATES:
                request=states[state]
                displayed=None if request is None else {
                    'id':request['id'],'status':request['status'],'commandRevision':request['commandRevision'],
                    'definitionVersion':1,'activeTaskCount':sum(t['status']=='ACTIVE' for t in request['tasks']),
                    'tasks':[{'id':t['id'],'status':t['status'],'voteCount':len(t['votes'])} for t in request['tasks']],
                    'forks':[{k:f[k] for k in ['id','fired','arrivedBranchIds','expectedBranchIds']} for f in request['forks']]}
                for locale in ['en','zh']:
                    for width in [390,1440]:
                        name=f'graph-{state}-{locale}-{width}';data=png(width,2)
                        (root/f'{name}.png').write_bytes(data)
                        item=dict(base,scenario='graph-workflow',state=state,locale=locale,image=f'{name}.png',
                                  imageSHA256=sha(data),viewport={'width':width,'height':2},scrollOrigin={'x':0,'y':0},
                                  request=request,renderedState=displayed,canvases=[{'scrollLeft':0,'scrollTop':0,
                                  'clientWidth':width,'scrollWidth':width,'clientHeight':2,'scrollHeight':2,'visibleNodeIds':['start']}])
                        (root/f'{name}.json').write_text(json.dumps(item))
            self.assertEqual(24,validate(root,source,backend))
            path=root/'graph-approved-en-1440.json';stale=json.loads(path.read_text())
            stale['renderedState'].update(status='PENDING',commandRevision=1)
            path.write_text(json.dumps(stale))
            with self.assertRaisesRegex(ValueError,'Screenshot DOM does not match'):
                validate(root,source,backend)

if __name__=='__main__':unittest.main()
