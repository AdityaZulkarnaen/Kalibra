// Lint fixture, deliberately invalid. See eslint.config.test.ts. Do not "fix" this file.
// Every line below reaches outside the pure core without importing anything, which is the
// hole that no-restricted-imports alone cannot see.
export const reachOut = async (): Promise<unknown> => {
  const seed = Math.random();
  const at = Date.now();
  const started = performance.now();
  const mode = process.env['KALIBRA_MODE'];
  const stamped = new Date();
  const response = await fetch('https://example.invalid/anything');
  return { seed, at, started, mode, stamped, response };
};
