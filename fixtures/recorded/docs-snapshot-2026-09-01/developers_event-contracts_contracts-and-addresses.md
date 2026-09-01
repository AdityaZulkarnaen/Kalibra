> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/developers/event-contracts/contracts-and-addresses.md).

# Contracts & Addresses

The protocol core is deployed via CREATE3, so the addresses are **identical on testnet and mainnet**:

| Contract            | Address (testnet 50312 = mainnet 5031)       |
| ------------------- | -------------------------------------------- |
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| MarketsCore         | `0x2802504314685D89bF6C992CA5a8e7cC78bc0294` |
| BinarySettlement    | `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23` |
| OutcomeToken6909    | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |
| OracleHub           | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| CollateralRouter    | `0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C` |

Per-market contracts (the market and its pool) are read from the module registry — `markets(marketId)` — or from the SDK; never hardcode them, since pools are recycled across windows.

**Collateral** is per-venue:

| Network | Token | Address                                      | Decimals |
| ------- | ----- | -------------------------------------------- | -------- |
| Mainnet | USDso | `0x00000022dA000002656c64D9eA6011ea952D008A` | 18       |
| Testnet | tUSDC | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` | 6        |

The two differ by a factor of 10^12. A constant that converts correctly on testnet misprices every order, book read and balance on mainnet, and nothing reverts to tell you — derive the scale from the collateral's `decimals()` rather than from a literal.

These are proxies, so each one's implementation can roll forward while the address stays put. Check any of them on the Somnia explorer: [mainnet](https://explorer.somnia.network) and [testnet](https://shannon-explorer.somnia.network).

Working from a non-JS stack? `@somnia-chain/markets-sdk` exports the ABIs you need directly (`binaryModuleReadAbi`, `binaryModuleWriteAbi`, `binarySettlementAbi`, `erc6909Abi`, `oracleHubAbi`), so you can pull them out of the package and drive the contracts with any RPC client. The package ships its own sources, so `npm pack` and open `src/` to read them as human-readable signature strings that mirror the Solidity.

{% hint style="warning" %}
Confirm the addresses on-chain before trading real funds, and never hardcode a market or pool address: those are per-window, and pools are recycled across windows. Read them from the module registry or the SDK instead.
{% endhint %}

## Getting testnet collateral

The testnet token mints on demand, so there is no faucet page and no address to paste anywhere: `faucet(uint256 amount)` credits **`msg.sender`**, and each call is capped at **10,000 tUSDC**. Asking for more reverts with `FaucetCapExceeded`.

```ts
await exchange.trader.faucet();                       // 10,000 tUSDC, the cap
await exchange.trader.faucet({ amount: 500n * 10n ** 6n });  // raw units, 6 decimals
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/developers/event-contracts/contracts-and-addresses.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
