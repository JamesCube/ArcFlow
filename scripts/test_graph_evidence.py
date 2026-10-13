import tempfile
import unittest
from pathlib import Path
from verify_graph_evidence import require_suite, DOMAIN, HTTP, JDBC

class GraphEvidenceTests(unittest.TestCase):
    def test_business_compatibility_and_real_database_names_cannot_drop_from_gate(self):
        self.assertIn('schemaFiveCollidingIdsRetainPaymentAcrossJsonRestartAndNewHostsRejectDowngrade', DOMAIN['GraphBusinessScenariosTest'])
        self.assertIn('GraphBusinessRestartHttpTest', HTTP)
        self.assertTrue({'quoteCanonicalIdentityRejectsBeforeAnyJdbcMutationAndSurvivesRestart', 'businessGraphFamiliesPersistPartialJoinsAndIsolateTypedSnapshots', 'schemaFiveCollidingBusinessIdsRemainPaymentAndRejectSchemaSixReopen'} <= JDBC)

    def test_named_behavior_not_raw_count(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'report.xml'
            p.write_text('<testsuite tests="100" skipped="0" errors="0" failures="0"><testcase name="unrelated"/></testsuite>')
            with self.assertRaises(ValueError): require_suite(p,{'join'})
            p.write_text('<testsuite tests="1" skipped="0" errors="0" failures="0"><testcase name="join"/></testsuite>')
            self.assertEqual(1,require_suite(p,{'join'}))
    def test_skips_missing_or_duplicate_cases_fail(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'report.xml'
            for xml in ['<testsuite skipped="1" errors="0" failures="0"><testcase name="join"><skipped/></testcase></testsuite>', '<testsuite skipped="0" errors="0" failures="0"><testcase name="join"/><testcase name="join"/></testsuite>', '<testsuite skipped="0" errors="0" failures="0"/>']:
                p.write_text(xml)
                with self.assertRaises(ValueError): require_suite(p,{'join'})

if __name__=='__main__': unittest.main()
