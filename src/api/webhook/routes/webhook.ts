export default {
  routes: [
    {
      method: "POST",
      path: "/webhook/stripe",
      handler: "webhook.handleStripe",
      config: {
        auth: false, // Pas d'authentification pour les webhooks Stripe
      },
    },
  ],
};
