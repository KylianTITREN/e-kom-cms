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
    console.log("🔔 ========================================");
    console.log("🔔 WEBHOOK REÇU - Début du traitement");
    console.log("🔔 ========================================");

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
          expand: ["line_items.data.price.product", "shipping_cost", "shipping_details"],
        });

        const lineItems = fullSession.line_items?.data || [];
        const customerEmail = fullSession.customer_details?.email;
        const customerName = fullSession.customer_details?.name || "Client";

        // Récupérer l'adresse de livraison
        const shippingAddress = (fullSession as any).shipping_details?.address || fullSession.customer_details?.address;

        console.log("📦 Adresse de livraison:", shippingAddress);

        if (!customerEmail) {
          console.error("❌ Email client manquant dans la session");
          ctx.status = 200; // On retourne 200 pour ne pas que Stripe réessaie
          ctx.body = { received: true, warning: "Email manquant" };
          return;
        }

        // Préparer les items pour l'email
        const items = lineItems.map((item, index) => {
          console.log(`\n🔍 === Traitement item ${index + 1} ===`);

          const product = item.price?.product as Stripe.Product | undefined;
          const productName = product?.name || item.description || "Produit";

          console.log("📦 Nom du produit:", productName);
          console.log("📦 Type de produit:", typeof product);
          console.log("📦 Produit complet:", JSON.stringify(product, null, 2));

          // Extraire les infos de gravure depuis les metadata du produit
          let info: string | undefined;
          if (productName.includes("[Gravure]")) {
            console.log("✍️  C'est une gravure, extraction des metadata...");
            console.log("📋 Metadata du produit:", product?.metadata);

            if (product?.metadata) {
              const parts: string[] = [];
              if (product.metadata.Texte) {
                console.log("✅ Texte trouvé:", product.metadata.Texte);
                parts.push(`Texte: "${product.metadata.Texte}"`);
              } else {
                console.log("❌ Pas de texte dans metadata");
              }
              if (product.metadata.Logo) {
                console.log("✅ Logo trouvé:", product.metadata.Logo);
                const logoFileName = product.metadata.Logo.split('/').pop() || 'logo';
                parts.push(`Logo: ${logoFileName}`);
              } else {
                console.log("❌ Pas de logo dans metadata");
              }
              info = parts.length > 0 ? parts.join(' | ') : undefined;
              console.log("📝 Info finale générée:", info);
            } else {
              console.log("❌ Pas de metadata du tout sur le produit");
            }
          }

          const itemData = {
            name: productName,
            quantity: item.quantity || 1,
            price: (item.amount_total || 0) / 100 / (item.quantity || 1),
            info,
          };

          console.log("✅ ItemData final:", JSON.stringify(itemData, null, 2));
          return itemData;
        });

        const total = (fullSession.amount_total || 0) / 100;

        console.log("📊 Items total:", items);
        console.log("💰 Total commande:", total);

        // Récupérer l'URL de la facture si disponible
        let invoiceUrl: string | undefined;
        if (fullSession.invoice) {
          try {
            const invoiceId = typeof fullSession.invoice === 'string' ? fullSession.invoice : fullSession.invoice.id;
            const invoice = await stripe.invoices.retrieve(invoiceId);
            invoiceUrl = invoice.invoice_pdf || undefined;
            console.log("📄 URL de la facture:", invoiceUrl);
          } catch (error) {
            console.warn("⚠️  Impossible de récupérer la facture");
          }
        }

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
          invoiceUrl,
        });

        console.log(`✅ Email de confirmation envoyé à ${customerEmail}`);
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
