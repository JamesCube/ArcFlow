-- PostgreSQL schema supplied for host-managed migrations and optional real-server integration checks.
-- Apply once, explicitly, before constructing JdbcApprovalStore.
CREATE TABLE arc_process_version (
    process_id VARCHAR(128) NOT NULL,
    process_version INTEGER NOT NULL CHECK (process_version > 0),
    definition_json TEXT NOT NULL,
    published_by VARCHAR(128) NOT NULL,
    published_at VARCHAR(64) NOT NULL,
    PRIMARY KEY (process_id, process_version)
);
CREATE TABLE arc_process_head (
    process_id VARCHAR(128) PRIMARY KEY,
    active_version INTEGER NOT NULL,
    FOREIGN KEY (process_id, active_version) REFERENCES arc_process_version (process_id, process_version)
);
CREATE TABLE arc_request (
    request_id VARCHAR(128) PRIMARY KEY,
    process_id VARCHAR(128) NOT NULL,
    process_version INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    applicant_id VARCHAR(128) NOT NULL,
    approver_id VARCHAR(128) NOT NULL,
    request_status VARCHAR(16) NOT NULL CHECK (request_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    current_step_id VARCHAR(64),
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    request_json TEXT NOT NULL,
    FOREIGN KEY (process_id, process_version) REFERENCES arc_process_version (process_id, process_version)
);
CREATE INDEX arc_request_applicant ON arc_request (applicant_id, created_at);
CREATE INDEX arc_request_approver ON arc_request (approver_id, request_status);
CREATE TABLE arc_request_event (
    request_id VARCHAR(128) NOT NULL REFERENCES arc_request (request_id),
    event_index INTEGER NOT NULL CHECK (event_index >= 0),
    event_json TEXT NOT NULL,
    PRIMARY KEY (request_id, event_index)
);
