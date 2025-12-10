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

export default {
  // ==========================================
  // CRÉATION : Strapi → Stripe automatiquement
  // ==========================================
  async afterCreate(event) {
    const { result } = event;

    try {
      // Si le produit a déjà un stripeProductId (ne devrait pas arriver), skip
      if (result.stripeProductId) {
        console.log(`⏭️  Produit "${result.title}" a déjà un ID Stripe - skip afterCreate`);
        return;
      }

      const stripe = getStripeInstance();
      if (!stripe) return;

      // Préparer la description
      const description = result.description ||
        `${result.title} - Option de gravure disponible`;

      // Créer le produit dans Stripe
      const stripeProduct = await stripe.products.create({
        name: `[Gravure] ${result.title}`,
        description,
        metadata: {
          strapiId: result.documentId || result.id.toString(),
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
      await strapi.db.query('api::engraving.engraving').update({
        where: { id: result.id },
        data: {
          stripeProductId: stripeProduct.id,
          stripePriceId: stripePrice.id,
        },
      });

      console.log(`✅ Gravure "${result.title}" créé dans Stripe:`, {
        productId: stripeProduct.id,
        priceId: stripePrice.id
      });
    } catch (error: any) {
      console.error(`❌ Erreur création Stripe pour "${result.title}":`, error.message);
    }
  },

  // ==========================================
  // MODIFICATION : Strapi → Stripe automatiquement
  // ==========================================
  async afterUpdate(event) {
    const { result, params } = event;

    try {
      // Skip si les seuls changements sont stripeProductId et/ou stripePriceId
      // (c'est nous qui venons de les mettre à jour dans afterCreate)
      const changedFields = Object.keys(params?.data || {});
      const nonStripeFields = changedFields.filter(
        field => !['stripeProductId', 'stripePriceId', 'updatedAt'].includes(field)
      );
      if (nonStripeFields.length === 0) {
        return;
      }

      const stripe = getStripeInstance();
      if (!stripe) return;

      // Si la gravure n'a pas d'ID Stripe, la créer maintenant
      if (!result.stripeProductId) {
        console.log(`🔧 Gravure "${result.title}" sans ID Stripe - création dans Stripe...`);

        const description = result.description ||
          `${result.title} - Option de gravure disponible`;

        // Créer le produit dans Stripe
        const stripeProduct = await stripe.products.create({
          name: `[Gravure] ${result.title}`,
          description,
          metadata: {
            strapiId: result.documentId || result.id.toString(),
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
        await strapi.db.query('api::engraving.engraving').update({
          where: { id: result.id },
          data: {
            stripeProductId: stripeProduct.id,
            stripePriceId: stripePrice.id,
          },
        });

        console.log(`✅ Gravure "${result.title}" créé dans Stripe:`, {
          productId: stripeProduct.id,
          priceId: stripePrice.id
        });

        return;
      }

      // Préparer la description
      const description = result.description ||
        `${result.title} - Option de gravure disponible`;

      // Mettre à jour le produit Stripe
      await stripe.products.update(result.stripeProductId, {
        name: `[Gravure] ${result.title}`,
        description,
        metadata: {
          strapiId: result.documentId || result.id.toString()
        },
      });

      console.log(`✅ Gravure "${result.title}" mis à jour dans Stripe (${result.stripeProductId})`);

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
          await strapi.db.query('api::engraving.engraving').update({
            where: { id: result.id },
            data: {
              stripePriceId: newPrice.id,
            },
          });

          console.log(`   → Prix mis à jour: ${(newPriceAmount / 100).toFixed(2)}€ (nouveau: ${newPrice.id})`);
        }
      }
    } catch (error: any) {
      console.error(`❌ Erreur update Stripe pour "${result.title}":`, error.message);
    }
  },

  // ==========================================
  // SUPPRESSION : Strapi → Archive Stripe
  // ==========================================
  async beforeDelete(event) {
    const { params } = event;

    try {
      // Récupérer le produit complet AVANT suppression
      const engraving = await strapi.db.query('api::engraving.engraving').findOne({
        where: { id: params.where.id },
      });

      if (!engraving) {
        console.log(`⏭️  Gravure introuvable - skip beforeDelete`);
        return;
      }

      // Skip si la gravure n'a pas de stripeProductId
      if (!engraving?.stripeProductId) {
        console.log(`⏭️  Gravure "${engraving.title}" sans ID Stripe - skip beforeDelete`);
        return;
      }

      const stripe = getStripeInstance();
      if (!stripe) return;

      // Archiver le produit dans Stripe (on ne peut pas le supprimer complètement)
      await stripe.products.update(engraving.stripeProductId, {
        active: false,
      });

      // Archiver aussi le prix actif
      if (engraving.stripePriceId) {
        await stripe.prices.update(engraving.stripePriceId, { active: false });
      }

      console.log(`✅ Gravure "${engraving.title}" archivé dans Stripe (${engraving.stripeProductId})`);
    } catch (error: any) {
      console.error('❌ Erreur archivage Stripe:', error.message);
    }
  },
};
