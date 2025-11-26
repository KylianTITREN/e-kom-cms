export default {
  routes: [
    {
      method: 'GET',
      path: '/homepage-content',
      handler: 'homepage-content.find',
    },
    {
      method: 'GET',
      path: '/homepage-content/:id',
      handler: 'homepage-content.findOne',
    },
  ],
};
