# Security policy

## Supported versions

Security fixes are provided for the latest published version.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting for this repository. Include affected versions,
reproduction steps, impact, and any suggested mitigation.

We will acknowledge a complete report within five business days. Please allow
time for investigation and a coordinated release before public disclosure.

## Credential safety

Never include Strapi tokens, environment files, content exports, audit
databases, or authenticated request logs in reports. Use synthetic fixtures.

Safe Strapi MCP cannot protect credentials exposed by the host machine or MCP
client. Use least-privilege Strapi tokens and keep environment and audit files
outside version control.
