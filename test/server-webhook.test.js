import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import app from "../server.js";
import { settingsKey } from "../order-notifications.js";

test("signed orders/create webhook emails each matching brand only its own items", async () => {
  const originalFetch = globalThis.fetch;
  const emailRequests = [];
  const secret = "webhook-test-secret";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "test-admin-token";
  process.env.SHOPIFY_WEBHOOK_SECRET = secret;
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.EMAIL_FROM = "Orders <orders@example.com>";
  process.env.APP_URL = "https://seller.example.com";

  globalThis.fetch = async (url, options) => {
    if (String(url).includes("api.resend.com/emails")) {
      emailRequests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "email_test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("myshopify.com/admin/api")) {
      return new Response(
        JSON.stringify({
          data: {
            shop: {
              metafields: {
                nodes: [
                  {
                    key: settingsKey("Rare Beauty"),
                    jsonValue: { vendorName: "Rare Beauty", email: "orders@rare.com", enabled: true },
                  },
                  {
                    key: settingsKey("Fenty Beauty"),
                    jsonValue: { vendorName: "Fenty Beauty", email: "orders@fenty.com", enabled: true },
                  },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(url, options);
  };

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const endpoint = `http://127.0.0.1:${port}/api/webhooks/shopify/orders-create`;
  const body = JSON.stringify({
    id: 1001,
    name: "#1001",
    created_at: "2026-01-01T12:00:00Z",
    currency: "USD",
    customer: { first_name: "Test", last_name: "Customer" },
    line_items: [
      { title: "Rare Lipstick", vendor: "Rare Beauty", quantity: 1, price: 20 },
      { title: "Fenty Gloss", vendor: "Fenty Beauty", quantity: 1, price: 18 },
    ],
  });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64");

  try {
    const rejected = await originalFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/create",
        "X-Shopify-Hmac-Sha256": "invalid",
      },
      body,
    });
    assert.equal(rejected.status, 401);
    assert.equal(emailRequests.length, 0);

    const response = await originalFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/create",
        "X-Shopify-Hmac-Sha256": signature,
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, notifications: 2 });
    assert.equal(emailRequests.length, 2);
    const rareEmail = emailRequests.find((email) => email.to[0] === "orders@rare.com");
    const fentyEmail = emailRequests.find((email) => email.to[0] === "orders@fenty.com");
    assert.ok(rareEmail);
    assert.ok(fentyEmail);
    assert.match(rareEmail.html, /Rare Lipstick/);
    assert.doesNotMatch(rareEmail.html, /Fenty Gloss/);
    assert.match(fentyEmail.html, /Fenty Gloss/);
    assert.doesNotMatch(fentyEmail.html, /Rare Lipstick/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
  }
});
