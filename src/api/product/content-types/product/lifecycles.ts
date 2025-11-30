import Stripe from 'stripe';

// Singleton Stripe - créé une seule fois
let stripeInstance: Stripe | null = null;

// Fonction helper pour obtenir l'instance Stripe
function getStripeInstance(): Stripe | null {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      console.error('❌ STRIPE_SECRET_KEY manquante dans .env');
      return null;
    }
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2025-09-30.clover',
    });
  }
  return stripeInstance;
}

// Helper pour convertir RichText en string
function richTextToString(richText: any): string {
  if (typeof richText === 'string') return richText;
  if (Array.isArray(richText)) {
    return richText
      .map((block: any) =>
        block.children?.map((child: any) => child.text).join('') || ''
      )
      .join('\n')
      .slice(0, 500); // Stripe limite à 5000 caractères
  }
  return '';
}

// Helper pour obtenir l'URL complète de l'image
async function getImageUrl(productId: number): Promise<string | undefined> {
  try {
    const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';

    // Récupérer le produit avec ses images
    const product = await strapi.db.query('api::product.product').findOne({
      where: { id: productId },
      populate: { images: true },
    });

    const imageUrl = product?.images?.[0]?.url;
    return imageUrl ? `${STRAPI_URL}${imageUrl}` : undefined;
  } catch (error) {
    console.warn('⚠️  Erreur récupération image:', error);
    return undefined;
  }
}

export default {
  // ==========================================
  // CRÉATION : Strapi → Stripe automatiquement
  // ==========================================
  async afterCreate(event) {
    const { result } = event;

    try {
      // Si le produit a déjà un stripeProductId (ne devrait pas arriver), skip
      if (result.stripeProductId) {
        console.log(`⏭️  Produit "${result.name}" a déjà un ID Stripe - skip afterCreate`);
        return;
      }

      const stripe = getStripeInstance();
      if (!stripe) return;

      // Préparer la description
      const description = richTextToString(result.description) ||
        `${result.name} - Disponible sur notre boutique`;

      // Récupérer l'image
      const imageUrl = await getImageUrl(result.id);

      // Créer le produit dans Stripe
      const stripeProduct = await stripe.products.create({
        name: result.name,
        description,
        images: imageUrl ? [imageUrl] : undefined,
        metadata: {
          strapiId: result.documentId || result.id.toString(),
          strapiSlug: result.slug || '',
        },
      });

      // Créer le prix dans Stripe
      const stripePrice = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: Math.round(result.price * 100),
        currency: 'eur',
        metadata: {
          strapiProductId: result.documentId || result.id.toString(),
        },
      });

      // Mettre à jour avec strapi.db.query pour NE PAS déclencher afterUpdate
      await strapi.db.query('api::product.product').update({
        where: { id: result.id },
        data: {
          stripeProductId: stripeProduct.id,
          stripePriceId: stripePrice.id,
        },
      });

      console.log(`✅ Produit "${result.name}" créé dans Stripe:`, {
        productId: stripeProduct.id,
        priceId: stripePrice.id,
        hasImage: !!imageUrl,
      });
    } catch (error: any) {
      console.error(`❌ Erreur création Stripe pour "${result.name}":`, error.message);
    }
  },

  // ==========================================
  // MODIFICATION : Strapi → Stripe automatiquement
  // ==========================================
  async afterUpdate(event) {
    const { result, params } = event;

    try {
      // Skip si c'est juste un changement de publishedAt (publish/unpublish)
      const changedFields = Object.keys(params?.data || {});
      if (changedFields.length === 1 && changedFields[0] === 'publishedAt') {
        return;
      }

      // Skip si les seuls changements sont stripeProductId et/ou stripePriceId
      // (c'est nous qui venons de les mettre à jour dans afterCreate)
      const nonStripeFields = changedFields.filter(
        field => !['stripeProductId', 'stripePriceId', 'publishedAt', 'updatedAt'].includes(field)
      );
      if (nonStripeFields.length === 0) {
        return;
      }

      // Si le produit n'a pas d'ID Stripe, on ne fait rien (sera géré par afterCreate)
      if (!result.stripeProductId) {
        console.log(`⏭️  Produit "${result.name}" n'a pas d'ID Stripe - skip afterUpdate`);
        return;
      }

      const stripe = getStripeInstance();
      if (!stripe) return;

      // Préparer la description
      const description = richTextToString(result.description) ||
        `${result.name} - Disponible sur notre boutique`;

      // Récupérer l'image
      const imageUrl = await getImageUrl(result.id);

      // Mettre à jour le produit Stripe
      await stripe.products.update(result.stripeProductId, {
        name: result.name,
        description,
        images: imageUrl ? [imageUrl] : undefined,
        metadata: {
          strapiId: result.documentId || result.id.toString(),
          strapiSlug: result.slug || '',
        },
      });

      console.log(`✅ Produit "${result.name}" mis à jour dans Stripe (${result.stripeProductId})`);

      // === GESTION DU PRIX ===
      if (changedFields.includes('price') && result.stripePriceId) {
        const existingPrice = await stripe.prices.retrieve(result.stripePriceId);
        const newPriceAmount = Math.round(result.price * 100);

        if (existingPrice.unit_amount !== newPriceAmount) {
          // Archiver l'ancien prix
          await stripe.prices.update(result.stripePriceId, { active: false });

          // Créer un nouveau prix
          const newPrice = await stripe.prices.create({
            product: result.stripeProductId,
            unit_amount: newPriceAmount,
            currency: 'eur',
            metadata: {
              strapiProductId: result.documentId || result.id.toString(),
            },
          });

          // Mettre à jour le produit Strapi (sans déclencher afterUpdate)
          await strapi.db.query('api::product.product').update({
            where: { id: result.id },
            data: {
              stripePriceId: newPrice.id,
            },
          });

          console.log(`   → Prix mis à jour: ${(newPriceAmount / 100).toFixed(2)}€ (nouveau: ${newPrice.id})`);
        }
      }
    } catch (error: any) {
      console.error(`❌ Erreur update Stripe pour "${result.name}":`, error.message);
    }
  },

  // ==========================================
  // SUPPRESSION : Strapi → Archive Stripe
  // ==========================================
  async beforeDelete(event) {
    const { params } = event;

    try {
      // Récupérer le produit complet AVANT suppression
      const product = await strapi.db.query('api::product.product').findOne({
        where: { id: params.where.id },
      });

      if (!product?.stripeProductId) {
        console.log(`⏭️  Produit sans ID Stripe - skip beforeDelete`);
        return;
      }

      const stripe = getStripeInstance();
      if (!stripe) return;

      // Archiver le produit dans Stripe (on ne peut pas le supprimer complètement)
      await stripe.products.update(product.stripeProductId, {
        active: false,
      });

      // Archiver aussi le prix actif
      if (product.stripePriceId) {
        await stripe.prices.update(product.stripePriceId, { active: false });
      }

      console.log(`✅ Produit "${product.name}" archivé dans Stripe (${product.stripeProductId})`);
    } catch (error: any) {
      console.error('❌ Erreur archivage Stripe:', error.message);
    }
  },
};
