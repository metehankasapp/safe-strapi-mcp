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

## In-place editing

`allowInPlaceEditing` is disabled by default. Enabling it permits writes to an
existing document's draft without owned-draft registration. The new tools require
a persisted preview, revision hashes and idempotency, retain existing component
IDs, and block destructive operation types, array replacement and content clearing.
Existing clone and owned-draft tools keep their original ownership rules.

Previews store page snapshots in the local audit database. Protect that database
like a content export. Tokens used by another tool, including the official MCP,
can bypass these checks. REST's final GET/PUT interval is not atomic; concurrent
external edits can be overwritten. A Strapi-side conditional-write endpoint is
required to eliminate that race and is not included in this version.

## Schema-first entry and media (0.3.0 source)

The general entry tools require a recorded schema/API inspection and persisted
preview. Existing updates require `allowEntryEditing`; this separate opt-in can
permit intentional schema-approved field/array/reference replacements. It does
not weaken or change the dedicated protected page workflow. Private/password
fields, unknown custom storage types and polymorphic relations are rejected.

Writes explicitly select `status=draft` for Draft & Publish types and verify
unchanged published versions. Types without a draft state require an explicitly
approved immediate-write preview. Media has no draft state: uploads become
visible immediately. Uploads require a reviewed exact local file/destination,
check file signatures/size/hashes, use multipart and verify saved metadata.
Neither operation is a publish/delete endpoint.

API/WAF errors never authorize bypassing authentication/security or switching to
Computer Use, admin UI, another MCP or shell writes. Unknown POST/upload outcomes
fail closed without blind retries/adopting records by slug; known PUT resources
can be re-read for reconciliation. Schema/target/revision changes invalidate a
preview. Human approval remains an AI-client workflow rule, not server-side
human authentication. Local audit snapshots are private content exports.
