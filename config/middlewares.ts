export default [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'res.cloudinary.com',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'res.cloudinary.com',
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      // Configuration personnalisée du body parser
      // On utilise une fonction pour ignorer le parsing pour les webhooks Stripe
      includeUnparsed: true,
      parsedMethods: ['POST', 'PUT', 'PATCH'],
      // Fonction pour déterminer si on doit parser le body
      // Retourne false pour les webhooks Stripe car on le parse manuellement
      formidable: {
        maxFileSize: 200 * 1024 * 1024, // 200mb
      },
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
