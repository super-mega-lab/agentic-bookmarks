# Security Overview

**Effective:** May 12, 2026
**Last updated:** May 12, 2026
**Canonical URL:** https://agenticbookmarks.com/legal/security

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
  source-available code at https://github.com/super-mega-lab/agentic-bookmarks under **PolyForm Shield 1.0.0**
  so you can verify our network behavior, not just trust it.

If you're filling out a security questionnaire about this product,
this page is intended to be the answer to most of it. If anything is
unclear or insufficient, email **contact@supermegalab.com**.

---

## 1. Architecture and data flow

### 1.1 What runs where

| Component | Location | Purpose |
|---|---|---|
| **VS Code extension** | User's device | UI, repository operations, feature gating |
| **MCP server** | User's device | Local protocol bridge for AI agents |
| **Repository hosts** (GitHub, GitLab, etc.) | Third-party infrastructure | Repository operations and visibility checks, contacted directly from the user's device |
| **User's AI provider** | User's choice | AI/MCP interactions, contacted directly from the user's device |

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
 │  Network layer   │
 │  (open source)   │
 │                  │
 └──────────────────┘

 No arrows to Provider infrastructure: the Software does not contact
 Super Mega Lab during the Beta Period.
```

### 1.3 Data flow to Provider

**None.** During the Beta Period the Software does not contact Super
Mega Lab's infrastructure at all. We do not receive source code,
prompts, AI interactions, repository names, branch names, file paths,
commit metadata, telemetry events, error reports, repository
visibility status, IP addresses, or any other content from the user's
development environment.

---

## 2. Verify, don't trust

A useful property of the architecture: **you can verify these claims
yourself.**

The portions of the extension that contain any network-capable code
are published as source under **PolyForm Shield 1.0.0** at https://github.com/super-mega-lab/agentic-bookmarks.
You can audit those components to confirm:

- That the Software does not contact Super Mega Lab during the Beta
  Period — the outbound host allowlist excludes any Provider service.
- That repository content, prompts, telemetry, or other
  development-environment data are never sent to Provider.
- That the repository visibility check runs on the user's device by
  querying the applicable repository host directly.

The proprietary core of the Software (the implementation of paid Pro
features and the shared logic both the extension and MCP server
depend on) is bundled with the Marketplace release as a compiled
artifact. The proprietary core does not initiate network requests;
all outbound network communication is the exclusive responsibility of
the open network layer in the public repository.

---

## 3. Encryption and data protection

The Software does not transmit data to Provider infrastructure during
the Beta Period. Where the Software contacts third-party services on
your direction (repository hosts, your AI provider), it uses the
encrypted endpoints those services provide (HTTPS / TLS).

---

## 4. Authentication and access control

During the Beta Period, all Pro features are available to all users
without a subscription, and the Software does not authenticate
against any Provider service. No account or sign-in is required.

---

## 5. Network design

The Software enforces an explicit allowlist of outbound hosts. The
allowlist is implemented in the public network layer at https://github.com/super-mega-lab/agentic-bookmarks.
During the Beta Period the allowlist excludes Provider infrastructure
entirely. Any change to the allowlist requires a code change visible
in the public repository.

---

## 6. Logging and monitoring

Provider operates no service that the Software contacts during the
Beta Period, and therefore Provider does not log any user activity,
IP address, request, or development-environment data.

---

## 7. Vulnerability management

### 7.1 Dependencies

The published source of the network layer at https://github.com/super-mega-lab/agentic-bookmarks enables
independent inspection of the Software's third-party dependencies.
Dependencies are reviewed for known vulnerabilities prior to each
Marketplace release. Critical and high-severity issues block release
until remediated.

### 7.2 Code review

Production code is reviewed prior to release. Releases are produced
from the public repository's release branch.

### 7.3 Secret scanning

The public repository enables automated secret scanning at the
hosting provider level (GitHub secret scanning).

---

## 8. Personnel

- All personnel with access to systems handling personal data sign
  written confidentiality obligations.
- Security and data-protection training is provided on hire and
  **annually** thereafter.
- Background checks are performed where lawful and appropriate to
  the role.

---

## 9. Sub-processors

Provider engages no sub-processors to process user data during the
Beta Period, because Provider receives no user data.

---

## 10. Incident response

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

## 11. Responsible disclosure

If you believe you have found a security issue in the Product or our
services:

- Email **contact@supermegalab.com**.
- Please include enough information to reproduce the issue.
- We will acknowledge receipt within **five (5) business days** and
  keep you informed of our progress.
- We commit not to pursue legal action against good-faith security
  researchers who follow this disclosure process and avoid privacy
  violations, service disruption, and data destruction.

---

## 12. Data subject rights

You can exercise the data protection rights described in the Privacy
Policy (access, rectification, erasure, portability, restriction,
objection, complaint) by emailing **contact@supermegalab.com**. Given the
limited data we hold, we are usually able to respond within 30 days
at no charge.

---

## 13. Compliance

We have designed our security program against the principles in
**ISO/IEC 27001** and **SOC 2 Trust Services Criteria**. We are not
yet certified or attested under either framework.

We comply with applicable data protection laws including the
**GDPR**, **UK GDPR**, **FADP**, and the **CCPA/CPRA**, as described
in the Privacy Policy and DPA.

---

## 14. International data transfers

Where applicable, we rely on the EU Standard Contractual Clauses,
the UK International Data Transfer Addendum, and equivalent Swiss
safeguards for cross-border transfers of personal data, as described
in the Privacy Policy.

---

## 15. Things we deliberately don't do

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

## 16. Documents and links

- **Privacy Policy:** https://agenticbookmarks.com/legal/privacy
- **Provider-Specific Terms / EULA:** https://agenticbookmarks.com/legal/terms
- **Bonterms Standard End User Agreement:**
  <https://bonterms.com/standard/end-user-agreement-v1/>
- **Data Protection Addendum:** https://agenticbookmarks.com/legal/dpa
- **Short-form Data Handling Statement:** https://agenticbookmarks.com/legal/data-handling
- **Sub-processor list:** https://agenticbookmarks.com/legal/subprocessors
- **Source repository (network layer):** https://github.com/super-mega-lab/agentic-bookmarks

---

## 17. Contact

- General security: **contact@supermegalab.com**
- Privacy / data subject rights: **contact@supermegalab.com**
- Vulnerability reports: **contact@supermegalab.com**
- Postal: Super Mega Lab LLC, 16192 Coastal Highway, Lewes, Delaware 19958

