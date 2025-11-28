
export default ({ env }) => ({
  connection: {
    client: 'prostgres',
    connectionString: env('DATABASE_URL'),
    ssl: false,
  },
  pool: {
    min: 2,
    max: 10,
  },
});
