#!/usr/bin/env python3
"""Require named graph behavior tests to execute; counts and skipped green jobs are not evidence."""
import argparse
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = {
    'GraphBusinessScenariosTest': {
        'allThreeActualTopologiesRouteBothWaysWithIndependentTasksAndWaitingJoins',
        'eachParallelRejectionCancelsSiblingAndNeverFiresJoin',
        'boundFamiliesApplyToDraftsPreviewsAndConditionlessHistoricalDefinitions',
        'newServicesKeepPublicationCasFrozenVersionsIdentityAndRetries',
        'quoteSourceGuardsOwnerImmutableFieldsPreviewSelectedReadersAndCanonicalKey',
        'sourceRevocationDuringDirectoryLookupIsRecheckedBeforeCreateAndPreviewReturn',
        'quoteHistoricalRetrySurvivesExpiryAndSourceRevisionButNotAccessRevocation',
        'concurrentQuoteRevisionSubmissionsConvergeAndChangedPayloadConflicts',
        'allNewJsonStoresRestartAndRejectCorruptHistoricalSnapshotsWithoutOverwritingBytes',
        'quoteNoncanonicalDurableKeyIsRejectedBeforeJsonMutation',
        'percentRoutingUsesExactComparisonAtRoundingBoundaryAndStrictShapes',
        'schemaFiveCollidingIdsRetainPaymentAcrossJsonRestartAndNewHostsRejectDowngrade',
    },
    'GraphEngineTest': {
        'thresholdDefaultAndFirstMatchingPriorityUseExactServerFacts',
        'branchesAdvanceIndependentlyThenJoinFiresExactlyOnce',
        'rejectCancelsOtherBranchAndNeverFabricatesVotes',
        'groupsRetainAnyVotingWithoutPretendingTheyAreParallelPaths',
        'snapshotReplayRejectsForgedRouteArrivalTaskAndHistory',
        'strictGraphWireRejectsMissingUnknownAndWrongScalarFields',
        'malformedPairCrossLaneAndMissingDefaultArePreciseErrors',
        'nestedExclusiveInsideParallelWaitsOnlyForItsSelectedBranch',
        'thirdNestedRegionIsRejectedButTwoLevelSampleIsValid',
        'everyRandomizedApprovalOrderingTerminatesWithoutDuplicateActivation',
        'replayReceiptBudgetNeverConsumesCapacityForOutstandingRealVotes',
    },
    'GraphApprovalServiceTest': {
        'commandReplayOppositeAndChangedPayloadHaveUnambiguousSemantics',
        'publicationDraftConflictAndInFlightVersionAreIndependent',
        'unselectedActorHasNoReadOrWriteRightsAndRevocationAfterReadIsChecked',
        'sameActorOwnsTwoRealTasksAndConcurrentArrivalsCreateOneSuccessor',
        'lostAcknowledgementIsSafelyRecoverableWithoutDuplicateSubmissionOrVote',
        'previewDoesNotMutateDraftOrRequestsAndWrongCurrencyDoesNotTakeDefault',
        'simultaneousOppositeVotesCannotBothCommitAndRejectionRacesLeaveNoLiveTasks',
    },
}
JSON = {
    'restartPreservesDraftPublicationFrozenInstanceAuditAndJoin',
    'isolatedFilenameOwnershipAndClosedOperationsAreEnforced',
    'draftMayBeIncompleteButPublicationCasAndExactContentAreRequired',
    'duplicateIdentityKeyAndStaleCasNeverAppendExtraCommands',
    'concurrentBranchCompletionRereadsRequestWideCasAndFiresJoinOnce',
    'rejectionCancelsAllOtherActiveTasksAcrossRestart',
    'unknownLegacyMalformedOrReplayCorruptSnapshotFailsWithoutRewriting',
    'replayableInstanceCannotClaimAConflictingPublishedDefinition',
    'legacyReaderRejectsWrapper14WithoutTouchingTheGraphFile',
    'configuredNonNullMapperStillWritesRequiredNullableProperties',
    'invalidWriteKeepsDurableBytesAndMemoryUnchanged',
}
HTTP = {
    'GraphBusinessApiTest': {
        'realBusinessGraphsRunTrueAndDefaultPathsWithIndependentTaskJoinAndRejection',
        'sourceQuotePolicyCannotBeBypassedThroughGraphHttpAndStrictWireRejectsDerivedFacts',
        'endpointFamilyAndDraftFactValidationAreAuthoritativeAndPublicationCasRemainsScoped',
    },
    'GraphBusinessRestartHttpTest': {'restoresEveryScenarioFrozenVersionSourceBindingAndWaitingJoinAcrossHttpRestart'},
    'GraphApiTest': {
        'authenticatesAndUsesCurrentDirectoryAndPublisherPermissions',
        'preservesOriginAndClientHeaderProtectionOnEveryGraphWrite',
        'incompleteDraftsPersistButCannotPublishAndBothCompareAndSwapTokensMatter',
        'invalidTopologyDiagnosticsBlockPublicationWithoutChangingPublishedVersion',
        'previewUsesServerNetTotalWithoutWritingAndRejectsWrongTypeCurrencyAndForgedTotals',
        'strictGraphAndBusinessBodiesNeverAcceptMissingUnknownDuplicateOrComputedState',
        'newPublicationDoesNotChangeExistingBusinessRoutesOrReadVisibility',
        'concurrentDistinctTaskCommandsSurviveAndJoinActivatesExactlyOnce',
        'freshKeyReplayIsDurablyBoundWithoutDuplicatingTheOriginalVote',
        'terminalRejectionCancelsSiblingTasksAtomicallyAndUnknownTasksCannotVote',
    },
    'GraphRestartHttpTest': {'restartsWithFrozenBusinessOneOutstandingBranchAndDurableCommandReplay'},
}
JDBC = {
    'quoteCanonicalIdentityRejectsBeforeAnyJdbcMutationAndSurvivesRestart',
    'businessGraphFamiliesPersistPartialJoinsAndIsolateTypedSnapshots',
    'schemaFiveCollidingBusinessIdsRemainPaymentAndRejectSchemaSixReopen',
    'freshSchemaIsExplicitUnknownSchemaRejectedAndLegacyTablesUntouched',
    'initializationAndRestartPreserveEveryDurableProjection',
    'sameActorHasTwoTaskRowsAndRequestFlagsAreLogicalOr',
    'terminalRejectionCancelsTasksAndPendingMembersInSameCommit',
    'draftAndPublishUseSeparateCasAndOldInstancesKeepOriginalDefinition',
    'duplicateSubmissionAndOppositeStaleDecisionAreSafeConflicts',
    'concurrentBranchCompletionsUseRequestWideCasAndJoinFiresOnlyOnce',
    'parallelApprovalVersusRejectionRaceNeverLeavesActiveWork',
    'creationAuditTaskAndMemberFailuresRollbackEveryTable',
    'decisionAuditCommandTaskAndMemberFailuresRollbackStateAndEarlierWrites',
    'lostCreateAndDecisionCommitAcknowledgementsReconcileFromDurableState',
    'missingAuditFailsOnReadAndRestart', 'changedTaskProjectionFailsOnReadAndRestart',
    'incorrectAggregatedPendingMembershipFailsClosed', 'missingTaskMemberFailsClosed',
    'corruptCommandProjectionFailsClosed',
    'unknownPersistedJsonFieldsAndMissingNullablePropertiesFailClosed',
    'invalidTransitionIsRejectedBeforeAnyMutation',
    'serviceDuplicateOppositeAndChangedPayloadRemainSafeAfterRestart',
    'anyGroupPartialRejectionSurvivesRestartAndReleasesJoinOnlyAfterApproval',
    'frozenConditionalRouteExcludesUnselectedBranchFromMemberProjection',
    'successfulFreshKeyVoteRetryBindsAliasAcrossRestartWithoutDoubleVoting',
    'malformedStoredTimestampIsAnIoFailureWithoutMutation',
    'maximumRuntimeIdentityLengthsFitTaskAndCommandProjections',
}

def require_suite(path, expected):
    report = ET.parse(path).getroot()
    for key in ('skipped', 'errors', 'failures'):
        if int(report.get(key, '-1')) != 0:
            raise ValueError(f'{path.name}: {key} is nonzero or missing')
    cases = report.findall('testcase')
    for name in sorted(expected):
        found = [case for case in cases if case.get('name') == name]
        if len(found) != 1 or any(found[0].find(tag) is not None for tag in ('skipped', 'error', 'failure')):
            raise ValueError(f'{path.name}: required behavior did not execute successfully: {name}')
    if not cases:
        raise ValueError(f'{path.name}: empty suite')
    return len(cases)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain', action='store_true')
    parser.add_argument('--http', action='store_true')
    parser.add_argument('--jdbc', choices=['h2', 'postgresql', 'mysql'], action='append', default=[])
    args = parser.parse_args()
    if not (args.domain or args.http or args.jdbc):
        parser.error('select the verification layers that actually ran in this job')
    suites = []
    if args.domain:
        base = ROOT / 'examples/approval-domain/target/surefire-reports'
        suites.extend((base / f'TEST-com.arcflow.approval.graph.{name}.xml', names) for name, names in DOMAIN.items())
        suites.append((base / 'TEST-com.arcflow.approval.graph.JsonGraphApprovalStoreTest.xml', JSON))
    if args.http:
        base = ROOT / 'examples/approval-demo/backend/target/surefire-reports'
        suites.extend((base / f'TEST-com.arcflow.demo.{name}.xml', names) for name, names in HTTP.items())
    for engine in args.jdbc:
        classname = {'h2': 'H2', 'postgresql': 'Postgresql', 'mysql': 'Mysql'}[engine] + 'GraphApprovalStoreTest'
        suites.append((ROOT / 'examples/approval-jdbc/target/surefire-reports' / f'TEST-com.arcflow.approval.jdbc.{classname}.xml', JDBC))
    for path, names in suites:
        count = require_suite(path, names)
        print(f'{path.name}: all {len(names)} required behavior names present; {count} cases executed without skips/errors/failures')

if __name__ == '__main__':
    main()
