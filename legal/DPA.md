# Data Processing Addendum (DRAFT)

> **DRAFT — NOT LEGAL ADVICE.** This document is a working draft prepared from
> the product's stated architecture. It must be reviewed and finalized by a
> qualified software/privacy attorney before use with any customer. Placeholder
> fields are marked `[BRACKETED]`. Do not deliver to a customer in this state.
>
> Drafting assumptions (verify before signing):
> - Licensor stores only: user id, email, polar_customer_id, created_at.
> - No telemetry, no source code, prompts, file paths, repository names,
>   branch names, commit history, diagnostics, or editor activity are
>   transmitted to or stored by Licensor.
> - Repository visibility is checked from the user's machine against
>   GitHub/GitLab APIs, not via Licensor's servers.
> - Polar.sh is the merchant of record for all billing and acts as an
>   independent controller for payment data.
> - Auth server verifies against Polar and issues short-lived signed tokens.

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

## Data Processing Addendum

This Data Processing Addendum ("**DPA**") forms part of the agreement between
**Super Mega Lab LLC** ("**Processor**" or "**Super Mega Lab**") and the
customer identified in the applicable order, subscription, or end user license
agreement ("**Customer**" or "**Controller**") (together, the "**Agreement**")
and applies to Processor's Processing of Personal Data on behalf of Customer in
connection with the Services.

In the event of a conflict between this DPA and the Agreement, this DPA
controls with respect to the Processing of Personal Data.

**Effective Date:** The date Customer accepts the Agreement or the date this
DPA is countersigned, whichever is later.

---

### 1. Definitions

Capitalized terms not defined here have the meanings given in the Agreement or
in Applicable Data Protection Law.

- **"Applicable Data Protection Law"** means all laws and regulations
  applicable to a party's Processing of Personal Data under the Agreement,
  including, as applicable: (a) Regulation (EU) 2016/679 ("**GDPR**"); (b) the
  UK GDPR and the UK Data Protection Act 2018 ("**UK GDPR**"); (c) the Swiss
  Federal Act on Data Protection ("**FADP**"); and (d) the California Consumer
  Privacy Act as amended by the CPRA ("**CCPA**").
- **"Controller"**, **"Processor"**, **"Data Subject"**, **"Personal Data"**,
  **"Processing"**, and **"Sub-processor"** have the meanings given in the
  GDPR, or the equivalent terms under Applicable Data Protection Law.
- **"Personal Data"** as used in this DPA means Personal Data that Processor
  Processes on behalf of Customer in connection with the Services, as
  described in Annex 1B.
- **"Services"** means the Agentic Bookmarks VS Code extension, MCP server,
  related client components, and the license verification and entitlement
  services provided by Processor pursuant to the Agreement.
- **"Standard Contractual Clauses"** or **"SCCs"** means the standard
  contractual clauses for the transfer of personal data to third countries
  pursuant to GDPR, approved by Commission Implementing Decision (EU)
  2021/914.
- **"UK Addendum"** means the International Data Transfer Addendum to the EU
  Commission Standard Contractual Clauses issued by the UK Information
  Commissioner under section 119A of the UK Data Protection Act 2018.
- **"Security Incident"** means a breach of security leading to the
  accidental or unlawful destruction, loss, alteration, unauthorized
  disclosure of, or access to, Personal Data Processed by Processor.

### 2. Roles of the Parties

2.1 With respect to Personal Data Processed in connection with the Services,
the parties acknowledge that Customer is the Controller and Processor is the
Processor.

2.2 Each party shall comply with its respective obligations under Applicable
Data Protection Law.

2.3 **Independent controllers.** Processor acts as an **independent
controller**, not a Processor for Customer, with respect to:
(a) account contact information collected directly from Customer for billing,
    administration, and license management;
(b) Personal Data Processed by Polar.sh and other payment service providers
    for billing, tax compliance, and payment processing; and
(c) data Processor Processes for its own internal business purposes, such
    as legal compliance, fraud prevention, and product safety.
The remainder of this DPA addresses only Personal Data Processed by Processor
as a Processor on Customer's behalf.

### 3. Scope and Subject Matter of Processing

The subject matter, nature, purpose, duration of Processing, types of Personal
Data, and categories of Data Subjects are described in **Annex 1B (Description
of Processing)**.

### 4. Customer Instructions

4.1 Processor shall Process Personal Data only on documented instructions from
Customer, including with regard to transfers of Personal Data to a third
country, unless required to do so by applicable law. The Agreement, this DPA,
and Customer's use and configuration of the Services constitute Customer's
documented instructions to Processor.

4.2 Processor shall promptly notify Customer if, in Processor's opinion, an
instruction infringes Applicable Data Protection Law. Processor is not
required to follow instructions that, in Processor's reasonable opinion,
violate Applicable Data Protection Law.

### 5. Confidentiality

Processor shall ensure that personnel authorized to Process Personal Data are
bound by appropriate confidentiality obligations and have received
appropriate training on the protection of Personal Data.

### 6. Security of Processing

6.1 Processor shall implement and maintain appropriate technical and
organizational measures designed to protect Personal Data against Security
Incidents and to ensure a level of security appropriate to the risk, taking
into account the nature, scope, context, and purposes of Processing and the
risks to Data Subjects.

6.2 The technical and organizational measures implemented by Processor are
described in **Annex 2 (Technical and Organizational Measures)**. Customer
acknowledges that the measures in Annex 2 provide an appropriate level of
security having regard to the nature of the Personal Data, which is limited
as described in Annex 1B.

### 7. Sub-processors

7.1 **General authorization.** Customer provides general written
authorization for Processor to engage Sub-processors to Process Personal
Data, subject to this Section 7.

7.2 **Current Sub-processors.** The current list of Sub-processors authorized
under this DPA is set out in **Annex 3 (Sub-processors)**.

7.3 **Notice of changes.** Processor shall notify Customer of any intended
addition or replacement of Sub-processors at least **thirty (30) days** in
advance, by updating Annex 3 at [SUBPROCESSOR-LIST-URL] and, if Customer has
subscribed to such notifications, by sending notice to the address Customer
provides for that purpose.

7.4 **Right to object.** Customer may object to a new Sub-processor in
writing within fourteen (14) days of notice on reasonable data protection
grounds. If the parties cannot resolve the objection within thirty (30)
days, Customer may terminate the affected portion of the Services without
penalty by giving written notice to Processor; Customer's exclusive remedy is
such termination and a pro-rated refund of pre-paid fees for the unused
portion of the term.

7.5 **Sub-processor obligations.** Processor shall enter into a written
agreement with each Sub-processor that imposes data protection obligations
substantially equivalent to those in this DPA. Processor remains liable to
Customer for the performance of each Sub-processor's obligations.

### 8. Data Subject Rights

8.1 Taking into account the nature of the Processing, Processor shall assist
Customer by appropriate technical and organizational measures, insofar as
possible, in fulfilling Customer's obligation to respond to requests from
Data Subjects exercising their rights under Applicable Data Protection Law.

8.2 If Processor receives a request from a Data Subject relating to Personal
Data Processed on behalf of Customer, Processor shall, without undue delay,
inform the Data Subject to direct the request to Customer, and shall not
respond substantively to the request except on Customer's documented
instructions or as required by law.

8.3 Given the limited Personal Data Processed (see Annex 1B), Customer can
typically fulfill access, rectification, deletion, and portability requests
without Processor's assistance. Where Customer requires Processor's
assistance, Processor shall provide such assistance for a reasonable
administrative fee unless prohibited by Applicable Data Protection Law.

### 9. Security Incident Notification

9.1 Processor shall notify Customer without undue delay, and in any event
within **seventy-two (72) hours** after becoming aware, of any Security
Incident affecting Personal Data Processed on behalf of Customer.

9.2 The notification shall include, to the extent known: (a) the nature of
the Security Incident, including the categories and approximate number of
Data Subjects and records concerned; (b) the likely consequences; (c) the
measures taken or proposed to address the Security Incident; and (d) a point
of contact for further information.

9.3 Processor's notification of, or response to, a Security Incident is not
an acknowledgment of fault or liability.

### 10. Data Protection Impact Assessments and Prior Consultation

Taking into account the nature of Processing and the information available to
Processor, Processor shall provide reasonable assistance to Customer with any
data protection impact assessments and prior consultations with supervisory
authorities required of Customer under Applicable Data Protection Law.

### 11. Audit Rights

11.1 Processor shall make available to Customer all information reasonably
necessary to demonstrate compliance with this DPA.

11.2 To the extent required by Applicable Data Protection Law, Customer (or
an independent auditor mandated by Customer and reasonably acceptable to
Processor) may, at Customer's expense and on at least **thirty (30) days**
prior written notice, conduct an audit of Processor's compliance with this
DPA, no more than **once in any twelve (12) month period** except where
required by a supervisory authority or following a Security Incident.

11.3 Processor may satisfy its audit obligations under this Section 11 by
providing Customer with copies of relevant third-party certifications,
attestations, or audit reports (such as SOC 2 Type II, ISO 27001, or
equivalent), where available.

11.4 Audits shall be conducted during business hours, shall not unreasonably
interfere with Processor's operations, and shall be subject to confidentiality
obligations.

### 12. International Data Transfers

12.1 To the extent that Processor's Processing of Personal Data on behalf of
Customer involves the transfer of Personal Data from the European Economic
Area, the United Kingdom, or Switzerland to a country not subject to an
adequacy decision, the parties agree that the SCCs (Module Two: Controller to
Processor) are incorporated by reference into this DPA, with the following
selections:

- **Clause 7 (Docking clause):** included.
- **Clause 9 (Sub-processor authorization):** Option 2 (general written
  authorization), with the notice period set out in Section 7.3 of this DPA.
- **Clause 11 (Redress):** the optional language is **not** included.
- **Clause 17 (Governing law):** the law of Ireland.
- **Clause 18 (Forum and jurisdiction):** the courts of Ireland.
- **Annex I.A (Parties):** as set out in Annex 1A of this DPA.
- **Annex I.B (Description of transfer):** as set out in Annex 1B of this DPA.
- **Annex I.C (Competent supervisory authority):** as determined under
  Clause 13 of the SCCs.
- **Annex II (Technical and organizational measures):** as set out in Annex 2
  of this DPA.
- **Annex III (Sub-processors):** as set out in Annex 3 of this DPA.

12.2 For transfers from the United Kingdom, the parties incorporate the **UK
Addendum**, with Tables 1, 2, and 3 completed by reference to this DPA and
the SCCs above, and Table 4 specifying that **neither party** may end the UK
Addendum as set out in Section 19 thereof.

12.3 For transfers from Switzerland, references in the SCCs to the GDPR shall
be deemed to refer also to the FADP, references to "EU Member State" shall
not preclude data subjects in Switzerland from exercising their rights, and
the competent supervisory authority shall be the Swiss Federal Data Protection
and Information Commissioner.

12.4 If the SCCs are amended, replaced, or repealed, the parties shall
cooperate in good faith to implement the successor mechanism.

### 13. Return and Deletion of Personal Data

13.1 Upon termination or expiration of the Agreement, Processor shall, at
Customer's choice, delete or return all Personal Data Processed on behalf of
Customer, and delete existing copies, unless storage is required by
applicable law.

13.2 Given the limited Personal Data Processed, Processor's standard practice
is to delete Personal Data within ninety (90) days of termination, except
that backups containing Personal Data may persist for up to six (6) months
in accordance with Processor's backup rotation, after which they are
overwritten or destroyed. During this retention period, Personal Data
remains subject to the confidentiality and security obligations of this DPA.

### 14. CCPA-Specific Terms

14.1 To the extent Personal Data includes "personal information" as defined
under the CCPA, Processor shall act as a "service provider" as defined under
the CCPA.

14.2 Processor shall not: (a) "sell" or "share" personal information as those
terms are defined under the CCPA; (b) retain, use, or disclose personal
information for any purpose other than the specific purpose of performing the
Services or as otherwise permitted by the CCPA; (c) retain, use, or disclose
personal information outside the direct business relationship between the
parties; or (d) combine personal information received from Customer with
personal information received from any other source, except as permitted
under the CCPA.

14.3 Processor certifies that it understands the restrictions in this
Section 14.

### 15. Liability

The liability of each party under this DPA shall be subject to the exclusions
and limitations of liability set out in the Agreement. Nothing in this DPA
limits liability that cannot be excluded under Applicable Data Protection Law.

### 16. Term and Termination

This DPA takes effect on the Effective Date and continues until the
Agreement terminates or expires, except that Sections 13 (Return and
Deletion), 15 (Liability), and any provisions which by their nature are
intended to survive shall survive termination.

### 17. Order of Precedence

In the event of any conflict or inconsistency between (a) the SCCs or UK
Addendum, (b) this DPA, and (c) the Agreement, the order of precedence with
respect to Processing of Personal Data is (a), then (b), then (c).

### 18. Governing Law

Except where mandatory data protection law requires otherwise (including the
SCCs as set out in Section 12), this DPA is governed by the law specified in
the Agreement, which is **[GOVERNING LAW — e.g., the laws of the State of
Delaware, USA]**.

### 19. Notices

Notices under this DPA shall be sent to the addresses set out in **Annex 1A
(List of Parties)** or as otherwise notified by the parties in accordance
with the Agreement.

### 20. Entire Addendum

This DPA, together with the Agreement, constitutes the entire agreement
between the parties with respect to the Processing of Personal Data and
supersedes any prior data processing terms.

---

## Annex 1A — List of Parties

### Data Exporter (Controller)

- **Name:** [CUSTOMER LEGAL NAME]
- **Address:** [CUSTOMER ADDRESS]
- **Contact for data protection matters:** [CUSTOMER DPO / CONTACT NAME, EMAIL]
- **Activities relevant to the data transferred:** Use of the Services for
  internal software development.
- **Role:** Controller.

### Data Importer (Processor)

- **Name:** Super Mega Lab LLC
- **Address:** 16192 Coastal Highway, Lewes, Delaware 19958
- **Contact for data protection matters:** Legal Department, contact@supermegalab.com
- **Activities relevant to the data transferred:** Provision of the Services,
  including license verification and entitlement issuance, as described in
  the Agreement.
- **Role:** Processor.

---

## Annex 1B — Description of Processing

### Categories of Data Subjects

End users of the Services, who are individuals authorized by Customer to use
the Services (typically Customer's employees, contractors, or other
authorized personnel).

### Categories of Personal Data

The Personal Data Processed by Processor on behalf of Customer is limited to
the following:

| Field | Source | Purpose |
|---|---|---|
| Internal user identifier (`id`) | Generated by Processor | Internal record key |
| Email address (`email`) | Provided via Polar.sh at subscription | License association, support contact, account communications |
| Polar customer identifier (`polar_customer_id`) | Provided by Polar.sh | Reconciliation with billing system, subscription verification |
| Account creation timestamp (`created_at`) | Generated by Processor | Account lifecycle |

In addition, the following Personal Data may be Processed transiently in
connection with the Services:

| Field | Source | Purpose | Retention |
|---|---|---|---|
| IP address | Network connection to license/auth server | Transport-layer connectivity, abuse prevention | [Not retained beyond [N] days in transient logs; not stored in the user record] |
| License/entitlement token contents | Issued by Processor | Authenticate Pro feature use | Tokens are short-lived; no separate copy retained server-side once issued |

### Data NOT Processed

For the avoidance of doubt, Processor does **not** receive, Process, or store
any of the following:

- Source code, file contents, file paths, or file names from Customer's
  development environment.
- Repository names, remote URLs, branch names, commit hashes, commit
  messages, or other version control metadata.
- Prompts, AI completions, model inputs or outputs, or assistant
  conversations.
- Editor activity, keystrokes, telemetry events, behavioral analytics, or
  product usage events.
- Diagnostics, error reports, or crash dumps (the Services do not transmit
  these to Processor).
- Repository visibility status (the Services determine repository visibility
  from the user's machine by querying the applicable repository host
  directly; Processor does not receive this information).

### Special Categories of Personal Data

None. The Services are not intended to Process special categories of
Personal Data within the meaning of Article 9 GDPR.

### Nature and Purpose of Processing

Processor Processes the Personal Data described above solely for the
following purposes:

1. To verify subscription status and issue signed entitlement tokens used by
   the Services to enable Pro features.
2. To associate license entitlements with the correct Customer account.
3. To send transactional communications relating to the Services and the
   subscription (e.g., subscription expiration, security notices).
4. To provide support if requested by an end user or Customer.
5. To comply with applicable law.

### Frequency of Processing

Continuous during the term of the Agreement, with token-issuance requests
typically occurring at extension startup and on token refresh intervals.

### Duration of Processing

For the duration of the Agreement plus the retention period set out in
Section 13.2.

### Transfers to Sub-processors

The subject matter, nature, and duration of Processing by Sub-processors are
as set out in Annex 3.

---

## Annex 2 — Technical and Organizational Measures

Processor implements and maintains the following technical and organizational
measures, taking into account the limited nature of the Personal Data
Processed:

### Privacy by Design

- **Data minimization:** Processor collects and stores only the data fields
  enumerated in Annex 1B. The Services are architected to avoid transmitting
  source code, repository metadata, or telemetry to Processor.
- **No telemetry:** The Services contain no telemetry, analytics, behavioral
  event logging, or product-usage reporting.
- **Local-first repository checks:** Repository visibility is determined on
  the user's machine by querying the applicable repository host (e.g., GitHub,
  GitLab) directly; this information is not transmitted to Processor.
- **Public network layer:** The network code in the Services is published as
  source-available code so that Customer may inspect all network behavior.

### Access Control

- Access to systems Processing Personal Data is limited to authorized
  personnel on a least-privilege basis.
- Authentication to administrative interfaces requires [SSO / strong password
  + MFA].
- Access is logged and reviewed [periodically / quarterly].

### Encryption

- **In transit:** All network communication between the Services and
  Processor's servers, and between Processor and Sub-processors, uses TLS 1.2
  or higher.
- **At rest:** Personal Data stored in Processor's databases is encrypted at
  rest using [AES-256 / provider-managed encryption].
- **Tokens:** Entitlement tokens are signed using [SIGNING ALGORITHM] and
  verified locally by the Services.

### Pseudonymization

The internal user identifier (`id`) is a non-identifying value not derived
from Personal Data. Where feasible, Processor uses this identifier rather
than email in internal logs and processing pipelines.

### System Security

- Servers are hosted with Vercel in the United States, which provides
  physical security, environmental controls, and infrastructure security
  consistent with industry standards.
- The license and authentication services run on [HOSTING DESCRIPTION].
- Operating systems and runtime dependencies are patched on a regular cadence.

### Logging and Monitoring

- Application logs are retained for [N] days.
- Logs are reviewed for security-relevant events.
- Logs do not contain source code, repository metadata, file paths, or other
  Customer development data.

### Backup and Recovery

- Backups of the user database are taken [DAILY] and retained for
  six (6) months in accordance with Section 13.2.
- Backups are encrypted at rest.

### Personnel

- Personnel with access to Personal Data are subject to written
  confidentiality obligations.
- Personnel receive training on data protection and security obligations on
  hire and [periodically thereafter].

### Incident Response

- Processor maintains an incident response procedure consistent with the
  notification obligations in Section 9.
- Security Incidents are tracked, investigated, and remediated in accordance
  with that procedure.

### Vendor Management

- Sub-processors are subject to written agreements imposing data protection
  obligations substantially equivalent to those in this DPA.

### Verification

- Processor periodically reviews these measures and updates them as
  appropriate. Processor may update Annex 2 from time to time, provided that
  no update materially diminishes the level of protection.

---

## Annex 3 — Sub-processors

The following Sub-processors are authorized to Process Personal Data on
Processor's behalf in connection with the Services as of the Effective Date:

| Sub-processor | Role | Personal Data Processed | Location |
|---|---|---|---|
| **Polar Software, Inc.** (Polar.sh) | Subscription management; provides email and customer identifier to Processor | email, polar_customer_id | United States |
| **Vercel** (including **Vercel Postgres** for the database) | Hosting of license/auth server and database; TLS termination | All Personal Data in Annex 1B; transient connection logs | United States |
| **Resend** | Sending transactional account/subscription emails | email | United States |

> **Note on Polar.sh:** Polar acts as merchant of record and as an
> independent controller of payment-related Personal Data (including payment
> method, billing address, and transaction history). Processor does not
> receive payment Personal Data from Polar; Processor receives only the
> email and customer identifier needed to associate a subscription with an
> end user account. Polar's processing of payment data is governed by
> Polar's own terms and privacy policy.

The current list of Sub-processors is maintained at:
**[SUBPROCESSOR-LIST-URL]**

---

## Signature Block

| **Customer (Controller)** | **Super Mega Lab LLC (Processor)** |
|---|---|
| Signature: __________________________ | Signature: __________________________ |
| Name: ________________________________ | Name: ________________________________ |
| Title: _______________________________ | Title: _______________________________ |
| Date: ________________________________ | Date: ________________________________ |

---

## Drafting Notes (REMOVE BEFORE DELIVERY)

These notes flag items that the drafting attorney and the business should
finalize.

### Items requiring decision

1. **Licensor legal entity** — name, jurisdiction, registered address.
2. **EU representative** under GDPR Art. 27 — required if Processor is
   established outside the EU and offers Services to EU data subjects.
   Common low-cost options: [EU-REP SERVICE].
3. **UK representative** under UK GDPR Art. 27 — required on the same basis
   for UK data subjects.
4. **Governing law** for the underlying Agreement (Section 18).
5. **SCC Clause 17 governing law** and **Clause 18 forum** — typically
   Ireland or another EU Member State; pick consistently.
6. **Sub-processor list URL** — where the live list will be published.
7. **Sub-processor objection period** — 14 vs. 30 days; default in draft is
   14 days but 30 is common for enterprise.
8. **Notification address** for sub-processor changes — email vs. RSS vs.
   in-product notice.
9. **Backup retention period** — must match operational reality.
10. **IP-address logging policy** — Annex 2 currently says "transient";
    confirm with ops what this actually means (no logging? rotated daily?
    retained at hosting provider?).
11. **Signing algorithm** for entitlement tokens (Annex 2).
12. **Hosting provider** and **region** — fill into Annex 2 and Annex 3.

### Items the business should validate

1. **Is the Customer's contracting party an organization, or an individual
   developer?** This DPA is drafted for a B2B Customer (Controller). For
   individual developers buying for personal use, GDPR generally treats them
   as the Data Subject themselves, and a DPA is unnecessary; the privacy
   policy alone is sufficient. Most enterprises will require a DPA, and
   this draft is for that case.

2. **Do you accept the SCC Module Two clause?** Module Two (Controller to
   Processor) is correct given the structure here. Do not switch to Module
   One unless your role changes to controller-to-controller.

3. **Are you OK with 72-hour breach notification?** This matches GDPR
   Art. 33 expectations from Customer. Some Processors push for "without
   undue delay" only; expect Customer pushback if you do.

4. **Audit rights.** The draft caps audits at one per twelve months and
   allows third-party reports in lieu — both are common Processor-friendly
   positions. Enterprises may ask for more.

5. **Polar's status.** Confirm with Polar that your understanding of their
   merchant-of-record + independent-controller role is correct, and that
   their DPA / processing terms cover the data flow you describe. The
   description in Annex 3 should match what Polar publishes.

6. **Account communications and email frequency.** The draft permits
   transactional emails. If you intend to send marketing, a separate
   consent path and a marketing privacy notice are needed.

7. **EULA acceptance.** GitLens does not collect explicit EULA acceptance
   in-product; acceptance flows through the GitKraken sign-up. Polar's
   checkout flow should similarly capture acceptance of your EULA at
   purchase. Confirm Polar's checkout supports linking to and recording
   acceptance of your EULA, or add a click-through on first launch of the
   Services. **Without a captured acceptance event somewhere in the chain,
   enforcement of EULA terms against an end user is harder.**

8. **CCPA "service provider" status.** Section 14 assumes Processor never
   uses Personal Data for its own purposes beyond the service relationship.
   Do not allow product analytics or marketing use of license-server data
   without revisiting this section.

### Companion documents you will also need

- **Privacy Policy** (public-facing; describes Processor's processing as
  controller, including the same minimal data set).
- **Acceptable Use Policy** (referenced from EULA).
- **Cookie / tracking notice** for any web properties (marketing site,
  account portal, docs).
- **Sub-processor list page** at the URL referenced above.
- **Security overview / trust page** (helps clear procurement faster than
  filling out questionnaires).

