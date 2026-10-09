import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "latinas_secret_key";

const RAW_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "gh0dgm-bq.myshopify.com";
const SHOPIFY_DOMAIN = RAW_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
let cachedAccessToken = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim() || null;
let tokenExpiresAt = 0;

const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-10/graphql.json`;
const OAUTH_TOKEN_URL = `https://${SHOPIFY_DOMAIN}/admin/oauth/access_token`;

const VENDORS_DB = [
  // Existing vendors
  { email: "alamar@brand.com", password: "password123", vendorName: "Alamar Cosmetics" },
  { email: "ceremonia@brand.com", password: "password123", vendorName: "Ceremonia" },
  { email: "rare@brand.com", password: "password123", vendorName: "Rare Beauty" },
  { email: "fenty@brand.com", password: "password123", vendorName: "Fenty Beauty" },
  { email: "tresluce@brand.com", password: "password123", vendorName: "Treslúce Beauty" },
  { email: "gente@brand.com", password: "password123", vendorName: "Gente Beauty" },

  // Brands from Shopify collections (vendor name must match the Shopify "Vendor" field exactly)
  { email: "valde@brand.com", password: "password123", vendorName: "VALDÉ BEAUTY" },
  { email: "sarelly@brand.com", password: "password123", vendorName: "Sarelly" },
  { email: "lib@brand.com", password: "password123", vendorName: "LIB" },
  { email: "deziskin@brand.com", password: "password123", vendorName: "Dezi Skin" },
  { email: "rokael@brand.com", password: "password123", vendorName: "Rokael Beauty" },
  { email: "ortega@brand.com", password: "password123", vendorName: "ORTEGA Beauty" },
  { email: "ecobrow@brand.com", password: "password123", vendorName: "Ecobrow" },
  { email: "mitucorazon@brand.com", password: "password123", vendorName: "mi|tu corazón" },
  { email: "dominique@brand.com", password: "password123", vendorName: "Dominique" },
  { email: "kiolal@brand.com", password: "password123", vendorName: "Ki'olal Biocosmetics" },
  { email: "pdl@brand.com", password: "password123", vendorName: "PDL Cosmetics" },
  { email: "prados@brand.com", password: "password123", vendorName: "Prados Beauty" },
  { email: "aloisia@brand.com", password: "password123", vendorName: "ALOISIA BEAUTY" },
  { email: "eausovert@brand.com", password: "password123", vendorName: "EAUSO VERT" },
  { email: "lasio@brand.com", password: "password123", vendorName: "Lasio Professional Hair Care" },
  { email: "ocoa@brand.com", password: "password123", vendorName: "OCOA" },
  { email: "shadesbyshan@brand.com", password: "password123", vendorName: "shades by Shan" },
  { email: "youthdealer@brand.com", password: "password123", vendorName: "Youth Dealer™" },
  { email: "beautyblender@brand.com", password: "password123", vendorName: "BEAUTYBLENDER" },
  { email: "nopalera@brand.com", password: "password123", vendorName: "NOPALERA" },
  { email: "isima@brand.com", password: "password123", vendorName: "ISIMA" },
  { email: "thehairgeneration@brand.com", password: "password123", vendorName: "The Hair Generation" },
  { email: "libertadvida@brand.com", password: "password123", vendorName: "Libertad Vida" },
  { email: "aoramexico@brand.com", password: "password123", vendorName: "AORA MEXICO" },
  { email: "soylatina@brand.com", password: "password123", vendorName: "Soy Latina" },
  { email: "lendava@brand.com", password: "password123", vendorName: "LENDAVA SKINCARE" },
  { email: "vitaparfum@brand.com", password: "password123", vendorName: "Vita Parfum" },
  { email: "justblessedhair@brand.com", password: "password123", vendorName: "Just Blessed Hair" },
  { email: "stace@brand.com", password: "password123", vendorName: "STACE Beauty" },
];

async function getValidAccessToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN.trim()) {
    return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN.trim();
  }

  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    throw new Error("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET in Environment Variables.");
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID.trim(),
      client_secret: SHOPIFY_CLIENT_SECRET.trim(),
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  cachedAccessToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in ? data.expires_in * 1000 : 86400 * 1000);
  return cachedAccessToken;
}

async function shopifyGraphQL(query, variables = {}) {
  try {
    const token = await getValidAccessToken();

    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        isError: true,
        status: res.status,
        message: typeof data.errors === "string" ? data.errors : JSON.stringify(data.errors || data),
      };
    }

    if (data.errors) {
      return {
        isError: true,
        status: 400,
        message: Array.isArray(data.errors)
          ? data.errors.map((e) => e.message).join(", ")
          : JSON.stringify(data.errors),
      };
    }

    return { isError: false, data: data.data };
  } catch (err) {
    return { isError: true, status: 502, message: err.message };
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Access token required." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: "Session expired." });
    req.vendor = user.vendorName;
    next();
  });
}

// 1. Auth Endpoint
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const vendor = VENDORS_DB.find(
    (v) => v.email.toLowerCase() === email?.toLowerCase() && v.password === password,
  );

  if (!vendor) return res.status(401).json({ error: "Invalid brand credentials." });

  const token = jwt.sign(
    { email: vendor.email, vendorName: vendor.vendorName },
    JWT_SECRET,
    { expiresIn: "7d" },
  );

  res.json({ success: true, token, vendorName: vendor.vendorName });
});

// 2. Fetch Brand Products & Catalog
app.get("/api/products", authenticateToken, async (req, res) => {
  try {
    const activeVendor = req.vendor;

    const query = `
      query getVendorCatalog($queryString: String!) {
        products(first: 50, query: $queryString) {
          edges {
            node {
              id
              title
              status
              featuredImage {
                url
              }
              variants(first: 20) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, {
      queryString: `vendor:"${activeVendor}"`,
    });

    if (result.isError) {
      return res.status(result.status || 502).json({ error: result.message });
    }

    const rawProducts = result.data?.products?.edges || [];
    const products = rawProducts.map(({ node }) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      imageUrl: node.featuredImage?.url || null,
      variants: node.variants.edges.map((v) => ({
        id: v.node.id,
        variantTitle: v.node.title,
        sku: v.node.sku || "N/A",
        price: v.node.price,
      })),
    }));

    res.json({ vendor: activeVendor, products });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// 3. Fetch Orders (with Address & Fulfillment metadata)
app.get("/api/orders", authenticateToken, async (req, res) => {
  try {
    const activeVendor = req.vendor;

    const query = `
      query getOrders {
        orders(first: 50, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              shippingAddress {
                name
                address1
                address2
                city
                province
                zip
                country
              }
              customer {
                firstName
                lastName
                email
              }
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    sku
                    vendor
                    quantity
                    originalUnitPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query);

    if (result.isError) {
      return res.status(result.status || 502).json({ error: result.message });
    }

    const rawOrders = result.data?.orders?.edges || [];
    const scopedOrders = [];

    rawOrders.forEach(({ node: order }) => {
      const brandItems = order.lineItems.edges
        .map((e) => e.node)
        .filter((item) => item.vendor?.trim().toLowerCase() === activeVendor.toLowerCase());

      if (brandItems.length > 0) {
        const brandTotal = brandItems.reduce((acc, item) => {
          return acc + parseFloat(item.originalUnitPriceSet.shopMoney.amount) * item.quantity;
        }, 0);

        scopedOrders.push({
          id: order.id,
          orderNumber: order.name,
          date: order.createdAt,
          financialStatus: order.displayFinancialStatus || "PAID",
          fulfillmentStatus: order.displayFulfillmentStatus || "UNFULFILLED",
          customer: {
            name: order.customer
              ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim()
              : order.shippingAddress?.name || "Store Customer",
            email: order.customer?.email || "N/A",
          },
          shippingAddress: order.shippingAddress
            ? {
                name: order.shippingAddress.name || "",
                address1: order.shippingAddress.address1 || "",
                address2: order.shippingAddress.address2 || "",
                city: order.shippingAddress.city || "",
                province: order.shippingAddress.province || "",
                zip: order.shippingAddress.zip || "",
                country: order.shippingAddress.country || "",
              }
            : null,
          items: brandItems,
          brandTotal: brandTotal.toFixed(2),
          currency: brandItems[0]?.originalUnitPriceSet?.shopMoney?.currencyCode || "USD",
        });
      }
    });

    res.json({ vendor: activeVendor, orders: scopedOrders });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// 4. Update Order Fulfillment Status (Complete vs. Pending)
app.post("/api/orders/update-status", authenticateToken, async (req, res) => {
  try {
    const { orderId, targetStatus } = req.body;

    if (!orderId || !targetStatus) {
      return res.status(400).json({ error: "Missing orderId or targetStatus" });
    }

    if (targetStatus === "FULFILLED") {
      // Step A: Find Open Fulfillment Order
      const foQuery = `
        query getFulfillmentOrders($id: ID!) {
          order(id: $id) {
            fulfillmentOrders(first: 5) {
              edges {
                node {
                  id
                  status
                }
              }
            }
          }
        }
      `;
      const foRes = await shopifyGraphQL(foQuery, { id: orderId });
      if (foRes.isError) return res.status(502).json({ error: foRes.message });

      const foEdges = foRes.data?.order?.fulfillmentOrders?.edges || [];
      const openFo = foEdges.find((e) => e.node.status === "OPEN" || e.node.status === "IN_PROGRESS");

      if (!openFo) {
        return res.status(400).json({ error: "No open fulfillment order available to complete." });
      }

      // Step B: Fulfill
      const fulfillMutation = `
        mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
          fulfillmentCreateV2(fulfillment: $fulfillment) {
            fulfillment {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      const fulfillRes = await shopifyGraphQL(fulfillMutation, {
        fulfillment: {
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: openFo.node.id }],
          notifyCustomer: false,
        },
      });

      if (fulfillRes.isError) return res.status(502).json({ error: fulfillRes.message });
      if (fulfillRes.data?.fulfillmentCreateV2?.userErrors?.length > 0) {
        return res.status(400).json({ error: fulfillRes.data.fulfillmentCreateV2.userErrors[0].message });
      }

      return res.json({ success: true, status: "FULFILLED" });
    } else if (targetStatus === "UNFULFILLED") {
      // Step A: Find Active Fulfillment
      const fQuery = `
        query getFulfillments($id: ID!) {
          order(id: $id) {
            fulfillments(first: 5) {
              id
              status
            }
          }
        }
      `;
      const fRes = await shopifyGraphQL(fQuery, { id: orderId });
      if (fRes.isError) return res.status(502).json({ error: fRes.message });

      const activeFulfillment = fRes.data?.order?.fulfillments?.find((f) => f.status === "SUCCESS");
      if (!activeFulfillment) {
        return res.status(400).json({ error: "No active fulfillment found to cancel." });
      }

      // Step B: Cancel Fulfillment
      const cancelMutation = `
        mutation fulfillmentCancel($id: ID!) {
          fulfillmentCancel(id: $id) {
            fulfillment {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      const cancelRes = await shopifyGraphQL(cancelMutation, { id: activeFulfillment.id });
      if (cancelRes.isError) return res.status(502).json({ error: cancelRes.message });
      if (cancelRes.data?.fulfillmentCancel?.userErrors?.length > 0) {
        return res.status(400).json({ error: cancelRes.data.fulfillmentCancel.userErrors[0].message });
      }

      return res.json({ success: true, status: "UNFULFILLED" });
    } else {
      return res.status(400).json({ error: "Invalid targetStatus. Use FULFILLED or UNFULFILLED." });
    }
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

export default app;