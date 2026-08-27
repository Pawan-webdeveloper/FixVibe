/**
 * Who issues the tokens this deployment trusts.
 *
 * CONVEX_SITE_URL is set by Convex itself; it is the deployment's own HTTP
 * origin, which is also where the JWKS the tokens are verified against is
 * published. Nothing to configure by hand, and nothing to keep in step.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: 'convex',
    },
  ],
}
