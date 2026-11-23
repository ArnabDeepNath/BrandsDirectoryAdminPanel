import crypto from "crypto";

export const SETTINGS_NAMESPACE = "vendor_portal";
const SETTINGS_KEY_PREFIX = "order_notification_";

export function settingsKey(vendorName) {
  const digest = crypto
    .createHash("sha256")
    .update(vendorName.trim().toLowerCase())
    .digest("hex")
    .slice(0, 20);
  return `${SETTINGS_KEY_PREFIX}${digest}`;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader || !Buffer.isBuffer(rawBody)) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const receivedBuffer = Buffer.from(hmacHeader, "base64");
  const expectedBuffer = Buffer.from(expected, "base64");

  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function parseSettings(value, vendorName) {
  if (!value || typeof value !== "object") {
    return { vendorName, email: "", enabled: false };
  }

  return {
    vendorName: value.vendorName || vendorName,
    email: normalizeEmail(value.email),
    enabled: Boolean(value.enabled && value.email),
  };
}

function graphQLError(result) {
  return new Error(result?.message || "Shopify Admin API request failed.");
}

export async function getNotificationSettings(shopifyGraphQL, vendorName) {
  const result = await shopifyGraphQL(
    `query getOrderNotificationSettings($namespace: String!, $key: String!) {
      shop {
        id
        settings: metafield(namespace: $namespace, key: $key) {
          jsonValue
        }
      }
    }`,
    { namespace: SETTINGS_NAMESPACE, key: settingsKey(vendorName) },
  );

  if (result.isError) throw graphQLError(result);
  return parseSettings(result.data?.shop?.settings?.jsonValue, vendorName);
}

export async function getAllNotificationSettings(shopifyGraphQL) {
  const result = await shopifyGraphQL(
    `query getAllOrderNotificationSettings($namespace: String!) {
      shop {
        metafields(namespace: $namespace, first: 250) {
          nodes {
            key
            jsonValue
          }
        }
      }
    }`,
    { namespace: SETTINGS_NAMESPACE },
  );

  if (result.isError) throw graphQLError(result);

  return (result.data?.shop?.metafields?.nodes || [])
    .filter((field) => field.key?.startsWith(SETTINGS_KEY_PREFIX))
    .map((field) => parseSettings(field.jsonValue, ""))
    .filter((settings) => settings.vendorName && settings.enabled && isValidEmail(settings.email));
}

async function ensureSettingsDefinition(shopifyGraphQL, vendorName) {
  const result = await shopifyGraphQL(
    `mutation createOrderNotificationDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id }
        userErrors { field message }
      }
    }`,
    {
      definition: {
        name: `Order notifications — ${vendorName}`,
        namespace: SETTINGS_NAMESPACE,
        key: settingsKey(vendorName),
        description: "Brand portal order notification recipient and status.",
        type: "json",
        ownerType: "SHOP",
      },
    },
  );

  if (result.isError) throw graphQLError(result);
  const errors = result.data?.metafieldDefinitionCreate?.userErrors || [];
  const unexpectedError = errors.find(
    (error) => !/already exists|already been taken|taken/i.test(error.message),
  );
  if (unexpectedError) throw new Error(unexpectedError.message);
}

export async function saveNotificationSettings(shopifyGraphQL, vendorName, input) {
  const email = normalizeEmail(input.email);
  const enabled = Boolean(input.enabled);

  if (email && !isValidEmail(email)) {
    throw new Error("Enter a valid notification email address.");
  }
  if (enabled && !email) {
    throw new Error("Add an email address before enabling notifications.");
  }

  const shopResult = await shopifyGraphQL(`query getShopForNotifications { shop { id } }`);
  if (shopResult.isError) throw graphQLError(shopResult);
  const shopId = shopResult.data?.shop?.id;
  if (!shopId) throw new Error("Unable to identify the Shopify shop.");

  await ensureSettingsDefinition(shopifyGraphQL, vendorName);

  const settings = { vendorName, email, enabled };
  const result = await shopifyGraphQL(
    `mutation saveOrderNotificationSettings($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key }
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: shopId,
          namespace: SETTINGS_NAMESPACE,
          key: settingsKey(vendorName),
          type: "json",
          value: JSON.stringify(settings),
        },
      ],
    },
  );

  if (result.isError) throw graphQLError(result);
  const errors = result.data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(", "));
  return settings;
}

export async function ensureOrderWebhook(shopifyGraphQL, callbackUrl) {
  if (!callbackUrl) throw new Error("Set APP_URL to register the order webhook.");

  const existingResult = await shopifyGraphQL(
    `query getOrderWebhooks {
      webhookSubscriptions(first: 100) {
        nodes {
          id
          topic
          uri
        }
      }
    }`,
  );
  if (existingResult.isError) throw graphQLError(existingResult);

  const subscriptions = existingResult.data?.webhookSubscriptions?.nodes || [];
  const existing = subscriptions.find(
    (subscription) =>
      subscription.topic === "ORDERS_CREATE" && subscription.uri?.startsWith("https://"),
  );

  if (existing?.uri === callbackUrl) {
    return { configured: true, callbackUrl };
  }

  const mutation = existing
    ? `mutation updateOrderWebhook($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }`
    : `mutation createOrderWebhook($webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: ORDERS_CREATE, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }`;

  const variables = {
    ...(existing ? { id: existing.id } : {}),
    webhookSubscription: { callbackUrl, format: "JSON" },
  };
  const result = await shopifyGraphQL(mutation, variables);
  if (result.isError) throw graphQLError(result);

  const payload = existing
    ? result.data?.webhookSubscriptionUpdate
    : result.data?.webhookSubscriptionCreate;
  const errors = payload?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(", "));
  return { configured: true, callbackUrl };
}

export function getItemsForVendor(order, vendorName) {
  const normalizedVendor = vendorName.trim().toLowerCase();
  return (order.line_items || []).filter(
    (item) => String(item.vendor || "").trim().toLowerCase() === normalizedVendor,
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "\u0026amp;")
    .replaceAll("<", "\u0026lt;")
    .replaceAll(">", "\u0026gt;")
    .replaceAll('"', "\u0026quot;")
    .replaceAll("'", "\u0026#039;");
}

function money(value, currency) {
  const amount = Number(value || 0).toFixed(2);
  return `${escapeHtml(currency || "USD")} $${amount}`;
}

export function buildOrderEmail({ vendorName, order, items, portalUrl }) {
  const currency = items[0]?.price_set?.shop_money?.currency_code || order.currency || "USD";
  const subtotal = items.reduce(
    (total, item) => total + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  const customerName =
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ||
    order.shipping_address?.name ||
    "Store customer";
  const address = order.shipping_address
    ? [
        order.shipping_address.address1,
        order.shipping_address.address2,
        [order.shipping_address.city, order.shipping_address.province, order.shipping_address.zip]
          .filter(Boolean)
          .join(", "),
        order.shipping_address.country,
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join("<br>")
    : "No physical shipping address provided.";
  const itemRows = items
    .map((item) => {
      const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(item.title)}</strong><br><span style="color:#64748b;font-size:12px;">${escapeHtml(item.variant_title || item.sku || "")}</span></td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center;">${Number(item.quantity || 0)}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;">${money(lineTotal, currency)}</td>
      </tr>`;
    })
    .join("");
  const orderName = order.name || `#${order.order_number || order.id}`;
  const subject = `New ${vendorName} order ${orderName}`;
  const html = `<!doctype html>
    <html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
          <div style="padding:24px 28px;background:#0f172a;color:#fff;">
            <div style="font-size:13px;color:#fca5a5;font-weight:bold;">LATINAS IN BEAUTY</div>
            <h1 style="margin:8px 0 0;font-size:24px;">New order received</h1>
          </div>
          <div style="padding:28px;">
            <p style="margin-top:0;">Hello ${escapeHtml(vendorName)}, you have a new order to fulfill.</p>
            <p style="font-size:20px;margin:20px 0 4px;"><strong>Order ${escapeHtml(orderName)}</strong></p>
            <p style="color:#64748b;margin:0 0 20px;">${escapeHtml(order.created_at ? new Date(order.created_at).toLocaleString("en-US") : "Just now")}</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <thead><tr style="background:#f8fafc;"><th style="padding:10px;text-align:left;">Item</th><th style="padding:10px;">Qty</th><th style="padding:10px;text-align:right;">Total</th></tr></thead>
              <tbody>${itemRows}</tbody>
              <tfoot><tr><td colspan="2" style="padding:14px 10px;text-align:right;"><strong>Brand items subtotal</strong></td><td style="padding:14px 10px;text-align:right;"><strong>${money(subtotal, currency)}</strong></td></tr></tfoot>
            </table>
            <h2 style="font-size:16px;margin:26px 0 8px;">Customer</h2>
            <p style="margin:0;line-height:1.6;">${escapeHtml(customerName)}${order.customer?.email ? `<br>${escapeHtml(order.customer.email)}` : ""}</p>
            <h2 style="font-size:16px;margin:22px 0 8px;">Shipping address</h2>
            <p style="margin:0;line-height:1.6;">${address}</p>
            ${portalUrl ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#da291c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold;">Open Partner Portal</a></p>` : ""}
          </div>
        </div>
      </div>
    </body></html>`;
  const text = [
    `New ${vendorName} order ${orderName}`,
    ...items.map((item) => `${item.quantity}x ${item.title} — ${money(item.price * item.quantity, currency)}`),
    `Brand items subtotal: ${money(subtotal, currency)}`,
    `Customer: ${customerName}`,
    order.customer?.email ? `Customer email: ${order.customer.email}` : "",
    portalUrl ? `Partner Portal: ${portalUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export async function sendEmail({ apiKey, from, to, subject, html, text }, fetchImpl = fetch) {
  if (!apiKey || !from) {
    throw new Error("Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.");
  }

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Email provider returned ${response.status}.`);
  }
  return data;
}
