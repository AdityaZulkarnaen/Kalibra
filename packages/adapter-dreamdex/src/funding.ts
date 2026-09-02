import { SOMNIA_ADDRESSES, withSomniaClient, type SomniaConfig } from './somnia.js';

/**
 * What a wallet holds, in the two things an agent needs to trade: gas and collateral.
 *
 * An underfunded agent does not stop. It sends an order that reverts on every cycle and pays
 * gas each time, and the on-chain reason is a bare selector unless someone decodes it — so
 * checking before starting is cheaper than diagnosing afterwards.
 */

export interface Funding {
  readonly address: string;
  /** Native STT, 18 decimals. Pays gas; without it nothing sends at all. */
  readonly gas: bigint;
  /** tUSDC on Shannon, 6 decimals. The collateral every order escrows. */
  readonly collateral: bigint;
}

export async function readFunding(
  config: SomniaConfig,
  addresses: readonly string[],
): Promise<Funding[]> {
  return withSomniaClient(config, async (client) => {
    const { createPublicClient, webSocket } = await import('viem');
    const { somniaShannon } = await import('@somnia-chain/markets-sdk/chains');
    const rpc = config.wsRpcUrl ?? somniaShannon.rpcUrls.default.webSocket?.[0];
    const chainClient = createPublicClient({ chain: somniaShannon, transport: webSocket(rpc) });

    const funding: Funding[] = [];
    for (const address of addresses) {
      const account = address as `0x${string}`;
      const [gas, collateral] = await Promise.all([
        chainClient.getBalance({ address: account }),
        client.getErc20Balance(SOMNIA_ADDRESSES.collateral as `0x${string}`, account),
      ]);
      funding.push({ address, gas, collateral });
    }
    return funding;
  });
}

/**
 * Mints testnet collateral to the signer. `faucet(uint256)` credits `msg.sender` and is
 * capped at 10,000 tUSDC per call, so each agent mints for itself rather than being funded
 * by a treasury transfer.
 */
export async function mintCollateral(
  config: SomniaConfig,
  privateKey: `0x${string}`,
  amount?: bigint,
): Promise<string> {
  return withSomniaClient({ ...config, privateKey }, async (client) => {
    const trader = client.createTrader({ privateKey });
    const result = await trader.faucet({
      ...(amount === undefined ? {} : { amount }),
      gas: await estimateFaucetGas(config, privateKey, amount ?? FAUCET_CAP),
    });
    return result.hash.toLowerCase();
  });
}

/** The contract's own per-call ceiling. Asking for more reverts with `FaucetCapExceeded`. */
const FAUCET_CAP = 10_000n * 10n ** 6n;

const faucetAbi = [
  {
    type: 'function',
    name: 'faucet',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const;

/**
 * Asks the chain what the call costs rather than naming a number.
 *
 * Both directions of guessing are real failures and neither announces itself as a gas
 * problem. Too high and the ceiling is reserved in full before the transaction is sent — the
 * SDK's 10,000,000 default puts a wallet holding under an STT beyond sending anything, and it
 * surfaces as "insufficient balance". Too low and the transaction lands, burns the whole
 * ceiling, and reverts with no recoverable reason.
 *
 * The headroom is because an estimate is taken against the current state and executed against
 * a slightly later one.
 */
async function estimateFaucetGas(
  config: SomniaConfig,
  privateKey: `0x${string}`,
  amount: bigint,
): Promise<bigint> {
  const [{ createPublicClient, webSocket }, { privateKeyToAccount }, { somniaShannon }] =
    await Promise.all([
      import('viem'),
      import('viem/accounts'),
      import('@somnia-chain/markets-sdk/chains'),
    ]);
  const rpc = config.wsRpcUrl ?? somniaShannon.rpcUrls.default.webSocket?.[0];
  const chainClient = createPublicClient({ chain: somniaShannon, transport: webSocket(rpc) });
  const estimate = await chainClient.estimateContractGas({
    address: SOMNIA_ADDRESSES.collateral as `0x${string}`,
    abi: faucetAbi,
    functionName: 'faucet',
    args: [amount],
    account: privateKeyToAccount(privateKey),
  });
  return (estimate * 3n) / 2n;
}
