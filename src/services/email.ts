import { Resend } from "resend";

// Singleton Resend
let resendInstance: Resend | null = null;

const getResend = (): Resend => {
  if (!resendInstance) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY manquante dans .env");
    }
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
};

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface OrderConfirmationData {
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  items: OrderItem[];
  total: number;
  shippingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    postal_code?: string;
    country?: string;
  };
}

export const emailService = {
  /**
   * Envoie un email de confirmation de commande
   */
  async sendOrderConfirmation(data: OrderConfirmationData): Promise<void> {
    try {
      const resend = getResend();

      // Formater l'expéditeur avec le nom si disponible
      const fromName = process.env.EMAIL_FROM_NAME || "E-commerce";
      const fromEmail = process.env.EMAIL_FROM || "noreply@votre-domaine.com";
      const fromFormatted = `${fromName} <${fromEmail}>`;

      const emailHtml = generateOrderConfirmationHtml(data);

      const result = await resend.emails.send({
        from: fromFormatted,
        to: data.customerEmail,
        subject: `Confirmation de commande #${data.orderNumber}`,
        html: emailHtml,
      });

      console.log("✅ Email envoyé avec succès:", result);
    } catch (error: any) {
      console.error("❌ Erreur lors de l'envoi de l'email:", error);
      throw new Error(`Échec d'envoi de l'email: ${error.message}`);
    }
  },
};

/**
 * Génère le HTML de l'email de confirmation
 */
function generateOrderConfirmationHtml(data: OrderConfirmationData): string {
  const itemsHtml = data.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 14px 12px; border-bottom: 1px solid #e0e0e0; color: #2c3e50; font-size: 15px;">
        ${item.name}
      </td>
      <td style="padding: 14px 12px; border-bottom: 1px solid #e0e0e0; text-align: center; color: #2c3e50; font-size: 15px;">
        ${item.quantity}
      </td>
      <td style="padding: 14px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; color: #2c3e50; font-size: 15px; font-weight: 500;">
        ${(item.price * item.quantity).toFixed(2)} €
      </td>
    </tr>
  `
    )
    .join("");

  const shippingHtml = data.shippingAddress
    ? `
    <!-- Adresse de livraison -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 25px;">
      <tr>
        <td style="padding: 25px; background-color: #f8f9fa; border-radius: 6px; border-left: 3px solid #2c3e50;">
          <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            Adresse de livraison
          </h3>
          <div style="color: #34495e; font-size: 15px; line-height: 1.7;">
            ${data.shippingAddress.line1 || ""}<br>
            ${data.shippingAddress.line2 ? data.shippingAddress.line2 + "<br>" : ""}
            ${data.shippingAddress.postal_code || ""} ${data.shippingAddress.city || ""}<br>
            ${data.shippingAddress.country || ""}
          </div>
        </td>
      </tr>
    </table>
  `
    : "";

  return `
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirmation de commande</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; line-height: 1.6;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
          <tr>
            <td align="center">
              <!-- Container principal -->
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);">

                <!-- Header sobre -->
                <tr>
                  <td style="background-color: #2c3e50; padding: 35px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">
                      Commande Confirmée
                    </h1>
                    <p style="margin: 8px 0 0 0; color: #bdc3c7; font-size: 14px;">
                      Commande #${data.orderNumber}
                    </p>
                  </td>
                </tr>

                <!-- Contenu -->
                <tr>
                  <td style="padding: 40px 30px;">

                    <!-- Message d'accueil -->
                    <p style="margin: 0 0 10px 0; color: #2c3e50; font-size: 16px; font-weight: 500;">
                      Bonjour ${data.customerName},
                    </p>
                    <p style="margin: 0 0 30px 0; color: #34495e; font-size: 15px; line-height: 1.7;">
                      Merci pour votre commande ! Nous avons bien reçu votre paiement et votre commande est en cours de traitement. Vous recevrez un email de confirmation d'expédition dès que votre colis sera envoyé.
                    </p>

                    <!-- Récapitulatif de la commande -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                      <tr>
                        <td style="padding: 25px; background-color: #f8f9fa; border-radius: 6px; border-left: 3px solid #2c3e50;">
                          <h2 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 16px; font-weight: 600;">
                            Récapitulatif de votre commande
                          </h2>

                          <!-- Tableau des produits -->
                          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 4px; overflow: hidden; border: 1px solid #e0e0e0;">
                            <thead>
                              <tr style="background-color: #f8f9fa;">
                                <th style="padding: 12px; text-align: left; color: #7f8c8d; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e0e0e0;">
                                  Produit
                                </th>
                                <th style="padding: 12px; text-align: center; color: #7f8c8d; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e0e0e0;">
                                  Qté
                                </th>
                                <th style="padding: 12px; text-align: right; color: #7f8c8d; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e0e0e0;">
                                  Prix
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              ${itemsHtml}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colspan="2" style="padding: 18px 12px; text-align: right; color: #2c3e50; font-weight: 600; font-size: 16px; background-color: #f8f9fa;">
                                  Total :
                                </td>
                                <td style="padding: 18px 12px; text-align: right; color: #2c3e50; font-weight: 600; font-size: 16px; background-color: #f8f9fa;">
                                  ${data.total.toFixed(2)} €
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </td>
                      </tr>
                    </table>

                    ${shippingHtml}

                    <!-- Message de remerciement -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 30px;">
                      <tr>
                        <td style="padding: 20px; background-color: #ffffff; border-radius: 6px; border: 1px solid #e0e0e0; text-align: center;">
                          <p style="margin: 0; color: #34495e; font-size: 15px; line-height: 1.7;">
                            Si vous avez des questions concernant votre commande, n'hésitez pas à nous contacter.
                          </p>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                    <p style="margin: 0 0 6px 0; color: #7f8c8d; font-size: 13px;">
                      Commande passée le ${new Date().toLocaleDateString('fr-FR', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                    <p style="margin: 0; color: #95a5a6; font-size: 12px;">
                      © ${new Date().getFullYear()} Votre E-commerce. Tous droits réservés.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}
