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

        console.log("🔔 ========================================");
        console.log("🔔 WEBHOOK REÇU - Début du traitement");
        console.log("🔔 ========================================");
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
            // L'adresse de livraison se trouve dans collected_information.shipping_details.address
            const shippingAddress = (fullSession as any).collected_information?.shipping_details?.address;

            console.log("📦 Adresse de livraison:", shippingAddress ? `${shippingAddress.line1}, ${shippingAddress.city}` : "Non fournie");
            console.log("📋 Metadata de la session:", fullSession.metadata ? Object.keys(fullSession.metadata).join(", ") : "Aucune");

            if (!customerEmail) {
              console.error("❌ Email client manquant");
              ctx.status = 400;
              ctx.body = { error: "Email client manquant" };
              return;
            }

            // Extraire les infos de gravure depuis les metadata de la session
            const engravingMetadata: Record<string, { text?: string; logo?: string }> = {};
            const nbGravures = parseInt(fullSession.metadata?.["Nombre de gravures"] || "0", 10);

            console.log(`📝 Nombre de gravures détecté: ${nbGravures}`);

            for (let i = 1; i <= nbGravures; i++) {
              const prefix = `Gravure ${i}`;
              const productName = fullSession.metadata?.[`${prefix} pour produit`];
              const text = fullSession.metadata?.[`${prefix} avec texte`];
              const logo = fullSession.metadata?.[`${prefix} avec logo`];

              if (productName) {
                engravingMetadata[productName] = {
                  text: text || undefined,
                  logo: logo || undefined,
                };
                console.log(`✍️  Gravure ${i} pour "${productName}":`, engravingMetadata[productName]);
              }
            }

            // Préparer les données pour l'email
            const items = lineItems.map((item: any, index: number) => {
              console.log(`\n🔍 === Item ${index + 1} ===`);

              const product = item.price?.product as Stripe.Product | undefined;
              const productName = product?.name || item.description || "Produit";

              console.log("📦 Nom:", productName);

              // Pour les gravures, construire l'info depuis les metadata
              let info: string | undefined;
              if (productName.includes("[Gravure]")) {
                console.log("✍️  C'est une gravure, recherche dans les metadata de la session...");

                // Trouver le produit associé dans les metadata
                for (const gravureData of Object.values(engravingMetadata)) {
                  const parts: string[] = [];
                  if (gravureData.text) {
                    parts.push(`Texte: "${gravureData.text}"`);
                  }
                  if (gravureData.logo) {
                    const logoFileName = gravureData.logo.split('/').pop() || 'logo';
                    parts.push(`Logo: ${logoFileName}`);
                  }

                  if (parts.length > 0) {
                    info = parts.join(' | ');
                    console.log("✅ Info gravure construite:", info);
                    break;
                  }
                }
              }

              const itemData = {
                name: productName,
                quantity: item.quantity || 1,
                price: parseFloat((item.amount_total / 100 / (item.quantity || 1)).toFixed(2)),
                info,
              };

              console.log("✅ ItemData:", `${itemData.name} x${itemData.quantity} - ${itemData.price}€${itemData.info ? ' (' + itemData.info + ')' : ''}`);
              return itemData;
            });

            // Calculer le sous-total (produits uniquement)
            const subtotal = parseFloat((fullSession.amount_subtotal! / 100).toFixed(2));

            // Frais de livraison
            const shippingCost = fullSession.total_details?.amount_shipping
              ? parseFloat((fullSession.total_details.amount_shipping / 100).toFixed(2))
              : 0;

            // Total général
            const total = parseFloat((fullSession.amount_total! / 100).toFixed(2));

            console.log(`📊 Sous-total: ${subtotal.toFixed(2)}€ | Livraison: ${shippingCost.toFixed(2)}€ | Total: ${total.toFixed(2)}€`);

            // Générer un numéro de commande court et lisible
            // Format: CMD-YYYYMMDD-XXXXX (ex: CMD-20251202-A3F9E)
            const date = new Date();
            const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
            const randomStr = session.id.slice(-5).toUpperCase(); // Prendre les 5 derniers caractères de l'ID Stripe
            const orderNumber = `CMD-${dateStr}-${randomStr}`;

            // Récupérer la facture générée automatiquement par Stripe
            let invoiceUrl: string | undefined;
            try {
              // L'invoice est créée automatiquement grâce à invoice_creation dans la session
              // On la récupère via la session
              const sessionWithInvoice = await stripe.checkout.sessions.retrieve(session.id, {
                expand: ["invoice"],
              });

              if (sessionWithInvoice.invoice) {
                const invoice = sessionWithInvoice.invoice as any;
                // URL pour télécharger le PDF de la facture
                invoiceUrl = invoice.invoice_pdf;
                console.log(`📄 Facture trouvée: ${invoice.id}`);
              } else {
                console.warn("⚠️  Aucune facture trouvée pour cette session");
              }
            } catch (error: any) {
              console.error("❌ Erreur lors de la récupération de la facture:", error.message);
              // Continuer même si la facture n'est pas disponible
            }

            // Envoyer l'email de confirmation avec la facture en pièce jointe
            await emailService.sendOrderConfirmation({
              customerEmail,
              customerName,
              orderNumber,
              items,
              subtotal,
              shippingCost,
              total,
              shippingAddress: shippingAddress ? {
                line1: shippingAddress.line1 || "",
                line2: shippingAddress.line2 || "",
                city: shippingAddress.city || "",
                postal_code: shippingAddress.postal_code || "",
                country: shippingAddress.country || "",
              } : undefined,
              invoiceUrl, // Ajouter l'URL de la facture
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
