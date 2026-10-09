#!/usr/bin/env python3
"""Travel approval on a disposable real backend. Synthetic data; no external integration."""
import argparse, base64, copy, json, os, pathlib, secrets, socket, subprocess, tempfile, time, urllib.error, urllib.request


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--jar',required=True,type=pathlib.Path)
    parser.add_argument('--java',default='java')
    args=parser.parse_args()
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1',0)); port=reserve.getsockname()[1]
    base=f'http://127.0.0.1:{port}'; route='/api/scenarios/oa-travel'; expense='/api/scenarios/oa-expense'
    passwords={actor:secrets.token_urlsafe(24) for actor in ('alice','bob','carol')}
    env=dict(os.environ,**{f'APPROVAL_{a.upper()}_PASSWORD':p for a,p in passwords.items()})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({})); count=0
    def call(actor,method,path,body=None,expected=200,key=None):
        nonlocal count
        headers={'Authorization':'Basic '+base64.b64encode(f'{actor}:{passwords[actor]}'.encode()).decode(),'X-Arcflow-Client':'approval-demo'}
        if key is not None: headers['Idempotency-Key']=key
        if body is not None: headers['Content-Type']='application/json'
        req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
        try:
            with opener.open(req,timeout=5) as response: status,payload=response.status,response.read()
        except urllib.error.HTTPError as error: status,payload=error.code,error.read()
        assert status==expected,(method,path,status,expected,payload.decode())
        count+=1; return json.loads(payload) if payload else None
    with tempfile.TemporaryDirectory(prefix='arcflow-travel-http-') as temporary:
        root=pathlib.Path(temporary); process=None; log=None
        def stop():
            nonlocal process,log
            if process is not None:
                process.terminate()
                try: process.wait(timeout=15)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
                process=None
            if log is not None: log.close(); log=None
        def start():
            nonlocal process,log
            log=(root/'server.log').open('ab')
            process=subprocess.Popen([args.java,'-jar',str(args.jar.resolve()),f'--server.port={port}','--server.address=127.0.0.1',f'--approval.data-file={root / "state.json"}'],env=env,stdout=log,stderr=subprocess.STDOUT)
            deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                if process.poll() is not None: raise RuntimeError('Disposable backend exited before readiness')
                try: call('alice','GET','/api/me'); return
                except urllib.error.URLError: time.sleep(.1)
            raise RuntimeError('Disposable backend did not become ready')
        try:
            start(); catalog=call('alice','GET','/api/scenarios')
            assert [item['id'] for item in catalog]==['erp-receiving','oa-expense','oa-seal-use','oa-travel']
            assert catalog[1]['lineItems']['maxItems']==20 and catalog[3]['lineItems'] is None
            definition=call('alice','GET',route+'/process'); assert definition['id']=='oa-travel'
            body={'business':{'type':'travel','documentVersion':1,'businessId':'TRAVEL-HTTP-001','title':'Synthetic project delivery trip',
                'reason':'Demonstration itinerary and budget only','destination':' Shanghai ','startDate':'2028-02-28','endDate':'2028-03-01',
                'purpose':'PROJECT_DELIVERY','estimatedCost':2800.29,'currency':'CNY','costCenter':'ENGINEERING'},'processVersion':1}
            original=call('alice','POST',route+'/documents',body,201,'travel-http')
            assert original['total']=='2800.29' and original['request']['days']==0
            assert original['request']['business']['destination']=='Shanghai' and 'durationDays' not in original['request']['business']
            assert original==call('alice','POST',route+'/documents',body,201,'travel-http')
            for path in ['/api/requests','/api/crm/requests',expense+'/requests']: assert call('alice','GET',path)==[]
            assert call('bob','GET','/api/requests/inbox?box=PENDING')['items']==[]
            call('alice','POST','/api/documents',body,400,'travel-http')
            call('alice','POST',expense+'/documents',body,400,'travel-http')
            call('alice','POST',route+'/documents',body,400)
            for field,value in [('startDate','2026-02-29'),('startDate','0000-01-01'),('endDate','2028-02-27'),
                    ('endDate','2028-06-01'),('destination','\x00'),('purpose','HOLIDAY'),('estimatedCost',.001),
                    ('estimatedCost',0),('estimatedCost',1000000000.01),('estimatedCost','2800.29'),('currency','BTC'),
                    ('currency','JPY'),('durationDays',3),('costCenter','UNKNOWN')]:
                invalid=copy.deepcopy(body); invalid['business'][field]=value
                call('alice','POST',route+'/documents',invalid,400,'bad-'+field)
            for field,value in [('destination','Beijing'),('startDate','2028-02-29'),('endDate','2028-03-02'),
                    ('purpose','TRAINING'),('estimatedCost',2800.30),('currency','USD'),('costCenter','SALES')]:
                changed=copy.deepcopy(body); changed['business'][field]=value
                call('alice','POST',route+'/documents',changed,409,'travel-http')
            id=original['request']['id']; decision=route+'/requests/'+id+'/decisions'
            for path in [expense+'/requests/'+id+'/decisions','/api/requests/'+id+'/decisions']:
                call('bob','POST',path,{'stepId':'tripReview','decision':'APPROVE','comment':''},404)
            call('carol','POST',decision,{'stepId':'budget','decision':'APPROVE','comment':''},409)
            call('alice','POST',decision,{'stepId':'tripReview','decision':'APPROVE','comment':''},403)
            intermediate=call('bob','POST',decision,{'stepId':'tripReview','decision':'APPROVE','comment':'Reviewed synthetic itinerary'})
            assert intermediate['request']['status']=='PENDING'
            publication=copy.deepcopy(definition); publication['name']='Updated synthetic travel review'
            call('bob','POST',route+'/process',{'expectedVersion':1,'definition':publication},403)
            assert call('alice','POST',route+'/process',{'expectedVersion':1,'definition':publication})['version']==2
            assert call('alice','GET',expense+'/process')['version']==1
            call('alice','POST',route+'/documents',body,409,'stale-new-intent')
            approved=call('carol','POST',decision,{'stepId':'budget','decision':'APPROVE','comment':'Budget review; no booking or payment'})
            assert approved['request']['status']=='APPROVED' and approved['request']['definition']==definition
            assert approved['request']['business']==original['request']['business'] and len(approved['request']['history'])==3
            other=copy.deepcopy(body); other['business']['businessId']='TRAVEL-HTTP-002'; other['processVersion']=2
            other['business'].update(startDate='9999-12-31',endDate='9999-12-31',currency='JPY',estimatedCost=1000000000)
            created=call('alice','POST',route+'/documents',other,201,'travel-reject'); assert created['total']=='1000000000'
            rejected=call('bob','POST',route+'/requests/'+created['request']['id']+'/decisions',{'stepId':'tripReview','decision':'REJECT','comment':'Synthetic alternate rejection branch'})
            assert rejected['request']['status']=='REJECTED'
            stop(); start()
            assert approved==call('alice','POST',route+'/documents',body,201,'travel-http')
            assert rejected==call('alice','POST',route+'/documents',other,201,'travel-reject')
            assert len(call('alice','GET',route+'/requests'))==2
            assert call('alice','GET',expense+'/requests')==[]
            state=json.loads((root/'state.json.scenario-oa-travel.json').read_text())
            assert state['schemaVersion']==8 and len(state['submissions'])==2
            print(f'Travel real-HTTP smoke passed: {count} authenticated checks, exact budget, dates, approval/rejection, isolation and restart.')
        finally: stop()


if __name__=='__main__': main()
