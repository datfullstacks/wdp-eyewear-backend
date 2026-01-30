const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WDP Eyewear Shop API',
      version: '1.0.0',
      description: 'API documentation for WDP Eyewear E-commerce System',
      contact: {
        name: 'WDP Team',
        email: 'support@wdp-eyewear.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: process.env.PRODUCTION_API_URL || 'https://api.wdp-eyewear.com',
        description: 'Production server'
      }
    ].filter(server => server.url), // Remove if URL is undefined
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User full name' },
            email: { type: 'string', format: 'email', description: 'User email address' },
            role: { type: 'string', enum: ['customer', 'sales', 'operations', 'manager', 'admin'], description: 'User role' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Product: {
          type: 'object',
          required: ['name', 'type', 'brand', 'pricing', 'inventory'],
          properties: {
            id: { type: 'string', description: 'Product ID' },
            name: { type: 'string', description: 'Product name' },
            slug: { type: 'string', description: 'SEO-friendly slug' },
            description: { type: 'string', description: 'Product description' },
            type: {
              type: 'string',
              enum: ['sunglasses', 'frame', 'lens', 'contact_lens', 'accessory', 'service', 'bundle', 'gift_card', 'other'],
              description: 'Product type'
            },
            brand: { type: 'string', description: 'Brand' },
            pricing: {
              type: 'object',
              required: ['currency', 'basePrice'],
              properties: {
                currency: { type: 'string', description: 'Currency (ISO 4217)' },
                basePrice: { type: 'number', description: 'Base price' },
                msrp: { type: 'number', description: 'List price' },
                salePrice: { type: 'number', description: 'Sale price' },
                discountPercent: { type: 'number', description: 'Discount percent' },
                taxRate: { type: 'number', description: 'Tax rate (%)' }
              }
            },
            inventory: {
              type: 'object',
              required: ['track'],
              properties: {
                track: { type: 'boolean', description: 'Track inventory' },
                threshold: { type: 'integer', description: 'Low stock threshold' }
              }
            },
            specs: { type: 'object', description: 'Type-specific specs (see product.md)' },
            variants: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku: { type: 'string', description: 'SKU' },
                  barcode: { type: 'string', description: 'Barcode' },
                  options: {
                    type: 'object',
                    properties: {
                      color: { type: 'string' },
                      size: { type: 'string' }
                    }
                  },
                  price: { type: 'number', description: 'Variant price' },
                  stock: { type: 'number', description: 'Stock quantity' },
                  warehouseLocation: { type: 'string', description: 'Warehouse location' },
                  assetIds: { type: 'array', items: { type: 'string' } }
                }
              }
            },
            media: {
              type: 'object',
              properties: {
                primaryAssetId: { type: 'string' },
                assets: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      assetType: { type: 'string', enum: ['2d', '3d'] },
                      role: { type: 'string' },
                      url: { type: 'string' },
                      format: { type: 'string' },
                      posterUrl: { type: 'string' }
                    }
                  }
                }
              }
            },
            status: { type: 'string', enum: ['draft', 'active', 'inactive', 'out_of_stock'], description: 'Product status' },
            ratingsAverage: { type: 'number', description: 'Average rating' },
            ratingsQuantity: { type: 'number', description: 'Number of ratings' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', description: 'Error message' },
            errors: { type: 'array', items: { type: 'object' } }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', description: 'Success message' },
            data: { type: 'object', description: 'Response data' }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./routes/*.js', './controllers/*.js'] // Path to files with swagger comments
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

module.exports = { swaggerUi, swaggerDocs };
