#!/usr/bin/env python3
"""Mutation regressions for the offline HTTP contract gate (stdlib only)."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from check_api_contract import Checker, ContractError, ROOT, SPEC_DIR, DOMAIN, DEMO, RUOYI, load_json


class ContractMutationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='arcflow-contract-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        source_manifest = load_json(ROOT / SPEC_DIR / 'source-contract.json')
        for source in source_manifest['sources']:
            target = self.root / source
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / source, target)
        for source in (ROOT / 'docs/api').rglob('*.json'):
            target = self.root / source.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)

    def mutate_json(self, path, mutate):
        target = self.root / path
        value = json.loads(target.read_text())
        mutate(value)
        target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

    def schema(self, mutate):
        self.mutate_json(SPEC_DIR / 'schemas.json', lambda data: mutate(data['$defs']))

    def spec(self, mutate, host='standalone'):
        self.mutate_json(SPEC_DIR / (host + '.openapi.json'), mutate)

    def source(self, name, before, after):
        path = self.root / name
        value = path.read_text()
        self.assertIn(before, value)
        path.write_text(value.replace(before, after, 1))

    def rejected(self, pattern=None):
        with self.assertRaisesRegex(ContractError, pattern or '.'):
            Checker(self.root).check()

    def test_baseline(self):
        self.assertIn('30 controller handlers', Checker(self.root).check())

    def test_missing_real_route(self):
        self.spec(lambda s: s['paths'].pop('/api/scenarios/oa-seal-use/documents'))
        self.rejected('count|omits')

    def test_invented_detail_route(self):
        self.spec(lambda s: s['paths'].__setitem__('/api/requests/{id}', copy.deepcopy(s['paths']['/api/me'])))
        self.rejected('Invented')

    def test_controller_route_rename(self):
        self.source(DEMO + 'ApprovalController.java', '@GetMapping("/me")', '@GetMapping("/identity")')
        self.rejected('inventory')

    def test_extra_controller_route(self):
        self.source(DEMO + 'ApprovalController.java', '@GetMapping("/me")', '@GetMapping("/new") String newRoute() { return "new"; }\n    @GetMapping("/me")')
        self.rejected('route inventory')

    def test_removed_source_review_guard(self):
        self.mutate_json(SPEC_DIR / 'source-contract.json', lambda s: s['sources'].pop(DEMO + 'SecurityConfig.java'))
        self.rejected('review guard')

    def test_changed_handler_name(self):
        self.source(DEMO + 'ApprovalController.java', 'Person me(Principal', 'Person identity(Principal')
        self.rejected('handler/source')

    def test_wrong_created_status(self):
        self.spec(lambda s: s['paths']['/api/documents']['post']['responses'].__setitem__('200', s['paths']['/api/documents']['post']['responses'].pop('201')))
        self.rejected('success status')

    def test_native_created_status_is_not_201(self):
        self.spec(lambda s: s['paths']['/arcflow/documents']['post']['responses'].__setitem__('201', s['paths']['/arcflow/documents']['post']['responses'].pop('200')), 'ruoyi')
        self.rejected('success status')

    def test_wrong_quote_wrapper(self):
        self.spec(lambda s: s['paths']['/api/crm/documents']['post']['responses']['201']['content']['application/json'].__setitem__('schema', {'$ref': '#/components/schemas/Request'}))
        self.rejected('response model')

    def test_invented_quote_view_revision(self):
        self.schema(lambda s: s['QuoteView']['properties'].__setitem__('revision', {'type': 'integer'}))
        self.rejected('record/property')

    def test_actual_record_drift(self):
        self.source(DOMAIN + 'QuoteDiscountCase.java', 'boolean quoteUpdated) {}', 'boolean quoteUpdated, int revision) {}')
        self.rejected('record/property')

    def test_unresolved_schema_ref(self):
        self.schema(lambda s: s['GenericSubmission']['properties'].__setitem__('business', {'$ref': '#/$defs/Nonexistent'}))
        self.rejected('Unresolved')

    def test_unsupported_schema_keyword_fails_closed(self):
        self.schema(lambda s: s['Leave'].__setitem__('minProperties', 5))
        self.rejected('Unsupported schema keywords')

    def test_changed_document_enum(self):
        self.schema(lambda s: s['DocumentType']['enum'].append('invoice'))
        self.rejected('Document type')

    def test_changed_catalog(self):
        self.spec(lambda s: s['x-scenario-catalog'].__setitem__('oa-expense', 'paymentRequest'))
        self.rejected('catalog drift')

    def test_changed_source_catalog(self):
        self.source(DOMAIN + 'ScenarioCatalog.java', 'new Template("oa-expense"', 'new Template("oa-invoice"')
        self.rejected('Registered scenario')

    def test_unsupported_runif_family(self):
        self.schema(lambda s: s['ReceivingPredicate']['properties']['field'].__setitem__('const', 'expense.total'))
        self.rejected('predicate schema drift')

    def test_generic_host_must_not_accept_scenario_documents(self):
        self.spec(lambda s: s['paths']['/api/documents']['post']['requestBody']['content']['application/json'].__setitem__('schema', {'$ref': '#/components/schemas/ScenarioSubmission'}))
        self.rejected('schema alternative|request DTO')

    def test_missing_required_business_field(self):
        self.mutate_json('docs/api/examples/leave.json', lambda b: b['business'].pop('days'))
        self.rejected('schema alternative')

    def test_unknown_submission_field(self):
        self.mutate_json('docs/api/examples/leave.json', lambda b: b.__setitem__('applicantId', 'bob'))
        self.rejected('false schema')

    def test_numeric_string_rejected(self):
        self.mutate_json('docs/api/examples/leave.json', lambda b: b['business'].__setitem__('days', '2'))
        self.rejected('schema alternative')

    def test_money_lexical_precision(self):
        path = self.root / 'docs/api/examples/expense.json'
        path.write_text(path.read_text().replace('0.1,', '0.100,', 1))
        self.rejected('schema alternative')

    def test_integer_lexeme_not_float(self):
        path = self.root / 'docs/api/examples/leave.json'
        path.write_text(path.read_text().replace('"days": 2', '"days": 2.0', 1))
        self.rejected('schema alternative')

    def test_receiving_negative_zero(self):
        path = self.root / 'docs/api/examples/receiving.json'
        path.write_text(path.read_text().replace('"rejected": 0', '"rejected": -0', 1))
        self.rejected('schema alternative')

    def test_cross_field_payment_constraint(self):
        self.mutate_json('docs/api/examples/payment.json', lambda b: b['business']['lines'][0].__setitem__('allocationAmount', 999999999))
        self.rejected('payment reconciliation')

    def test_contract_milestone_total(self):
        self.mutate_json('docs/api/examples/contract.json', lambda b: b['business'].__setitem__('contractAmount', 123))
        self.rejected('milestone total')

    def test_publication_schema_mismatch(self):
        self.mutate_json('docs/api/examples/publish-all.json', lambda b: b['definition'].__setitem__('schemaVersion', 2))
        self.rejected('group requires')

    def test_duplicate_json_keys(self):
        path = self.root / 'docs/api/examples/leave.json'
        path.write_text(path.read_text().replace('"days": 2', '"days": 2, "days": 3', 1))
        self.rejected('duplicate JSON')

    def test_wrong_auth_scheme(self):
        self.spec(lambda s: s.__setitem__('security', []))
        self.rejected('authentication contract')

    def test_removed_client_header(self):
        self.spec(lambda s: s['paths']['/api/process']['post'].__setitem__('parameters', []))
        self.rejected('client header')

    def test_required_scenario_key_becomes_optional(self):
        self.spec(lambda s: s['components']['parameters']['RequiredIdempotencyKey'].__setitem__('required', False))
        self.rejected('required idempotency')

    def test_changed_native_permission(self):
        self.spec(lambda s: s['paths']['/arcflow/requests/{id}/decisions']['post'].__setitem__('x-ruoyi-permission', 'arcflow:request:read'), 'ruoyi')
        self.rejected('native permission')

    def test_changed_security_behavior_requires_review(self):
        self.source(DEMO + 'SecurityConfig.java', '"approval-demo".equals(req.getHeader', '"changed-client".equals(req.getHeader')
        self.rejected('reviewed semantic source changed')

    def test_native_controlled_403_is_required(self):
        self.spec(lambda s: s['paths']['/arcflow/me']['get']['responses'].pop('403'), 'ruoyi')
        self.rejected('controlled error status')

    def test_generic_union_cannot_expand_silently(self):
        self.schema(lambda s: s['GenericBusinessDocument']['oneOf'].append({'$ref': '#/$defs/Expense'}))
        self.rejected('Generic document union')

    def test_threshold_trailing_zeroes_are_normalized(self):
        path = self.root / 'docs/api/examples/publish-payment-routing.json'
        value = path.read_text()
        self.assertIn('"threshold": 10000', value)
        path.write_text(value.replace('"threshold": 10000', '"threshold": 1.000', 1))
        self.assertIn('PASS', Checker(self.root).check())

    def test_threshold_significant_precision_is_rejected(self):
        self.mutate_json('docs/api/examples/publish-payment-routing.json', lambda b: b['definition']['nodes'][2]['runIf']['predicates'][0].__setitem__('threshold', 0.001))
        self.rejected('schema alternative')

    def test_expense_predicate_cannot_be_removed_from_union(self):
        self.schema(lambda s: s['RoutingPredicate']['oneOf'].remove({'$ref': '#/$defs/ExpensePredicate'}))
        self.rejected('Routing predicate union')

    def test_expense_field_schema_cannot_drift(self):
        self.schema(lambda s: s['ExpensePredicate']['properties']['field'].__setitem__('const', 'expense.clientTotal'))
        self.rejected('runIf predicate schema')

    def test_expense_condition_requires_explicit_currency(self):
        self.mutate_json('docs/api/examples/publish-expense-routing.json', lambda b: b['definition']['nodes'][2]['runIf']['predicates'][0].pop('currency'))
        self.rejected('schema alternative')

    def test_expense_condition_rejects_fractional_jpy(self):
        self.mutate_json('docs/api/examples/publish-expense-routing.json', lambda b: b['definition']['nodes'][2]['runIf']['predicates'][0].__setitem__('currency', 'JPY'))
        self.rejected('fractional JPY threshold')

    def test_expense_condition_cannot_target_payment_host(self):
        self.mutate_json('docs/api/examples/publish-expense-routing.json', lambda b: b['definition'].__setitem__('id', 'erp-payment'))
        self.rejected('condition family does not belong')

    def test_expense_submission_cannot_supply_authoritative_total(self):
        self.mutate_json('docs/api/examples/expense-routing-equal.json', lambda b: b['business'].__setitem__('totalAmount', 0.29))
        self.rejected('schema alternative')

    def test_expense_threshold_is_a_number_not_an_expression(self):
        self.mutate_json('docs/api/examples/publish-expense-routing.json', lambda b: b['definition']['nodes'][2]['runIf']['predicates'][0].__setitem__('threshold', 'sum(lines)'))
        self.rejected('schema alternative')

    def test_expense_condition_family_must_be_declared_in_openapi(self):
        self.spec(lambda s: s['x-condition-families'].remove('expense.totalAmount'))
        self.rejected('OpenAPI condition family')

    def test_business_decimal_scale_applies_after_exponent(self):
        path = self.root / 'docs/api/examples/expense.json'
        value = path.read_text()
        self.assertIn('0.1,', value)
        path.write_text(value.replace('0.1,', '1.000e3,', 1))
        self.assertIn('PASS', Checker(self.root).check())

    def test_java_isblank_keeps_nonbreaking_space_distinction(self):
        self.mutate_json('docs/api/examples/leave.json', lambda b: b['business'].__setitem__('title', '\u00a0'))
        self.assertIn('PASS', Checker(self.root).check())

    def test_fixed_unicode_seal_text_rejects_nonbreaking_space(self):
        self.mutate_json('docs/api/examples/seal-use.json', lambda b: b['business'].__setitem__('documentName', '\u00a0'))
        self.rejected('blank text')

    def test_utf16_length_is_not_unicode_codepoint_length(self):
        self.mutate_json('docs/api/examples/leave.json', lambda b: b['business'].__setitem__('title', '\U0001f600' * 61))
        self.rejected('schema alternative')

    def test_reference_trailing_newline_is_rejected(self):
        self.mutate_json('docs/api/examples/procurement.json', lambda b: b['business'].__setitem__('businessId', 'PO-1\n'))
        self.rejected('schema alternative')

    def test_receiving_positive_rejection_requires_visible_reason(self):
        def change(body):
            line = next(line for line in body['business']['lines'] if line['rejected'])
            line['exceptionReason'] = '\ufeff'
        self.mutate_json('docs/api/examples/receiving.json', change)
        self.rejected('missing exception reason')

    def test_payment_positive_deduction_requires_visible_reason(self):
        def change(body):
            line = next(line for line in body['business']['lines'] if line['deductionAmount'])
            line['deductionReason'] = '\ufeff'
        self.mutate_json('docs/api/examples/payment.json', change)
        self.rejected('missing deduction reason')

    def test_standard_contract_reason_uses_java_trim(self):
        def change(body):
            body['business']['termsKind'] = 'STANDARD'
            body['business']['deviationReason'] = '\u00a0'
        self.mutate_json('docs/api/examples/contract.json', change)
        self.rejected('deviation reason')

    def trim_text_cases(self):
        return [('expense', ('business', 'lines', 0, 'description')),
                ('travel', ('business', 'destination')),
                ('travel', ('business', 'title')),
                ('travel', ('business', 'reason'))]

    def validate_trim_case(self, checker, example, field, value):
        body = load_json(self.root / ('docs/api/examples/' + example + '.json'), lexical=True)
        target = body
        for part in field[:-1]:
            target = target[part]
        target[field[-1]] = value
        checker.validate(body, {'$ref': '#/$defs/ScenarioSubmission'}, self.root / SPEC_DIR / 'schemas.json')
        checker.domain_example(body, example)

    def test_trimmed_scenario_text_rejects_each_c0_and_space(self):
        checker = Checker(self.root)
        for example, field in self.trim_text_cases():
            for codepoint in range(0x21):
                with self.subTest(example=example, field=field, codepoint=codepoint):
                    with self.assertRaises(ContractError):
                        self.validate_trim_case(checker, example, field, chr(codepoint))

    def test_trimmed_scenario_text_rejects_mixed_blank_after_trim(self):
        checker = Checker(self.root)
        for example, field in self.trim_text_cases():
            for value in ['\x00 \t\x1b', '\x00\u2000\x01', '\x1f\u3000\x00', '\u2000\x00']:
                with self.subTest(example=example, field=field, value=repr(value)):
                    with self.assertRaises(ContractError):
                        self.validate_trim_case(checker, example, field, value)

    def test_trimmed_scenario_text_preserves_exact_java_positive_cases(self):
        checker = Checker(self.root)
        # Internal C0 is not trimmed if non-ASCII whitespace surrounds it.
        # NBSP/NEL/BOM are not Java isBlank characters and must not be banned here.
        for example, field in self.trim_text_cases():
            for value in ['\u00a0', '\u0085', '\ufeff', '\x00Synthetic\x1f', '\u2000\x00\u2000', '\x7f']:
                with self.subTest(example=example, field=field, value=repr(value)):
                    self.validate_trim_case(checker, example, field, value)

    def test_trim_rule_cannot_be_dropped_from_model(self):
        self.schema(lambda s: s['Travel']['properties']['destination'].__setitem__('x-nonblank', 'java-isBlank'))
        self.rejected('trim/isBlank contract drift')

    def test_unknown_nonblank_policy_fails_closed(self):
        self.schema(lambda s: s['Travel']['properties']['destination'].__setitem__('x-nonblank', 'java-trim-typo'))
        self.rejected('Unsupported x-nonblank')

    def test_java_utf16_length_handles_escaped_lone_surrogates(self):
        checker = Checker(self.root)
        for value in ['\ud800', '\udfff', '\ud800' * 120]:
            with self.subTest(codepoints=len(value)):
                body = load_json(self.root / 'docs/api/examples/leave.json', lexical=True)
                body['business']['title'] = value
                checker.validate(body, {'$ref': '#/$defs/GenericSubmission'}, self.root / SPEC_DIR / 'schemas.json')
        body['business']['title'] = '\ud800' * 121
        with self.assertRaises(ContractError):
            checker.validate(body, {'$ref': '#/$defs/GenericSubmission'}, self.root / SPEC_DIR / 'schemas.json')

    def test_comments_and_whitespace_do_not_invalidate_source_review(self):
        path = self.root / DEMO / 'SecurityConfig.java'
        path.write_text('// Reviewed source comments are not semantic.\n\n' + path.read_text())
        self.assertIn('PASS', Checker(self.root).check())


if __name__ == '__main__':
    unittest.main(verbosity=2)
