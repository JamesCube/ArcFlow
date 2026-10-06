-- Explicit approval SQL schema revision 1 -> 2 migration. Apply exactly once.
-- Stop all application writers; back up first; run with the host migration identity.
-- No existing requests are assigned keys. Do not run this after the revision-2 fresh schema.
CREATE TABLE arc_submission_key (
    applicant_id VARCHAR(128) NOT NULL,
    submission_key VARCHAR(128) NOT NULL,
    request_id VARCHAR(128) NOT NULL UNIQUE,
    PRIMARY KEY (applicant_id, submission_key),
    FOREIGN KEY (request_id) REFERENCES arc_request (request_id)
);
