
export default ({ env }) => ({
  postgres: {
    connection: {
      connectionString: env('DATABASE_URL'),
      ssl: false,
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
});
