#!/usr/bin/env python3
"""Synthetic typed-document HTTP contract for the review-only mobile client.

Creates an isolated loopback backend using the existing mobile HTTP harness.
Does not launch a browser or add a document-writing path to the mobile app.
"""
import argparse
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location("mobile_http", Path(__file__).with_name("verify-http.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def verify(suite):
    suite.start()
    version = suite.request("/process")["version"]
    legacy = suite.submit(version)
    business = {
        "type": "procurement", "businessId": "PO-SYNTHETIC-001",
        "title": "Synthetic mobile procurement", "reason": "No actual purchase or payment",
        "item": "Synthetic equipment", "quantity": 3, "unitPrice": 199.99, "currency": "CNY",
    }
    body = {"processVersion": version, "business": business}
    suite.request("/documents", user=None, body=body, expected=401)
    suite.request("/documents", body=body, expected=403, headers={"X-Arcflow-Client": None})
    purchase = suite.request("/documents", body=body, expected=201)
    suite.check(purchase["business"] == business, "Typed immutable business fields changed")
    suite.check(purchase["days"] == 0 and purchase["title"] == business["title"] and
                purchase["reason"] == business["reason"], "Compatibility projection is inconsistent")
    total = Decimal(str(purchase["business"]["unitPrice"])) * purchase["business"]["quantity"]
    suite.check(total == Decimal("599.97"), "Exact procurement total changed")
    typed_leave = suite.request("/documents", body={"processVersion": version, "business": {
        "type": "leave", "businessId": "LEAVE-SYNTHETIC-001", "title": "Synthetic typed leave",
        "reason": "Synthetic test", "days": 2,
    }}, expected=201)
    suite.check(typed_leave["days"] == typed_leave["business"]["days"] == 2,
                "Typed leave projection differs")
    suite.check("business" not in legacy, "Legacy leave shape changed")
    rows = suite.request("/requests", "bob")
    suite.check({row["id"] for row in rows} == {legacy["id"], purchase["id"], typed_leave["id"]},
                "Approver mixed business list is incomplete")
    suite.vote(purchase, "alice", expected=403)
    suite.vote(purchase, "carol", expected=404)
    approved = suite.vote(purchase, "bob", comment="Synthetic procurement reviewed")
    suite.state(approved, "APPROVED", None, 2)
    suite.check(approved["business"] == purchase["business"], "Decision rewrote business fields")
    suite.check(suite.vote(purchase, "bob") == approved, "Exact decision replay changed audit")
    suite.vote(purchase, "bob", "REJECT", expected=409)
    suite.check(approved["history"][-1]["comment"] == "Synthetic procurement reviewed",
                "Immutable decision note changed")
    maximum = {**business, "businessId": "PO-MAX-JPY", "quantity": 100000,
               "unitPrice": 1000000000, "currency": "JPY"}
    max_row = suite.request("/documents", body={"processVersion": version, "business": maximum}, expected=201)
    suite.check(Decimal(str(max_row["business"]["unitPrice"])) * max_row["business"]["quantity"] == Decimal("100000000000000"),
                "Maximum exact JPY total changed")
    for currency in ("USD", "EUR", "GBP"):
        row = suite.request("/documents", body={"processVersion": version, "business": {
            **business, "businessId": "PO-" + currency, "currency": currency, "unitPrice": 0.01,
        }}, expected=201)
        suite.check(row["business"]["currency"] == currency, "Currency changed")
    for overrides in ({"unitPrice": 0}, {"unitPrice": "199.99"}, {"quantity": 0},
                      {"quantity": 100001}, {"quantity": 1.5}, {"unitPrice": 1000000000.01},
                      {"unitPrice": 1.001}, {"currency": "JPY", "unitPrice": 1.01},
                      {"currency": "XYZ"}, {"unknown": True}):
        suite.request("/documents", body={"processVersion": version, "business": {**business, **overrides}}, expected=400)
    before = suite.request("/requests", "bob")
    suite.restart()
    suite.check(suite.request("/requests", "bob") == before,
                "Mixed documents and audit did not survive restart")
    snapshot = json.loads((suite.directory / "requests.json").read_text())
    suite.check(snapshot["schemaVersion"] == 5, "Typed documents did not persist as schema 5")
    print(f"PASS: {suite.http_checks} typed-document HTTP checks; {suite.invariants} invariants; 1 restart", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, default=Path(__file__).resolve().parents[2] / "approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar")
    parser.add_argument("--java", default="java")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="arcflow-mobile-documents-") as directory:
        suite = module.Suite(args, directory)
        try:
            verify(suite)
        finally:
            suite.stop()


if __name__ == "__main__":
    main()
