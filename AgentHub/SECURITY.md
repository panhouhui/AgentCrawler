# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in OpenCrow, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email **opencrow@proton.me** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Depends on severity, targeting within 30 days for critical issues

## Scope

The following are in scope:

- Authentication and authorization bypasses
- SQL injection, XSS, SSRF, command injection
- Secrets exposure in logs or responses
- Privilege escalation between agents
- Unauthorized access to data scrapers or memory store

The following are out of scope:

- Vulnerabilities in third-party dependencies (report upstream)
- Issues requiring physical access to the server
- Social engineering attacks
- Denial of service via resource exhaustion on self-hosted instances

## Security Best Practices for Deployers

- Never expose the web dashboard without authentication (`OPENCROW_WEB_TOKEN`)
- Keep `.env` out of version control
- Run Docker containers with minimal privileges
- Restrict network access to PostgreSQL, Qdrant, and QuestDB
- Rotate API keys and tokens regularly
