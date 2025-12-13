import Stripe from "stripe";

// Singleton Stripe
let stripeInstance: Stripe | null = null;

const getStripe = (): Stripe => {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY manquante dans .env");
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-09-30.clover",
    });
  }
  return stripeInstance;
};

export default {
  /**
   * Récupère les shipping rates depuis Stripe
   * pour afficher les infos dans le panier
   */
  async getRates(ctx) {
    try {
      const stripe = getStripe();

      // Récupérer tous les shipping rates actifs
      const shippingRates = await stripe.shippingRates.list({
        active: true,
        limit: 100,
      });

      // Transformer les données pour le front
      const rates = shippingRates.data.map((rate) => ({
        id: rate.id,
        displayName: rate.display_name,
        type: rate.type, // "fixed_amount"
        fixedAmount: rate.fixed_amount ? {
          amount: rate.fixed_amount.amount / 100, // Convertir en euros
          currency: rate.fixed_amount.currency,
        } : null,
        // Récupérer le seuil de livraison gratuite depuis les metadata si configuré
        freeShippingThreshold: rate.metadata?.free_shipping_threshold
          ? parseFloat(rate.metadata.free_shipping_threshold)
          : null,
        deliveryEstimate: rate.delivery_estimate ? {
          minimum: rate.delivery_estimate.minimum,
          maximum: rate.delivery_estimate.maximum,
        } : null,
        metadata: rate.metadata,
      }));

      console.log(`✅ ${rates.length} shipping rates récupérés depuis Stripe`);

      ctx.body = {
        rates,
      };
    } catch (error: any) {
      console.error("❌ Erreur lors de la récupération des shipping rates:", error);
      ctx.status = 500;
      ctx.body = {
        error: "Impossible de récupérer les tarifs de livraison",
        message: error.message,
      };
    }
  },
};
