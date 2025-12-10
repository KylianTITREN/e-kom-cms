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

      // VALIDATION : Vérifier que tous les produits existent et sont à jour
      const validationErrors = [];

      for (const item of items) {
        // Validation de base
        if (!item.id || !item.name || !item.price || !item.quantity) {
          validationErrors.push(`Produit invalide dans le panier`);
          continue;
        }

        // Récupérer le produit actuel depuis Strapi
        try {
          const productId = !isNaN(Number(item.id)) ? Number(item.id) : item.id;
          const currentProduct = await strapi.db.query("api::product.product").findOne({
            where: { id: productId },
            select: ["id", "name", "price", "publishedAt"],
            populate: ["engravings"],
          });

          // Vérifier que le produit existe toujours
          if (!currentProduct) {
            validationErrors.push(`Le produit "${item.name}" n'est plus disponible`);
            continue;
          }

          // Vérifier que le produit est toujours publié
          if (!currentProduct.publishedAt) {
            validationErrors.push(`Le produit "${item.name}" n'est plus disponible`);
            continue;
          }

          // Vérifier que le prix n'a pas changé
          if (Math.abs(currentProduct.price - item.price) > 0.01) {
            validationErrors.push(
              `Le prix de "${item.name}" a changé (${item.price.toFixed(2)}€ → ${currentProduct.price.toFixed(2)}€)`
            );
            continue;
          }

          // Si gravure sélectionnée, vérifier qu'elle existe toujours et que son prix est correct
          if (item.engraving) {
            const currentEngraving = await strapi.db.query("api::engraving.engraving").findOne({
              where: { documentId: item.engraving.type },
              select: ["id", "title", "price", "publishedAt"],
            });

            if (!currentEngraving) {
              validationErrors.push(`L'option de gravure "${item.engraving.label}" n'est plus disponible`);
              continue;
            }

            if (!currentEngraving.publishedAt) {
              validationErrors.push(`L'option de gravure "${item.engraving.label}" n'est plus disponible`);
              continue;
            }

            if (Math.abs(currentEngraving.price - item.engraving.price) > 0.01) {
              validationErrors.push(
                `Le prix de la gravure "${item.engraving.label}" a changé (${item.engraving.price.toFixed(2)}€ → ${currentEngraving.price.toFixed(2)}€)`
              );
              continue;
            }
          }
        } catch (error: any) {
          console.error(`❌ Erreur validation produit ${item.id}:`, error.message);
          validationErrors.push(`Erreur lors de la validation du produit "${item.name}"`);
        }
      }

      // Si des erreurs de validation, renvoyer une erreur 409 (Conflict)
      if (validationErrors.length > 0) {
        console.warn(`⚠️  Validation panier échouée:`, validationErrors);
        ctx.status = 409;
        ctx.body = {
          error: "cart_outdated",
          message: "Votre panier n'est plus à jour. Veuillez le vider et recommencer.",
          details: validationErrors,
        };
        return;
      }

      // Préparer les line_items
      const line_items_promises = items.map(async (item) => {
        const lineItems = [];

        // Récupérer le produit Strapi pour obtenir le stripePriceId
        const productId = !isNaN(Number(item.id)) ? Number(item.id) : item.id;
        const product = await strapi.db.query("api::product.product").findOne({
          where: { id: productId },
          select: ["stripePriceId"],
        });

        // Si le produit a un stripePriceId, l'utiliser
        if (product?.stripePriceId) {
          console.log(`✅ Utilisation du Price ID Stripe pour "${item.name}": ${product.stripePriceId}`);
          lineItems.push({
            price: product.stripePriceId,
            quantity: item.quantity,
          });
        } else {
          // Sinon, créer le price dynamiquement (fallback)
          console.log(`⚠️  Création dynamique du prix pour "${item.name}"`);
          lineItems.push({
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
          });
        }

        // Ajouter un line_item pour la gravure si présente
        if (item.engraving) {
          console.log(`✍️  Ajout de gravure pour "${item.name}": ${item.engraving.label}`);

          // Construire la description détaillée
          const descriptionParts = [];
          if (item.engraving.text) {
            descriptionParts.push(`Texte: "${item.engraving.text}"`);
          }
          if (item.engraving.logoUrl) {
            const logoFileName = item.engraving.logoUrl.split('/').pop() || 'logo';
            descriptionParts.push(`Logo: ${logoFileName}`);
          }

          // Toujours utiliser price_data pour la gravure (permet description personnalisée par commande)
          console.log(`✅ Création gravure dynamique`);
          lineItems.push({
            price_data: {
              currency: "eur",
              unit_amount: Math.round(item.engraving.price * 100),
              product_data: {
                name: `[Gravure] ${item.engraving.label}`,
                metadata: {
                  "Texte": item.engraving.text || "",
                  "Logo": item.engraving.logoUrl || "",
                },
              },
            },
            quantity: item.quantity,
          });
        }

        return lineItems;
      });

      const line_items_nested = await Promise.all(line_items_promises);
      const line_items = line_items_nested.flat();

      // Préparer les metadata avec infos de gravure
      const engravingInfo = items
        .filter(item => item.engraving)
        .map(item => ({
          product: item.name,
          type: item.engraving.label,
          text: item.engraving.text || "",
          logoUrl: item.engraving.logoUrl || "",
        }));

      const sessionMetadata: Record<string, string> = {
        "Nombre de gravures": String(engravingInfo.length),
      };

      engravingInfo.forEach((engraving, index) => {
        const prefix = `Gravure ${index + 1}`;
        sessionMetadata[`${prefix} pour produit`] = engraving.product;
        sessionMetadata[`${prefix} de type`] = engraving.type;
        if (engraving.text) {
          sessionMetadata[`${prefix} avec texte`] = engraving.text;
        }
        if (engraving.logoUrl) {
          sessionMetadata[`${prefix} avec logo`] = engraving.logoUrl;
        }
      });

      // Créer la session Stripe avec metadata
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        success_url: `${process.env.FRONT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONT_URL}/cancel`,
        metadata: sessionMetadata,
        // Options de paiement - MODIFIEZ ICI pour ajouter d'autres moyens de paiement
        payment_method_types: [
          "card",           // Cartes bancaires (Visa, Mastercard, Amex)
          // "paypal",      // PayPal (nécessite compte PayPal Business + activation Stripe Dashboard)
          // "klarna",      // Klarna (paiement en plusieurs fois)
          // "bancontact",  // Bancontact (Belgique)
          // "ideal",       // iDEAL (Pays-Bas)
          // "link",        // Link by Stripe (paiement rapide)
        ],
        // Apple Pay s'active automatiquement si:
        // 1. Activé dans Stripe Dashboard (Settings > Payment methods > Apple Pay)
        // 2. Domaine vérifié en HTTPS
        // 3. Navigateur compatible (Safari, Chrome sur iOS, etc.)
        billing_address_collection: "required",
        shipping_address_collection: {
          allowed_countries: ["FR", "BE", "CH", "LU", "MC"],
        },
        // Codes promo activés
        allow_promotion_codes: true,
        // Langue et devise
        locale: "fr",
        currency: "eur",
        // Expire après 30 minutes
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        // FACTURATION AUTOMATIQUE
        invoice_creation: {
          enabled: true,
          invoice_data: {
            description: `Commande ${process.env.SHOP_NAME || "e-kom"}`,
            metadata: sessionMetadata,
            rendering_options: {
              amount_tax_display: "include_inclusive_tax", // Afficher TTC
            },
          },
        },
        // Récupérer l'email du client pour la facture
        customer_email: items[0]?.customerEmail, // Ajoutez ceci si vous avez l'email
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
