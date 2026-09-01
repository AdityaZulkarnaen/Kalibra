/**
 * `@kalibra/api` is consumed for its published Zod schemas only, and `@kalibra/core` for its
 * error base class, both straight from TypeScript source, so the contract this app parses
 * against cannot drift from the one the server validates against. Next has to compile that
 * source, hence transpilePackages.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@kalibra/api', '@kalibra/core'],
  reactStrictMode: true,
};

export default nextConfig;
