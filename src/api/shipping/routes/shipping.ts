export default {
  routes: [
    {
      method: "GET",
      path: "/shipping/rates",
      handler: "shipping.getRates",
      config: {
        auth: false, // Public, accessible sans authentification
      },
    },
  ],
};
