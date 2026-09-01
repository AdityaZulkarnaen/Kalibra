> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/trading/event-contracts.md).

# Event Contracts

Event Contracts are simple Up/Down markets on crypto prices. Pick a market, choose a side, and stake USDso: if the asset closes the window at or above its opening price, Up wins; below, Down wins. Every winning contract pays out exactly 1 USDso at settlement, and the most you can ever lose is your stake.

## Features

* **Zero Fees**: no entry, settlement, or winnings fee.
* **Capped Risk**: fully collateralized, no leverage, no liquidations — your stake is your maximum loss.
* **Rolling Windows**: BTC and ETH markets on 15-minute and 1-hour windows today, with more assets and windows to come. One window closes, the next opens.
* **Fair Odds**: prices come from a live on-chain order book, not a house line. What you see is the market's real read on the odds.
* **On-Chain Settlement**: everything settles non-custodially on Somnia in USDso, and every result can be checked against the published settlement reference.

## How a market works

1. **Pick a window** — e.g. *BTC, 15 minutes*. The line to beat is the window's **opening price**.
2. **Choose a side and stake** — prices are quoted between 0 and 1 USDso and read as the market's implied chance: buying Up at 0.60 costs 0.60 USDso per contract.
3. **Hold or exit** — you can sell back at the live price any time while the window is open.
4. **Settlement** — when the clock runs out, the closing price is compared to the opening price. Winning contracts redeem for 1 USDso each; losing contracts expire worthless. See [Settlement & Voids](/trading/event-contracts/settlement-and-voids.md).

{% hint style="info" %}
A worked example: stake 60 USDso on Up at a price of 0.60 and you hold 100 contracts. If the window closes at or above its opening price, you redeem 100 USDso. If not, the 60 USDso stake is gone — nothing more.
{% endhint %}

Find Event Contracts in the dreamDEX app at [app.dreamdex.io/event-contracts](https://app.dreamdex.io/event-contracts), next to Trade and Portfolio.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/trading/event-contracts.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
