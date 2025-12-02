import type { Core } from '@strapi/strapi';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Middleware pour conserver le body brut pour les webhooks Stripe
    strapi.server.use(async (ctx, next) => {
      if (ctx.request.url === '/api/webhook/stripe' && ctx.request.method === 'POST') {
        // Stocker le body brut pour la vérification de signature Stripe
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          ctx.req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          ctx.req.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            ctx.request.body[Symbol.for('unparsedBody')] = rawBody;
            resolve();
          });
          ctx.req.on('error', reject);
        });
      }
      await next();
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {},
};
