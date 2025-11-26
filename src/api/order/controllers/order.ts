import Stripe from "stripe";

export default {
  async checkout(ctx) {
    const { items, merchantId } = ctx.request.body;

    if (!merchantId) {
      ctx.throw(400, "merchantId manquant");
    }

    // On récupère la clé Stripe du marchand
    const merchant = await strapi.db.query("api::merchant.merchant").findOne({
      where: { id: merchantId },
    });

    if (!merchant || !merchant.stripe_secret_key) {
      ctx.throw(400, "Clé Stripe introuvable pour ce marchand");
    }

    const stripe = new Stripe(merchant.stripe_secret_key, {
      apiVersion: '2025-09-30.clover',
    });

    // Préparer les line_items
    const line_items = await Promise.all(
      items.map(async (item) => {
        // Essayer de récupérer le produit Strapi pour obtenir le stripePriceId
        const product = await strapi.documents('api::product.product').findFirst({
          filters: {
            $or: [
              { documentId: item.id },
              { id: item.id },
            ],
          },
        });

        // Si le produit a un stripePriceId, l'utiliser
        if (product?.stripePriceId) {
          console.log(`✅ Utilisation du Price ID Stripe pour "${item.name}": ${product.stripePriceId}`);
          return {
            price: product.stripePriceId,
            quantity: item.quantity,
          };
        }

        // Sinon, créer le price dynamiquement (fallback)
        console.log(`⚠️  Création dynamique du prix pour "${item.name}"`);
        return {
          price_data: {
            currency: "eur",
            product_data: { 
              name: item.name,
              images: item.image ? [item.image] : [],
            },
            unit_amount: Math.round(item.price * 100),
          },
          quantity: item.quantity,
        };
      })
    );

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${process.env.FRONT_URL}/success`,
      cancel_url: `${process.env.FRONT_URL}/cancel`,
    });

    ctx.body = { id: session.id, url: session.url };
  },
};