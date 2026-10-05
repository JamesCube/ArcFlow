-- MySQL 8.0.17+ / 8.x, approval SQL schema revision 1. Not MariaDB or MySQL 5.7.
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
