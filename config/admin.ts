export default ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
  locales: ['en', 'fr'],

  // Configuration du mode Preview
  preview: {
    enabled: true,
    config: {
      allowedOrigins: env('FRONT_URL'),

      async handler(uid: string, { documentId, status }: { documentId: string; locale?: string; status?: string }) {
        // Fonction qui détermine le pathname de preview selon le content type
        const getPreviewPathname = (uid: string, documentId: string) => {
          // Map des content types vers leurs routes frontend
          switch (uid) {
            case 'api::product.product':
              // Pour les produits, on utilise le slug
              // On va chercher le produit pour obtenir son slug
              return `/produit/${documentId}`; // documentId peut servir de fallback si le slug n'est pas trouvé

            case 'api::news-article.news-article':
              // Pour les actualités
              return `/actualites/${documentId}`;

            case 'api::legal-page.legal-page':
              // Pour les pages légales
              return `/legal/${documentId}`;

            case 'api::homepage-content.homepage-content':
              // Pour la page d'accueil
              return `/`;

            // Content types sans preview (settings, categories, brands, etc.)
            case 'api::setting.setting':
            case 'api::category.category':
            case 'api::subcategory.subcategory':
            case 'api::brand.brand':
              return null;

            default:
              console.warn(`Preview non configuré pour le content type: ${uid}`);
              return null;
          }
        };

        const pathname = getPreviewPathname(uid, documentId);

        // Si pas de route de preview pour ce content type, on retourne null
        if (!pathname) {
          return null;
        }

        // Construction de l'URL de preview avec le secret et le status
        const previewUrl = new URL('/api/preview', env('FRONT_URL'));
        previewUrl.searchParams.set('url', pathname);
        previewUrl.searchParams.set('secret', env('PREVIEW_SECRET'));

        // Ajouter le status (draft ou published) pour que Next.js puisse l'utiliser
        if (status) {
          previewUrl.searchParams.set('status', status);
        }

        // Ajouter le documentId pour que Next.js puisse fetcher le bon document
        previewUrl.searchParams.set('documentId', documentId);

        return previewUrl.toString();
      },
    },
  },
});
