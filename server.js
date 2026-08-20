import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'latinas_secret_key';
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2026-01/graphql.json`;

// Central Vendor Registry
const VENDORS_DB = [
  { email: 'alamar@brand.com', password: 'password123', vendorName: 'Alamar Cosmetics' },
  { email: 'ceremonia@brand.com', password: 'password123', vendorName: 'Ceremonia' },
  { email: 'rare@brand.com', password: 'password123', vendorName: 'Rare Beauty' },
  { email: 'fenty@brand.com', password: 'password123', vendorName: 'Fenty Beauty' },
  { email: 'tresluce@brand.com', password: 'password123', vendorName: 'Treslúce Beauty' },
  { email: 'gente@brand.com', password: 'password123', vendorName: 'Gente Beauty' }
];

// Helper: GraphQL Client
async function shopifyGraphQL(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return await res.json();
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Session expired or invalid token.' });
    }
    req.vendor = user.vendorName;
    next();
  });
}

// -------------------------------------------------------------
// 1. Auth Endpoint
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const vendor = VENDORS_DB.find(
    (v) => v.email.toLowerCase() === email?.toLowerCase() && v.password === password
  );

  if (!vendor) {
    return res.status(401).json({ error: 'Invalid brand credentials.' });
  }

  const token = jwt.sign(
    { email: vendor.email, vendorName: vendor.vendorName },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ success: true, token, vendorName: vendor.vendorName });
});

// -------------------------------------------------------------
// 2. Fetch Brand Products & Inventory (SKUs, Stock, Status)
// -------------------------------------------------------------
app.get('/api/products', authenticateToken, async (req, res) => {
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
              totalInventory
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

    // Escaped double quotes ensure multi-word vendor names match accurately
    const variables = {
      queryString: `vendor:"${activeVendor}"`
    };

    const response = await shopifyGraphQL(query, variables);

    if (response.errors) {
      console.error('Shopify GraphQL Error:', response.errors);
      return res.status(500).json({ error: response.errors[0].message });
    }

    const rawProducts = response.data?.products?.edges || [];

    const products = rawProducts.map(({ node }) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      totalInventory: node.totalInventory !== undefined ? node.totalInventory : null,
      imageUrl: node.featuredImage?.url || null,
      variants: node.variants.edges.map((v) => ({
        id: v.node.id,
        variantTitle: v.node.title,
        sku: v.node.sku || 'N/A',
        price: v.node.price
      }))
    }));

    res.json({ vendor: activeVendor, products });
  } catch (error) {
    console.error('Server error fetching products:', error);
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 3. Fetch Orders (Scoped + Customer Details)
// -------------------------------------------------------------
app.get('/api/orders', authenticateToken, async (req, res) => {
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
              customer {
                firstName
                lastName
                email
              }
              shippingAddress {
                city
                province
                country
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

    const response = await shopifyGraphQL(query);

    if (response.errors) {
      console.error('Shopify GraphQL Orders Error:', response.errors);
      return res.status(500).json({ error: response.errors[0].message });
    }

    const rawOrders = response.data?.orders?.edges || [];
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
          orderNumber: order.name,
          date: order.createdAt,
          financialStatus: order.displayFinancialStatus,
          fulfillmentStatus: order.displayFulfillmentStatus,
          customer: {
            name: order.customer ? `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() : 'Guest Checkout',
            email: order.customer?.email || 'N/A',
            destination: order.shippingAddress ? `${order.shippingAddress.city || ''}, ${order.shippingAddress.country || ''}` : 'Digital / Not Provided'
          },
          items: brandItems,
          brandTotal: brandTotal.toFixed(2),
          currency: brandItems[0]?.originalUnitPriceSet?.shopMoney?.currencyCode || 'USD'
        });
      }
    });

    res.json({ vendor: activeVendor, orders: scopedOrders });
  } catch (error) {
    console.error('Server error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 4. Create Product (Enforces Vendor & Metafields)
// -------------------------------------------------------------
app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    const activeVendor = req.vendor;
    const { title, price, sku, description, imageUrl, tag01, tag02 } = req.body;

    const mutation = `
      mutation createProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
        productCreate(input: $input, media: $media) {
          product {
            id
            title
            vendor
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        title,
        descriptionHtml: `<p>${description || ''}</p>`,
        vendor: activeVendor,
        status: 'DRAFT',
        metafields: [
          ...(tag01 ? [{ namespace: 'custom', key: 'Tag_01', type: 'single_line_text_field', value: tag01 }] : []),
          ...(tag02 ? [{ namespace: 'custom', key: 'tag_02', type: 'single_line_text_field', value: tag02 }] : [])
        ]
      },
      media: imageUrl ? [{ originalSource: imageUrl, mediaContentType: 'IMAGE' }] : []
    };

    const response = await shopifyGraphQL(mutation, variables);
    const result = response.data?.productCreate;

    if (result?.userErrors?.length > 0) {
      return res.status(400).json({ errors: result.userErrors });
    }

    const productId = result.product.id;

    // Set Variant Price and SKU
    if (price || sku) {
      const getVariantQuery = `
        query getVariant($id: ID!) {
          product(id: $id) {
            variants(first: 1) {
              edges { node { id } }
            }
          }
        }
      `;
      const varRes = await shopifyGraphQL(getVariantQuery, { id: productId });
      const variantId = varRes.data?.product?.variants?.edges[0]?.node?.id;

      if (variantId) {
        const updatePriceMutation = `
          mutation updateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }
        `;
        await shopifyGraphQL(updatePriceMutation, {
          productId,
          variants: [{
            id: variantId,
            ...(price && { price: price.toString() }),
            ...(sku && { sku: sku.toString() })
          }]
        });
      }
    }

    res.json({ success: true, product: result.product });
  } catch (error) {
    console.error('Server error creating product:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Multi-Vendor Portal active at http://localhost:${PORT}\n`);
});