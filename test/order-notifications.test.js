import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildOrderEmail,
  ensureOrderWebhook,
  getAllNotificationSettings,
  getItemsForVendor,
  getNotificationSettings,
  getOrderForNotification,
  saveNotificationSettings,
  sendEmail,
  settingsKey,
  verifyShopifyWebhook,
} from "../order-notifications.js";

test("settings keys are stable, case-insensitive, and vendor-specific", () => {
  assert.equal(settingsKey("Rare Beauty"), settingsKey(" rare beauty "));
  assert.notEqual(settingsKey("Rare Beauty"), settingsKey("Fenty Beauty"));
});

test("Shopify webhook signatures accept the exact body and reject tampering", () => {
  const body = Buffer.from(JSON.stringify({ id: 123 }));
  const secret = "test-secret";
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64");

  assert.equal(verifyShopifyWebhook(body, signature, secret), true);
  assert.equal(verifyShopifyWebhook(Buffer.from("{}"), signature, secret), false);
  assert.equal(verifyShopifyWebhook(body, "invalid", secret), false);
  assert.equal(verifyShopifyWebhook(body, signature, ""), false);
});

test("only line items belonging to the brand are selected", () => {
  const order = {
    line_items: [
      { title: "Lipstick", vendor: "Rare Beauty" },
      { title: "Blush", vendor: " rare beauty " },
      { title: "Cleanser", vendor: "Other Brand" },
    ],
  };
  assert.deepEqual(
    getItemsForVendor(order, "Rare Beauty").map((item) => item.title),
    ["Lipstick", "Blush"],
  );
});

test("real-order notification lookup returns only the authenticated brand's items", async () => {
  let variables;
  const graphQL = async (query, input) => {
    variables = input;
    return {
      isError: false,
      data: {
        orders: {
          nodes: [
            {
              id: "gid://shopify/Order/1093",
              name: "#1093",
              createdAt: "2026-11-14T16:05:06Z",
              currencyCode: "USD",
              customer: { firstName: "Test", lastName: "Customer", defaultEmailAddress: { emailAddress: "customer@example.com" } },
              shippingAddress: { address1: "123 Example Street", country: "United States" },
              lineItems: {
                nodes: [
                  {
                    title: "Inicia",
                    variantTitle: "Default Title",
                    sku: "AORA-1",
                    vendor: "AORA MEXICO",
                    quantity: 1,
                    originalUnitPriceSet: { shopMoney: { amount: "32.00", currencyCode: "USD" } },
                  },
                  {
                    title: "Other brand item",
                    vendor: "Other Brand",
                    quantity: 1,
                    originalUnitPriceSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } },
                  },
                ],
              },
            },
          ],
        },
      },
    };
  };

  const { order, items } = await getOrderForNotification(graphQL, "AORA MEXICO", " #1093 ");
  assert.deepEqual(variables, { queryString: "name:#1093" });
  assert.equal(order.name, "#1093");
  assert.equal(order.created_at, "2026-11-14T16:05:06Z");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Inicia");
  assert.equal(items[0].price, "32.00");
  assert.equal(items[0].price_set.shop_money.currency_code, "USD");

  await assert.rejects(
    getOrderForNotification(graphQL, "AORA MEXICO", "invalid"),
    /valid order number/,
  );
  await assert.rejects(
    getOrderForNotification(graphQL, "Different Brand", "#1093"),
    /does not contain items/,
  );
});

test("order emails contain brand totals and escape customer-controlled HTML", () => {
  const email = buildOrderEmail({
    vendorName: "Rare Beauty",
    order: {
      id: 1,
      name: "#1001",
      currency: "USD",
      customer: { first_name: "A", last_name: "Customer" },
      shipping_address: { address1: "<script>alert(1)</script>", city: "Los Angeles" },
    },
    items: [
      { title: "<b>Lipstick</b>", quantity: 2, price: 10, price_set: { shop_money: { currency_code: "USD" } } },
    ],
    portalUrl: "https://seller.example.com",
  });

  assert.equal(email.subject, "New Rare Beauty order #1001");
  assert.match(email.html, /USD \$20\.00/);
  assert.match(email.html, /\u0026lt;b\u0026gt;Lipstick\u0026lt;\/b\u0026gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.text, /2x <b>Lipstick<\/b>/);
});

test("notification settings reject invalid or incomplete configuration", async () => {
  const graphQL = async () => {
    throw new Error("GraphQL should not be called for invalid input");
  };
  await assert.rejects(
    saveNotificationSettings(graphQL, "Rare Beauty", { email: "bad-email", enabled: true }),
    /valid notification email/,
  );
  await assert.rejects(
    saveNotificationSettings(graphQL, "Rare Beauty", { email: "", enabled: true }),
    /Add an email address/,
  );
});

test("notification settings create their definition and persist JSON on the shop", async () => {
  const calls = [];
  const graphQL = async (query, variables) => {
    calls.push({ query, variables });
    if (query.includes("getShopForNotifications")) {
      return { isError: false, data: { shop: { id: "gid://shopify/Shop/1" } } };
    }
    if (query.includes("metafieldDefinitionCreate")) {
      return { isError: false, data: { metafieldDefinitionCreate: { userErrors: [] } } };
    }
    return { isError: false, data: { metafieldsSet: { userErrors: [] } } };
  };

  const settings = await saveNotificationSettings(graphQL, "Rare Beauty", {
    email: " Orders@RareBeauty.com ",
    enabled: true,
  });
  assert.deepEqual(settings, {
    vendorName: "Rare Beauty",
    email: "orders@rarebeauty.com",
    enabled: true,
  });
  assert.equal(calls.length, 3);
  assert.match(calls[1].query, /metafieldDefinitionCreate/);
  assert.equal(calls[2].variables.metafields[0].ownerId, "gid://shopify/Shop/1");
  assert.equal(JSON.parse(calls[2].variables.metafields[0].value).email, "orders@rarebeauty.com");
});

test("mapped brands use their default recipient until settings are saved", async () => {
  const graphQL = async () => ({ isError: false, data: { shop: { settings: null } } });
  assert.deepEqual(await getNotificationSettings(graphQL, " rokael beauty "), {
    vendorName: "Rokael Beauty",
    email: "celeste@rokaelbeauty.com",
    enabled: true,
  });
  assert.deepEqual(await getNotificationSettings(graphQL, "Unmapped Brand"), {
    vendorName: "Unmapped Brand",
    email: "",
    enabled: false,
  });
});

test("settings reads default to disabled and webhook reads ignore disabled recipients", async () => {
  const empty = await getNotificationSettings(
    async () => ({ isError: false, data: { shop: { settings: null } } }),
    "Rare Beauty",
  );
  assert.deepEqual(empty, { vendorName: "Rare Beauty", email: "", enabled: false });

  const all = await getAllNotificationSettings(async () => ({
    isError: false,
    data: {
      shop: {
        metafields: {
          nodes: [
            { key: settingsKey("Rare Beauty"), jsonValue: { vendorName: "Rare Beauty", email: "orders@rare.com", enabled: true } },
            { key: settingsKey("Fenty Beauty"), jsonValue: { vendorName: "Fenty Beauty", email: "orders@fenty.com", enabled: false } },
            { key: settingsKey("Rokael Beauty"), jsonValue: { vendorName: "Rokael Beauty", email: "celeste@rokaelbeauty.com", enabled: false } },
            { key: "unrelated", jsonValue: { vendorName: "Other", email: "other@example.com", enabled: true } },
          ],
        },
      },
    },
  }));
  assert.ok(all.some((setting) => setting.vendorName === "Rare Beauty"));
  assert.ok(all.some((setting) => setting.vendorName === "Melt Cosmetics"));
  assert.ok(!all.some((setting) => setting.vendorName === "Fenty Beauty"));
  assert.ok(!all.some((setting) => setting.vendorName === "Rokael Beauty"));
  assert.ok(!all.some((setting) => setting.vendorName === "Other"));
});

test("webhook setup creates, updates, and reuses the orders/create subscription", async () => {
  const callbackUrl = "https://seller.example.com/api/webhooks/shopify/orders-create";
  let createVariables;
  const createGraphQL = async (query, variables) => {
    if (query.includes("query getOrderWebhooks")) {
      return { isError: false, data: { webhookSubscriptions: { nodes: [] } } };
    }
    createVariables = variables;
    return { isError: false, data: { webhookSubscriptionCreate: { userErrors: [] } } };
  };
  await ensureOrderWebhook(createGraphQL, callbackUrl);
  assert.deepEqual(createVariables.webhookSubscription, { callbackUrl, format: "JSON" });

  let updateVariables;
  const updateGraphQL = async (query, variables) => {
    if (query.includes("query getOrderWebhooks")) {
      return {
        isError: false,
        data: {
          webhookSubscriptions: {
            nodes: [{ id: "gid://shopify/WebhookSubscription/1", topic: "ORDERS_CREATE", uri: "https://old.example.com/webhook" }],
          },
        },
      };
    }
    updateVariables = variables;
    return { isError: false, data: { webhookSubscriptionUpdate: { userErrors: [] } } };
  };
  await ensureOrderWebhook(updateGraphQL, callbackUrl);
  assert.equal(updateVariables.id, "gid://shopify/WebhookSubscription/1");

  let calls = 0;
  await ensureOrderWebhook(async () => {
    calls += 1;
    return {
      isError: false,
      data: { webhookSubscriptions: { nodes: [{ topic: "ORDERS_CREATE", uri: callbackUrl }] } },
    };
  }, callbackUrl);
  assert.equal(calls, 1);
});

test("Resend delivery sends the recipient and surfaces provider errors", async () => {
  let request;
  await sendEmail(
    { apiKey: "key", from: "Orders <orders@example.com>", to: "brand@example.com", subject: "New order", html: "<p>Order</p>", text: "Order" },
    async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: "email_1" }) };
    },
  );
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.deepEqual(JSON.parse(request.options.body).to, ["brand@example.com"]);

  await assert.rejects(
    sendEmail(
      { apiKey: "key", from: "orders@example.com", to: "brand@example.com", subject: "New order" },
      async () => ({ ok: false, status: 422, json: async () => ({ message: "Invalid sender" }) }),
    ),
    /Invalid sender/,
  );
});
