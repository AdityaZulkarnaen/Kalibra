> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/developers/quick-start.md).

# Quick Start

This guide walks through placing your first order on dreamDEX, describing how you can interact with both the HTTP API and on-chain smart contracts to trade tokens.

The guide shows three paths: the [dreamDEX CLI](https://github.com/somnia-chain/somnia-dex-cli/) for the fastest experience, the HTTP API with `curl` for full control, and [Foundry's `cast`](https://book.getfoundry.sh/) for direct contract interaction.

{% hint style="info" %}
**Building an automated bot or agent?** Use the default **wallet funding** flow — there is no vault deposit step, just a one-time ERC-20 approval to the pool. See [Choose a Funding Source](#3-choose-a-funding-source).
{% endhint %}

## Prerequisites

Before you can perform any trades, you need:

* An EVM wallet connected to **Somnia mainnet** (chain ID `5031`).
* Tokens to trade (the base token of the market you want to trade on).
* Your private key is assumed to be in your environment as `$PRIVATE_KEY`.
* An HTTP client that can call REST endpoints; we will assume `curl` is on your path.
* The [dreamDEX CLI](https://github.com/somnia-chain/somnia-dex-cli/) for the simplest workflow (`go install github.com/somnia-chain/somnia-dex-cli/cmd/dreamdex@latest`), and/or [Foundry](https://book.getfoundry.sh/) (`cast`) for direct contract interaction.

## Choose an Environment

Set `BASE_URL` once and every `curl` example below targets the right environment. The `/v0` path segment is part of the base URL on both environments - omitting it returns a 404.

```sh
# Mainnet (Somnia, chain ID 5031)
BASE_URL="https://api.dreamdex.io/v0"

# Testnet (Somnia Shannon, chain ID 50312) - uncomment to use instead
# BASE_URL="https://stg.api.dreamdex.io/v0"
```

This guide uses mainnet addresses, chain ID, and RPC throughout. To run it against testnet, switch `BASE_URL` above and substitute the [testnet contract addresses, chain ID, and RPC](/developers/contracts/contract-specifications.md#testnet-somnia-shannon-chain-id-50312). See the [HTTP API base URLs](/developers/http-api.md#base-urls) for the full per-environment reference.

{% hint style="info" %}
**Getting testnet funds.** Trading on Somnia Shannon testnet (chain ID `50312`) needs test funds - no mainnet capital required:

* **STT (gas):** claim from the [Somnia testnet faucet](https://testnet.somnia.network/) (or the [Google Cloud Web3 faucet](https://cloud.google.com/web3/faucet?network=somnia)). You need STT to pay gas for any transaction.
* **Test trading tokens** (SOMI, WBTC, WETH): mint from the testnet token faucet contract `0x89Ebc05dE83aB9752B95030218BB10A542b96B7C` via `requestTokens(address[] tokens, uint256[] amounts)` (all 18 decimals).
* **USDso (the quote token):** acquire by swapping from a token you hold on a live testnet market (e.g. sell SOMI on `SOMI:USDso`) or via [Simple Swap](/trading/readme-1/simple-swap.md). Testnet books can be thin - if a market is empty, post a resting order and wait, or start from the most active pair.
  {% endhint %}

## 1. Discover Markets

Fetch the available trading pairs via the [Market Data](/developers/http-api/market-data.md) endpoint. This step is required regardless of which path you use - it is the simplest way to obtain the contract and token addresses for a market.

```sh
curl $BASE_URL/markets
```

```json
{
  "markets": [
    {
      "symbol": "WETH:USDso",
      "contract": "0xa936da11B57b50A344e1293AAaE5232885ea2bDE",
      "base":     "0x936Ab8C674bcb567CD5dEB85D8A216494704E9D8",
      "quote":    "0x00000022dA000002656c64D9eA6011ea952D008A",
      "baseDecimals": 18,
      "quoteDecimals": 18,
      "tickSize": "0.01",
      "lotSize": "0.0001",
      "minQuantity": "0.001"
    }
  ]
}
```

Note the `contract` (Pool address), `base` and `quote` (token addresses), decimal counts, and the `tickSize`, `lotSize`, and `minQuantity` constraints — your order parameters must respect these. The values above are **illustrative for one pair**; each market sets its own, and they can change. Always read them per-market from `GET /v0/markets` or on-chain `getPoolParams()` at runtime rather than hard-coding. See [Spot Contract Specifications](/developers/contracts/contract-specifications.md) for details on each field.

{% hint style="warning" %}
**Respect `minQuantity`, `lotSize`, and `tickSize`.** An order below `minQuantity`, or whose `quantity`/`price` is not a whole multiple of `lotSize`/`tickSize`, is rejected on-chain. `minQuantity` is the most common cause of a rejected first order — check it before sizing.
{% endhint %}

If you are using the dreamDEX CLI, no manual setup is needed - it fetches market metadata automatically:

```sh
dreamdex markets
```

If you are using `cast` directly, save these values:

```bash
POOL="0xa936da11B57b50A344e1293AAaE5232885ea2bDE"         # SpotPool (WETH:USDso, Somnia mainnet)
BASE_TOKEN="0x936Ab8C674bcb567CD5dEB85D8A216494704E9D8"   # WETH
QUOTE_TOKEN="0x00000022dA000002656c64D9eA6011ea952D008A"  # USDso
BASE_DECIMALS=18
QUOTE_DECIMALS=18
RPC="https://api.infra.mainnet.somnia.network"
```

{% hint style="info" %}
**Native-token markets (SOMI/USDso).** The SOMI/USDso pool uses SOMI as the chain's **native token**. Under the default auto-pull flow, `placeOrder` is `payable` and pulls input from `msg.value` rather than an ERC-20 allowance; for manual vault funding, deposit with `depositNative()` and `msg.value` instead of `approve` + `deposit(token, amount)`. The rest of this guide assumes an ERC-20 base (e.g. WETH); swap in the SOMI/USDso pool address and use the native variants when trading SOMI.
{% endhint %}

## 2. Authenticate (HTTP API only)

*Skip this step if you are using the dreamDEX CLI or `cast` - both sign transactions directly with your private key. The CLI handles SIWE authentication automatically; run `dreamdex login` to import your key on first use, or set `DREAMDEX_PRIVATE_KEY` in your environment for headless/CI workflows.*

If you want to use the HTTP API to construct transactions on your behalf, you will need to authenticate first, to ensure the returned transactions reference your wallet correctly. This process does not cede any control to your wallet; you remain in full control.

dreamDEX supports [Sign-In with Ethereum (ERC-4361)](https://eips.ethereum.org/EIPS/eip-4361). First request a nonce, then sign a SIWE message with your wallet and submit it to receive a JWT bearer token. See [Authentication](/developers/http-api/authentication.md) for full details.

**Request a nonce:**

```sh
curl $BASE_URL/auth/nonce
```

```json
{ "nonce": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" }
```

**Sign in:**

Construct an ERC-4361 message containing the nonce, sign it with your wallet, and POST both to the login endpoint:

```sh
curl -X POST $BASE_URL/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "api.dreamdex.io wants you to sign in with your Ethereum account:\n0xYourAddress\n\nSign in to dreamDEX\n\nURI: https://api.dreamdex.io\nVersion: 1\nChain ID: 5031\nNonce: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6\nIssued At: 2026-01-01T00:00:00.000Z",
    "signature": "0x..."
  }'
```

```json
{
  "token": "eyJhbGciOiJFUzI1NiIs...",
  "expiresAt": 1765537769841
}
```

Include this token in all subsequent HTTP API requests to private endpoints:

```sh
TOKEN="eyJhbGciOiJFUzI1NiIs..."
```

## 3. Choose a Funding Source

dreamDEX supports two ways to fund orders:

### Option A: Wallet Funding (default)

Tokens are pulled directly from your wallet at execution time and proceeds are delivered straight back to it. This is the simplest path - no deposit step needed - but if performing many trades, may cost more in gas fees overall. It supports all [order types](/trading/common/order-types.md), including resting limit orders (GTC, PostOnly).

**Requirements:**

* You must grant the SpotPool contract an ERC-20 allowance to spend your tokens **before** submitting the order - without this the on-chain transaction will revert. (On native-token markets the input is taken from `msg.value` instead of an allowance.)

**Approve the SpotPool contract to spend your tokens:**

Using the HTTP API:

```sh
curl -X POST $BASE_URL/markets/WETH:USDso/vault/approve \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "walletAddress": "0xYourAddress",
    "currency": "WETH",
    "amount": "1"
  }'
```

This returns an unsigned `approve(spender, amount)` transaction targeting the **token contract**, signalling that you grant permission for the contract to spend this token on your behalf. You need to sign and broadcast it.

To do this using `cast`:

```bash
# Approve the pool to spend 1 WETH (18 decimals)
cast send $BASE_TOKEN \
  "approve(address,uint256)" \
  $POOL $(cast to-wei 1) \
  --rpc-url $RPC --private-key $PRIVATE_KEY
```

If you are using the dreamDEX CLI, approval is handled automatically when placing an order (step 4) - skip ahead.

Once confirmed, the SpotPool contract can transfer up to that amount from your wallet when your order executes. Then proceed to step 4.

### Option B: Vault Funding

Pre-deposit tokens into the market's on-chain [vault](/developers/http-api/vault.md) and trade against that balance — useful if you keep a working balance in the pool (auto-pull then only tops up any shortfall from your wallet). Market makers and HFT integrators can additionally call `setManualVaultMode(true)` to settle fills to the vault rather than auto-delivering them to the wallet.

**Step 1 - Approve** (same as Option A above).

**Step 2 - Deposit:**

Using the HTTP API:

```sh
curl -X POST $BASE_URL/markets/WETH:USDso/vault/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "walletAddress": "0xYourAddress",
    "currency": "WETH",
    "amount": "1"
  }'
```

Sign and broadcast the returned transaction, e.g. using `cast`:

```bash
# Deposit 1 WETH into the vault
cast send $POOL \
  "deposit(address,uint256)" \
  $BASE_TOKEN $(cast to-wei 1) \
  --rpc-url $RPC --private-key $PRIVATE_KEY
```

Using the dreamDEX CLI:

```bash
dreamdex vault approve WETH:USDso --currency WETH --amount 1
dreamdex vault deposit WETH:USDso --currency WETH --amount 1
```

Then proceed to step 4 with vault funding.

## 4. Place an Order

### Option A: Using the HTTP API

Call the [prepare order](/developers/http-api/trading.md) endpoint to get an unsigned transaction:

```sh
curl -X POST $BASE_URL/markets/WETH:USDso/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "limit",
    "side": "buy",
    "price": "2500.00",
    "amount": "1",
    "walletAddress": "0xYourAddress",
    "fundingSource": "wallet",
    "orderType": "immediateOrCancel"
  }'
```

The server returns an unsigned EVM transaction:

```json
{
  "to": "0xPoolContract",
  "data": "0xabcdef...",
  "value": "0",
  "chainId": "5031"
}
```

Sign and broadcast it to the Somnia network, e.g. using `cast`:

```bash
cast send \
  --to "0xPoolContract" \
  --data "0xabcdef..." \
  --rpc-url $RPC --private-key $PRIVATE_KEY
```

### Option B: Using the dreamDEX CLI

The CLI handles transaction construction, signing, and broadcasting in a single command:

**Wallet funding** (default):

```bash
dreamdex order place WETH:USDso --side buy --type limit --amount 1 --price 2500
```

**Vault funding:**

```bash
dreamdex order place WETH:USDso --side buy --type limit --amount 1 --price 2500 \
  --funding-source vault --order-type postOnly
```

The CLI auto-detects whether token approval is needed and submits an approval transaction first if required. Market orders are also supported:

```bash
dreamdex order place WETH:USDso --side buy --amount 1 --slippage 0.5
```

### Option C: Using `cast`

When calling the [contract](/developers/contracts/functions.md) directly, prices and quantities must be in **raw on-chain units** - the human-readable value multiplied by `10^decimals`:

```bash
# Price: 2500.00 USDso (18 decimals) → 2500 × 10^18
export PRICE=$(cast to-wei 2500)

# Quantity: 1 WETH (18 decimals) → 1 × 10^18
export QUANTITY=$(cast to-wei 1)

# Expiration: 24 hours from now, in nanoseconds
export EXPIRE_NS=$(( ($(date +%s) + 86400) * 1000000000 ))
```

Both funding sources use the same `placeOrder` entrypoint. Under the default auto-pull flow it pulls the input from your wallet; in [manual vault mode](/developers/contracts/functions.md#setmanualvaultmode) it draws from your pre-deposited vault balance instead:

```bash
cast send $POOL \
  "placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)" \
  true 0 $PRICE $QUANTITY $EXPIRE_NS 2 0 0x0000000000000000000000000000000000000000 0 \
  --rpc-url $RPC --private-key $PRIVATE_KEY
```

The `orderType` of `2` (IOC) above is just an example — `placeOrder` accepts any order type, including resting limit orders (`0` = GTC, `3` = PostOnly). On a native-token market add `--value $(cast to-wei <amount>)` so the pool can auto-pull the input from `msg.value`.

The parameters are:

| Parameter              | Description                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `isBid`                | `true` for buy, `false` for sell                                                                                                  |
| `userData`             | Arbitrary 64-bit tag (use `0`)                                                                                                    |
| `price`                | Limit price in raw units (`value × 10^quoteDecimals`)                                                                             |
| `quantity`             | Order size in raw units (`value × 10^baseDecimals`)                                                                               |
| `expireTimestampNs`    | Expiration in nanoseconds since Unix epoch (must be a future timestamp)                                                           |
| `orderType`            | `0` = Normal (GTC), `1` = Fill-or-Kill, `2` = IOC, `3` = PostOnly                                                                 |
| `selfMatchingOption`   | `0` = cancel taker on self-match, `1` = cancel maker                                                                              |
| `builder`              | Optional builder address — see [Builder Codes](/developers/contracts/functions.md#builder-codes). Pass `0x0000...0000` if unused. |
| `builderFeeBpsTimes1k` | Per-order builder fee rate (BPS\_TIMES\_1K). Must be `0` when `builder` is the zero address.                                      |

{% hint style="info" %}
**Builder codes are live on mainnet and testnet.** The pool cap `getMaxBuilderFeeBpsTimes1k()` is currently `100000` (1%) on every pool on both networks; when a pool's cap is `0`, a non-zero `builder` reverts with `BuilderCodesNotSupported`. Leave both trailing arguments at the zero values shown above for an untagged order, or approve a builder first to tag one.
{% endhint %}

{% hint style="warning" %}
**Taker orders must cross the book.** An IOC/FOK buy has to price at or above the best ask (a sell at or below the best bid) to fill; a `price` of `0` never crosses and produces no fill. Price your limit to cross, bounded by your slippage tolerance.
{% endhint %}

### Recommended workflow

1. **Simulate first.** Call the transaction via `eth_call` (or `cast call`). A rejected order **reverts**, so the simulation reverts too — decode the selector against the [Errors](/developers/contracts/errors.md#order-rejection) page to learn why. The place-order functions still return `(bool success, uint128 orderId)`, but `success` is now always `true`: if the call returned at all, the order was accepted.
2. **Sign and broadcast.** If the simulation succeeds, sign the transaction and send it to the Somnia network.
3. **Verify after confirmation.** A rejected order is now a **failed transaction** (`status: 0`), not a successful no-op — so `status: 1` does mean the book accepted your order. It still does not prove a **fill**, because an accepted order may simply be resting. Decode the receipt logs:
   * `OrderPlaced` - the order was accepted.
   * `OrderFilled` (one per fill leg) - the order actually executed. A `NormalOrder` that rests produces `OrderPlaced` with no `OrderFilled`, which is correct behaviour rather than a failure. Sum the `OrderFilled` quantities (or diff your balances) to learn how much filled.

{% hint style="info" %}
**This changed with the order-rejection upgrade.** Previously an order the book could not honour — an IOC that never crossed, a PostOnly that would have crossed, an already-expired order — came back as a *successful* transaction with `success = false` and no logs, which was easy to miss. Those cases now revert with a named reason. If you have logic that treats "`status: 1` and no `OrderFilled`" as a rejection, it should now branch on the revert instead; the remaining log-only case is a healthy resting order.
{% endhint %}

## 5. Track Your Order

### Option A: Poll via REST

```sh
curl -H "Authorization: Bearer $TOKEN" \
  $BASE_URL/markets/WETH:USDso/orders/<orderId>
```

### Option B: Using the dreamDEX CLI

```bash
# List open orders
dreamdex order list WETH:USDso --status open

# Get a specific order
dreamdex order get WETH:USDso <orderId>

# Stream live updates
dreamdex watch order <orderId>

# Cancel an order
dreamdex order cancel WETH:USDso <orderId>
```

### Option C: Stream via WebSocket

Connect to the [WebSocket API](/developers/websocket-api/real-time-feed.md) at `wss://api.dreamdex.io/v0/ws/public` (testnet: `wss://stg.api.dreamdex.io/v0/ws/public`) and subscribe to order updates:

```json
{
  "operation": "subscribe",
  "channel": "order",
  "params": { "orderId": "0xYourOrderId" }
}
```

You will receive a snapshot of the current order state followed by real-time updates as the order fills or is cancelled.

### Option D: Query via `cast`

```bash
# Get order details by ID (OrderId is a uint128 on-chain)
cast call $POOL \
  "getOrder(uint128)" \
  $ORDER_ID \
  --rpc-url $RPC
```

To cancel an order:

```bash
cast send $POOL \
  "cancelOrder(uint128)" \
  $ORDER_ID \
  --rpc-url $RPC --private-key $PRIVATE_KEY
```

## Summary

| Step                 | HTTP API                 | dreamDEX CLI                                      | `cast`                                |
| -------------------- | ------------------------ | ------------------------------------------------- | ------------------------------------- |
| Discover markets     | `GET /v0/markets`        | `dreamdex markets`                                | Same (HTTP API required)              |
| Authenticate         | `POST /v0/auth/login`    | `dreamdex login`                                  | Not needed                            |
| Approve token        | `POST .../vault/approve` | Automatic                                         | `cast send <token> "approve(...)"`    |
| Deposit (vault only) | `POST .../vault/deposit` | `dreamdex vault deposit ...`                      | `cast send <pool> "deposit(...)"`     |
| Place order (wallet) | `POST .../orders`        | `dreamdex order place ...`                        | `cast send <pool> "placeOrder(...)"`  |
| Place order (vault)  | `POST .../orders`        | `dreamdex order place ... --funding-source vault` | `cast send <pool> "placeOrder(...)"`  |
| Check order          | `GET .../orders/{id}`    | `dreamdex order get ...`                          | `cast call <pool> "getOrder(...)"`    |
| Cancel order         | -                        | `dreamdex order cancel ...`                       | `cast send <pool> "cancelOrder(...)"` |

{% hint style="info" %}
**Useful view functions**: Call `getPoolParams()` on any SpotPool to discover its token addresses, fee rates, tick size, lot size, and min quantity. Call `getWithdrawableBalance(address, token)` to check your available balance before withdrawing. Call `getOwnOpenOrders()` to list your active orders.
{% endhint %}

## Next Steps

* [Order Types](/trading/common/order-types.md) - Learn about all supported order types and time-in-force options
* [Stop Orders](/trading/readme-1/stop-orders.md) - Set up automated stop-loss and take-profit orders
* [Contracts](/developers/contracts.md) - Full contract API reference
* [HTTP API](/developers/http-api.md) - Full REST API reference
* [WebSocket API](/developers/websocket-api.md) - Real-time market data and order tracking


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/developers/quick-start.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
