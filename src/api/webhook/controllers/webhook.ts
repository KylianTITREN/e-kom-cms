import Stripe from "stripe";
import { emailService } from "../../../services/email";

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
  async handleStripe(ctx) {
    const stripe = getStripe();
    const sig = ctx.request.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("❌ STRIPE_WEBHOOK_SECRET manquante dans .env");
      ctx.status = 500;
      ctx.body = { error: "Configuration serveur manquante" };
      return;
    }

    if (!sig) {
      console.error("❌ Signature Stripe manquante");
      ctx.status = 400;
      ctx.body = { error: "Signature manquante" };
      return;
    }

    let event: Stripe.Event;

    try {
      // Vérifier la signature du webhook
      event = stripe.webhooks.constructEvent(
        ctx.request.body[Symbol.for("unparsedBody")], // Body brut nécessaire pour la signature
        sig,
        webhookSecret
      );
    } catch (err: any) {
      console.error("❌ Erreur de signature webhook:", err.message);
      ctx.status = 400;
      ctx.body = { error: `Webhook Error: ${err.message}` };
      return;
    }

    console.log(`📥 Webhook reçu: ${event.type}`);

    // Gérer l'événement checkout.session.completed
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      try {
        // Récupérer les détails complets de la session avec les line_items
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ["line_items.data.price.product"],
        });

        const lineItems = fullSession.line_items?.data || [];
        const customerEmail = fullSession.customer_details?.email;
        const customerName = fullSession.customer_details?.name || "Client";
        const shippingAddress = fullSession.shipping_details?.address;

        if (!customerEmail) {
          console.error("❌ Email client manquant dans la session");
          ctx.status = 200; // On retourne 200 pour ne pas que Stripe réessaie
          ctx.body = { received: true, warning: "Email manquant" };
          return;
        }

        // Préparer les items pour l'email
        const items = lineItems.map((item) => {
          const product = item.price?.product as Stripe.Product | undefined;
          return {
            name: product?.name || item.description || "Produit",
            quantity: item.quantity || 1,
            price: (item.amount_total || 0) / 100 / (item.quantity || 1), // Convertir en euros
          };
        });

        const total = (fullSession.amount_total || 0) / 100;

        // Envoyer l'email de confirmation
        await emailService.sendOrderConfirmation({
          customerEmail,
          customerName,
          orderNumber: session.id.substring(session.id.length - 8).toUpperCase(),
          items,
          total,
          shippingAddress: shippingAddress
            ? {
                line1: shippingAddress.line1 || undefined,
                line2: shippingAddress.line2 || undefined,
                city: shippingAddress.city || undefined,
                postal_code: shippingAddress.postal_code || undefined,
                country: shippingAddress.country || undefined,
              }
            : undefined,
        });

        console.log(`✅ Email de confirmation envoyé à ${customerEmail}`);

        // TODO: Créer une entrée "Order" dans Strapi si nécessaire
        // await strapi.db.query("api::order.order").create({
        //   data: {
        //     stripeSessionId: session.id,
        //     customerEmail,
        //     items,
        //     total,
        //     status: "paid",
        //   },
        // });
      } catch (error: any) {
        console.error("❌ Erreur lors du traitement du webhook:", error);
        // On retourne 200 quand même pour éviter que Stripe réessaie indéfiniment
        ctx.status = 200;
        ctx.body = { received: true, error: error.message };
        return;
      }
    }

    // Répondre à Stripe pour confirmer la réception
    ctx.status = 200;
    ctx.body = { received: true };
  },
};
