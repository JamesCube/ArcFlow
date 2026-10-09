#!/usr/bin/env python3
"""Disposable real HTTP/restart contract. No mocked server, browser, or external business system.

Run after packaging the declared backend:
  python3 examples/approval-demo/backend/scripts/verify-payment-contract-http.py \
    --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar

The script starts and stops only its own Java process with a new temporary data directory.
A supplementary runtime must be labeled with --runtime-label; that does not verify Boot 4.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

PAYMENT = {"type":"paymentRequest","documentVersion":1,"businessId":"PAY-HTTP-001","title":"Payment application","reason":"Synthetic invoice snapshots only","supplierRef":"SUPPLIER-DEMO-A","currency":"CNY","requestedPaymentOn":"2099-01-15","lines":[{"lineId":"line-1","invoiceRef":"INV-DEMO-01","description":"Synthetic equipment","invoiceAmount":10000,"previouslySettledAmount":4000,"allocationAmount":4500,"deductionAmount":500,"deductionReason":"Synthetic quality deduction"},{"lineId":"line-2","invoiceRef":"INV-DEMO-02","description":"Synthetic supplies","invoiceAmount":4000,"previouslySettledAmount":0,"allocationAmount":2500,"deductionAmount":0,"deductionReason":""}]}
CONTRACT = {"type":"contractApproval","documentVersion":1,"businessId":"CONTRACT-HTTP-001","title":"Internal contract review","reason":"Synthetic draft, no signature","customerRef":"CUSTOMER-DEMO-A","contractRevision":1,"contractCategory":"SERVICE","currency":"CNY","contractAmount":100000,"startOn":"2099-01-01","endOn":"2099-12-31","termsKind":"NONSTANDARD","deviationReason":"Synthetic liability limit deviation","documentRef":"DOC-CONTRACT-DEMO-01","lines":[{"lineId":"line-1","milestoneRef":"M1","description":"Proposal","dueOn":"2099-01-15","amount":30000,"acceptanceCriteria":"Proposal delivered and confirmed"},{"lineId":"line-2","milestoneRef":"M2","description":"Interim delivery","dueOn":"2099-06-30","amount":40000,"acceptanceCriteria":"Interim acceptance"},{"lineId":"line-3","milestoneRef":"M3","description":"Final delivery","dueOn":"2099-12-15","amount":30000,"acceptanceCriteria":"Final acceptance"}]}
IDS = ["crm-contract","erp-payment","erp-receiving","oa-expense","oa-seal-use","oa-travel"]

class Backend:
    def __init__(self, jar, java, directory):
        self.jar, self.java, self.directory = jar, java, directory
        self.process = None
        self.log = None
        self.http_count = 0
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            self.port = reserve.getsockname()[1]
        self.base = f"http://127.0.0.1:{self.port}"
        # No environment HTTP proxy is involved in local functional verification.
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def start(self):
        self.log = (self.directory / "backend.log").open("ab")
        env = dict(os.environ)
        env.update({f"APPROVAL_{actor.upper()}_PASSWORD": f"http-test-{actor}-password" for actor in ("alice","bob","carol")})
        self.process = subprocess.Popen([self.java,"-jar",str(self.jar),f"--server.port={self.port}","--server.address=127.0.0.1",f"--approval.data-file={self.directory / 'state.json'}"],cwd=self.directory,env=env,stdout=self.log,stderr=subprocess.STDOUT)
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            if self.process.poll() is not None:
                raise AssertionError("Backend exited before readiness: " + (self.directory / "backend.log").read_text())
            try:
                self.request("GET","/api/scenarios",expected=200)
                return
            except (OSError, AssertionError):
                time.sleep(.2)
        raise AssertionError("Backend readiness timeout")
    def stop(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try: self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill(); self.process.wait(timeout=10)
        if self.log: self.log.close()
    def request(self, method, path, body=None, actor="alice", key=None, expected=200, raw=None, client=True):
        assert path.startswith("/api/"), path
        headers={"Accept":"application/json"}
        if actor:
            headers["Authorization"]="Basic "+base64.b64encode(f"{actor}:http-test-{actor}-password".encode()).decode()
        if client: headers["X-Arcflow-Client"]="approval-demo"
        if key is not None: headers["Idempotency-Key"]=key
        payload = raw.encode() if raw is not None else None if body is None else json.dumps(body,separators=(",",":")).encode()
        if payload is not None: headers["Content-Type"]="application/json"
        request=urllib.request.Request(self.base+path,data=payload,headers=headers,method=method)
        self.http_count += 1
        try:
            with self.client.open(request,timeout=15) as response: status,data=response.status,response.read()
        except urllib.error.HTTPError as error: status,data=error.code,error.read()
        assert status==expected,(method,path,expected,status,data.decode(errors="replace"))
        return json.loads(data) if data else None
    def submit(self, scenario, business, key, version=1, expected=201):
        return self.request("POST",f"/api/scenarios/{scenario}/documents",{"business":business,"processVersion":version},key=key,expected=expected)
    def vote(self, scenario, id, actor, step, decision="APPROVE", comment="Synthetic opinion", expected=200):
        return self.request("POST",f"/api/scenarios/{scenario}/requests/{id}/decisions",{"stepId":step,"decision":decision,"comment":comment},actor=actor,expected=expected)

def check(backend):
    assert [entry["id"] for entry in backend.request("GET","/api/scenarios")]==IDS
    payment=backend.submit("erp-payment",PAYMENT,"payment-key")
    contract=backend.submit("crm-contract",CONTRACT,"contract-key")
    assert set(payment)=={"request","total","paymentSummary"}
    assert payment["total"]=="6500.00"
    assert payment["paymentSummary"]=={"type":"paymentRequest","declaredOutstanding":"10000.00","grossAllocation":"7000.00","deductionTotal":"500.00","netTotal":"6500.00"}
    assert set(contract)=={"request","total"} and contract["total"]=="100000.00"
    for scenario,document in (("erp-payment",PAYMENT),("crm-contract",CONTRACT)):
        path=f"/api/scenarios/{scenario}"
        backend.request("GET",path+"/requests",actor=None,expected=401)
        backend.request("POST",path+"/documents",{"business":document,"processVersion":1},key="no-client",client=False,expected=403)
        backend.request("POST",path+"/documents",{"business":document,"processVersion":1},expected=400)
        for other in IDS:
            if other!=scenario: backend.submit(other,document,"cross-host",expected=400)
        backend.request("POST","/api/documents",{"business":document,"processVersion":1},key="generic-rejected",expected=400)
        raw=json.dumps({"business":document,"processVersion":1},separators=(",",":"))
        backend.request("POST",path+"/documents",key="duplicate",raw=raw.replace('"documentVersion":1','"documentVersion":1,"documentVersion":1'),expected=400)
        changed=copy.deepcopy(document);changed["total"]=1
        backend.submit(scenario,changed,"derived-forgery",expected=400)
    for field,value in (("allocationAmount",6001),("deductionAmount",4501),("previouslySettledAmount",10001),("invoiceAmount","10000"),("deductionReason","")):
        changed=copy.deepcopy(PAYMENT);changed["lines"][0][field]=value
        backend.submit("erp-payment",changed,"invalid-payment",expected=400)
    for field,value in (("contractAmount",100000.01),("contractAmount",99999.99),("contractRevision",0),("termsKind","STANDARD"),("deviationReason","")):
        changed=copy.deepcopy(CONTRACT);changed[field]=value
        backend.submit("crm-contract",changed,"invalid-contract",expected=400)
    changed=copy.deepcopy(CONTRACT);changed["lines"][1]["dueOn"]="2099-01-01"
    backend.submit("crm-contract",changed,"invalid-contract",expected=400)
    p,c=payment["request"]["id"],contract["request"]["id"]
    backend.vote("crm-contract",p,"bob","payment-check",expected=404)
    backend.vote("erp-payment",c,"bob","commercial-review",expected=404)
    backend.vote("erp-payment",p,"alice","payment-check",expected=403)
    backend.vote("erp-payment",p,"bob","payment-final",expected=409)
    first=backend.vote("erp-payment",p,"bob","payment-check",comment="Original ALL opinion")
    assert first["request"]["currentStepId"]=="payment-check" and len(first["request"]["history"])==2
    assert backend.vote("erp-payment",p,"bob","payment-check",comment="Never overwrite")==first
    assert backend.submit("erp-payment",PAYMENT,"payment-key")==first
    backend.vote("erp-payment",p,"bob","payment-check","REJECT",expected=409)
    # Publication changes the next request, not either saved business/definition snapshot.
    publication=copy.deepcopy(contract["request"]["definition"])
    publication["name"]="Contract review with final ANY"
    publication["nodes"].insert(-1,{"id":"contract-final","type":"parallelApproval","name":"Final review","assigneeId":None,"assigneeIds":["bob","carol"],"completionMode":"ANY"})
    backend.request("POST","/api/scenarios/crm-contract/process",{"expectedVersion":1,"definition":publication},actor="bob",expected=403)
    backend.request("POST","/api/scenarios/crm-contract/process",{"expectedVersion":1,"definition":publication})
    backend.submit("crm-contract",CONTRACT,"fresh-stale",expected=409)
    newer=backend.submit("crm-contract",CONTRACT,"contract-v2",version=2)
    assert newer["request"]["processVersion"]==2
    first_contract=backend.vote("crm-contract",c,"bob","commercial-review",comment="Original commercial opinion")
    assert first_contract["request"]["currentStepId"]=="contract-review"
    # Close and reopen the actual JVM after partial votes and publication.
    backend.stop();backend.start()
    assert backend.submit("erp-payment",PAYMENT,"payment-key")==first
    assert backend.submit("crm-contract",CONTRACT,"contract-key")==first_contract
    assert backend.vote("erp-payment",p,"carol","payment-check")["request"]["currentStepId"]=="payment-final"
    assert backend.vote("erp-payment",p,"bob","payment-final","REJECT")["request"]["status"]=="PENDING"
    paid_review=backend.vote("erp-payment",p,"carol","payment-final")
    assert paid_review["request"]["status"]=="APPROVED" and len(paid_review["request"]["history"])==5
    assert paid_review["request"]["business"]==payment["request"]["business"] and paid_review["paymentSummary"]==payment["paymentSummary"]
    assert backend.vote("crm-contract",c,"bob","contract-review")["request"]["status"]=="PENDING"
    rejected=backend.vote("crm-contract",c,"carol","contract-review","REJECT")
    assert rejected["request"]["status"]=="REJECTED" and rejected["request"]["definition"]==contract["request"]["definition"]
    assert len(rejected["request"]["history"])==4
    new_id=newer["request"]["id"]
    for actor,step in (("bob","commercial-review"),("bob","contract-review"),("carol","contract-review")): backend.vote("crm-contract",new_id,actor,step)
    assert backend.vote("crm-contract",new_id,"bob","contract-final","REJECT")["request"]["status"]=="PENDING"
    approved=backend.vote("crm-contract",new_id,"carol","contract-final")
    assert approved["request"]["status"]=="APPROVED" and len(approved["request"]["history"])==6
    # Both rejection rules have their own real request, no fabricated votes.
    veto=backend.submit("erp-payment",PAYMENT,"payment-all-veto")["request"]["id"]
    assert backend.vote("erp-payment",veto,"bob","payment-check","REJECT")["request"]["status"]=="REJECTED"
    backend.vote("erp-payment",veto,"carol","payment-check",expected=409)
    all_no=backend.submit("erp-payment",PAYMENT,"payment-any-all-no")["request"]["id"]
    for actor in ("bob","carol"): backend.vote("erp-payment",all_no,actor,"payment-check")
    assert backend.vote("erp-payment",all_no,"bob","payment-final","REJECT")["request"]["status"]=="PENDING"
    assert backend.vote("erp-payment",all_no,"carol","payment-final","REJECT")["request"]["status"]=="REJECTED"
    backend.stop();backend.start()
    assert backend.submit("erp-payment",PAYMENT,"payment-key")==paid_review
    assert backend.submit("crm-contract",CONTRACT,"contract-key")==rejected
    assert backend.submit("crm-contract",CONTRACT,"contract-v2",2)==approved
    for scenario,document,key,version in (("erp-payment",PAYMENT,"payment-key",1),("crm-contract",CONTRACT,"contract-key",1)):
        changed=copy.deepcopy(document);changed["title"]="Changed after terminal"
        backend.submit(scenario,changed,key,version,expected=409)
        backend.submit(scenario,document,key,version+1,expected=409)
    for scenario,schema in (("erp-payment",11),("crm-contract",12)):
        state=json.loads((backend.directory/f"state.json.scenario-{scenario}.json").read_text())
        assert state["schemaVersion"]==schema
    assert backend.request("GET","/api/requests")==[]
    return {"httpAttemptsIncludingReadiness":backend.http_count,"restarts":2,"paymentSummary":payment["paymentSummary"],"contractV1":"REJECTED","contractV2":"APPROVED","paymentAllAny":"APPROVED","externalBusinessCalls":"No external business endpoint is configured or used by this smoke harness."}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar",type=Path,required=True)
    parser.add_argument("--java",default="java")
    parser.add_argument("--runtime-label",default="declared Boot 4.1.1")
    parser.add_argument("--report",type=Path)
    args=parser.parse_args();jar=args.jar.resolve();assert jar.is_file(),jar
    with zipfile.ZipFile(jar) as archive:
        boot_libraries=sorted(Path(name).name for name in archive.namelist() if name.startswith("BOOT-INF/lib/spring-boot-") and name.endswith(".jar"))
    if args.runtime_label=="declared Boot 4.1.1": assert "spring-boot-4.1.1.jar" in boot_libraries,boot_libraries
    with tempfile.TemporaryDirectory(prefix="arcflow-payment-contract-http-") as temporary:
        backend=Backend(jar,args.java,Path(temporary))
        try:
            backend.start();report=check(backend)
            report.update(runtime=args.runtime_label,jarSha256=hashlib.sha256(jar.read_bytes()).hexdigest(),springBootLibraries=boot_libraries)
            if args.report: args.report.write_text(json.dumps(report,indent=2)+"\n")
            print(json.dumps(report,indent=2))
        except Exception:
            print((Path(temporary)/"backend.log").read_text(errors="replace"))
            raise
        finally: backend.stop()

if __name__=="__main__": main()
