import Stripe from "stripe";

export default {
  async checkout(ctx) {
    const { items } = ctx.request.body;

    // Récupérer les paramètres globaux pour la clé Stripe
    const settings = await strapi.documents('api::setting.setting').findFirst();

    if (!settings || !settings.stripeSecretKey) {
      ctx.throw(400, "Clé Stripe non configurée dans les paramètres");
    }

    const stripe = new Stripe(settings.stripeSecretKey, {
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