# Latinas in Beauty Partner Portal

Express and vanilla-JS brand portal for Shopify products, orders, fulfillment, analytics, and order email notifications.

## Order email notifications

Each brand can open **Settings** in the portal, enter its notification email, and enable or disable new-order emails. Settings are stored as shop metafields in Shopify, so no separate database is required and Vercel deployments do not erase them.

`brand-notification-emails.js` contains the default recipient map for the 26 configured brands, including AORA MEXICO (`nour@aoramakeup.com`). These defaults are enabled automatically. A brand's saved Shopify settings take precedence, including when notifications are disabled.

When a Shopify `orders/create` webhook arrives, the server:

1. Verifies Shopify's HMAC signature using the app client secret.
2. Finds enabled brand recipients and filters the order to each brand's line items.
3. Sends each matching brand an email containing its items, subtotal, customer, and shipping address through Resend.

The app creates or updates the webhook subscription when notification settings are loaded or saved. The callback is:

```text
POST {APP_URL}/api/webhooks/shopify/orders-create
```

### Deployment setup

Copy `.env.example` into your environment configuration and set the existing Shopify variables plus:

- `APP_URL`: the public HTTPS portal URL, for example `https://seller.lbeauty.org`.
- `RESEND_API_KEY`: an API key from [Resend](https://resend.com).
- `EMAIL_FROM`: a sender on a domain verified in Resend, for example `Latinas in Beauty <orders@lbeauty.org>`.
- `SHOPIFY_WEBHOOK_SECRET`: optional; defaults to `SHOPIFY_CLIENT_SECRET`.

The Shopify app needs its existing order/product access and permission to manage its webhook subscriptions and shop metafields. After deploying, open **Settings** once to confirm that email delivery and the automatic webhook both show as connected. Save a recipient and use **Send Test Email** to verify delivery.

## Run locally

```sh
npm install
npm start
```

## Test

```sh
npm test
```

Shopify references: [webhookSubscriptionCreate](https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/webhookSubscriptionCreate), [WebhookHttpEndpoint](https://shopify.dev/docs/api/admin-graphql/2026-01/objects/WebhookHttpEndpoint), and [metafieldsSet](https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/metafieldsSet).
