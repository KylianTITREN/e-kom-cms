import Stripe from 'stripe';

/**
 * Script pour synchroniser tous les produits Strapi existants avec Stripe
 * Usage: npm run strapi console
 * Puis copier-coller le contenu de ce fichier
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-09-30.clover',
});

async function syncAllProducts() {
  console.log('🔄 Début de la synchronisation des produits...');

  try {
    // Récupérer tous les produits
    const products = await strapi.documents('api::product.product').findMany();

    console.log(`📦 ${products.length} produits trouvés`);

    for (const product of products) {
      try {
        // Si le produit a déjà un ID Stripe, on le skip
        if (product.stripeProductId) {
          console.log(`⏭️  "${product.name}" déjà synchronisé (${product.stripeProductId})`);
          continue;
        }

        // Créer le produit dans Stripe
        const stripeProduct = await stripe.products.create({
          name: product.name,
          description: typeof product.description === 'string' 
            ? product.description 
            : 'Produit disponible sur notre boutique',
          metadata: {
            strapiId: product.documentId || product.id.toString(),
          },
        });

        // Créer le prix dans Stripe
        const stripePrice = await stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: Math.round(product.price * 100),
          currency: 'eur',
        });

        // Mettre à jour le produit Strapi
        await strapi.documents('api::product.product').update({
          documentId: product.documentId,
          data: {
            stripeProductId: stripeProduct.id,
            stripePriceId: stripePrice.id,
          },
        });

        console.log(`✅ "${product.name}" synchronisé:`, {
          productId: stripeProduct.id,
          priceId: stripePrice.id,
        });

        // Petite pause pour éviter de surcharger l'API Stripe
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`❌ Erreur pour "${product.name}":`, error.message);
      }
    }

    console.log('✨ Synchronisation terminée !');
  } catch (error) {
    console.error('❌ Erreur lors de la synchronisation:', error);
  }
}

// Pour exécuter dans la console Strapi
syncAllProducts();
