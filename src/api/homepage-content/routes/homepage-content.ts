module.exports = {
  routes: [
    { method: 'GET', path: '/homepage-content', handler: 'homepage-content.find' },
    { method: 'PUT', path: '/homepage-content', handler: 'homepage-content.update' },
  ],
};
