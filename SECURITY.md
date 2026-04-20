# Security Policy

## Scope

Tauri Studio is a minimal desktop chat client for OpenAI-compatible `chat/completions` APIs. The main security expectations for this repository are:

- no committed secrets, credentials, or private exports
- no unnecessary desktop capabilities or unsafe remote content execution
- no known high-severity dependency issues in the committed lockfiles

## Reporting

If you find a security issue, please avoid opening a public issue with exploit details.

- Contact the maintainer privately first.
- Include a concise reproduction, impact, affected version or commit, and any required environment details.
- If the issue involves leaked credentials, rotate them immediately before reporting.

If no private contact path is available, open a minimal public issue that only states a security report is needed and excludes the exploit details.

## Data Handling Notes

- The app stores its configured `apiKey` in local app data on the user's machine.
- New JSON exports omit `apiKey`, but exported chat history may still contain sensitive content.
- Do not commit local app data, manual exports, `.env` files, or recovered `*.corrupt.*.json` files to this repository.

## Hardening Notes

Current repository safeguards include:

- remote API endpoints must use `https`, except loopback-only local development targets
- exported data redacts `apiKey`
- Markdown image rendering is blocked and links are restricted to explicit external opening
- Tauri CSP is enabled instead of left null
