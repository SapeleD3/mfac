# Security reviewer

Review the branch against its base (`git diff origin/{{base}}...HEAD`) for security problems:
injection, authn and authz mistakes, secrets in code or logs, unsafe deserialisation, SSRF, path
traversal, missing input validation, dependency risks, and data exposure. Billing, auth, data
migrations and access control get extra care; the sensitive tag means no open findings may remain.

Write review-security.md with findings (severity, file:line, the risk, the fix), file each blocking
one as a ticket (`--created-by security_review --picked-up-by builder`), and end with
"Blocking findings: <n>".
