import Stripe from "stripe";

// Singleton Stripe - créé une seule fois
let stripeInstance: Stripe | null = null;

const getStripe = (): Stripe => {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY manquante dans .env");
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-09-30.clover", // Version Stripe actuelle
    });
  }
  return stripeInstance;
};

export default {
  async checkout(ctx) {
    try {
      const { items } = ctx.request.body;

      // Validation des items
      if (!items || !Array.isArray(items) || items.length === 0) {
        ctx.status = 400;
        ctx.body = { error: "Le panier est vide" };
        return;
      }

      const stripe = getStripe();

      // Préparer les line_items avec validation
      const line_items = await Promise.all(
        items.map(async (item) => {
          // Validation de l'item
          if (!item.id || !item.name || !item.price || !item.quantity) {
            throw new Error(`Item invalide: ${JSON.stringify(item)}`);
          }

          if (item.price <= 0) {
            throw new Error(`Prix invalide pour "${item.name}": ${item.price}`);
          }

          if (item.quantity <= 0 || item.quantity > 99) {
            throw new Error(`Quantité invalide pour "${item.name}": ${item.quantity}`);
          }

          // Essayer de récupérer le produit Strapi pour obtenir le stripePriceId
          let product: any = null;
          try {
            // Tenter conversion en number, sinon utiliser l'ID tel quel
            const productId = !isNaN(Number(item.id)) ? Number(item.id) : item.id;
            product = await strapi.db.query("api::product.product").findOne({
              where: { id: productId },
              select: ["stripePriceId"],
            });
          } catch (error: any) {
            console.warn(`⚠️  Produit non trouvé dans Strapi (ID: ${item.id}):`, error.message);
          }

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
                description: item.description || undefined,
                images: item.image ? [item.image] : undefined,
              },
              unit_amount: Math.round(item.price * 100), // Convertir en centimes
            },
            quantity: item.quantity,
          };
        })
      );

      // Créer la session Stripe avec metadata
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        success_url: `${process.env.FRONT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONT_URL}/cancel`,
        metadata: {
          source: "e-kom-front",
          timestamp: new Date().toISOString(),
          items_count: items.length,
        },
        // Options de paiement
        payment_method_types: ["card"],
        billing_address_collection: "required",
        shipping_address_collection: {
          allowed_countries: ["FR", "BE", "CH", "LU", "MC"],
        },
        // Langue et devise
        locale: "fr",
        currency: "eur",
        // Expire après 30 minutes
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      });

      console.log(`✅ Session Stripe créée: ${session.id}`);
      ctx.body = { id: session.id, url: session.url };
    } catch (error: any) {
      console.error("❌ Erreur lors de la création de la session Stripe:", error);

      ctx.status = 500;
      ctx.body = {
        error: "Erreur lors de la création de la session de paiement",
        message: error?.message || "Erreur inconnue",
      };
    }
  },
};
