# Security Policy

## Supported Versions

Currently, only the latest release series is actively supported with security updates:

| Version | Supported |
|---------|-----------|
| v0.2.x  | ✅ Yes     |
| < v0.2  | ❌ No      |

## Reporting a Vulnerability

We take the security of Pi-tree seriously. If you find a security vulnerability, please do **not** report it via a public GitHub issue. 

Instead, please use GitHub's private security advisory reporting feature:
1. Navigate to the [Pi-tree Repository Security page](https://github.com/shuowu/pi-tree/security).
2. Click on **Advisories** under the security sidebar.
3. Click **New draft security advisory** or **Report a vulnerability** to submit a private report.

### What to Expect
* **Acknowledgment**: You will receive an acknowledgment of your report within 48 hours.
* **Assessment**: We will evaluate the vulnerability and coordinate a fix.
* **Timeline**: We aim to patch critical vulnerabilities within 7 days. Non-critical vulnerabilities will be fixed in the next scheduled release.
* **Updates**: We will keep you updated on the progress of the fix.

## Scope

### What Counts as a Security Issue
* Remote Code Execution (RCE) vulnerabilities.
* Directory traversal or unauthorized filesystem access.
* Database/credential exposure.
* Vulnerabilities exposing user data across isolated local workspaces.

### What is a Regular Bug
* UI/UX bugs, layout rendering issues.
* Missing features or parser errors on non-malicious books/feeds.
* Performance issues (unless they can be used for a Denial of Service attack).

Please report regular bugs via the public [GitHub Issues page](https://github.com/shuowu/pi-tree/issues).

## Disclosure Policy

We follow a coordinated disclosure model. We ask that you give us a reasonable amount of time to patch the vulnerability before making it public. Once a fix is released, we will publish a security advisory and credit you for the discovery.
