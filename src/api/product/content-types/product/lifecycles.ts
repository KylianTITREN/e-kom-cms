import Stripe from 'stripe';

// Fonction helper pour obtenir l'instance Stripe depuis les settings
async function getStripeInstance(): Promise<Stripe | null> {
  try {
    const settings = await strapi.documents('api::setting.setting').findFirst();
    
    if (!settings?.stripeSecretKey) {
      console.error('⚠️  Aucune clé Stripe configurée dans les paramètres');
      return null;
    }

    return new Stripe(settings.stripeSecretKey, {
      apiVersion: '2025-09-30.clover',
    });
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des paramètres Stripe:', error);
    return null;
  }
}

export default {
  // Après la création d'un produit
  async afterCreate(event) {
    const { result } = event;

    try {
      // Si le produit a déjà un stripeProductId (ne devrait pas arriver), skip
      if (result.stripeProductId) {
        console.log(`⏭️  Produit "${result.name}" a déjà un ID Stripe - skip afterCreate`);
        return;
      }

      const stripe = await getStripeInstance();
      if (!stripe) return;

      // Créer le produit dans Stripe
      const stripeProduct = await stripe.products.create({
        name: result.name,
        description: result.description 
          ? (typeof result.description === 'string' 
              ? result.description 
              : 'Produit disponible sur notre boutique')
          : 'Produit disponible sur notre boutique',
        metadata: {
          strapiId: result.documentId || result.id.toString(),
        },
      });

      // Créer le prix dans Stripe
      const stripePrice = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: Math.round(result.price * 100),
        currency: 'eur',
      });

      // Mettre à jour avec strapi.db.query pour NE PAS déclencher afterUpdate
      await strapi.db.query('api::product.product').update({
        where: { documentId: result.documentId },
        data: {
          stripeProductId: stripeProduct.id,
          stripePriceId: stripePrice.id,
        },
      });

      console.log(`✅ Produit "${result.name}" créé dans Stripe:`, {
        productId: stripeProduct.id,
        priceId: stripePrice.id,
      });
    } catch (error) {
      console.error('❌ Erreur lors de la création du produit Stripe:', error);
    }
  },

  // Après la mise à jour d'un produit
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
        field => field !== 'stripeProductId' && field !== 'stripePriceId' && field !== 'publishedAt' && field !== 'updatedAt'
      );
      if (nonStripeFields.length === 0) {
        return;
      }

      // Si le produit n'a pas d'ID Stripe, on ne fait rien (sera géré par afterCreate)
      if (!result.stripeProductId) {
        return;
      }

      const stripe = await getStripeInstance();
      if (!stripe) return;
      
      // Mettre à jour le produit Stripe
      await stripe.products.update(result.stripeProductId, {
        name: result.name,
        description: result.description 
          ? (typeof result.description === 'string' 
              ? result.description 
              : 'Produit disponible sur notre boutique')
          : 'Produit disponible sur notre boutique',
      });

      // Si le prix a changé, créer un nouveau prix (Stripe ne permet pas de modifier un prix existant)
      if (result.stripePriceId) {
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
          });

          // Mettre à jour le produit Strapi (sans déclencher afterUpdate)
          await strapi.db.query('api::product.product').update({
            where: { documentId: result.documentId },
            data: {
              stripePriceId: newPrice.id,
            },
          });

          console.log(`✅ Prix du produit "${result.name}" mis à jour:`, newPrice.id);
        }
      }

      console.log(`✅ Produit "${result.name}" mis à jour dans Stripe`);
    } catch (error) {
      console.error('❌ Erreur lors de la mise à jour du produit Stripe:', error);
    }
  },

  // Avant la suppression d'un produit
  async beforeDelete(event) {
    const { params } = event;

    try {
      // Récupérer le produit complet AVANT suppression
      // Utiliser strapi.db.query car params.where contient l'id numérique, pas le documentId
      const product = await strapi.db.query('api::product.product').findOne({
        where: { id: params.where.id },
      });

      if (!product?.stripeProductId) {
        return;
      }

      const stripe = await getStripeInstance();
      if (!stripe) return;

      // Archiver le produit dans Stripe (on ne peut pas le supprimer complètement)
      await stripe.products.update(product.stripeProductId, {
        active: false,
      });

      console.log(`✅ Produit "${product.name}" archivé dans Stripe`);
    } catch (error) {
      console.error('❌ Erreur lors de l\'archivage du produit Stripe:', error);
    }
  },
};
