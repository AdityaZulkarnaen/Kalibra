import { z } from 'zod';

import { MalformedPayloadError } from './adapter.js';
import type { FetchLike } from './live.js';
import {
  FILL_FIELDS,
  MARKET_FIELDS,
  fillsResponse,
  marketsResponse,
  type VenueFill,
  type VenueMarket,
} from './venue.js';

/** The indexer reads the attestation needs, scoped to one market. */

export async function queryMarket(
  doFetch: FetchLike,
  indexerUrl: string,
  marketId: string,
): Promise<VenueMarket> {
  const rows = await gql(
    doFetch,
    indexerUrl,
    `{ Market(where: {marketId: {_eq: "${marketId}"}}) { ${MARKET_FIELDS} } }`,
    marketsResponse,
    'Market',
  );
  const market = rows.Market[0];
  if (market === undefined) throw new MalformedPayloadError('Market', `${marketId} not found`);
  return market;
}

export async function queryFills(
  doFetch: FetchLike,
  indexerUrl: string,
  marketId: string,
): Promise<VenueFill[]> {
  const rows = await gql(
    doFetch,
    indexerUrl,
    `{ Fill(where: {market_id: {_eq: "${marketId}"}}, order_by: {blockNumber: asc})
       { ${FILL_FIELDS} } }`,
    fillsResponse,
    'Fill',
  );
  return rows.Fill;
}

async function gql<T>(
  doFetch: FetchLike,
  indexerUrl: string,
  query: string,
  schema: z.ZodType<{ data?: T | undefined; errors?: Array<{ message: string }> | undefined }>,
  label: string,
): Promise<T> {
  const response = await doFetch(indexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new MalformedPayloadError(label, `indexer returned HTTP ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new MalformedPayloadError(label, z.prettifyError(parsed.error));
  const { data, errors } = parsed.data;
  if (errors !== undefined && errors.length > 0) {
    throw new MalformedPayloadError(label, errors.map((e) => e.message).join('; '));
  }
  if (data === undefined) throw new MalformedPayloadError(label, 'no data in response');
  return data;
}
