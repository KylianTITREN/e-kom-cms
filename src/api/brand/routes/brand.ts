import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::brand.brand', {
  config: {
    find: {
      auth: false,
    },
    findOne: {
      auth: false,
    },
  },
});
