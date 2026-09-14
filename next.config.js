/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep server-only secrets out of the client bundle by convention: never
  // prefix Alchemy keys, DB URLs, or session secrets with NEXT_PUBLIC_.

  webpack: (config) => {
    // thirdweb's Coinbase smart-account / x402 payment code paths reference
    // optional peer packages (@x402/svm, @x402/evm) that we don't install,
    // since this app doesn't use Coinbase Smart Wallet's x402 payments
    // feature. Resolving them to `false` tells webpack to treat any import
    // of these as an empty module instead of a hard build failure.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@coinbase/cdp-sdk': false,
      '@base-org/account': false,
    };
    return config;
  },
};

module.exports = nextConfig;
