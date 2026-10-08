-- Explicit SQL revision 2 to 3 upgrade for postgresql. Apply once with ALL writers stopped.
-- Do not restart application traffic until bounded JdbcApprovalStore.backfillMembers reports ready.
-- No JSON/audit/process/key rows are rewritten. MySQL DDL implicitly commits.
-- SQL revision 3 member projection. Complete definition actors, not a representative approver.
-- Binary keys make exact identity and ASCII request ordering independent of database collation.
CREATE TABLE arc_request_member (
    request_id VARCHAR(128) NOT NULL,
    process_id VARCHAR(128) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_key BYTEA NOT NULL CHECK (OCTET_LENGTH(actor_key) BETWEEN 2 AND 256),
    pending BOOLEAN NOT NULL CHECK (pending IN (FALSE, TRUE)),
    handled BOOLEAN NOT NULL CHECK (handled IN (FALSE, TRUE)),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    request_status VARCHAR(16) NOT NULL CHECK (request_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    process_version INTEGER NOT NULL CHECK (process_version > 0),
    created_seconds BIGINT NOT NULL,
    created_nanos INTEGER NOT NULL CHECK (created_nanos BETWEEN 0 AND 999999999),
    request_sort_key BYTEA NOT NULL CHECK (OCTET_LENGTH(request_sort_key) BETWEEN 1 AND 128),
    PRIMARY KEY (request_id, actor_key),
    FOREIGN KEY (request_id) REFERENCES arc_request (request_id)
);
CREATE INDEX arc_member_pending ON arc_request_member (actor_key, process_id, pending, created_seconds, created_nanos, request_sort_key);
CREATE INDEX arc_member_handled ON arc_request_member (actor_key, process_id, handled, created_seconds, created_nanos, request_sort_key);
CREATE TABLE arc_member_projection_state (
    singleton_id INTEGER NOT NULL PRIMARY KEY CHECK (singleton_id = 1),
    ready BOOLEAN NOT NULL CHECK (ready IN (FALSE, TRUE)),
    last_request_id VARCHAR(128)
);
INSERT INTO arc_member_projection_state (singleton_id, ready, last_request_id) VALUES (1, FALSE, NULL);
