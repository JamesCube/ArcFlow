#!/usr/bin/env python3
"""Run expense approval on a disposable real backend, including restart. No external integration."""
import argparse, base64, copy, json, os, pathlib, secrets, socket, subprocess, tempfile, time, urllib.error, urllib.request


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--jar',required=True,type=pathlib.Path)
    parser.add_argument('--java',default='java')
    args=parser.parse_args()
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1',0)); port=reserve.getsockname()[1]
    base=f'http://127.0.0.1:{port}'; route='/api/scenarios/oa-expense'
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
    with tempfile.TemporaryDirectory(prefix='arcflow-expense-http-') as temporary:
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
            start(); catalog=call('alice','GET','/api/scenarios'); expense=next(item for item in catalog if item['id']=='oa-expense'); assert expense['lineItems']['maxItems']==20
            definition=call('alice','GET',route+'/process'); assert definition['id']=='oa-expense'
            body={'business':{'type':'expense','documentVersion':1,'businessId':'EXP-HTTP-001','title':'Synthetic office expenses','reason':'Demonstration receipt references only','costCenter':'ENGINEERING','currency':'CNY','lines':[
                {'lineId':'line-1','spentOn':'2026-10-01','category':'OFFICE','description':'Demo supplies','amount':.1,'receiptRef':'R-HTTP-1'},
                {'lineId':'line-2','spentOn':'2026-10-02','category':'TRAVEL','description':'Demo transit','amount':.2,'receiptRef':'R-HTTP-2'}]},'processVersion':1}
            original=call('alice','POST',route+'/documents',body,201,'expense-http'); assert original['total']=='0.30'
            assert original==call('alice','POST',route+'/documents',body,201,'expense-http')
            assert call('alice','GET','/api/requests')==[]
            assert call('bob','GET','/api/requests/inbox?box=PENDING')['items']==[]
            assert call('alice','GET','/api/crm/requests')==[]
            call('alice','POST','/api/documents',body,400,'expense-http'); call('alice','POST',route+'/documents',body,400)
            changed=copy.deepcopy(body); changed['business']['lines'][0]['amount']=.11; call('alice','POST',route+'/documents',changed,409,'expense-http')
            for field,value in [('spentOn','2026-02-30'),('description','\x00')]:
                invalid=copy.deepcopy(body); invalid['business']['lines'][0][field]=value; call('alice','POST',route+'/documents',invalid,400,'bad-'+field)
            decision=route+'/requests/'+original['request']['id']+'/decisions'
            call('carol','POST',decision,{'stepId':'finance','decision':'APPROVE','comment':''},409)
            call('alice','POST',decision,{'stepId':'manager','decision':'APPROVE','comment':''},403)
            intermediate=call('bob','POST',decision,{'stepId':'manager','decision':'APPROVE','comment':'Reviewed synthetic references'}); assert intermediate['request']['status']=='PENDING'
            next_definition=copy.deepcopy(definition); next_definition['name']='Updated synthetic expense review'
            assert call('alice','POST',route+'/process',{'expectedVersion':1,'definition':next_definition})['version']==2
            call('alice','POST',route+'/documents',body,409,'stale-new-intent')
            approved=call('carol','POST',decision,{'stepId':'finance','decision':'APPROVE','comment':'No payment is issued'})
            assert approved['request']['status']=='APPROVED' and approved['request']['definition']==definition
            assert approved['request']['business']==original['request']['business'] and len(approved['request']['history'])==3
            other=copy.deepcopy(body); other['business']['businessId']='EXP-HTTP-002'; other['processVersion']=2
            created=call('alice','POST',route+'/documents',other,201,'expense-reject')
            rejected=call('bob','POST',route+'/requests/'+created['request']['id']+'/decisions',{'stepId':'manager','decision':'REJECT','comment':'Synthetic alternate rejection branch'}); assert rejected['request']['status']=='REJECTED'
            stop(); start()
            assert approved==call('alice','POST',route+'/documents',body,201,'expense-http')
            assert rejected==call('alice','POST',route+'/documents',other,201,'expense-reject')
            assert len(call('alice','GET',route+'/requests'))==2
            state=json.loads((root/'state.json.scenario-oa-expense.json').read_text()); assert state['schemaVersion']==7 and len(state['submissions'])==2
            print(f'Expense real-HTTP smoke passed: {count} authenticated checks, exact money, approval/rejection, isolation and restart.')
        finally: stop()


if __name__=='__main__': main()
