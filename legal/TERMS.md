# Provider-Specific Terms (DRAFT)

**For use with:** Bonterms Standard End User Agreement (Version 1.0)
(<https://bonterms.com/standard/end-user-agreement-v1/>) (the "**Standard
Agreement**").

**Provider:** Super Mega Lab LLC
**Product:** Agentic Bookmarks VS Code extension and related components.
**Last updated:** May 12, 2026
**Version:** 1.0

> **DRAFT — NOT LEGAL ADVICE.** This document is a working draft prepared
> from the product's stated architecture and licensing strategy. It must
> be reviewed and finalized by a qualified software/privacy attorney
> before use. Placeholder fields are marked `[BRACKETED]`. Do not deliver
> to a customer or publish on the Marketplace listing in this state.
>
> Drafting assumptions:
> - Provider distributes the Software via the VS Code Marketplace (and
>   optionally Open VSX) and uses Polar.sh as merchant of record.
> - Public-repository Pro features are available without a paid
>   subscription as a deliberate Additional Use Grant.
> - The Software contains no telemetry, no analytics, and no behavioral
>   event logging.
> - AI/MCP features execute locally on the Customer's device using the
>   Customer's own AI provider; Provider does not receive or process AI
>   inputs or outputs.
> - Provider publishes the public-repository portions of the Software
>   under **PolyForm Shield 1.0.0**; the proprietary core is
>   maintained in a separate private repository and is distributed
>   only in compiled form, bundled into the Marketplace release.
> - The Product launches in a Beta Period during which all Pro
>   Features are available to all users at no cost; the license
>   verification service is not yet running during the Beta Period.
> - Capitalized terms not defined here have the meanings given in the
>   Standard Agreement.

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

## How these Provider-Specific Terms apply

These Provider-Specific Terms ("**Provider-Specific Terms**") are issued
by Provider under Section 1.1 of the Standard Agreement and form part of
the Agreement between Provider and Customer.

In any conflict, the order of precedence stated in Section 1.4 of the
Standard Agreement applies: (i) any Amendment, (ii) these
Provider-Specific Terms, then (iii) the Standard Agreement. Where these
Provider-Specific Terms supplement (rather than conflict with) the
Standard Agreement, both apply.

---

## 1. Provider Identification

**Provider:** Super Mega Lab LLC, a Delaware limited liability company.
**Registered office:** 16192 Coastal Highway, Lewes, Delaware 19958.
**Notice address:** contact@supermegalab.com.
**Privacy contact:** contact@supermegalab.com.
**Support contact:** contact@supermegalab.com.

## 2. The Product

**Product**, as defined in Section 1.1 of the Standard Agreement,
comprises:

(a) the **Agentic Bookmarks VS Code extension** distributed through the
    Visual Studio Marketplace and, where Provider chooses to publish
    there, Open VSX (the "**Extension**");

(b) the bundled **MCP server** that runs locally on Customer's device
    (the "**MCP Server**");

(c) the **license verification and entitlement service** operated by
    Provider (the "**License Service**"); and

(d) any updates, patches, and successor versions Provider makes
    generally available.

For purposes of the Standard Agreement:

- The Extension and MCP Server are **Provider Software** under
  Section 2.2.
- The License Service is a **Cloud Service** under Section 2.1, but its
  scope is limited to license activation, entitlement issuance, and
  related communications described in these Provider-Specific Terms and
  the Privacy Policy. Customer Data (as defined in the Standard
  Agreement) is not transmitted to or processed by the License Service
  except as set out in Section 6 of these Provider-Specific Terms.

## 3. Subscriptions, Fees, and Billing

### 3.1 Marketplace and merchant of record

Provider sells Subscriptions through **Polar Software, Inc. ("Polar")**,
acting as merchant of record. Customer's purchase relationship for
billing, payment processing, tax collection, and refund handling is with
Polar under Polar's terms, available at <https://polar.sh/legal>. The
Agreement between Provider and Customer for use of the Product is this
Agreement (the Standard Agreement together with these Provider-Specific
Terms).

### 3.2 Subscription tiers

Provider currently offers the following Subscription tiers for the
Product:

| Tier | Pricing | Included |
|---|---|---|
| **Community** (no paid Subscription) | Free | Use of the Product on Public Repositories, including those Pro Features identified at [POLICY URL] as available under the Additional Use Grant in Section 5. |
| **Pro** | [PRICE/USER/PERIOD] | All Pro Features on Private Repositories and Public Repositories. |
| **[Team / Business / Enterprise, if offered]** | [PRICE] | [SCOPE] |

Current pricing and tier composition are stated on Provider's
Marketplace listing and at [PRICING URL]. Provider may add, remove, or
modify tiers; existing Subscriptions remain governed by the tier in
effect at purchase or renewal.

### 3.3 Payment, taxes, and refunds

Fees, taxes, payment terms, and refund mechanics are governed by the
Order placed with Polar and by Polar's terms. Provider is not the
merchant of record and does not directly process payment or tax. Where
the Standard Agreement refers to invoicing, payment, or refunds (e.g.,
in Section 10 of the Standard Agreement and Section 12.4(b) of these
Provider-Specific Terms), Provider satisfies those obligations through
Polar.

### 3.4 Subscription renewal and cancellation

Subscriptions renew and may be cancelled in accordance with the Order
and Polar's checkout. Customer may cancel at any time through Polar;
cancellation takes effect at the end of the then-current Subscription
Term, and access to Pro Features on Private Repositories will continue
until that time. The Community tier remains available without
Subscription, subject to these Provider-Specific Terms.

## 4. Definitions Specific to the Product

The following definitions apply in addition to those in the Standard
Agreement:

- **"Beta Period"** means the period beginning on the Effective Date
  and ending on the Beta End Date stated at [POLICY URL]. The Beta
  End Date may be extended prospectively by Provider by updating
  [POLICY URL]. Section 5A (Beta Free Access Period) governs use of
  the Product during the Beta Period.
- **"Beta End Date"** means the date stated at [POLICY URL] on which
  the Beta Period ends.
- **"Pro Features"** means features of the Product that Provider
  identifies as available only to Subscribers, except where the
  Additional Use Grant in Section 5 or the Beta Free Access Period
  in Section 5A applies.
- **"Public Repository"** means a Git repository whose contents are
  visible to unauthenticated viewers without authorization, as
  determined by the applicable repository host (e.g., GitHub, GitLab,
  Bitbucket). For the avoidance of doubt, a private organization fork
  of a Public Repository is not itself a Public Repository.
- **"Private Repository"** means any Git repository that is not a
  Public Repository, including private repositories on GitHub, GitLab,
  Bitbucket, or any self-hosted Git host.
- **"Public Repository Pro Features"** means the subset of Pro Features
  identified at [POLICY URL] as available without a paid Subscription
  on Public Repositories under the Additional Use Grant in Section 5.
- **"Always-Pro Features"** means Pro Features identified at [POLICY URL]
  as requiring a paid Subscription regardless of repository visibility.
- **"Source-Available Components"** means the portions of the Product
  that Provider publishes in source form in the public repository
  referenced in Section 7. The proprietary core (as described in
  Section 7.5) is not a Source-Available Component.
- **"Marketplace"** means the Visual Studio Marketplace, Open VSX, or
  any other marketplace through which Provider lists the Product.

## 5. Additional Use Grant for Public Repositories

### 5.1 Grant

Notwithstanding any contrary provision of the Standard Agreement,
Provider grants to each Customer a non-exclusive, revocable,
non-sublicensable license to use Public Repository Pro Features when
the Product is used in a workspace consisting solely of Public
Repositories, without a paid Subscription, subject to all other terms
of the Agreement.

### 5.2 Scope and limits

This Additional Use Grant:

(a) covers only Public Repository Pro Features as identified at
    [POLICY URL] as updated by Provider from time to time;

(b) does not extend to Always-Pro Features, which require a paid
    Subscription regardless of repository visibility;

(c) does not extend to use of the Product with any Private Repository
    or any workspace that includes Private Repositories;

(d) does not require Customer to create an account or provide
    identifying information to Provider; and

(e) does not waive or modify the restrictions in Section 7.3 of the
    Standard Agreement (Restrictions) or any other obligation of
    Customer under the Agreement.

### 5.3 Determination of repository status

Repository status is determined by the Product on Customer's device by
querying the applicable repository host. Provider does not receive
repository names, remote URLs, branch names, file paths, commit
metadata, or repository visibility status as part of this determination.
Where the Product cannot determine repository status, the Product may
treat the workspace as eligible for a limited grace period before
requiring a paid Subscription, as described in the Documentation.

### 5.4 Updates to the Additional Use Grant

Provider may update the scope of Public Repository Pro Features at
[POLICY URL] from time to time. Updates take effect prospectively and
do not retroactively affect prior compliant use. Provider will provide
reasonable notice of material reductions in scope through the Product
or at [POLICY URL].

## 5A. Beta Free Access Period

### 5A.1 Grant

From the Effective Date through the Beta End Date, Provider grants to
each Customer a non-exclusive, revocable, non-sublicensable license to
use **all Pro Features, including Always-Pro Features**, without a
paid Subscription, subject to all other terms of the Agreement (the
"**Beta Free Access Period**").

### 5A.2 Scope and limits

The Beta Free Access Period:

(a) applies to all Pro Features, including Always-Pro Features, until
    the Beta End Date;

(b) does not require Customer to create an account, provide payment
    information, or contact Provider in any way;

(c) does not waive or modify the restrictions in Section 7.3 of the
    Standard Agreement or Section 10 (Acceptable Use) of these
    Provider-Specific Terms; and

(d) is independent of the Additional Use Grant in Section 5 (Public
    Repositories), which continues to apply after the Beta End Date.

### 5A.3 Extension and revocation

Provider may extend the Beta Period by prospectively updating the Beta
End Date at [POLICY URL]. Provider may also modify or revoke the Beta
Free Access Period prospectively by updating [POLICY URL]. Any such
modification or revocation takes effect prospectively only and does
not retroactively affect Customer's use during the Beta Period that
complied with the Agreement.

### 5A.4 Transition after the Beta End Date

Beginning on the Beta End Date, access to Pro Features will be subject
to the ordinary Subscription requirements and to the Additional Use
Grant in Section 5. Provider will provide reasonable advance notice of
the Beta End Date through the Product, the Marketplace listing, or at
[POLICY URL].

## 6. Telemetry and Data Collection

### 6.1 No telemetry

Notwithstanding Section 3.4 of the Standard Agreement (Usage Data),
Provider does **not** collect Usage Data from the Product. The Product
contains no telemetry, no analytics, no behavioral event logging, and
no product-usage reporting. Provider does not receive:

(a) source code, file contents, file paths, file names, or document
    contents;

(b) repository names, remote URLs, branch names, commit hashes, commit
    messages, or other version control metadata;

(c) prompts, AI completions, model inputs or outputs, or assistant
    conversations;

(d) editor activity, keystrokes, command invocations, or feature-usage
    events;

(e) diagnostics, error reports, crash dumps, or stack traces; or

(f) repository visibility status (which is determined locally as
    described in Section 5.3).

### 6.2 Limited Provider data

In connection with the License Service, Provider receives and stores
only:

(a) an internal user identifier issued by Provider;

(b) the email address associated with the Subscription, provided by
    Polar;

(c) the Polar customer identifier, for reconciliation;

(d) the account creation timestamp; and

(e) transient connection metadata (including IP address) processed by
    Provider's hosting infrastructure as part of TLS connection
    establishment.

The use, retention, and deletion of these limited categories of data
are governed by Provider's Privacy Policy and DPA referenced in
Section 9.

### 6.3 Future telemetry, if any

If Provider in the future introduces telemetry, analytics, or other
data-collection capabilities, those capabilities will be (i) **off by
default**, (ii) disclosed in advance through the Privacy Policy and the
Product's documentation, (iii) subject to Customer's affirmative opt-in
where required by Law, and (iv) reflected in an updated version of these
Provider-Specific Terms before any data is collected.

## 7. Source-Available Components

### 7.1 Separate license for Source-Available Components

Provider publishes the public-repository portions of the Product as
**Source-Available Components** in a public repository at [REPO URL]
under **PolyForm Shield 1.0.0** (the "**Source-Available License**").
The text of the Source-Available License is included in the public
repository and is reproduced at [LICENSE URL].

Use of the Source-Available Components is governed by the
Source-Available License with respect to the rights granted thereunder.
Use of the Product as a whole, including the proprietary core (as
described in Section 7.5) and any use of the Source-Available
Components in conjunction with the proprietary core or in connection
with a Subscription, is additionally governed by this Agreement.

### 7.2 Reverse engineering carve-out

The restrictions in Section 7.3(b) of the Standard Agreement (reverse
engineering, decompilation, and source access) **do not apply** to the
Source-Available Components, which are made available in source form
under the Source-Available License. Customer's rights with respect to
the source of the Source-Available Components are governed by the
Source-Available License.

For the avoidance of doubt, Section 7.3(b) of the Standard Agreement
continues to apply in full to all proprietary components of the Product
that Provider has not published in source form, and the Source-Available
License does not grant rights with respect to those proprietary
components.

### 7.3 Anti-cloning preserved

Nothing in the Source-Available License or in this Section 7 grants
Customer a license, by implication or otherwise, to:

(a) use the Source-Available Components, alone or in combination with
    any other materials, to develop, train, or produce a product or
    service that competes with the Product (which remains prohibited
    under Section 7.3(f) of the Standard Agreement); or

(b) use the Source-Available Components or the Product to train,
    fine-tune, or evaluate any artificial intelligence or machine
    learning model intended to reproduce, reimplement, or substitute
    for the Product or any substantial portion of it.

### 7.4 No additional grant

The Source-Available License is the **only** license under which
Provider has published the Source-Available Components in source form.
This Agreement does not expand the rights granted by the Source-Available
License with respect to those components.

### 7.5 Proprietary core distributed in compiled form

The proprietary core of the Product is maintained in a separate
private repository operated by Provider, is **not published as
source**, and is distributed only as a compiled artifact bundled into
the Marketplace release of the Product. Use of the proprietary core
is governed solely by the Agreement (the Standard Agreement together
with these Provider-Specific Terms); no source-available license,
including the Source-Available License referenced in Section 7.1,
grants any rights with respect to the proprietary core.

The Product, as installed by Customer, is dependent on the proprietary
core: the Source-Available Components alone do not constitute a
functional implementation of the Product. Customer's right to use the
Marketplace release of the Product, including the bundled proprietary
core, is conferred only by this Agreement.

## 8. Local AI Features and Customer AI Providers

### 8.1 Local execution

The Product's AI-related features execute locally on Customer's device.
Where the Product uses the Model Context Protocol (MCP) or otherwise
interacts with an AI agent or model, that interaction occurs between
the Product, Customer's local environment, and Customer's chosen AI
provider. **Provider does not operate, host, route, intercept, log, or
have access to Customer's prompts, AI completions, model inputs, model
outputs, or any other AI interaction data.**

### 8.2 Customer AI provider relationship

Customer's relationship with its chosen AI provider (including any
agreement, privacy notice, and acceptable-use policy of that provider)
is solely between Customer and that AI provider, and is governed by
Section 8 of the Standard Agreement (Third-Party Platforms).

### 8.3 No model training by Provider

Provider does not use Customer's data, source code, prompts, AI
interactions, or other materials to train, fine-tune, or evaluate any
artificial intelligence or machine learning model. Because Provider
does not receive Customer Data or AI interaction data (see Sections 6
and 8.1), there is no Provider data-collection pathway through which
such training could occur.

## 9. Privacy and Data Protection

### 9.1 Privacy Policy

Provider's Privacy Policy is published at [PRIVACY POLICY URL] and is
incorporated by reference. The Privacy Policy describes the limited
categories of personal data Provider processes (consistent with
Section 6.2), the legal bases for processing, retention, and Customer
rights.

### 9.2 Data Protection Addendum

For the purposes of Section 3.3 of the Standard Agreement, Provider's
**Data Protection Addendum** is published at [DPA URL] and applies to
the extent applicable data protection law requires a controller-processor
agreement between Provider and Customer.

### 9.3 Data Handling Statement

Provider also publishes a short-form Data Handling Statement at
[DATA-HANDLING URL] for use with Customers whose diligence is satisfied
by a concise privacy and data-flow disclosure rather than a full DPA.

## 10. Acceptable Use

In addition to the restrictions in Section 7 of the Standard Agreement,
Customer will not, and will not permit any User or other person to:

(a) use the Product, the Source-Available Components, or any portion of
    either to develop, train, or produce a product or service that
    competes with the Product;

(b) use the Product or any portion of it to train, fine-tune, or
    evaluate any artificial intelligence or machine learning model
    intended to reproduce or substitute for the Product;

(c) circumvent, disable, or interfere with the License Service,
    entitlement verification, or any access-control mechanism in the
    Product;

(d) misrepresent repository visibility status to obtain access to Pro
    Features that would otherwise require a paid Subscription;

(e) use the Product to scrape, mirror, or systematically extract content
    from any repository host or third-party service in a manner that
    violates that service's terms of use; or

(f) remove, alter, or obscure any proprietary notice, license file, or
    attribution included in or with the Product.

## 11. Termination of the Additional Use Grant

The Additional Use Grant in Section 5 is **revocable**. Provider may
revoke or modify the scope of the Additional Use Grant prospectively by
updating [POLICY URL]. Revocation does not retroactively affect prior
compliant use under the Grant.

In addition to the termination rights in Section 12 of the Standard
Agreement, Provider may terminate the Additional Use Grant with respect
to a particular Customer if Provider reasonably determines that the
Customer has materially breached Section 5.2 (Scope and limits) or
Section 10 (Acceptable Use). Such termination does not affect the
Customer's rights under any then-current paid Subscription.

## 12. Suspension of Marketplace Access

In addition to Section 11 of the Standard Agreement (Suspension),
Provider may disable a Customer's License Service entitlement, without
notice, if Provider reasonably believes the Customer has tampered with,
bypassed, or fraudulently obtained access to the Product. Provider will
make reasonable efforts to notify the Customer and to restore
entitlement if the underlying issue is resolved.

## 13. Updates to these Provider-Specific Terms

Provider may update these Provider-Specific Terms from time to time.
The current version is published at [PROVIDER TERMS URL]. Material
changes affecting Customer's rights or obligations will be communicated
through the Product, the Marketplace listing, or by email to the
address associated with the Subscription, with at least **thirty (30)
days** notice before the change takes effect. Customer's continued use
of the Product after a material change takes effect constitutes
acceptance of the updated terms; if Customer does not accept, Customer
must cease use and may cancel any paid Subscription for a pro-rata
refund of unused fees through Polar.

## 14. Governing Law, Venue, and Dispute Resolution

### 14.1 Governing law

For the purposes of Section 19 of the Standard Agreement, the
**Governing Law** of the Agreement is the laws of the **State of
Delaware**, without reference to its conflict-of-laws rules. The
United Nations Convention on Contracts for the International Sale of
Goods does not apply.

### 14.2 Courts and venue

For the purposes of Section 19 of the Standard Agreement, the
**Courts** are the state and federal courts located in
**New Castle County, Delaware**, and each party consents to the
exclusive jurisdiction and venue of those courts. Notwithstanding the
foregoing, either party may seek injunctive or other equitable relief
in any court of competent jurisdiction to protect its intellectual
property or confidential information.

### 14.3 Class action waiver

To the extent permitted by Law, each party waives any right to bring
or participate in a class, collective, or representative action
arising out of or related to the Agreement.

### 14.4 [Optional: arbitration]

[OPTION — discuss with counsel: include a binding arbitration clause
and jury trial waiver, e.g., "Any dispute arising out of or related to
the Agreement that is not resolved within 30 days of written notice
will be resolved by final and binding arbitration administered by [JAMS
/ AAA] in [Wilmington, Delaware] under its [Streamlined / Commercial]
Arbitration Rules. Each party waives any right to a jury trial." Note
that arbitration trades court access for speed and confidentiality;
weigh against the cost-recovery benefits of court litigation for IP
disputes.]

## 15. Notices

For the purposes of Section 19 of the Standard Agreement, notices to
Provider must be sent to **contact@supermegalab.com** and to the postal address in
Section 1 of these Provider-Specific Terms. Notices to Customer will be
sent to the email address associated with the Subscription or, for
Community-tier users without a Subscription, may be communicated through
the Product, the Marketplace listing, or [POLICY URL].

## 16. U.S. Government End Users

The Product is "commercial computer software" or a "commercial item" for
purposes of FAR 12.212 and DFARS 227.7202. Use, reproduction, release,
modification, disclosure, or transfer of the Product by U.S. Government
end users is governed solely by the Agreement, and all other use is
prohibited.

## 17. Hazardous and High-Risk Use

Without limiting Section 7.2 of the Standard Agreement, the Product is
not designed for and may not be used in connection with the operation
of nuclear facilities, aircraft navigation or communication systems,
air traffic control systems, life-support systems, weapons systems, or
any other application in which failure of the Product could result in
death, personal injury, or environmental damage.

## 18. Severability and Survival

If any provision of these Provider-Specific Terms is held invalid or
unenforceable, that provision will be limited to the minimum extent
necessary so that the remainder of these Provider-Specific Terms and
the Agreement remain in effect. The provisions of Sections 5 and 5A
(Additional Use Grants and Beta Free Access Period scope and limits,
but not the Grants themselves, which are revocable), 6 (Telemetry),
7 (Source-Available Components and proprietary core), 8 (Local AI
Features), 9 (Privacy), 10 (Acceptable Use), and 14 (Governing Law)
survive expiration or termination of the Agreement to the extent
necessary to give effect to their terms.

---

## Drafting Notes (REMOVE BEFORE PUBLICATION)

These notes flag items that the drafting attorney and the business
should finalize.

### Items requiring decision

1. **Provider legal entity** — name, jurisdiction of formation,
   registered office, notice address.
2. **Pricing and tier structure** in Section 3.2 — fill in once
   pricing is set.
3. **Source-available license** — selected: **PolyForm Shield 1.0.0**.
   Sections 7.1, 7.2, 7.3, and 7.5 reflect this choice.
4. **Source-available repo URL** in Section 7.1.
5. **Policy URL for Public Repository Pro Features** — Section 5 hooks
   to this URL; the live list of which Pro Features are free on Public
   Repositories should live here.
6. **Privacy Policy URL** in Section 9.1.
7. **DPA URL** in Section 9.2 (long-form DPA already drafted).
8. **Data Handling Statement URL** in Section 9.3 (short-form already
   drafted).
9. **Provider-Specific Terms URL** in Section 13 (where these terms
   themselves are published — likely
   [licensor.com]/legal/marketplace-terms).
10. **Pricing URL** in Section 3.2.
11. **Notice email** in Section 15.
12. **Arbitration option** in Section 14.4 — discuss with counsel.
    Default draft does not include arbitration; class-action waiver is
    retained.
13. **Repository visibility "grace" behavior** in Section 5.3 — must
    match the implementation in the gating code.
14. **Always-Pro vs. Public-Repo Pro Features list** — must match the
    `isProFeatureOnAllRepos` partition in the code. Keep the policy
    page and the code in sync; consider an automated check.

### Items the business should validate

1. **Polar's role** — confirm Polar acts as merchant of record (not
   merely payment processor) for your geography mix, and that
   Customer's purchase contract is with Polar in those jurisdictions.
   If Polar is only a payment processor in some markets, the wording
   in Section 3 may need a regional split.
2. **Open VSX listing** — Section 2(a) anticipates listing on Open VSX.
   Remove the reference if you don't plan to list there; Open VSX has
   its own publisher terms that should be reviewed.
3. **No-account default** — Section 5.2(d) commits to "no account
   required" for the Additional Use Grant. Make sure the gating code
   actually does not require sign-in for Public Repository Pro
   Features. If you ever want to require a free account for those
   features, this clause must be amended *before* the change ships.
4. **Updates and material change** — Section 13 commits to 30 days'
   notice of material changes. Match this in your release/comms
   process. Cosmetic or clarifying changes can ship without notice.
5. **The promise of no future telemetry without opt-in** —
   Section 6.3 is a hard commitment. Confirm with product/eng that
   "off by default + opt-in" is acceptable if telemetry is ever
   considered. Removing this clause later would be a material change
   under Section 13.
6. **Source-available reverse-engineering carve-out** — Section 7.2
   is essential to avoid contradicting your published source-available
   license. PolyForm Shield 1.0.0 supports the rights referenced
   here; reconfirm if you ever change licenses.
7. **Definition of "Public Repository"** in Section 4 — relies on the
   repository host's definition. If you ever support self-hosted Git
   without a clear public/private signal, the definition may need
   refinement.
8. **Class-action waiver enforceability** — Section 14.3 is broadly
   enforceable in the US under federal law but has carve-outs in some
   states. Counsel can advise.
9. **U.S. Government clause** in Section 16 — keep if you intend to
   sell to or be installed by US Government users, even indirectly via
   contractors. It costs nothing to keep.

### Companion documents referenced from these Provider-Specific Terms

- **Privacy Policy** at [PRIVACY POLICY URL] — still to draft.
- **Data Protection Addendum** at [DPA URL] — drafted as
  `DPA.md`.
- **Data Handling Statement** at [DATA-HANDLING URL] — drafted as
  `DATA-HANDLING.md`.
- **Public Repository Pro Features policy** at [POLICY URL] — list of
  which features are Public-Repo-free vs. Always-Pro; should match the
  gating code.
- **Pricing page** at [PRICING URL].
- **Source-available license file** in the public repo — the
  `LICENSE` file (PolyForm Shield 1.0.0) already prepared at
  `bookmarks/workfolder/drafts/LICENSE`.

### Mechanics of publishing

Publish on the Marketplace listing as follows:

1. Link the **unmodified** Bonterms Standard End User Agreement at
   <https://bonterms.com/standard/end-user-agreement-v1/> (or post an
   exact duplicate hosted by Provider).
2. Link or post these Provider-Specific Terms at
   [PROVIDER TERMS URL].
3. Link the Privacy Policy and DPA at their respective URLs.
4. Capture acceptance through Polar's checkout (which presents the
   bundled terms) and, for Community-tier users, through the
   Marketplace install action and a one-time first-launch dialog if
   counsel recommends it.

### Acceptance event recording (open question)

Counsel should advise whether to record an acceptance event for the
Community tier (e.g., a one-time first-launch dialog that records
"accepted at version X on date Y" locally without phoning home). The
GitLens model does not record such acceptance and has worked at scale,
but a local-only acceptance record costs nothing and strengthens
enforceability.
