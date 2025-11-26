export default {
  routes: [
    {
      method: "POST",
      path: "/order/checkout",
      handler: "order.checkout",
      config: {
        auth: false,
      },
    },
  ],
};