import test from "node:test";
import assert from "node:assert/strict";
import app from "../server.js";

test("authenticated real-order test sends the saved recipient only its brand items", async () => {
  const originalFetch = globalThis.fetch;
  const emailRequests = [];
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "test-admin-token";
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.EMAIL_FROM = "Orders <orders@example.com>";
  process.env.APP_URL = "https://seller.example.com";

  globalThis.fetch = async (url, options) => {
    if (String(url).includes("api.resend.com/emails")) {
      emailRequests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "email_1093" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("myshopify.com/admin/api")) {
      const { query, variables } = JSON.parse(options.body);
      if (query.includes("getOrderNotificationSettings")) {
        return Response.json({
          data: {
            shop: {
              settings: {
                jsonValue: {
                  vendorName: "AORA MEXICO",
                  email: "nour@aoramakeup.com",
                  enabled: true,
                },
              },
            },
          },
        });
      }
      if (query.includes("getOrderForNotification")) {
        assert.deepEqual(variables, { queryString: "name:#1093" });
        return Response.json({
          data: {
            orders: {
              nodes: [
                {
                  id: "gid://shopify/Order/1093",
                  name: "#1093",
                  createdAt: "2026-11-14T16:05:06Z",
                  currencyCode: "USD",
                  customer: { firstName: "Test", lastName: "Customer" },
                  shippingAddress: { address1: "123 Example Street" },
                  lineItems: {
                    nodes: [
                      {
                        title: "Inicia",
                        variantTitle: "Default Title",
                        vendor: "AORA MEXICO",
                        quantity: 1,
                        originalUnitPriceSet: {
                          shopMoney: { amount: "32.00", currencyCode: "USD" },
                        },
                      },
                      {
                        title: "Other brand item",
                        vendor: "Other Brand",
                        quantity: 1,
                        originalUnitPriceSet: {
                          shopMoney: { amount: "10.00", currencyCode: "USD" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        });
      }
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const loginResponse = await originalFetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "aoramexico@brand.com", password: "N8aKGNsa02Of" }),
    });
    const login = await loginResponse.json();
    assert.equal(loginResponse.status, 200);

    const response = await originalFetch(`${base}/api/settings/notifications/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${login.token}`,
      },
      body: JSON.stringify({ orderName: "#1093" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      orderName: "#1093",
      message: "Order email sent to nour@aoramakeup.com.",
    });
    assert.equal(emailRequests.length, 1);
    assert.deepEqual(emailRequests[0].to, ["nour@aoramakeup.com"]);
    assert.equal(emailRequests[0].subject, "New AORA MEXICO order #1093");
    assert.match(emailRequests[0].html, /Inicia/);
    assert.doesNotMatch(emailRequests[0].html, /Other brand item/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
  }
});
