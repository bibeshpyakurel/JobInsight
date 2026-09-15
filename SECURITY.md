# Security Policy

## Supported versions

This project is maintained on `main`. Security fixes are applied to `main` and
released from there; older commits are not backported.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it through GitHub's private vulnerability reporting: open the
**Security** tab on this repository and choose **Report a vulnerability**. That
channel is private between you and the maintainer.

Please include:

- what the issue is and which component it affects
- the steps or request needed to reproduce it
- what an attacker gains, in concrete terms

## What to expect

| Stage                | Target            |
| -------------------- | ----------------- |
| Acknowledgement      | within 72 hours   |
| Initial assessment   | within 7 days     |
| Fix or mitigation    | depends on severity, discussed on the report |

You will get a reply either way, including when the conclusion is that the
behaviour is intentional.

## Scope

In scope: this repository's source, its build and deployment workflows, and
its dependency manifests.

Out of scope: vulnerabilities in third-party services this project talks to
(report those to the service), findings that require an already-compromised
machine or account, and automated-scanner output with no demonstrated impact.

## Handling secrets

Secret scanning and push protection are enabled on this repository. If you
believe a credential has been committed, report it privately as above rather
than pushing a commit that removes it — removal alone does not revoke it.
