// Convex ↔ Clerk JWT integration.
//
// `domain` is the Clerk Issuer URL (e.g. https://your-instance.clerk.accounts.dev).
// `applicationID` matches the JWT template name in Clerk dashboard (we use "convex").
//
// Set CLERK_JWT_ISSUER_DOMAIN in `.env.local` AND on the Convex deployment:
//   npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://<your-instance>.clerk.accounts.dev"
//
// See https://docs.convex.dev/auth/clerk

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
