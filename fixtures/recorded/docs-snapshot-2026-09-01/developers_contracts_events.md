> For the complete documentation index, see [llms.txt](https://docs.dreamdex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.dreamdex.io/developers/contracts/events.md).

# Events

## SpotPool / OrderBook Events

### `OrderPlaced`

Emitted for every accepted order, regardless of whether any quantity ultimately rests on the book.

```solidity
event OrderPlaced(OrderId indexed orderId, Order placedOrder);
```

**topic0:** `0xd90f62f61ee2f606b132cfdfd883ddd079228b6fd6bffd9d7cf848daf824639d` · expands to `OrderPlaced(uint128,(uint128,bool,address,uint64,uint256,uint256,uint256,uint64))`

| Parameter     | Type                                                   | Description                      |
| ------------- | ------------------------------------------------------ | -------------------------------- |
| `orderId`     | `OrderId`                                              | The ID of the newly placed order |
| `placedOrder` | [`Order`](/developers/contracts/types.md#order-struct) | The full order details           |

***

### `OrderRested`

Emitted when an order comes to rest on the book after placement. Only emitted for the residual quantity that is actually inserted into the priority index. Orders that fully fill on placement, IOC residuals, and FOK orders do not emit this event. The resting order's details are available on the paired `OrderPlaced`.

```solidity
event OrderRested(OrderId indexed orderId);
```

**topic0:** `0xcdd45acd62788abc10f79d86fac34df2a63e1a3b20f061c5bcf431ff6a09b866` · expands to `OrderRested(uint128)`

***

### `OrderFilled`

Emitted when two orders are matched and filled.

```solidity
event OrderFilled(OrderId indexed takerOrderId, OrderId indexed makerOrderId, uint256 quantityFilled, uint256 takerRemainingQuantity, uint256 makerRemainingQuantity, uint256 fillPrice);
```

**topic0:** `0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399` · expands to `OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)`

| Parameter                | Type      | Description                                                        |
| ------------------------ | --------- | ------------------------------------------------------------------ |
| `takerOrderId`           | `OrderId` | The ID of the taker (incoming) order                               |
| `makerOrderId`           | `OrderId` | The ID of the maker (resting) order                                |
| `quantityFilled`         | `uint256` | The quantity of base asset filled in this match                    |
| `takerRemainingQuantity` | `uint256` | The taker order's remaining quantity after this fill               |
| `makerRemainingQuantity` | `uint256` | The maker order's remaining quantity after this fill               |
| `fillPrice`              | `uint256` | The price at which this match executed (the maker's resting price) |

***

### `OrderCancelled`

Emitted when an order is cancelled by its owner.

```solidity
event OrderCancelled(OrderId indexed orderId);
```

**topic0:** `0x06ff08ed6b6987bb7df963009d8b54dc03988f4e465c009924929bb010fe03e7` · expands to `OrderCancelled(uint128)`

***

### `OrderExpired`

Emitted when an expired order is removed — either inline during matching, or via the permissionless `cancelExpiredOrders` / `sweepExpiredAtLevel` cleanup paths.

```solidity
event OrderExpired(OrderId indexed orderId);
```

**topic0:** `0x6003d149bc2c6baa0780d4302ad5f925fef5715780d3b6f7d2da5476548da101` · expands to `OrderExpired(uint128)`

***

### `OrderReduced`

Emitted when an order's quantity is reduced by its owner.

```solidity
event OrderReduced(OrderId indexed orderId, uint256 newQuantity);
```

**topic0:** `0xf6871493c13434b4a7fa02b5540fb6188e8db3f63e6b7013db073e9535b5a860` · expands to `OrderReduced(uint128,uint256)`

***

### `OrderAmended`

Emitted when an order is amended — `oldOrderId` is replaced by the freshly placed `newOrderId`. Fires alongside the replacement's `OrderPlaced(newOrderId)` (and `OrderRested(newOrderId)` if it rests), linking the amended order to its replacement so off-chain book reconstruction sees the amend as one action. Normally also paired with `OrderCancelled(oldOrderId)` from the cancel leg; when `alwaysPlace` skipped the cancel (the old order was already gone) there is no paired `OrderCancelled` in this transaction. The replacement always carries a fresh id, so `oldOrderId != newOrderId`.

```solidity
event OrderAmended(OrderId indexed oldOrderId, OrderId indexed newOrderId);
```

**topic0:** `0x55bc401cf5a2a5a9291c8ec209b7a004016d780b1bdf933cb240e6e8556bba1b` · expands to `OrderAmended(uint128,uint128)`

| Parameter    | Type      | Description                               |
| ------------ | --------- | ----------------------------------------- |
| `oldOrderId` | `OrderId` | The amended (old) order, now dead         |
| `newOrderId` | `OrderId` | The replacement order placed by the amend |

***

### `OrderRejected`

Emitted by the **batch** placement surfaces ([`placeOrders`](/developers/contracts/functions.md#placeorders) / `placeOrdersFor`) when a well-formed request could not be honoured. It pairs with the `false` entry in the returned `bool[]`, carrying the reason and the request index that the boolean alone cannot express. No order id exists, so there is nothing to key on but `requestIndex`.

Singular [`placeOrder`](/developers/contracts/functions.md#placeorder) does **not** emit this — it reverts instead, so a rejection there is visible as a failed transaction, not a log.

```solidity
event OrderRejected(address indexed owner, OrderRejectionReason indexed reason, uint256 requestIndex);
```

**topic0:** `0xa8d29afa5f94c3b7716775d4d634f8b829870b24615782f87b7796a33f7c3057` · expands to `OrderRejected(address,uint8,uint256)`

| Parameter      | Type                                                                               | Description                                        |
| -------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `owner`        | `address`                                                                          | Order owner the rejected request was for (indexed) |
| `reason`       | [`OrderRejectionReason`](/developers/contracts/types.md#orderrejectionreason-enum) | Why the book refused it (indexed)                  |
| `requestIndex` | `uint256`                                                                          | Position in the submitted `requests` array         |

***

### `OrderCancelledSelfMatch`

Emitted when a resting maker order is cancelled because an incoming **same-owner** taker crossed it with `SelfMatchingOption.CancelMaker`. Distinct from `OrderCancelled` (owner-initiated): this is the protocol removing a maker due to a same-owner self-match, and it is the only path by which an order leaves the book **without another lifecycle event**. The maker's locked funds are returned to the owner exactly as in any other removal. Off-chain consumers reconstructing the book from the event stream must handle it to avoid leaving a stale resting order (DEX-1236).

```solidity
event OrderCancelledSelfMatch(OrderId indexed orderId);
```

**topic0:** `0x06338cfffed6cc456515196256e4c180e4639f134af550d7fca7a4995aa6b4e7` · expands to `OrderCancelledSelfMatch(uint128)`

***

### `PayoutFallbackToVault`

Emitted when an auto-deliver payout to the order owner fails (the recipient reverts, returns `false`, or exhausts the bounded gas budget) and the pool falls back to crediting the owner's internal vault balance instead. The owner can retrieve the funds with [`withdraw`](/developers/contracts/functions.md#withdraw). Relevant on the default auto-pull / auto-deliver flow: a fill/cancel/expiry payout that would normally arrive in the wallet has instead been parked in the vault.

```solidity
event PayoutFallbackToVault(address indexed owner, address indexed token, uint256 amount);
```

**topic0:** `0xa6fbbe47b5e6bc19e27bfd1b0eda75bde21982ebbac4321d329a674073a80c71` · expands to `PayoutFallbackToVault(address,address,uint256)`

| Parameter | Type      | Description                                          |
| --------- | --------- | ---------------------------------------------------- |
| `owner`   | `address` | The intended recipient of the payout                 |
| `token`   | `address` | The token the payout would have been delivered in    |
| `amount`  | `uint256` | The amount credited to the owner's vault as fallback |

***

### `MarkPriceUpdated`

Emitted when the midpoint price advances. `markPrice` is the **EMA-smoothed** midpoint and is the value the `SpotStopOrderRegistry` consumes to evaluate triggers. `rawMidpoint` is the unsmoothed `(bestBid + bestAsk) / 2` snapshot at emission time, exposed for off-chain consumers (UIs, indexers) — it **must not** be used as a trigger feed.

```solidity
event MarkPriceUpdated(address indexed asset, uint256 markPrice, uint256 rawMidpoint);
```

**topic0:** `0x2f0f7e3d58a217d311f516b216fa2f75081e17821bebb5f007fa57ff4e71f888` · expands to `MarkPriceUpdated(address,uint256,uint256)`

| Parameter     | Type      | Description                                  |
| ------------- | --------- | -------------------------------------------- |
| `asset`       | `address` | The base token address                       |
| `markPrice`   | `uint256` | The new EMA-smoothed midpoint (trigger feed) |
| `rawMidpoint` | `uint256` | The unsmoothed midpoint at emission time     |

During the bootstrap branch (first emission) and the defensive zero-params fallback, `markPrice == rawMidpoint`. In steady state they diverge by the EMA smoothing factor.

***

### `MidpointEmaParametersUpdated`

Emitted when the admin updates the midpoint EMA parameters.

```solidity
event MidpointEmaParametersUpdated();
```

**topic0:** `0xf46ac7a0fbbc6891e7cd2053888eda2fddec5f8910f5a705d86992baad12533e` · expands to `MidpointEmaParametersUpdated()`

***

### `MidpointEmaReset`

Emitted when the admin resets the EMA state via `resetMidpointEma`. The next book event after this re-runs the bootstrap branch.

```solidity
event MidpointEmaReset();
```

**topic0:** `0xd1bde9d764947194ba98cbb30000972dcf8b2d5794a5434b33733c8700bdbb71` · expands to `MidpointEmaReset()`

***

### `FeeRecipientUpdated`

Emitted when the fee recipient is rotated by the current recipient via `updateFeeRecipient`.

```solidity
event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
```

**topic0:** `0xaaebcf1bfa00580e41d966056b48521fa9f202645c86d4ddf28113e617c1b1d3` · expands to `FeeRecipientUpdated(address,address)`

***

### `BuilderApproved`

Emitted when a user updates their approval for a builder via [`approveBuilder`](/developers/contracts/functions.md#approvebuilder). `maxFeeBpsTimes1k = 0` indicates a revocation.

```solidity
event BuilderApproved(address indexed user, address indexed builder, uint256 maxFeeBpsTimes1k);
```

**topic0:** `0x4cf5e8fadb7b3ba42f2bdb90c5f286dbc66c42bc1c3d46ca5e21af9583c47045` · expands to `BuilderApproved(address,address,uint256)`

| Parameter          | Type      | Description                                                                              |
| ------------------ | --------- | ---------------------------------------------------------------------------------------- |
| `user`             | `address` | Address granting (or revoking) approval                                                  |
| `builder`          | `address` | Builder address being approved                                                           |
| `maxFeeBpsTimes1k` | `uint256` | New maximum builder fee the builder may charge per order (BPS\_TIMES\_1K; `0` = revoked) |

***

### `BuilderFeeCharged`

Emitted on every fill of a builder-tagged order with the per-fill fee amount credited to the builder. Fires once per side per fill (maker side and taker side each emit if they carry a builder). Skipped when the order has no builder. `amount` may be `0` on small fills because the fee is floor-rounded; the event still fires so consumers can detect that the builder path executed.

```solidity
event BuilderFeeCharged(OrderId indexed orderId, address indexed builder, address indexed token, uint256 amount);
```

**topic0:** `0xb603f98363ba2c49dc586ce0aa14affc3f62a5df0b81fa84c6bfb96ec4eccc93` · expands to `BuilderFeeCharged(uint128,address,address,uint256)`

| Parameter | Type      | Description                                                            |
| --------- | --------- | ---------------------------------------------------------------------- |
| `orderId` | `OrderId` | The order whose fill credited the builder                              |
| `builder` | `address` | The builder address that received the fee                              |
| `token`   | `address` | The token the fee was paid in (quote for bids, base for asks)          |
| `amount`  | `uint256` | The fee amount transferred to the builder (floor-rounded, may be zero) |

***

### `MaxBuilderFeeUpdated`

Emitted when the admin updates the protocol-wide cap on per-user→builder approvals (`maxBuilderFeeBpsTimes1k`).

```solidity
event MaxBuilderFeeUpdated(uint256 oldMax, uint256 newMax);
```

**topic0:** `0xe0500bac95300d4f20ea053b47cb470ec82d16538e04c61abf09506d566f510d` · expands to `MaxBuilderFeeUpdated(uint256,uint256)`

***

### `OrderBookParametersUpdated`

Emitted when the order book parameters (tick size, lot size, min quantity) are updated by the admin.

```solidity
event OrderBookParametersUpdated(OrderBookParameters newParameters);
```

**topic0:** `0x398f7a2174a55ac12abaac475b707d39f9d5c54f68d459438912f38ed1a3042c` · expands to `OrderBookParametersUpdated((uint256,uint256,uint256))`

***

### `ContractApprovalUpdated`

Emitted once per address whose approval to place orders on behalf of users is updated via `updateIsApprovedContractToPlaceOrders`. Emitted regardless of whether the new approval state differs from the prior state.

```solidity
event ContractApprovalUpdated(address indexed contractAddress, bool isApproved);
```

**topic0:** `0xe7faf35453f298b6a9532f9ec4839fe826111c39a635574f6aa40d6f20a83b01` · expands to `ContractApprovalUpdated(address,bool)`

***

### `ManualVaultModeUpdated`

Emitted when a user toggles their auto-pull opt-out flag via [`setManualVaultMode`](/developers/contracts/functions.md#setmanualvaultmode). `enabled = true` means manual-vault mode (auto-pull disabled); `false` re-enables auto-pull. Does not affect orders already resting.

```solidity
event ManualVaultModeUpdated(address indexed user, bool enabled);
```

**topic0:** `0x7b7ce1bc7bf80870c9a0ed2000e6cd86cceb99618506cc32e86c30daf8af9b1f` · expands to `ManualVaultModeUpdated(address,bool)`

***

### `NativeDeposit`

Emitted when native tokens enter an owner's internal vault balance from outside the vault — via [`depositNative`](/developers/contracts/functions.md#depositnative) or the auto-pull of a native-input order (the payer may be a third party, e.g. an operator-placed order). **Native-only:** ERC-20 deposits are observable off-chain via the token's own `Transfer` log (wallet → vault), but the native token has no such log, hence this explicit event.

```solidity
event NativeDeposit(address indexed owner, uint256 amount);
```

**topic0:** `0xcd9850463422a7449c406a036e35e5edb6fbe35a64c9f12a2354be98a750c0d3` · expands to `NativeDeposit(address,uint256)`

| Parameter | Type      | Description                                     |
| --------- | --------- | ----------------------------------------------- |
| `owner`   | `address` | The address whose internal balance was credited |
| `amount`  | `uint256` | The amount deposited                            |

***

### `NativeWithdraw`

Emitted when native tokens are debited from an owner's internal vault balance out to their wallet — via [`withdraw`](/developers/contracts/functions.md#withdraw) of the native token or a native fill/cancel payout auto-delivered to the wallet. **Native-only**, for the same reason as [`NativeDeposit`](#nativedeposit): ERC-20 withdrawals surface on the token's own `Transfer` log (vault → wallet); the native token does not.

```solidity
event NativeWithdraw(address indexed owner, uint256 amount);
```

**topic0:** `0xe08eed5bb22ce46ac6172def838c0de5f5c31fec3802434ff8b265d37e1839a1` · expands to `NativeWithdraw(address,uint256)`

| Parameter | Type      | Description                                        |
| --------- | --------- | -------------------------------------------------- |
| `owner`   | `address` | The address whose balance was debited and received |
| `amount`  | `uint256` | The amount withdrawn                               |

***

## Stop Order Events

These events are emitted by the `SpotStopOrderRegistry` contract. See [Stop Orders](/trading/readme-1/stop-orders.md) for details.

### `PendingOrderCreated`

Emitted when a new pending stop order is created.

```solidity
event PendingOrderCreated(OrderId indexed orderId, address indexed owner, bool isBid, uint256 quantity, uint256 triggerPrice, Operator triggerOperator, PendingOrderType orderType, address builder, uint96 builderFeeBpsTimes1k);
```

**topic0:** `0x3c81b59a7f502c4c6f5b0cf5ed4520fd5f486e8f1668644df4ce47708f302df3` · expands to `PendingOrderCreated(uint128,address,bool,uint256,uint256,uint8,uint8,address,uint96)`

| Parameter              | Type               | Description                                                                                                                               |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `orderId`              | `OrderId`          | Unique identifier of the pending order                                                                                                    |
| `owner`                | `address`          | Address of the order owner                                                                                                                |
| `isBid`                | `bool`             | True for buy, false for sell                                                                                                              |
| `quantity`             | `uint256`          | Quantity of base tokens for this order                                                                                                    |
| `triggerPrice`         | `uint256`          | The price threshold for activation                                                                                                        |
| `triggerOperator`      | `Operator`         | GTE or LTE                                                                                                                                |
| `orderType`            | `PendingOrderType` | LIMIT or MARKET                                                                                                                           |
| `builder`              | `address`          | Builder address tagged on the order (`address(0)` for no builder). See [Builder Codes](/developers/contracts/functions.md#builder-codes). |
| `builderFeeBpsTimes1k` | `uint96`           | Per-fill builder fee rate the triggered IOC will charge (BPS\_TIMES\_1K units; `0` when `builder == address(0)`)                          |

***

### `PendingOrderTriggered`

Emitted when a pending order is triggered by a mark-price update and submitted to the order book.

```solidity
event PendingOrderTriggered(OrderId indexed pendingOrderId, bool success, OrderId indexed spotOrderId);
```

**topic0:** `0x1f6c55ddf148c254351e138eb9e5767174742b25eda5b9eb2166de5fa3f640aa` · expands to `PendingOrderTriggered(uint128,bool,uint128)`

| Parameter        | Type      | Description                                               |
| ---------------- | --------- | --------------------------------------------------------- |
| `pendingOrderId` | `OrderId` | The pending order's own ID                                |
| `success`        | `bool`    | True if the order was successfully placed on the SpotPool |
| `spotOrderId`    | `OrderId` | The resulting spot order ID (zero if failed)              |

***

### `PendingOrderCancelled`

Emitted when a pending order is cancelled by its owner. The SOMI payment is refunded (or credited to unclaimed SOMI if the transfer fails — see `SomiRefundFailed`).

```solidity
event PendingOrderCancelled(OrderId indexed orderId);
```

**topic0:** `0x225c2e0c029d6933d02c8279f566167a93c2523922013b852ba0e1ca860dcb8f` · expands to `PendingOrderCancelled(uint128)`

***

### `InertOrderCancelled`

Emitted when an inert pending order is cleaned up via `cancelInertOrders` (or the `removeSubscription(OrderId[])` overload). Only emitted while the registry has no active subscription. The order's stored `somiPaid` is credited to the original owner's unclaimed SOMI balance.

```solidity
event InertOrderCancelled(OrderId indexed orderId, address indexed owner, uint256 somiCredited);
```

**topic0:** `0xc83f4ce652582029f221328349ad59befaf3edb489060651ca5ee08693f4923c` · expands to `InertOrderCancelled(uint128,address,uint256)`

***

### `SomiRefundFailed`

Emitted when a SOMI refund transfer fails during order cancellation (for example, the order owner is a contract without a `receive`/`fallback`). The refund amount is credited to the owner's unclaimed balance, withdrawable via `claimSomi()`.

```solidity
event SomiRefundFailed(OrderId indexed orderId, address indexed owner, uint256 amount);
```

**topic0:** `0x877f1b210b51beb67979009e5d8138984e674d480839d829b7c0453e0bf1f55c` · expands to `SomiRefundFailed(uint128,address,uint256)`

***

## Stop Order Admin Events

### `SomiPaymentPerOrderUpdated`

Emitted when the admin updates the SOMI payment required per stop order.

```solidity
event SomiPaymentPerOrderUpdated(uint256 oldValue, uint256 newValue);
```

**topic0:** `0xf2025f0796e09dc70e78306842f1e9b48d10d7f38648697b7f58e01f1f6644ea` · expands to `SomiPaymentPerOrderUpdated(uint256,uint256)`

***

### `SlippageToleranceUpdated`

Emitted when the admin updates the slippage tolerance for MARKET-type stop orders.

```solidity
event SlippageToleranceUpdated(uint256 oldValue, uint256 newValue);
```

**topic0:** `0xddd31550b26e9ef8ade466958be83ff8a014d9b4f36d546b61a6847a45306575` · expands to `SlippageToleranceUpdated(uint256,uint256)`

***

### `MinStopDistanceUpdated`

Emitted when the admin updates the minimum allowed distance between `triggerPrice` and the EMA midpoint at order creation time.

```solidity
event MinStopDistanceUpdated(uint256 oldValue, uint256 newValue);
```

**topic0:** `0x6ce4a13ada786501320e10a059b00a59be12054c07423f548dd067a615999937` · expands to `MinStopDistanceUpdated(uint256,uint256)`

***

### `GasBufferBpsUpdated`

Emitted when the admin updates the per-iteration gas buffer used by the trigger loop. The cached effective `gasBuffer` (= `subscriptionGasLimit × bps / 10_000`) is recomputed atomically with this update.

```solidity
event GasBufferBpsUpdated(uint256 oldBps, uint256 newBps);
```

**topic0:** `0x11bb4f6c2f173c78945e95922a8c8118ae85c4d65edb9000b60101e2b03fd2ff` · expands to `GasBufferBpsUpdated(uint256,uint256)`

***

### `SomiWithdrawn`

Emitted when the admin withdraws excess SOMI from the contract. Only SOMI not reserved for pending order refunds or unclaimed cancel refunds can be withdrawn.

```solidity
event SomiWithdrawn(address indexed recipient, uint256 amount);
```

**topic0:** `0x978e68fe16f38fafa62d857ecfaa0aa7b202ea0f1d83e7f7ca3a3fc63138bf28` · expands to `SomiWithdrawn(address,uint256)`

***

### `SubscriptionCreated`

Emitted when the admin creates a Somnia reactivity subscription, activating the registry.

```solidity
event SubscriptionCreated(uint256 subscriptionId);
```

**topic0:** `0x6a2b70dde6ae0193f84b6a9eeb3b0ebdc3a35e99d9167b88c570158dd09cb0f7` · expands to `SubscriptionCreated(uint256)`

***

### `SubscriptionRemoved`

Emitted when the admin removes the active reactivity subscription, making the registry dormant.

```solidity
event SubscriptionRemoved(uint256 subscriptionId);
```

**topic0:** `0xd1c6b5ddb714097c609effd1e0bad19ed5e40f5c26a006cea26152fdb5545c48` · expands to `SubscriptionRemoved(uint256)`


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.dreamdex.io/developers/contracts/events.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
