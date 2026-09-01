> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/trading/event-contracts/settlement-and-voids.md).

# Settlement & Voids

## What settles a market

Each window resolves against its **opening price**: if the settlement price is at or above it, Up wins; below it, Down wins. The settlement price comes from a multi-source price reference — never a single exchange tick — and each market's reference and result are published, so every settlement can be checked.

## Checking a settlement yourself

Every market's settlement question is public on the [oracle explorer](https://prd.oracle.somnia.host/explore). Open a question and switch to the **Graph** tab to see the whole pipeline for that specific market: the question as it was recorded on-chain, each price source with the value it returned, the median across them, how many sources had to agree, and which side that median landed on.

Nothing about a settlement is a black box. If a result ever looks wrong, that page is the receipt.

## The lifecycle

1. **Trading** — orders accepted while the window is open. You can exit any time at the live price.
2. **Locked** — the window ends; no new orders. Resting orders can still be cancelled.
3. **Resolved** — the settlement price is compared to the opening price and the winning side is fixed. Winning contracts redeem for 1 USDso each.

The comparison happens within a short settlement window after expiry. Markets roll continuously, so the next window is already open while the previous one settles.

## Voided markets

If a reliable settlement price cannot be determined within the settlement window, the market **voids rather than settling on bad data**. In a voided market there is no winner: **both sides redeem at 0.5 USDso per contract**, returning the pooled collateral evenly. No fee is taken on a void.

{% hint style="warning" %}
A voided market is a refund, not a loss: whatever side you held, each contract returns 0.5 USDso — exactly the collateral that backed it.
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/trading/event-contracts/settlement-and-voids.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
