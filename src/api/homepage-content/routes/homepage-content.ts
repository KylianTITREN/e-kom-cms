export default {
  routes: [
    {
      method: 'GET',
      path: '/homepage-content',
      handler: 'homepage-content.find',
      config: {
        auth: false,
      },
    },
  ],
};
