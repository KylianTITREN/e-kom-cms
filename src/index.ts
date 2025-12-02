import type { Core } from '@strapi/strapi';
import Stripe from 'stripe';
import { emailService } from './services/email';

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
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Middleware pour gérer les webhooks Stripe DIRECTEMENT
    // sans passer par koa-body qui ne peut pas gérer le body brut
    strapi.server.use(async (ctx, next) => {
      if (ctx.request.url === '/api/webhook/stripe' && ctx.request.method === 'POST') {
        const stripe = getStripe();
        const sig = ctx.request.headers["stripe-signature"];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!webhookSecret) {
          console.error("❌ STRIPE_WEBHOOK_SECRET manquante dans .env");
          ctx.status = 500;
          ctx.body = { error: "Configuration serveur manquante" };
          return; // Ne pas appeler next(), on traite directement la requête
        }

        if (!sig) {
          console.error("❌ Signature Stripe manquante");
          ctx.status = 400;
          ctx.body = { error: "Signature manquante" };
          return;
        }

        // Lire le body brut
        const chunks: Buffer[] = [];
        for await (const chunk of ctx.req) {
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks).toString('utf8');

        console.log('✅ Body brut capturé pour webhook Stripe');

        // Vérifier la signature
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(rawBody, sig as string, webhookSecret);
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
            // Récupérer les détails de la session avec les line_items
            const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
              expand: ["line_items", "line_items.data.price.product"],
            });

            const customerEmail = fullSession.customer_details?.email;
            const customerName = fullSession.customer_details?.name || "Client";
            const lineItems = fullSession.line_items?.data || [];
            const shippingAddress = (fullSession as any).shipping_details?.address;

            if (!customerEmail) {
              console.error("❌ Email client manquant");
              ctx.status = 400;
              ctx.body = { error: "Email client manquant" };
              return;
            }

            // Préparer les données pour l'email
            const items = lineItems.map((item: any) => ({
              name: item.description || "Produit",
              quantity: item.quantity || 1,
              price: parseFloat((item.amount_total / 100).toFixed(2)),
            }));

            const total = parseFloat((fullSession.amount_total! / 100).toFixed(2));

            // Générer un numéro de commande court et lisible
            // Format: CMD-YYYYMMDD-XXXXX (ex: CMD-20251202-A3F9E)
            const date = new Date();
            const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
            const randomStr = session.id.slice(-5).toUpperCase(); // Prendre les 5 derniers caractères de l'ID Stripe
            const orderNumber = `CMD-${dateStr}-${randomStr}`;

            // Envoyer l'email de confirmation
            await emailService.sendOrderConfirmation({
              customerEmail,
              customerName,
              orderNumber,
              items,
              total,
              shippingAddress: shippingAddress ? {
                line1: shippingAddress.line1 || "",
                line2: shippingAddress.line2 || "",
                city: shippingAddress.city || "",
                postal_code: shippingAddress.postal_code || "",
                country: shippingAddress.country || "",
              } : undefined,
            });

            console.log(`✅ Webhook Stripe reçu avec succès`);
            console.log(`📧 Email de confirmation envoyé à: ${customerEmail}`);

            ctx.status = 200;
            ctx.body = { received: true };
            return; // Ne pas appeler next()
          } catch (error: any) {
            console.error("❌ Erreur lors du traitement du webhook:", error);
            ctx.status = 500;
            ctx.body = { error: "Erreur lors du traitement" };
            return;
          }
        }

        // Pour les autres types d'événements, retourner 200
        ctx.status = 200;
        ctx.body = { received: true };
        return; // Ne pas appeler next()
      }

      await next();
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {},
};
