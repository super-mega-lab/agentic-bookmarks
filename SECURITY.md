# Security Overview (DRAFT)

**Effective:** May 12, 2026
**Last updated:** May 12, 2026
**Canonical URL:** [SECURITY OVERVIEW URL]

> **DRAFT — NOT LEGAL ADVICE.** Working draft of a public-facing
> security and trust page. Statements here must match the actual
> implementation; drift between this page and reality is the most
> common cause of failed enterprise security reviews. Fields marked
> `[BRACKETED]` need confirmation with engineering and operations
> before publishing.

> **URLs not yet determined.** Domain selection and the URL structure
> for legal documents are open. The expectation is that legal
> documents will live under a subfolder of the main company page
> dedicated to the product, e.g.,
> `[company-domain.com]/[product-slug]/legal/...`. Every `[…URL]`
> placeholder in this document will resolve to a path under that
> subfolder; the specific paths are not yet fixed. Cross-document
> references using these placeholders should remain consistent so
> that a single find-and-replace pass can populate them later.

---

## At a glance

**Agentic Bookmarks** is a VS Code extension and bundled MCP server
designed so that the easiest answer to most enterprise security
questions is: **the data isn't there to begin with.**

- **No telemetry.** No analytics, no behavioral logging, no usage
  events.
- **No source code, prompts, or repository data leaves your machine.**
- **AI features run locally** using your own AI provider. We never
  see prompts or completions.
- **Repository visibility is checked from your machine**, not via our
  servers.
- **Open and inspectable.** The public-repository portions of the
  Software, including the entire network layer, are published as
  source-available code at [REPO URL] under **PolyForm Shield 1.0.0**
  so you can verify our network behavior, not just trust it.

If you're filling out a security questionnaire about this product,
this page is intended to be the answer to most of it. If anything is
unclear or insufficient, email **contact@supermegalab.com**.

> **Beta Period note.** The Software is launching in a Beta Period
> during which the license verification service described below is
> **not yet running**. During the Beta Period the Software does not
> contact our infrastructure at all. Descriptions of server-side
> behavior in Sections 1, 3, 4, 6, 7, and 8 apply to the post-beta
> architecture and will take effect when the license verification
> service launches at the end of the Beta Period.

---

## 1. Architecture and data flow

### 1.1 What runs where

| Component | Location | Purpose |
|---|---|---|
| **VS Code extension** | User's device | UI, repository operations, feature gating |
| **MCP server** | User's device | Local protocol bridge for AI agents |
| **License verification service** | Our hosted infrastructure | Subscription verification and entitlement token issuance |
| **Polar.sh** | Polar's infrastructure | Merchant of record; subscription billing and management |
| **Repository hosts** (GitHub, GitLab, etc.) | Third-party infrastructure | Repository operations and visibility checks, contacted directly from user's device |
| **User's AI provider** | User's choice | AI/MCP interactions, contacted directly from user's device |

### 1.2 What flows where

```text
                        ┌────────────────────────┐
   User's device        │                        │
 ┌──────────────────┐   │   Repository hosts     │
 │                  │◄──┤  (GitHub, GitLab, …)   │
 │  VS Code         │   │                        │
 │  Extension       │   └────────────────────────┘
 │                  │
 │  MCP Server  ────┼──►┌────────────────────────┐
 │                  │   │   User's AI provider   │
 │                  │   └────────────────────────┘
 │                  │
 │  Network layer   │   ┌────────────────────────┐
 │  (open source)   ├──►│ Our license service    │
 │                  │   │ (only)                 │
 └──────────────────┘   └────────────────────────┘

                        ┌────────────────────────┐
                        │    Polar.sh (MoR)      │
                        │  email + customer ID   ├──► Our license service
                        └────────────────────────┘
```

### 1.3 What our servers receive

The license verification service receives only:

- A signed request from the extension asking to verify a subscription
  or refresh an entitlement token.
- Connection metadata (e.g., IP address) processed transiently for
  TLS connection establishment and abuse prevention.
- A subscription email and Polar customer identifier provided by
  Polar at subscription creation, used to associate a license with
  the right user.

The license verification service does **not** receive source code,
prompts, AI interactions, repository names, branch names, file paths,
commit metadata, telemetry events, error reports, repository
visibility status, or any other content from the user's development
environment.

A complete inventory is published in our [Privacy Policy] and DPA
[DPA URL].

---

## 2. Verify, don't trust

A useful property of the architecture: **you can verify most of these
claims yourself.**

The portions of the extension that perform any network communication
are published as source under **PolyForm Shield 1.0.0** at
[REPO URL]. The relevant directories include:

- `[PATH]` — the network/HTTP client and host allowlist.
- `[PATH]` — the license verification logic.
- `[PATH]` — the repository visibility check (queries the repository
  host directly from the user's device).

You can audit these to confirm:

- That outbound requests go only to hosts in a published allowlist.
- That repository content, prompts, telemetry, or other
  development-environment data are never sent to our servers.
- That the license-verification request payload is limited to what
  Section 1.3 describes.

During the Beta Period the trust story is even simpler: **the license
verification service is not running**, so the Software does not contact
our infrastructure at all. You can confirm this by inspecting the
network layer in the public repository — the outbound host allowlist
during beta excludes the license verification service entirely.

The proprietary core of the Software (the implementation of paid Pro
features and the shared logic both the extension and MCP server depend
on) is maintained in a separate private repository and bundled into
the Marketplace release as a compiled artifact. The proprietary core
does **not initiate network requests directly**; networking is the
exclusive responsibility of the open network layer in the public
repository. This is enforced by our build process [describe
enforcement, e.g., "by static analysis on every release build"].

---

## 3. Encryption

### 3.1 In transit

- All network communication between the extension and our license
  service uses **TLS 1.2 or higher**.
- TLS configuration follows current industry recommendations
  (e.g., Mozilla "intermediate" or stricter), with weak ciphers
  disabled.
- HSTS is enabled on our HTTPS endpoints.

### 3.2 At rest

- The user database (containing the limited account data described in
  the Privacy Policy) is encrypted at rest using
  [AES-256 / provider-managed encryption — fill in actual mechanism].
- Backups are encrypted at rest with [SAME or DIFFERENT mechanism].

### 3.3 Tokens

Entitlement tokens are signed using **[SIGNING ALGORITHM, e.g.,
EdDSA / RS256]** and verified locally by the extension. Token
contents are limited to subscription state, expiration, and feature
flags — no personal identifiers beyond an internal user identifier.
Tampering with the network layer of the extension does not produce a
valid signed token, because signing keys are held only by our
license service.

---

## 4. Authentication and access control

### 4.1 Customer authentication

End users prove subscription entitlement by exchanging a Polar
purchase confirmation for a signed entitlement token. The extension
verifies the token locally on each launch and on a refresh schedule.

The Community tier (free Pro features on public repositories) does
**not** require an account or sign-in. See the Provider-Specific Terms
for scope.

### 4.2 Internal access to systems

- Access to systems handling personal data is restricted to
  authorized personnel on a least-privilege basis.
- Administrative access requires
  **[SSO with MFA / strong password + MFA]**.
- Production access is logged and reviewed
  **[periodically / quarterly]**.
- Personnel access is revoked promptly upon role change or departure.

### 4.3 Service-to-service authentication

- Communication between our backend services uses
  [mutual TLS / signed tokens / cloud-provider IAM] for authentication.
- Long-lived credentials are avoided in favor of short-lived
  rotated credentials issued by [IDP/cloud-provider IAM].

---

## 5. Hosting infrastructure

- **Primary hosting:** Vercel, in United States. The hosting provider
  supplies physical security, environmental controls, and infrastructure
  security consistent with industry standards (ISO 27001, SOC 2, or
  equivalent).
- **Database:** Vercel Postgres.
- **Edge / TLS termination:** Vercel.

We rely on the hosting provider's documented certifications for
infrastructure-level controls (data center physical security,
networking, host hardening). Their compliance reports are available
through their respective trust portals.

---

## 6. Network design

- The license service is exposed only over HTTPS on
  **[PORT 443]** through [TLS terminator / load balancer].
- The application is segmented from the database; the database is
  not directly reachable from the internet.
- An explicit allowlist of outbound hosts is enforced from the
  extension; the published list is in `[PATH IN REPO]`. Any change
  requires a code change visible in the public repository.

---

## 7. Logging and monitoring

### 7.1 What we log

- **Application logs** for the license service, retained for **[N
  days]**, used for operational and security purposes.
- **Connection metadata** at the TLS terminator
  (timestamp, IP, request path, response code) — see Section 7.3 for
  retention.
- **Audit logs** of administrative actions on production systems.

### 7.2 What we do not log

- We do **not** log entitlement token contents.
- We do **not** log any payload from the extension that would identify
  user activity beyond what the request requires.
- We do **not** receive or log source code, prompts, repository names,
  file paths, or other development-environment data — that data never
  reaches our infrastructure.

### 7.3 IP address retention

[STATE THE ACTUAL POLICY. Match Privacy Policy §3.2 and DPA Annex 1B
exactly. Examples:
"IP addresses appear in transient TLS-terminator logs at our hosting
provider and are retained for [N] days, after which they are deleted."
OR
"We do not retain IP addresses linked to user accounts. IP-bearing
logs at the TLS terminator are kept by the hosting provider for [N]
days for operational and security purposes and then rotated."]

### 7.4 Monitoring and alerting

We monitor service health, error rates, authentication anomalies,
and abuse signals. Alerts route to an on-call rotation maintained by
Super Mega Lab.

---

## 8. Backups and recovery

- The user database is backed up **[DAILY / hourly]** to encrypted
  storage in United States.
- Backups are retained for **[SIX (6) MONTHS]** in accordance with our
  retention schedule.
- We periodically test restore procedures.
- Our target recovery objectives are: **RPO [N] hours**,
  **RTO [N] hours**.

---

## 9. Vulnerability management

### 9.1 Patching and dependencies

- Operating systems and runtime images are patched on a regular
  cadence, with critical security patches applied as soon as
  practical.
- Dependencies are scanned **[continuously / per-release]** with
  [TOOL, e.g., Dependabot, Renovate, Snyk]. Critical and high
  severity issues are triaged and remediated according to a
  documented SLA.

### 9.2 Code review and CI

- All production code is reviewed by at least one other engineer
  before merge.
- Static analysis and dependency vulnerability scanning run in CI.
- Builds are reproducible and produced in CI (no developer-machine
  builds reach production).

### 9.3 Secret management

- Secrets are stored in [SECRET MANAGER, e.g., AWS Secrets Manager,
  GCP Secret Manager, 1Password] and never committed to source
  control.
- Pre-commit and CI checks scan for accidentally committed secrets.

---

## 10. Personnel

- All personnel with access to systems handling personal data sign
  written confidentiality obligations.
- Security and data-protection training is provided on hire and
  **[periodically / annually]** thereafter.
- Background checks are performed where lawful and appropriate to
  the role.

---

## 11. Sub-processors

We use a small number of carefully selected sub-processors. The
current list is published at **[SUBPROCESSOR LIST URL]** and includes:

| Sub-processor | Role | Data |
|---|---|---|
| **Polar Software, Inc.** | Merchant of record; subscription management. Polar acts as an independent controller for billing data. | Polar provides email and customer ID to us. |
| **Vercel** (including **Vercel Postgres** for the database) | Hosts the license service and database; provides TLS termination | The limited account data described in the Privacy Policy; transient connection metadata |
| **Resend** | Sends transactional account/subscription emails | Email address |

We require sub-processors to commit to data protection obligations
substantially equivalent to ours.

---

## 12. Incident response

We maintain a documented incident response procedure that covers
detection, triage, containment, eradication, recovery, and
post-incident review.

In the event of a security incident affecting personal data, we will
notify affected customers without undue delay, and in any event
**within seventy-two (72) hours** of becoming aware, consistent with
our DPA and applicable law. Notification will include, to the extent
known: nature of the incident, approximate scope, measures taken or
proposed, and a contact for further information.

---

## 13. Responsible disclosure

If you believe you have found a security issue in the Product or our
services:

- Email **contact@supermegalab.com**.
- Please include enough information to reproduce the issue.
- We will acknowledge receipt within **[N] business days** and keep
  you informed of our progress.
- We commit not to pursue legal action against good-faith security
  researchers who follow this disclosure process and avoid privacy
  violations, service disruption, and data destruction.

[Optional: bug-bounty program details if applicable.]

---

## 14. Data subject rights

You can exercise the data protection rights described in the Privacy
Policy (access, rectification, erasure, portability, restriction,
objection, complaint) by emailing **contact@supermegalab.com**. Given the
limited data we hold, we are usually able to respond within 30 days
at no charge.

---

## 15. Compliance

[Pick the truthful version below. Do NOT claim certifications you
don't hold.]

[OPTION A — Pre-certification:]
We have designed our security program against the principles in
**ISO/IEC 27001** and **SOC 2 Trust Services Criteria**. We are not
yet certified or attested under either framework. We rely on the
certifications of our hosting and infrastructure providers
(see Section 5) for infrastructure-level controls.

[OPTION B — Certified:]
[List certifications, attestation reports, audit dates, and how to
request copies under NDA.]

We comply with applicable data protection laws including the
**GDPR**, **UK GDPR**, **FADP**, and the **CCPA/CPRA**, as described
in the Privacy Policy and DPA.

---

## 16. International data transfers

Where applicable, we rely on the EU Standard Contractual Clauses,
the UK International Data Transfer Addendum, and equivalent Swiss
safeguards for cross-border transfers of personal data, as described
in the Privacy Policy.

---

## 17. Things we deliberately don't do

These are commitments, not omissions:

| We don't | Why |
|---|---|
| Telemetry, analytics, or behavioral event logging | Privacy-by-design |
| Receive or process source code, prompts, or repository content | Architectural |
| Train AI/ML models on customer data of any kind | Policy + architectural — no data flow exists |
| Sell, share, rent, or trade personal information | Policy |
| Use third-party advertising or marketing trackers | Policy |
| Run AI features through our servers | Local-first architecture |

If we ever change one of these, it is a **material change** under our
Privacy Policy and Provider-Specific Terms requiring at least 30
days' notice and, where applicable, opt-in consent.

---

## 18. Documents and links

- **Privacy Policy:** [PRIVACY POLICY URL]
- **Provider-Specific Terms / EULA:** [PROVIDER TERMS URL]
- **Bonterms Standard End User Agreement:**
  <https://bonterms.com/standard/end-user-agreement-v1/>
- **Data Protection Addendum:** [DPA URL]
- **Short-form Data Handling Statement:** [DATA-HANDLING URL]
- **Sub-processor list:** [SUBPROCESSOR LIST URL]
- **Source repository (network layer):** [REPO URL]
- **Status page:** [STATUS PAGE URL, IF ANY]

---

## 19. Contact

- General security: **contact@supermegalab.com**
- Privacy / data subject rights: **contact@supermegalab.com**
- Vulnerability reports: **contact@supermegalab.com** (PGP key:
  [PGP KEY URL, IF ANY])
- Postal: Super Mega Lab LLC, 16192 Coastal Highway, Lewes, Delaware 19958

---

## Drafting Notes (REMOVE BEFORE PUBLICATION)

These notes flag items for engineering, ops, and the drafting attorney.

### Items requiring decision

1. **Hosting provider, region, database type, edge provider** — fill
   into Section 5.
2. **Encryption-at-rest mechanism** in Section 3.2 (the actual
   provider-managed or app-level mechanism in use).
3. **Token signing algorithm** in Section 3.3.
4. **Authentication mechanism for admin access** in Section 4.2.
5. **Application log retention** in Section 7.1.
6. **IP address retention** in Section 7.3 — must match Privacy
   Policy §3.2 and DPA Annex 1B exactly.
7. **Backup cadence and retention** in Section 8 — must match DPA
   §13.2.
8. **RPO/RTO** in Section 8.
9. **Dependency scanning tool** in Section 9.1.
10. **Secret manager** in Section 9.3.
11. **Personnel training cadence** in Section 10.
12. **Email provider, ops/error provider** in Section 11 — match
    DPA Annex 3 and Privacy Policy §6.
13. **Acknowledgment SLA for security reports** in Section 13.
14. **Compliance statement** in Section 15 — pick Option A
    (pre-certification) or Option B (certified). Do NOT claim
    certifications you do not hold.
15. **Status page** in Section 18, if any.
16. **PGP key URL** in Section 19, if used.

### Items requiring engineering confirmation

The most important review pass is by engineering, not legal. The
specific claims that must match implementation reality:

1. **The "data we do not collect" list** (Section 1.3, Section 17,
   and the "deliberately don't do" table). One mismatched line is a
   security-page-credibility crisis.

2. **The published outbound host allowlist** referenced in
   Section 6 — confirm it actually exists at the path stated.

3. **The "proprietary components do not initiate network requests"
   claim** in Section 2 — confirm this is true and that there is an
   enforcement mechanism (static analysis, build check, code review
   policy). If there isn't an enforcement mechanism, soften the
   claim or build one.

4. **Token signing setup** — confirm signing keys are held only by
   the license service, not embedded in the extension.

5. **Encryption-at-rest** — confirm the database actually uses the
   stated mechanism. "Provider-managed encryption" on cloud
   databases is fine but should be named accurately.

6. **Backup encryption** — confirm.

7. **CI/build process** — claims about reproducible builds, CI-only
   production builds, dependency scanning, secret scanning must
   match what's actually in the build pipeline.

### Items the business should validate

1. **Compliance claims (Section 15)** — the single most common
   source of legal trouble for a security page is overclaiming
   certifications. If you are not SOC 2 attested, do not say you
   are. "Designed against the principles of" is honest and
   acceptable; "compliant with" or "certified under" without an
   attestation is not.

2. **The 72-hour breach notification commitment (Section 12)** —
   this matches GDPR norms and the DPA. Make sure incident response
   actually routes notifications to a person who can meet that
   timeline 24/7. If the on-call rotation can't, the timeline
   should be softened to "without undue delay" only.

3. **The "we don't" commitments in Section 17** — these are public
   promises that change becomes a material event. Confirm with
   product leadership that all of them are durable.

4. **Bug-bounty / responsible disclosure** — Section 13 commits to
   not pursuing good-faith researchers. Ensure leadership and
   counsel understand this. It's standard but should be a
   deliberate choice.

5. **The "verify it yourself" framing in Section 2** — you commit
   to publishing the network layer at [REPO URL]. If at any point
   network code moves into the proprietary core, this framing is
   no longer accurate. Build an architectural rule that prevents
   that drift.

### Cross-document consistency check

Run these claims through the four legal documents and confirm
alignment:

| Claim | Security Overview | Privacy Policy | Provider-Specific Terms | DPA |
|---|---|---|---|---|
| Categories of data NOT collected | §1.3, §17 | §2 | §6.1 | Annex 1B |
| What data IS collected | §1.3 | §3 | §6.2 | Annex 1B |
| Polar as MoR + independent controller | §11 | §14 | §3.1 | Annex 3 |
| Local AI / no Provider AI access | §1, §17 | §12 | §8 | Annex 1B |
| Sub-processors (Polar, hosting, email, ops) | §11 | §6 | §9 | Annex 3 |
| 72-hour breach notice | §12 | §11 | — | §9 |
| Backup retention | §8 | §8 | — | §13.2 |
| TLS 1.2+ everywhere | §3.1 | §11 | — | Annex 2 |
| Encryption at rest | §3.2 | §11 | — | Annex 2 |
| IP retention | §7.3 | §3.2 | — | Annex 1B |

Any drift across these documents is a defect. Fix in all five
(including this Security Overview) before publishing.

### Mechanics of publishing

1. Publish at a stable URL like
   `[licensor.com]/security` or `[licensor.com]/trust`.
2. Link from: the marketing site footer, the Marketplace listing,
   the Privacy Policy (Section 11), the DPA (Annex 2), and the
   Provider-Specific Terms (Section 9).
3. Treat this as a living document; date the "Last updated" line
   and maintain a changelog.
4. **Do not** lock this behind a sales gate or NDA. Most enterprise
   security teams will skip a security page that requires an NDA
   to read; a public page is faster procurement, not weaker
   security.

### What this page is and isn't

This is a **trust page**, not a SOC 2 report. Sophisticated buyers
will ask for additional documentation:

- **Pen-test summary** (run an annual pen test once you have
  meaningful traction; publish a redacted summary).
- **Architecture diagrams** for highly diligent customers.
- **SOC 2 Type II report** when applicable (~12-24 months from now,
  ~$30-60k for first-year audit).
- **Detailed security questionnaire responses** (CAIQ, SIG-Lite,
  custom forms).

A good trust page significantly reduces the volume of these
follow-ups but does not eliminate them.
