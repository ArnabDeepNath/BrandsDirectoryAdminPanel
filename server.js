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

const RAW_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN || "gh0dgm-bq.myshopify.com";
const SHOPIFY_DOMAIN = RAW_DOMAIN.replace(/^https?:\/\//, "").replace(
  /\/+$/,
  "",
);
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
let cachedAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || null;

const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-10/graphql.json`;
const OAUTH_TOKEN_URL = `https://${SHOPIFY_DOMAIN}/admin/oauth/access_token`;

const VENDORS_DB = [
  {
    email: "alamar@brand.com",
    password: "password123",
    vendorName: "Alamar Cosmetics",
  },
  {
    email: "ceremonia@brand.com",
    password: "password123",
    vendorName: "Ceremonia",
  },
  {
    email: "rare@brand.com",
    password: "password123",
    vendorName: "Rare Beauty",
  },
  {
    email: "fenty@brand.com",
    password: "password123",
    vendorName: "Fenty Beauty",
  },
  {
    email: "tresluce@brand.com",
    password: "password123",
    vendorName: "Treslúce Beauty",
  },
  {
    email: "gente@brand.com",
    password: "password123",
    vendorName: "Gente Beauty",
  },
];

// Automatically mint/refresh Shopify Access Token
async function getValidAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;

  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    throw new Error("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Failed to exchange token: ${JSON.stringify(data)}`);
  }

  cachedAccessToken = data.access_token;
  return cachedAccessToken;
}

// Helper: GraphQL Client
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
        message:
          typeof data.errors === "string"
            ? data.errors
            : JSON.stringify(data.errors || data),
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
    return { isError: true, status: 500, message: err.message };
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Access token required." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Session expired." });
    req.vendor = user.vendorName;
    next();
  });
}

// 1. Auth Endpoint
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const vendor = VENDORS_DB.find(
    (v) =>
      v.email.toLowerCase() === email?.toLowerCase() && v.password === password,
  );

  if (!vendor)
    return res.status(401).json({ error: "Invalid brand credentials." });

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
      return res.status(result.status || 500).json({ error: result.message });
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
    res.status(500).json({ error: error.message });
  }
});

// 3. Fetch Orders
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
      return res.status(result.status || 500).json({ error: result.message });
    }

    const rawOrders = result.data?.orders?.edges || [];
    const scopedOrders = [];

    rawOrders.forEach(({ node: order }) => {
      const brandItems = order.lineItems.edges
        .map((e) => e.node)
        .filter(
          (item) =>
            item.vendor?.trim().toLowerCase() === activeVendor.toLowerCase(),
        );

      if (brandItems.length > 0) {
        const brandTotal = brandItems.reduce((acc, item) => {
          return (
            acc +
            parseFloat(item.originalUnitPriceSet.shopMoney.amount) *
              item.quantity
          );
        }, 0);

        scopedOrders.push({
          orderNumber: order.name,
          date: order.createdAt,
          financialStatus: order.displayFinancialStatus,
          fulfillmentStatus: order.displayFulfillmentStatus,
          items: brandItems,
          brandTotal: brandTotal.toFixed(2),
          currency:
            brandItems[0]?.originalUnitPriceSet?.shopMoney?.currencyCode ||
            "USD",
        });
      }
    });

    res.json({ vendor: activeVendor, orders: scopedOrders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Create Product
app.post("/api/products", authenticateToken, async (req, res) => {
  try {
    const activeVendor = req.vendor;
    const { title, price, sku, description, imageUrl, tag01, tag02 } = req.body;

    const mutation = `
      mutation createProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
        productCreate(input: $input, media: $media) {
          product { id title vendor handle }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      input: {
        title,
        descriptionHtml: `<p>${description || ""}</p>`,
        vendor: activeVendor,
        status: "DRAFT",
        metafields: [
          ...(tag01
            ? [
                {
                  namespace: "custom",
                  key: "Tag_01",
                  type: "single_line_text_field",
                  value: tag01,
                },
              ]
            : []),
          ...(tag02
            ? [
                {
                  namespace: "custom",
                  key: "tag_02",
                  type: "single_line_text_field",
                  value: tag02,
                },
              ]
            : []),
        ],
      },
      media: imageUrl
        ? [{ originalSource: imageUrl, mediaContentType: "IMAGE" }]
        : [],
    };

    const result = await shopifyGraphQL(mutation, variables);

    if (result.isError) {
      return res.status(result.status || 500).json({ error: result.message });
    }

    const resData = result.data?.productCreate;
    if (resData?.userErrors?.length > 0) {
      return res.status(400).json({ errors: resData.userErrors });
    }

    res.json({ success: true, product: resData.product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default app;
