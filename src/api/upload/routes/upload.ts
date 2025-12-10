export default {
  routes: [
    {
      method: 'POST',
      path: '/upload/engraving-logo',
      handler: 'upload.uploadEngravingLogo',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
