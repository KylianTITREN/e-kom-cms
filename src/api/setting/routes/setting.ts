export default {
  routes: [
    {
      method: 'GET',
      path: '/setting',
      handler: 'setting.find',
    },
    {
      method: 'PUT',
      path: '/setting',
      handler: 'setting.update',
    },
  ],
};
