-- Billing moved from Stripe to Razorpay.
--
-- RENAME rather than drop-and-add: the values in these columns are the only
-- link between an account and its payment history at the processor, and a
-- dropped column takes that link with it. The names are provider-neutral now
-- so the next processor change is a code change and not a migration.
--
-- The unique constraints are renamed with them; Postgres does not do that
-- automatically, and leaving a constraint called
-- subscriptions_stripe_customer_id_unique on a column called
-- billing_customer_id is a trap for whoever reads this schema next.
ALTER TABLE "subscriptions" RENAME COLUMN "stripe_customer_id" TO "billing_customer_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME COLUMN "stripe_subscription_id" TO "billing_subscription_id";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME CONSTRAINT "subscriptions_stripe_customer_id_unique" TO "subscriptions_billing_customer_id_unique";--> statement-breakpoint
ALTER TABLE "subscriptions" RENAME CONSTRAINT "subscriptions_stripe_subscription_id_unique" TO "subscriptions_billing_subscription_id_unique";
