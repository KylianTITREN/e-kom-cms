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

    const stripe = new Stripe(merchant.stripe_secret_key);

    const line_items = items.map((i) => ({
      price_data: {
        currency: "eur",
        product_data: { name: i.name },
        unit_amount: Math.round(i.price * 100),
      },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${process.env.FRONT_URL}/success`,
      cancel_url: `${process.env.FRONT_URL}/cancel`,
    });

    ctx.body = { id: session.id, url: session.url };
  },
};