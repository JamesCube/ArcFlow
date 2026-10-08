-- MySQL 8.0.17+ / 8.x, approval SQL schema revision 3. Not MariaDB or MySQL 5.7.
-- First-install migration only. Apply once, outside an application transaction, before opening the store.
-- MySQL DDL implicitly commits. No automatic upgrade, CREATE IF NOT EXISTS or JSON import is performed.
-- Stable IDs are exact/case-sensitive, including trailing spaces in actor IDs (NO PAD).
-- LONGTEXT is necessary: accumulated parallel-group histories can exceed TEXT's 65,535-byte limit.
CREATE TABLE arc_process_version (
    process_id VARCHAR(128) NOT NULL,
    process_version INTEGER NOT NULL CHECK (process_version > 0),
    definition_json LONGTEXT NOT NULL,
    published_by VARCHAR(128) NOT NULL,
    published_at VARCHAR(64) NOT NULL,
    PRIMARY KEY (process_id, process_version)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE TABLE arc_process_head (
    process_id VARCHAR(128) PRIMARY KEY,
    active_version INTEGER NOT NULL,
    FOREIGN KEY (process_id, active_version) REFERENCES arc_process_version (process_id, process_version)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
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
    request_json LONGTEXT NOT NULL,
    FOREIGN KEY (process_id, process_version) REFERENCES arc_process_version (process_id, process_version),
    INDEX arc_request_applicant (applicant_id, created_at),
    INDEX arc_request_approver (approver_id, request_status)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE TABLE arc_request_event (
    request_id VARCHAR(128) NOT NULL,
    event_index INTEGER NOT NULL CHECK (event_index >= 0),
    event_json LONGTEXT NOT NULL,
    PRIMARY KEY (request_id, event_index),
    -- Table-level FK is required: MySQL ignores inline column REFERENCES syntax.
    FOREIGN KEY (request_id) REFERENCES arc_request (request_id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- Durable submission retry keys; existing unkeyed requests intentionally have no mapping.
CREATE TABLE arc_submission_key (
    applicant_id VARCHAR(128) NOT NULL,
    submission_key VARCHAR(128) NOT NULL,
    request_id VARCHAR(128) NOT NULL UNIQUE,
    PRIMARY KEY (applicant_id, submission_key),
    FOREIGN KEY (request_id) REFERENCES arc_request (request_id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- SQL revision 3 member projection. Complete definition actors, not a representative approver.
-- Binary keys make exact identity and ASCII request ordering independent of database collation.
CREATE TABLE arc_request_member (
    request_id VARCHAR(128) NOT NULL,
    process_id VARCHAR(128) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_key VARBINARY(256) NOT NULL CHECK (OCTET_LENGTH(actor_key) BETWEEN 2 AND 256),
    pending BOOLEAN NOT NULL CHECK (pending IN (FALSE, TRUE)),
    handled BOOLEAN NOT NULL CHECK (handled IN (FALSE, TRUE)),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    request_status VARCHAR(16) NOT NULL CHECK (request_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    process_version INTEGER NOT NULL CHECK (process_version > 0),
    created_seconds BIGINT NOT NULL,
    created_nanos INTEGER NOT NULL CHECK (created_nanos BETWEEN 0 AND 999999999),
    request_sort_key VARBINARY(128) NOT NULL CHECK (OCTET_LENGTH(request_sort_key) BETWEEN 1 AND 128),
    PRIMARY KEY (request_id, actor_key),
    FOREIGN KEY (request_id) REFERENCES arc_request (request_id)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE INDEX arc_member_pending ON arc_request_member (actor_key, process_id, pending, created_seconds, created_nanos, request_sort_key);
CREATE INDEX arc_member_handled ON arc_request_member (actor_key, process_id, handled, created_seconds, created_nanos, request_sort_key);
CREATE TABLE arc_member_projection_state (
    singleton_id INTEGER NOT NULL PRIMARY KEY CHECK (singleton_id = 1),
    ready BOOLEAN NOT NULL CHECK (ready IN (FALSE, TRUE)),
    last_request_id VARCHAR(128)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
-- Fresh installation only. Existing installations MUST use the not-ready upgrade below.
INSERT INTO arc_member_projection_state (singleton_id, ready, last_request_id) VALUES (1, TRUE, NULL);
