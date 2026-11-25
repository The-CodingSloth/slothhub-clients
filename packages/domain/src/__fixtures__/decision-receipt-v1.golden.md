# SlothHub decision receipt

> Imported receipt content is unverified. Review it before relying on the decision.

- Receipt: golden&#45;決定
- Created: 2026&#45;07&#45;22T18:00:00&#46;000Z
- Catalog snapshot: 2026&#45;07&#45;20T17:00:00&#46;000Z
- Selected Tool: Undecided

## Requirements

- Works offline&#10;when traveling — present

## Criteria

- privacy: Privacy — No remote processing

## Candidates

### Café Tool

- Note: Missing current pricing&#46;
- privacy: present — value: Local only — note: Checked manually — evidence checked: 2026&#45;07&#45;18T12:00:00&#46;000Z — citations: docs
- Pricing: unknown

### Unavailable Tool

- privacy: not evaluated
- Availability: user asserted absent

## Rationale

Undecided&#46;&#10;More evidence is needed&#46;

## Tradeoffs

- Freshness vs&#46; certainty
- Unicode: 🦥

## Rejected candidates

- tool&#45;unavailable — No longer available&#46;

## Citations

- Privacy docs — https://example&#46;com/privacy — checked 2026&#45;07&#45;18T12:00:00&#46;000Z

<!-- SLOTHUB_DECISION_RECEIPT_JSON_V1_BEGIN -->
```json
{"candidates":[{"evaluations":[{"citationIds":["docs"],"criterionId":"privacy","evidenceCheckedAt":"2026-07-18T12:00:00.000Z","note":"Checked manually","state":"present","value":"Local only"}],"facts":[{"key":"pricing","label":"Pricing","state":"unknown"}],"note":"Missing current pricing.","tool":{"id":"tool-cafe","name":"Café Tool","slug":"cafe","url":"https://example.com/cafe"}},{"evaluations":[{"criterionId":"privacy","state":"not_evaluated"}],"facts":[{"key":"availability","label":"Availability","state":"user_asserted_absent"}],"tool":{"id":"tool-unavailable","name":"Unavailable Tool","slug":"unavailable"}}],"catalogSnapshotAt":"2026-07-20T17:00:00.000Z","citations":[{"checkedAt":"2026-07-18T12:00:00.000Z","id":"docs","title":"Privacy docs","url":"https://example.com/privacy"}],"createdAt":"2026-07-22T18:00:00.000Z","criteria":[{"description":"No remote processing","id":"privacy","label":"Privacy"}],"extensions":{"x-note":"résumé"},"rationale":"Undecided.\nMore evidence is needed.","receiptId":"golden-決定","rejectedCandidates":[{"rationale":"No longer available.","toolId":"tool-unavailable"}],"requirements":[{"id":"offline","state":"present","text":"Works offline\nwhen traveling"}],"schemaVersion":"1","selectedTool":null,"tradeoffs":["Freshness vs. certainty","Unicode: 🦥"],"versions":{"catalog":"sha256:golden","producer":"golden@1","schema":"1"}}
```
<!-- SLOTHUB_DECISION_RECEIPT_JSON_V1_END -->
