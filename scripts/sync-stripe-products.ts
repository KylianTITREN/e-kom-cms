import Stripe from 'stripe';

/**
 * Script pour synchroniser tous les produits Strapi existants avec Stripe
 *
 * Usage:
 *   npm run strapi console
 *   Puis copier-coller le contenu de ce fichier
 *
 * Options:
 *   FORCE_RESYNC=true : Force la re-synchronisation de tous les produits
 *   UPDATE_PRICES=true : Met à jour les prix Stripe si changés dans Strapi
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-09-30.clover',
});

// Options de configuration
const FORCE_RESYNC = process.env.FORCE_RESYNC === 'true';
const UPDATE_PRICES = process.env.UPDATE_PRICES === 'true';
const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';

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

// Statistiques
const stats = {
  total: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
};

async function syncAllProducts() {
  console.log('🔄 Début de la synchronisation des produits...');
  console.log(`Options: FORCE_RESYNC=${FORCE_RESYNC}, UPDATE_PRICES=${UPDATE_PRICES}`);

  try {
    // Récupérer tous les produits avec leurs relations
    const products = await strapi.db.query('api::product.product').findMany({
      populate: {
        images: true,
      },
    });

    stats.total = products.length;
    console.log(`📦 ${products.length} produits trouvés\n`);

    for (const product of products) {
      try {
        await syncProduct(product);

        // Pause pour éviter de surcharger l'API Stripe (rate limit: 100 req/s)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        stats.errors++;
        console.error(`❌ Erreur pour "${product.name}":`, error.message);
      }
    }

    // Afficher les statistiques
    console.log('\n✨ Synchronisation terminée !');
    console.log('📊 Statistiques:');
    console.log(`   - Total: ${stats.total}`);
    console.log(`   - Créés: ${stats.created}`);
    console.log(`   - Mis à jour: ${stats.updated}`);
    console.log(`   - Ignorés: ${stats.skipped}`);
    console.log(`   - Erreurs: ${stats.errors}`);
  } catch (error: any) {
    console.error('❌ Erreur lors de la synchronisation:', error);
  }
}

async function syncProduct(product: any) {
  const hasStripeProduct = !!product.stripeProductId;

  // Si déjà synchronisé et pas de force resync, skip
  if (hasStripeProduct && !FORCE_RESYNC && !UPDATE_PRICES) {
    console.log(`⏭️  "${product.name}" déjà synchronisé (${product.stripeProductId})`);
    stats.skipped++;
    return;
  }

  // Préparer l'image principale pour Stripe
  const imageUrl = product.images?.[0]?.url
    ? `${STRAPI_URL}${product.images[0].url}`
    : undefined;

  // Préparer la description
  const description = richTextToString(product.description) ||
    `${product.name} - Disponible sur notre boutique`;

  // === CRÉATION OU UPDATE DU PRODUIT ===
  let stripeProduct: Stripe.Product;

  if (!hasStripeProduct || FORCE_RESYNC) {
    // Créer le produit dans Stripe
    stripeProduct = await stripe.products.create({
      name: product.name,
      description,
      images: imageUrl ? [imageUrl] : undefined,
      metadata: {
        strapiId: product.documentId || product.id.toString(),
        strapiSlug: product.slug || '',
      },
    });

    console.log(`✅ Produit créé: "${product.name}" (${stripeProduct.id})`);
    stats.created++;
  } else {
    // Récupérer le produit existant
    stripeProduct = await stripe.products.retrieve(product.stripeProductId);

    // Mettre à jour si nécessaire
    const needsUpdate =
      stripeProduct.name !== product.name ||
      stripeProduct.description !== description;

    if (needsUpdate) {
      stripeProduct = await stripe.products.update(product.stripeProductId, {
        name: product.name,
        description,
        images: imageUrl ? [imageUrl] : undefined,
      });
      console.log(`🔄 Produit mis à jour: "${product.name}"`);
      stats.updated++;
    }
  }

  // === GESTION DU PRIX ===
  let stripePriceId = product.stripePriceId;

  // Si pas de price ou UPDATE_PRICES activé
  if (!stripePriceId || UPDATE_PRICES) {
    const currentPriceInCents = Math.round(product.price * 100);

    // Vérifier si le prix a changé
    let needsNewPrice = !stripePriceId;

    if (stripePriceId) {
      const currentPrice = await stripe.prices.retrieve(stripePriceId);
      needsNewPrice = currentPrice.unit_amount !== currentPriceInCents;
    }

    if (needsNewPrice) {
      // Les prices Stripe sont immutables, on doit en créer un nouveau
      const newPrice = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: currentPriceInCents,
        currency: 'eur',
        metadata: {
          strapiProductId: product.documentId || product.id.toString(),
        },
      });

      // Archiver l'ancien prix si existant
      if (stripePriceId) {
        await stripe.prices.update(stripePriceId, { active: false });
        console.log(`   → Prix mis à jour: ${(currentPriceInCents / 100).toFixed(2)}€ (nouveau: ${newPrice.id})`);
      } else {
        console.log(`   → Prix créé: ${(currentPriceInCents / 100).toFixed(2)}€ (${newPrice.id})`);
      }

      stripePriceId = newPrice.id;
    }
  }

  // === MISE À JOUR STRAPI ===
  await strapi.db.query('api::product.product').update({
    where: { id: product.id },
    data: {
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePriceId,
    },
  });
}

// Pour exécuter dans la console Strapi
syncAllProducts();
