/**
 * Deriving an address from a signing key.
 *
 * It lives in this package because viem does, and viem is reached by dynamic import
 * everywhere here so that nothing on the offline path loads it (invariant I3).
 *
 * The derivation exists so an operator never has to state a wallet address alongside its
 * key. A hand-written mapping can disagree with the key it sits next to, and the failure is
 * silent: fills would be attributed to a wallet that never traded, and the agent's score
 * would be computed over somebody else's positions.
 */

/** The 0x-prefixed, lowercased address that signs with `privateKey`. */
export async function addressForKey(privateKey: `0x${string}`): Promise<string> {
  const { privateKeyToAccount } = await import('viem/accounts');
  return privateKeyToAccount(privateKey).address.toLowerCase();
}
