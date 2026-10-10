# Security policy

## Supported versions

Security fixes are considered for the latest tagged Drop release (`v1.1.0` at
the time of writing). Older tags are retained for reference, not promised
ongoing support. This policy does not promise a response or fix deadline.

## Report a vulnerability

Please do not disclose an exploitable issue, access token, signed URL, private
media, device identifier, or other sensitive data in a public GitHub issue.
If GitHub's **Report a vulnerability** option is available for this repository,
use it. If it is not available, open a public issue requesting a private
security contact channel **without including vulnerability details or secrets**.
The maintainer can then arrange a confidential channel. No private reporting
feature or email address is assumed to exist yet.

Include a minimal reproduction, affected version, impact, and relevant
sanitized logs once a private channel is established. Do not test against
systems or content you do not control or have permission to use.

## Scope

Drop handles untrusted URLs and media. Reports concerning SSRF, redirects,
TLS validation, range-download integrity, storage limits, local file paths,
the optional direct-media backend, authentication, embedded Python/QuickJS,
native modules, or the persistent library are welcome. Drop is intended for
public or otherwise authorized content; bypassing DRM, access controls,
private accounts, paywalls, or memberships is outside its scope.
