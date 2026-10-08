#!/usr/bin/env python3
"""Run the packaged local backend with throwaway credentials; exercise real HTTP and restart."""
import argparse, base64, json, os, pathlib, secrets, socket, subprocess, tempfile, time, urllib.error, urllib.request

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--jar', required=True, type=pathlib.Path)
    parser.add_argument('--java', default='java')
    parser.add_argument('--inbox', action='store_true', help='Also verify isolation from the integrated member inbox')
    args = parser.parse_args()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    passwords = {actor: secrets.token_urlsafe(24) for actor in ('alice', 'bob', 'carol')}
    environment = dict(os.environ, **{f'APPROVAL_{actor.upper()}_PASSWORD': value for actor, value in passwords.items()})
    count = 0
    def call(actor, method, path, body=None, expected=200, extra=None):
        nonlocal count
        headers = {'Authorization': 'Basic ' + base64.b64encode(f'{actor}:{passwords[actor]}'.encode()).decode(), 'X-Arcflow-Client': 'approval-demo'}
        if extra: headers.update(extra)
        if body is not None: headers['Content-Type'] = 'application/json'
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=5) as response: status, payload = response.status, response.read()
        except urllib.error.HTTPError as error: status, payload = error.code, error.read()
        assert status == expected, (method, path, status, expected, payload.decode())
        count += 1
        return json.loads(payload) if payload else None
    with tempfile.TemporaryDirectory(prefix='arcflow-crm-http-') as temporary:
        root = pathlib.Path(temporary)
        def start():
            log = (root / 'server.log').open('ab')
            process = subprocess.Popen([args.java, '-jar', str(args.jar.resolve()), f'--server.port={port}', '--server.address=127.0.0.1', f'--approval.data-file={root / "state.json"}'], env=environment, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None: raise RuntimeError('Local server exited: ' + (root / 'server.log').read_text())
                try:
                    call('alice', 'GET', '/api/me'); return process, log
                except urllib.error.URLError: time.sleep(.1)
            process.terminate(); process.wait(timeout=10); raise RuntimeError('Local server did not become ready')
        def stop(process, log):
            process.terminate(); process.wait(timeout=15); log.close()
        process, log = start()
        try:
            quote = call('alice', 'GET', '/api/crm/quotes')[0]
            process_definition = call('alice', 'GET', '/api/crm/process')
            assert [step['assigneeId'] for step in process_definition['nodes'][1:-1]] == ['bob','carol']
            business = {'type':'quoteDiscount','businessId':quote['businessId'],'title':'设备报价折扣申请','reason':'十套设备的合成报价','customerRef':quote['customerRef'],'quoteRevision':quote['revision'],'item':quote['item'],'quantity':quote['quantity'],'listUnitPrice':quote['listUnitPrice'],'requestedUnitPrice':850.00,'currency':quote['currency'],'validUntil':quote['validUntil']}
            body={'business':business,'processVersion':1}
            original=call('alice','POST','/api/crm/documents',body,201)
            assert (original['requestedTotal'],original['reductionTotal'],original['discountPercent']) == ('8500.00','1500.00','15')
            assert original == call('alice','POST','/api/crm/documents',body,201)
            if args.inbox:
                assert call('bob','GET','/api/requests/inbox?box=PENDING')['items']==[]
                assert call('carol','GET','/api/requests/inbox?box=PENDING')['items']==[]
            call('alice','POST','/api/crm/documents',dict(body,business=dict(business,requestedUnitPrice=800)),409)
            call('alice','POST','/api/crm/documents',dict(body,business=dict(business,listUnitPrice=1100)),409)
            call('alice','POST','/api/crm/documents',dict(body,business=dict(business,customerRef='OTHER')),409)
            call('alice','POST','/api/crm/documents',dict(body,business=dict(business,quoteRevision=2)),404)
            call('bob','POST','/api/crm/documents',body,403)
            call('alice','POST','/api/documents',body,400)
            call('alice','POST','/api/crm/documents',body,400,{'Idempotency-Key':'not-supported-by-host'})
            id=original['request']['id']; path=f'/api/crm/requests/{id}/decisions'
            call('carol','POST',path,{'stepId':'finance','decision':'APPROVE','comment':''},409)
            call('alice','POST',path,{'stepId':'salesManager','decision':'APPROVE','comment':''},403)
            first=call('bob','POST',path,{'stepId':'salesManager','decision':'APPROVE','comment':'Sales review'})
            assert first['request']['status']=='PENDING'
            if args.inbox:
                assert call('carol','GET','/api/requests/inbox?box=PENDING')['items']==[]
                assert call('bob','GET','/api/requests/inbox?box=HANDLED')['items']==[]
            approved=call('carol','POST',path,{'stepId':'finance','decision':'APPROVE','comment':'Finance review'})
            assert approved['request']['status']=='APPROVED'; assert approved['request']['business']==original['request']['business']
            assert len(approved['request']['history'])==3
            call('carol','POST',path,{'stepId':'finance','decision':'REJECT','comment':''},409)
            assert call('alice','GET','/api/requests')==[]
            if args.inbox:
                assert call('bob','GET','/api/requests/inbox?box=PENDING')['items']==[]
                assert call('carol','GET','/api/requests/inbox?box=HANDLED')['items']==[]
            legacy=call('alice','POST','/api/requests',{'title':'Leave','reason':'Rest','days':2,'processVersion':1},201)
            assert 'business' not in legacy
            if args.inbox:
                assert [r['id'] for r in call('bob','GET','/api/requests/inbox?box=PENDING')['items']]==[legacy['id']]
        finally: stop(process,log)
        process,log=start()
        try:
            assert call('alice','POST','/api/crm/documents',body,201)==approved
            assert call('bob','GET','/api/crm/requests')==[approved]
            assert len(call('alice','GET','/api/requests'))==1
            if args.inbox:
                assert [r['id'] for r in call('bob','GET','/api/requests/inbox?box=PENDING')['items']]==[legacy['id']]
            state=json.loads((root/'state.json.quotes.json').read_text()); assert state['schemaVersion']==6
            assert len(state['requests'])==len(state['submissions'])==1
        finally: stop(process,log)
    print(json.dumps({'status':'PASS','http_checks':count,'backend':'packaged Spring Boot, real localhost HTTP','restart':True,'synthetic_only':True,'external_calls':False,'browser':'NOT RUN','generic_inbox_isolation_checked':args.inbox},indent=2))
if __name__ == '__main__': main()
