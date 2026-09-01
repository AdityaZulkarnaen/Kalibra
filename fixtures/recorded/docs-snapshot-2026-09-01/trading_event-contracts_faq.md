> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/trading/event-contracts/faq.md).

# FAQ

**What does the price mean?** Prices are quoted between 0 and 1 USDso and read as the market's implied chance of Up winning. Up at 0.72 means the market currently prices a 72% chance the window closes at or above its opening price. Up and Down prices always sum to 1.

**What is "the line to beat"?** The window's opening price. There are no preset strikes — each window resolves against where it opened.

**Are fees really zero?** Yes. No entry fee, no settlement fee, no cut of winnings.

**Can I exit before the window closes?** Yes — sell back at the live price any time while the market is in Trading.

**What happens if the price feed fails?** The market voids instead of settling on unreliable data. Both sides redeem at 0.5 USDso per contract. See [Settlement & Voids](/trading/event-contracts/settlement-and-voids.md).

**When does the next market open?** Windows roll continuously — as one closes, the next one for the same asset and duration is already open.

**Where are my funds?** On-chain, non-custodial, in USDso. Positions are tokens in your wallet; winnings are redeemed on-chain after settlement.

**How much volume has a market traded?** It is not shown in the app yet, but it is on-chain, so nothing has to be reconstructed: every market carries the collateral traded, the number of contracts, and the trade count on its own row. [Read a market's volume](/developers/event-contracts/recipes.md#read-a-markets-volume) has the one call that returns them, and explains what the figure counts before you compare it against a number from anywhere else.

**Can I trade with a bot?** Yes — Event Contracts run on an on-chain order book with no API rate limits. See [Building on Event Contracts](/developers/event-contracts.md).


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/trading/event-contracts/faq.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
