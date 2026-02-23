# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue** — security vulnerabilities should be reported privately
2. **Email**: Send details to [security@gigi.dev](mailto:security@gigi.dev)
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Depends on severity, typically within 2 weeks for critical issues

## Security Considerations

Gigi is a self-hosted AI coordinator that runs with significant system access. When deploying:

- **Never expose Gigi directly to the public internet** without proper authentication
- **Rotate API keys** (Anthropic, Gitea tokens) regularly
- **Use TLS** for all external connections
- **Review the system prompt** in `lib/core/agent.ts` for your deployment context
- **Database credentials** should use strong passwords and restricted network access
- **Docker secrets** are preferred over environment variables for sensitive values

## Scope

The following are in scope for security reports:

- Authentication/authorization bypasses
- Remote code execution
- SQL injection or data leakage
- Credential exposure in logs or responses
- WebSocket security issues
- MCP tool permission escalation

The following are generally out of scope:

- Denial of service (Gigi is designed for single-operator use)
- Issues requiring physical access to the host
- Social engineering
